import type { Object3D, Vector3 } from "three";
import { createArrow, type Arrow } from "./arrow";
import { viewpointFor } from "./rays";
import type { PinVisual, Vec3 } from "./types";

export type Libs = {
  THREE: typeof import("three");
  OrbitControls: typeof import("three/addons/controls/OrbitControls.js").OrbitControls;
};

/** Loaded inside an effect, so nothing here runs during server rendering. */
export async function loadLibs(): Promise<Libs> {
  const [THREE, controls] = await Promise.all([import("three"), import("three/addons/controls/OrbitControls.js")]);
  return { THREE, OrbitControls: controls.OrbitControls };
}

const EASE_MS = 900;
const ARROW_MIN_PX = 64;
const ARROW_MAX_PX = 180;

/**
 * The part both scene kinds share: renderer, orbit camera, the arrows with their HTML labels,
 * focus and camera easing. Labels are rendered by React into `labelHost` with a data-pin
 * attribute; the engine only moves them.
 */
export function createEngine(libs: Libs, host: HTMLElement, labelHost: HTMLElement, accent: string) {
  const { THREE, OrbitControls } = libs;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.autoClear = false;
  renderer.domElement.className = "block size-full touch-none outline-none";
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0f14);
  // Arrows live in their own scene, drawn after the depth buffer is cleared.
  const overlay = new THREE.Scene();
  overlay.add(new THREE.HemisphereLight(0xffffff, 0x30343f, 1.6));
  const camera = new THREE.PerspectiveCamera(55, 1, 0.02, 200);
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(0.4, 0.7, 1);
  camera.add(key);
  overlay.add(camera);

  const accentColor = new THREE.Color(accent);
  const up = new THREE.Vector3(0, 1, 0);
  const centre = new THREE.Vector3();
  let sceneScale = 1;
  let home: { position: Vector3; target: Vector3 } | null = null;

  let controls = makeControls();
  function makeControls() {
    const next = new OrbitControls(camera, renderer.domElement);
    next.enableDamping = true;
    next.dampingFactor = 0.08;
    next.screenSpacePanning = true;
    next.zoomToCursor = true;
    next.addEventListener("start", () => {
      ease = null;
    });
    return next;
  }

  let ease: { fromPosition: Vector3; fromTarget: Vector3; toPosition: Vector3; toTarget: Vector3; start: number } | null =
    null;
  function easeTo(position: Vector3, target: Vector3) {
    ease = {
      fromPosition: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toPosition: position.clone(),
      toTarget: target.clone(),
      start: performance.now(),
    };
  }

  const arrows = new Map<string, { arrow: Arrow; visual: PinVisual; line: Object3D | null }>();
  let focusId: string | null = null;
  const tmp = new THREE.Vector3();
  const tmpAxis = new THREE.Vector3();

  function applyEmphasis() {
    for (const [id, entry] of arrows) {
      entry.arrow.setEmphasis(focusId === null ? "normal" : id === focusId ? "focus" : "dim");
    }
  }

  function removeArrow(id: string) {
    const entry = arrows.get(id);
    if (!entry) return;
    overlay.remove(entry.arrow.object);
    entry.arrow.dispose();
    if (entry.line) disposeLine(entry.line);
    arrows.delete(id);
  }

  function disposeLine(line: Object3D) {
    overlay.remove(line);
    const drawn = line as import("three").Line;
    drawn.geometry.dispose();
    (drawn.material as import("three").Material).dispose();
  }

  /** The tip of a pin's arrow, or null when there is nothing to draw for it yet. */
  function tipOf(visual: PinVisual): Vec3 | null {
    if (visual.position) return visual.position;
    if (!visual.ray) return null;
    const { origin, direction, length } = visual.ray;
    return [origin[0] + direction[0] * length, origin[1] + direction[1] * length, origin[2] + direction[2] * length];
  }

  function setPins(visuals: PinVisual[]) {
    const seen = new Set<string>();
    for (const visual of visuals) {
      const tip = tipOf(visual);
      if (!tip) continue;
      seen.add(visual.id);
      let entry = arrows.get(visual.id);
      if (!entry) {
        const arrow = createArrow(THREE, accentColor);
        overlay.add(arrow.object);
        entry = { arrow, visual, line: null };
        arrows.set(visual.id, entry);
      }
      entry.visual = visual;
      if (entry.line) {
        disposeLine(entry.line);
        entry.line = null;
      }
      if (visual.position) {
        entry.arrow.setPose(tmp.set(...tip), up, false);
      } else if (visual.ray) {
        // Not placed yet: lie along the view ray, with a faint line back to the camera that saw it.
        tmpAxis.set(...visual.ray.direction).negate();
        entry.arrow.setPose(tmp.set(...tip), tmpAxis, true);
        const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...visual.ray.origin), tmp.clone()]);
        const material = new THREE.LineBasicMaterial({ color: accentColor, transparent: true, opacity: 0.45 });
        entry.line = new THREE.Line(geometry, material);
        overlay.add(entry.line);
      }
    }
    for (const id of [...arrows.keys()]) if (!seen.has(id)) removeArrow(id);
    applyEmphasis();
  }

  function frameOn(id: string) {
    const entry = arrows.get(id);
    const tip = entry && tipOf(entry.visual);
    if (!tip) return false;
    const fallback = home ? home.position : camera.position;
    const position = viewpointFor(tip, centre.toArray(), up.toArray(), sceneScale * 0.85, fallback.toArray());
    easeTo(new THREE.Vector3(...position), new THREE.Vector3(...tip));
    return true;
  }

  function resize() {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  let onScreen = true;
  const visibility = new IntersectionObserver(([entry]) => {
    onScreen = entry?.isIntersecting ?? true;
  });
  visibility.observe(host);

  const labels = new Map<string, HTMLElement>();
  function labelFor(id: string) {
    let element = labels.get(id);
    if (!element?.isConnected) {
      element = labelHost.querySelector<HTMLElement>(`[data-pin="${CSS.escape(id)}"]`) ?? undefined;
      if (element) labels.set(id, element);
      else labels.delete(id);
    }
    return element;
  }

  renderer.setAnimationLoop((now) => {
    if (!onScreen) return;
    const seconds = now / 1000;
    if (ease) {
      const t = Math.min(1, (performance.now() - ease.start) / EASE_MS);
      const k = t * t * (3 - 2 * t);
      camera.position.lerpVectors(ease.fromPosition, ease.toPosition, k);
      controls.target.lerpVectors(ease.fromTarget, ease.toTarget, k);
      if (t >= 1) ease = null;
    }
    controls.update();
    // The camera sits in the overlay scene, and the renderer only refreshes a camera that has
    // no parent. Without this the room pass draws with last frame's rotation and the arrows
    // slide off their pins while the view moves.
    camera.updateMatrixWorld();

    // Room-scale arrows, held between a smallest and largest size on screen.
    const height = host.clientHeight || 1;
    const perPixel = (2 * Math.tan((camera.fov * Math.PI) / 360)) / height;
    for (const { arrow } of arrows.values()) {
      const worldPerPixel = camera.position.distanceTo(arrow.object.position) * perPixel;
      const size = Math.max(sceneScale * 0.16, ARROW_MIN_PX * worldPerPixel);
      arrow.setSize(Math.min(size, (ARROW_MAX_PX * worldPerPixel) / arrow.emphasisScale()));
      arrow.update(seconds);
    }

    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(overlay, camera);

    const width = host.clientWidth;
    for (const [id, { arrow }] of arrows) {
      const element = labelFor(id);
      if (!element) continue;
      arrow.labelAnchor(tmp).project(camera);
      const hidden = tmp.z > 1 || tmp.z < -1 || Math.abs(tmp.x) > 1.3 || Math.abs(tmp.y) > 1.3;
      element.style.visibility = hidden ? "hidden" : "visible";
      if (hidden) continue;
      const x = (tmp.x * 0.5 + 0.5) * width;
      const y = (-tmp.y * 0.5 + 0.5) * height;
      element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  });

  return {
    THREE,
    renderer,
    scene,
    camera,
    dom: renderer.domElement,
    /** `scale` is the capture's spread: arrows, view distances and clip planes follow it. */
    setFrame(frame: { up: Vec3; centre: Vec3; scale: number }) {
      const changed = up.distanceTo(tmp.set(...frame.up)) > 1e-4;
      up.set(...frame.up).normalize();
      centre.set(...frame.centre);
      sceneScale = frame.scale;
      if (changed) {
        // OrbitControls reads camera.up once, when it is built.
        const target = controls.target.clone();
        controls.dispose();
        camera.up.copy(up);
        controls = makeControls();
        controls.target.copy(target);
      }
      camera.near = sceneScale / 200;
      camera.far = sceneScale * 80;
      camera.updateProjectionMatrix();
    },
    setHome(position: Vec3, target: Vec3, jump: boolean) {
      home = { position: new THREE.Vector3(...position), target: new THREE.Vector3(...target) };
      if (!jump) return;
      ease = null;
      camera.position.copy(home.position);
      controls.target.copy(home.target);
      controls.update();
    },
    goHome() {
      if (home) easeTo(home.position, home.target);
    },
    setPins,
    hasArrow: (id: string) => arrows.has(id),
    setFocus(id: string | null, frame: boolean) {
      focusId = id;
      applyEmphasis();
      return id !== null && frame ? frameOn(id) : false;
    },
    /** First hit of a screen point on `objects`, in world coordinates. */
    pick(clientX: number, clientY: number, objects: Object3D[]): Vec3 | null {
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(objects, true)[0];
      return hit ? (hit.point.toArray() as Vec3) : null;
    },
    dispose() {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      visibility.disconnect();
      for (const id of [...arrows.keys()]) removeArrow(id);
      controls.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}

export type Engine = ReturnType<typeof createEngine>;

/** A tap, as opposed to the end of an orbit drag. */
export function onTap(element: HTMLElement, handler: (event: PointerEvent) => void) {
  let down: { x: number; y: number; at: number } | null = null;
  const onDown = (event: PointerEvent) => {
    down = { x: event.clientX, y: event.clientY, at: performance.now() };
  };
  const onUp = (event: PointerEvent) => {
    if (!down) return;
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    const held = performance.now() - down.at;
    down = null;
    if (moved < 6 && held < 600) handler(event);
  };
  element.addEventListener("pointerdown", onDown);
  element.addEventListener("pointerup", onUp);
  return () => {
    element.removeEventListener("pointerdown", onDown);
    element.removeEventListener("pointerup", onUp);
  };
}
