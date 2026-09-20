import type { ScanLiveState, ScanPin } from "@memory-glasses/shared";
import type { Group, Object3D } from "three";
import { ApiError, apiFetch } from "@/lib/client/api";
import type { Engine } from "./engine";
import { createPinFeed, putPin, withPin } from "./pins";
import { DEFAULT_FRAME_ASPECT, observationRay, pointAlong } from "./rays";
import type { LiveCameras, LiveSceneState, PinVisual, PosedCamera, Vec3, ViewerEvents, ViewerHandle } from "./types";

const STATE_POLL_MS = 2000;
const PIN_POLL_MS = 3000;
/** With no splat to hit, a pin waits this long before it settles for a point along its ray. */
const NO_SPLAT_GRACE_MS = 15_000;

type SplatObject = Object3D & { dispose(): void; context: { numSplats: { value: number } } };

/** Cameras further than this many radii from the middle are SLAM strays: not framed, not drawn. */
const STRAY_RADII = 3;

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/**
 * The middle and size of the capture from the camera positions themselves. splat-slam's own
 * target and spread are means, and one pose thrown far off drags the whole view after it.
 */
function captureBounds(cameras: PosedCamera[]): { centre: Vec3; radius: number } {
  const centre = [0, 1, 2].map((axis) => median(cameras.map((camera) => camera.position[axis]))) as Vec3;
  const reach = cameras
    .map((camera) => Math.hypot(...camera.position.map((value, axis) => value - centre[axis])))
    .sort((a, b) => a - b);
  return { centre, radius: Math.max(reach[Math.floor(reach.length * 0.8)], 1e-3) };
}

/**
 * A growing splat-slam scene, after splat-slam's web/live.js: poll the state, load each new splat
 * version and swap it in once it has initialised, redraw the camera path when the map grows.
 * It also turns observations into positions, which is the one thing only a viewer can do, because
 * only a viewer holds the splat to cast the ray against.
 */
export async function createLiveViewer(
  engine: Engine,
  events: ViewerEvents,
  focusItemId: string | undefined,
): Promise<ViewerHandle> {
  const { THREE } = engine;
  const spark = await import("@sparkjsdev/spark");
  const sparkRenderer = new spark.SparkRenderer({ renderer: engine.renderer });
  engine.scene.add(sparkRenderer);

  let disposed = false;
  let timer: number | undefined;
  let sceneId: string | null = null;
  let scene: LiveSceneState | null = null;
  let cams: LiveCameras | null = null;
  let bounds: { centre: Vec3; radius: number } | null = null;
  let camsAt = 0;
  let byFile = new Map<string, PosedCamera>();
  let mapVersion = -1;
  let framed = false;
  let firstUp: Vec3 | null = null;
  let splat: SplatObject | null = null;
  let splatFile: string | null = null;
  let loading: string | null = null;
  let pins: ScanPin[] = [];
  let focusPending = focusItemId ?? null;
  /** `${itemId}|${frame}` of every observation already sent for a position. */
  const attempted = new Set<string>();

  const path: Group = new THREE.Group();
  path.renderOrder = 10;
  engine.scene.add(path);

  function clearPath() {
    for (const child of [...path.children]) {
      const line = child as import("three").Line;
      line.geometry.dispose();
      (line.material as import("three").Material).dispose();
      path.remove(child);
    }
  }

  function line(points: Vec3[], color: number, opacity: number, closed = false) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(...point)));
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
    path.add(closed ? new THREE.LineLoop(geometry, material) : new THREE.Line(geometry, material));
  }

  function rayFor(camera: PosedCamera, u: number, v: number) {
    const frame = cams!;
    return observationRay({
      position: camera.position,
      forward: camera.forward,
      up: camera.up ?? frame.up,
      fovYDeg: camera.fov_y_deg ?? frame.fov_y_deg,
      aspect: camera.aspect ?? frame.aspect ?? DEFAULT_FRAME_ASPECT,
      u,
      v,
    });
  }

  /** A point SLAM threw far outside the capture. A ray from there lands nowhere useful. */
  function isStray(point: Vec3) {
    const { centre, radius } = bounds!;
    return Math.hypot(...point.map((value, axis) => value - centre[axis])) > radius * STRAY_RADII;
  }

  function drawPath() {
    clearPath();
    if (!cams || !bounds || cams.cameras.length < 2) return;
    const { radius } = bounds;
    const near = cams.cameras.filter((camera) => !isStray(camera.position));
    line(near.map((camera) => camera.position), 0x9aa3b5, 0.8);
    // The newest camera as a small frustum.
    const newest = cams.cameras[cams.cameras.length - 1];
    const depth = radius * 0.25;
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => pointAlong(rayFor(newest, u, v), depth));
    line(corners, 0xffffff, 1, true);
    for (const corner of corners) line([newest.position, corner], 0xffffff, 1);
  }

  function frameHome() {
    if (!cams || !bounds) return;
    const target = new THREE.Vector3(...bounds.centre);
    // The first map's up is kept: a changed up makes the engine rebuild its orbit controls,
    // which would drop a drag each time the map grows.
    firstUp ??= new THREE.Vector3(...cams.up).normalize().toArray() as Vec3;
    const up = new THREE.Vector3(...firstUp);
    // Above and behind the capture, looking down at the whole path.
    const reach = bounds.radius * 2.4;
    const back = new THREE.Vector3(...cams.cameras[0].position).sub(target).setLength(reach);
    const position = target.clone().addScaledVector(up, reach * 0.8).add(back);
    engine.setFrame({ up: firstUp, centre: bounds.centre, scale: bounds.radius });
    engine.setHome(position.toArray() as Vec3, bounds.centre, !framed);
    framed = true;
  }

  function forgetScene() {
    cams = null;
    bounds = null;
    byFile = new Map();
    mapVersion = -1;
    framed = false;
    firstUp = null;
    splatFile = null;
    loading = null;
    pins = [];
    attempted.clear();
    clearPath();
    if (splat) {
      engine.scene.remove(splat);
      splat.dispose();
      splat = null;
    }
    engine.setPins([]);
    events.onPins([]);
  }

  async function loadSplat(file: string, forScene: string) {
    // state.splat is "splat/v0003.spz"; the route takes the bare file name.
    const name = file.split("/").pop() ?? file;
    const url = `/api/scan/live/scenes/${encodeURIComponent(forScene)}/splat/${encodeURIComponent(name)}`;
    const mesh = new spark.SplatMesh({ url }) as unknown as SplatObject & { initialized: Promise<unknown> };
    loading = file;
    try {
      await mesh.initialized;
    } catch (error) {
      if (loading === file) loading = null;
      events.onNotice(`Splat ${name} did not load: ${error instanceof Error ? error.message : "unknown error"}`);
      return;
    }
    if (disposed || forScene !== sceneId) return mesh.dispose();
    engine.scene.add(mesh);
    if (splat) {
      engine.scene.remove(splat);
      splat.dispose();
    }
    splat = mesh;
    splatFile = file;
    loading = null;
    showPins();
  }

  /**
   * Spark only learns a mesh's splat count in SplatMesh.update(), which runs during a render.
   * Before that a raycast walks zero splats and always misses.
   */
  const splatReady = () => splat !== null && splat.context.numSplats.value > 0;

  /** Where the ray lands in the splat, else half the capture's radius along it. */
  function solve(ray: { origin: Vec3; direction: Vec3 }): Vec3 {
    const { radius } = bounds!;
    if (splat && splatReady()) {
      const raycaster = new THREE.Raycaster(
        new THREE.Vector3(...ray.origin),
        new THREE.Vector3(...ray.direction),
        radius * 0.05,
        radius * STRAY_RADII * 2,
      );
      splat.updateMatrixWorld(true);
      const hit = raycaster.intersectObject(splat, false)[0];
      // A floater far outside the room is a worse answer than the fallback.
      if (hit && !isStray(hit.point.toArray() as Vec3)) return hit.point.toArray() as Vec3;
    }
    return pointAlong(ray, radius * 0.5);
  }

  function resolve(pin: ScanPin, frame: string, ray: { origin: Vec3; direction: Vec3 }) {
    const key = `${pin.itemId}|${frame}`;
    if (attempted.has(key) || !sceneId) return;
    // Prefer a real hit: wait for the splat unless the scene has none to offer yet.
    if (!splat && (scene?.splat || Date.now() - camsAt < NO_SPLAT_GRACE_MS)) return;
    // Loaded but not drawn yet: the pin poll calls this again in a few seconds.
    if (splat && !splatReady()) return;
    attempted.add(key);
    putPin({ itemId: pin.itemId, sceneId, position: solve(ray), source: "slam", frame })
      .then(({ pin: saved }) => {
        if (disposed || saved.sceneId !== sceneId) return;
        pins = withPin(pins, saved);
        showPins();
      })
      .catch((error: unknown) => {
        // 409: a newer observation replaced this frame. Anything else gets another go later.
        if (error instanceof ApiError && error.status === 409) return feed.refresh();
        window.setTimeout(() => attempted.delete(key), 10_000);
      });
  }

  function showPins() {
    const visuals: PinVisual[] = pins.map((pin) => {
      const solved = { id: pin.itemId, position: pin.position, ray: null };
      // Solved from this very frame, placed by hand, or nothing to solve from.
      if (!pin.observation || pin.observation.frame === pin.positionFrame || !cams || !bounds) return solved;
      // No pose yet, or a stray one: keep the last solved spot, which a lost frame must not erase.
      const camera = byFile.get(pin.observation.frame);
      if (!camera || isStray(camera.position)) return solved;
      const ray = rayFor(camera, pin.observation.u, pin.observation.v);
      resolve(pin, pin.observation.frame, ray);
      return pin.position ? solved : { id: pin.itemId, position: null, ray: { ...ray, length: bounds.radius * 0.5 } };
    });
    engine.setPins(visuals);
    events.onPins(pins);
    if (focusPending && engine.hasArrow(focusPending)) {
      engine.setFocus(focusPending, true);
      events.onFocus(focusPending);
      focusPending = null;
    }
  }

  const feed = createPinFeed(() => sceneId, PIN_POLL_MS, (next) => {
    pins = next;
    showPins();
  });

  async function apply(live: ScanLiveState) {
    if (live.sceneId !== sceneId) {
      forgetScene();
      sceneId = live.sceneId;
      feed.refresh();
    }
    scene = live.scene as LiveSceneState | null;
    if (!live.configured) {
      events.onStatus([]);
      return events.onMessage("Live scanning is not set up on this server.");
    }
    if (!live.reachable || !sceneId || !scene) {
      events.onStatus(["offline"]);
      return events.onMessage("The scan server is not reachable.");
    }

    const forScene = sceneId;
    if (scene.map_version !== mapVersion && (scene.registered ?? 0) > 0) {
      const response = await fetch(`/api/scan/live/scenes/${encodeURIComponent(forScene)}/cameras`);
      if (disposed || forScene !== sceneId) return;
      // 404 until the first map is written.
      if (response.ok) {
        const next = (await response.json()) as LiveCameras;
        if (next.cameras?.length) {
          if (!cams) camsAt = Date.now();
          cams = next;
          bounds = captureBounds(next.cameras);
          byFile = new Map(next.cameras.map((camera) => [camera.file, camera]));
          // The file's own version: the state poll can run ahead of the cameras.json on disk.
          mapVersion = next.map_version ?? scene.map_version ?? mapVersion;
          frameHome();
          drawPath();
          showPins();
        }
      }
    }
    if (scene.splat && scene.splat !== splatFile && scene.splat !== loading && cams) void loadSplat(scene.splat, forScene);

    const bits = [scene.status ?? "waiting"];
    if (scene.splat_version) bits.push(`v${scene.splat_version}`, `${Math.round((scene.splats ?? 0) / 1000)}k splats`);
    bits.push(`${scene.registered ?? 0} posed`);
    if (scene.pending) bits.push(`${scene.pending} queued`);
    events.onStatus(scene.error ? [`error: ${scene.error}`] : bits);
    events.onMessage(
      cams ? null : `Scanning: ${scene.received ?? 0} frames received, ${scene.registered ?? 0} posed`,
    );
  }

  async function tick() {
    try {
      const live = await apiFetch<ScanLiveState>("/api/scan/live");
      if (!disposed) await apply(live);
    } catch {
      if (!disposed) {
        events.onStatus(["offline"]);
        if (!cams) events.onMessage("The scan server is not reachable.");
      }
    }
    if (!disposed) timer = window.setTimeout(tick, STATE_POLL_MS);
  }
  void tick();

  return {
    setFocus(itemId) {
      engine.setFocus(itemId, true);
    },
    home: () => engine.goHome(),
    setView() {},
    setPlacing() {},
    async resetScan() {
      const live = await apiFetch<ScanLiveState>("/api/scan/live", { method: "POST", json: { action: "reset" } });
      if (!disposed) await apply(live);
    },
    dispose() {
      disposed = true;
      window.clearTimeout(timer);
      feed.stop();
      clearPath();
      splat?.dispose();
      // Only this ends Spark's sort worker; losing the GL context does not.
      engine.scene.remove(sparkRenderer);
      sparkRenderer.dispose();
      engine.dispose();
    },
  };
}
