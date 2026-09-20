import { STATIC_SCAN_SCENE_ID, type ScanPin } from "@memory-glasses/shared";
import type { Material, Mesh, Object3D } from "three";
import { onTap, type Engine } from "./engine";
import { createPinFeed, putPin, withPin } from "./pins";
import type { StaticSceneFile, ViewerEvents, ViewerHandle } from "./types";

const BASE = "/scan/room";
const PIN_POLL_MS = 5000;

/** The bundled demo room: a textured mesh, with the splat of the same room loaded on first use. */
export async function createStaticViewer(
  engine: Engine,
  events: ViewerEvents,
  focusItemId: string | undefined,
): Promise<ViewerHandle> {
  const { THREE } = engine;
  let disposed = false;

  const response = await fetch(`${BASE}/scene.json`);
  if (!response.ok) throw new Error("The room scan is missing from this build.");
  const file = (await response.json()) as StaticSceneFile;
  const sceneId = file.sceneId ?? STATIC_SCAN_SCENE_ID;
  engine.setFrame({ up: file.up, centre: file.home.target, scale: file.spread });
  engine.setHome(file.home.position, file.home.target, true);

  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().loadAsync(`${BASE}/${file.mesh}`, (progress) => {
    if (progress.total) {
      events.onMessage(`Loading the room: ${(progress.loaded / 1e6).toFixed(0)} of ${(progress.total / 1e6).toFixed(0)} MB`);
    }
  });
  const room = gltf.scene;
  room.traverse((object: Object3D) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    for (const material of [mesh.material].flat() as Material[]) {
      // One-sided: from outside you look through the back of a wall into the room.
      material.side = THREE.FrontSide;
      const map = (material as Material & { map?: import("three").Texture | null }).map;
      if (map) map.anisotropy = engine.renderer.capabilities.getMaxAnisotropy();
    }
  });
  engine.scene.add(room);
  events.onMessage(null);

  // Pins. A placement shows at once and holds until its PUT has answered.
  let pins: ScanPin[] = [];
  const placed = new Map<string, ScanPin>();
  let focusPending = focusItemId ?? null;
  function show(next: ScanPin[]) {
    pins = next;
    for (const pin of placed.values()) pins = withPin(pins, pin);
    engine.setPins(pins.map((pin) => ({ id: pin.itemId, position: pin.position, ray: null })));
    events.onPins(pins);
    if (focusPending && engine.hasArrow(focusPending)) {
      engine.setFocus(focusPending, true);
      events.onFocus(focusPending);
      focusPending = null;
    }
  }
  const feed = createPinFeed(() => sceneId, PIN_POLL_MS, show);

  // The splat, drawn in the mesh's frame.
  let splat: Object3D | null = null;
  let sparkRenderer: (Object3D & { dispose(): void }) | null = null;
  let splatLoading: Promise<void> | null = null;
  let view: "mesh" | "splat" = "mesh";
  function applyView() {
    const showSplat = view === "splat" && splat !== null;
    room.visible = !showSplat;
    if (splat) splat.visible = showSplat;
  }
  async function loadSplat() {
    events.onMessage("Loading the splat…");
    const spark = await import("@sparkjsdev/spark");
    if (disposed) return;
    // One per viewer: a retry after a failed load must not add a second.
    if (!sparkRenderer) {
      sparkRenderer = new spark.SparkRenderer({ renderer: engine.renderer });
      engine.scene.add(sparkRenderer);
    }
    const mesh = new spark.SplatMesh({ url: `${BASE}/${file.splat}` });
    await mesh.initialized;
    if (disposed) return mesh.dispose();
    new THREE.Matrix4().fromArray(file.splatToMesh).decompose(mesh.position, mesh.quaternion, mesh.scale);
    engine.scene.add(mesh);
    splat = mesh;
  }

  // The mesh reads from above, like a dollhouse. A splat only reads from inside the room, so its
  // home is a place the phone stood.
  function applyHome(move: boolean) {
    const from = view === "splat" ? file.cameras[Math.floor(file.cameras.length / 2)] : undefined;
    if (!from) return engine.setHome(file.home.position, file.home.target, false);
    const reach = file.distance * 0.8;
    const target = from.position.map((value, i) => value + from.forward[i] * reach) as typeof from.position;
    engine.setHome(from.position, target, false);
    if (move) engine.goHome();
  }

  let placing: { id: string; name: string } | null = null;
  const stopTap = onTap(engine.dom, (event) => {
    if (!placing) return;
    // The mesh stays the pick surface in splat view too: it is the same room in the same frame.
    const position = engine.pick(event.clientX, event.clientY, [room]);
    if (!position) return events.onNotice("Tap a surface in the room.");
    const item = placing;
    const stamp = new Date().toISOString();
    const pin: ScanPin = {
      itemId: item.id,
      itemName: item.name,
      sceneId,
      position,
      positionFrame: null,
      observation: null,
      source: "manual",
      seenAt: pins.find((other) => other.itemId === item.id)?.seenAt ?? stamp,
      updatedAt: stamp,
    };
    placed.set(item.id, pin);
    show(pins);
    engine.setFocus(item.id, false);
    events.onFocus(item.id);
    events.onNotice(null);
    events.onPlaced(item.id);
    putPin({ itemId: item.id, sceneId, position, source: "manual" })
      .then(({ pin: saved }) => {
        if (placed.get(item.id) === pin) placed.delete(item.id);
        if (!disposed) show(withPin(pins, saved));
      })
      .catch((error: unknown) => {
        if (placed.get(item.id) === pin) placed.delete(item.id);
        if (disposed) return;
        events.onNotice(`The pin was not saved: ${error instanceof Error ? error.message : "request failed"}`);
        feed.refresh();
      });
  });

  return {
    setFocus(itemId) {
      engine.setFocus(itemId, true);
    },
    home: () => engine.goHome(),
    setView(next) {
      view = next;
      applyView();
      if (next !== "splat" || splat) return applyHome(next === "splat");
      splatLoading ??= loadSplat()
        .then(() => {
          events.onMessage(null);
          if (view === "splat") applyHome(true);
        })
        .catch((error: unknown) => {
          splatLoading = null;
          events.onMessage(null);
          events.onNotice(`The splat did not load: ${error instanceof Error ? error.message : "unknown error"}`);
        })
        .finally(() => {
          if (!disposed) applyView();
        });
    },
    setPlacing(item) {
      placing = item;
      engine.dom.style.cursor = item ? "crosshair" : "";
    },
    resetScan: async () => {},
    dispose() {
      disposed = true;
      feed.stop();
      stopTap();
      (splat as (Object3D & { dispose?: () => void }) | null)?.dispose?.();
      // Only this ends Spark's sort worker; losing the GL context does not.
      if (sparkRenderer) {
        engine.scene.remove(sparkRenderer);
        sparkRenderer.dispose();
      }
      room.traverse((object: Object3D) => {
        const mesh = object as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const material of [mesh.material].flat() as Material[]) {
          (material as Material & { map?: import("three").Texture | null }).map?.dispose();
          material.dispose();
        }
      });
      engine.dispose();
    },
  };
}
