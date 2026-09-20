import type { Vec3 } from "./types";

// Plain array maths, so the ray for an observation can be checked without three.js.

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function normalize(a: Vec3): Vec3 {
  const length = Math.hypot(a[0], a[1], a[2]);
  return length > 1e-9 ? scale(a, 1 / length) : [0, 0, 0];
}

/** The portrait phone on the chest. splat-slam's live cameras.json carries no aspect. */
export const DEFAULT_FRAME_ASPECT = 9 / 16;

/**
 * The world ray through (u, v) of a posed frame. u runs left to right and v runs top to bottom,
 * both 0..1. The pose has no roll, so `up` (the camera's own, else the scene's) fixes the basis.
 */
export function observationRay(input: {
  position: Vec3;
  forward: Vec3;
  up: Vec3;
  fovYDeg: number;
  aspect: number;
  u: number;
  v: number;
}): { origin: Vec3; direction: Vec3 } {
  const forward = normalize(input.forward);
  let right = cross(forward, input.up);
  // Looking straight along up: any horizontal axis will do.
  if (Math.hypot(...right) < 1e-6) right = cross(forward, Math.abs(forward[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]);
  right = normalize(right);
  const cameraUp = cross(right, forward);
  const halfHeight = Math.tan((input.fovYDeg * Math.PI) / 360);
  const x = (2 * input.u - 1) * halfHeight * input.aspect;
  const y = (1 - 2 * input.v) * halfHeight;
  const direction = normalize([
    forward[0] + right[0] * x + cameraUp[0] * y,
    forward[1] + right[1] * x + cameraUp[1] * y,
    forward[2] + right[2] * x + cameraUp[2] * y,
  ]);
  return { origin: input.position, direction };
}

export function pointAlong(ray: { origin: Vec3; direction: Vec3 }, distance: number): Vec3 {
  return [
    ray.origin[0] + ray.direction[0] * distance,
    ray.origin[1] + ray.direction[1] * distance,
    ray.origin[2] + ray.direction[2] * distance,
  ];
}

/**
 * Where to stand to look at `point`: between it and the room's centre, raised along up, so the
 * view is from inside the room and a wall is never in the way.
 */
export function viewpointFor(point: Vec3, centre: Vec3, up: Vec3, distance: number, fallback: Vec3): Vec3 {
  const unitUp = normalize(up);
  const flatten = (a: Vec3) => sub(a, scale(unitUp, dot(a, unitUp)));
  let inward = flatten(sub(centre, point));
  if (Math.hypot(...inward) < distance * 0.05) inward = flatten(sub(fallback, point));
  if (Math.hypot(...inward) < 1e-6) inward = flatten([1, 0, 0]);
  inward = normalize(inward);
  const tilt = (35 * Math.PI) / 180;
  const offset = [0, 1, 2].map((i) => (inward[i] * Math.cos(tilt) + unitUp[i] * Math.sin(tilt)) * distance);
  return [point[0] + offset[0], point[1] + offset[1], point[2] + offset[2]];
}
