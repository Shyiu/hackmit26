import type { ScanPin } from "@memory-glasses/shared";

export type Vec3 = [number, number, number];

/** apps/web/public/scan/room/scene.json. Everything is in the mesh GLB's frame, y up. */
export type StaticSceneFile = {
  sceneId: string;
  mesh: string;
  splat: string;
  up: Vec3;
  /** Column-major 4x4 taking splat coordinates to the mesh frame. */
  splatToMesh: number[];
  fovYDeg: number;
  aspect: number;
  /** Mean distance of the capture cameras from their centroid: the room's scale. */
  spread: number;
  distance: number;
  home: { position: Vec3; target: Vec3 };
  cameras: { position: Vec3; forward: Vec3 }[];
  anchors: { position: Vec3; note: string }[];
};

/** `aspect` and `fov_y_deg` are per camera when the server writes them: a turned phone is a second camera. */
export type PosedCamera = { file: string; position: Vec3; forward: Vec3; up?: Vec3; aspect?: number; fov_y_deg?: number };

/** splat-slam's cameras.json. The live server leaves out `aspect` and the per-camera `up`. */
export type LiveCameras = {
  map_version?: number;
  up: Vec3;
  target: Vec3;
  distance: number;
  spread: number;
  fov_y_deg: number;
  aspect?: number;
  cameras: PosedCamera[];
};

/** The parts of splat-slam's scene state the viewer reads. */
export type LiveSceneState = {
  status?: string;
  error?: string | null;
  received?: number;
  registered?: number;
  map_version?: number;
  splat_version?: number;
  splats?: number;
  pending?: number;
  splat?: string | null;
};

/** How one pin is drawn. `ray` is set while a live observation still waits for its position. */
export type PinVisual = {
  id: string;
  position: Vec3 | null;
  ray: { origin: Vec3; direction: Vec3; length: number } | null;
};

export type ViewerEvents = {
  onPins(pins: ScanPin[]): void;
  /** The one line shown in the middle of the viewport, or null once there is something to look at. */
  onMessage(message: string | null): void;
  /** Bits for the status strip under the live view. */
  onStatus(bits: string[]): void;
  onFocus(itemId: string | null): void;
  /** A short-lived line for something that went wrong, such as a pin that did not save. */
  onNotice(notice: string | null): void;
  onPlaced(itemId: string): void;
};

export type ViewerHandle = {
  setFocus(itemId: string | null): void;
  home(): void;
  /** Static scenes only. */
  setView(view: "mesh" | "splat"): void;
  /** Static scenes only: the next tap on the mesh places this item. Null leaves place mode. */
  setPlacing(item: { id: string; name: string } | null): void;
  /** Live scenes only: drop the current scene and start a fresh one. */
  resetScan(): Promise<void>;
  dispose(): void;
};
