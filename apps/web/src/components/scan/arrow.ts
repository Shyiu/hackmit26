import type { Color, Vector3 } from "three";

type Three = typeof import("three");

export type ArrowEmphasis = "normal" | "focus" | "dim";

const BOB = 0.14; // of the arrow's height
const EMPHASIS = {
  normal: { scale: 1, opacity: 0.95, glow: 0.45 },
  focus: { scale: 1.45, opacity: 1, glow: 0.8 },
  dim: { scale: 0.8, opacity: 0.4, glow: 0.2 },
} as const;

/**
 * A cone and shaft one unit tall, tip at the group's origin, pointing down its -Y. The engine
 * draws arrows in a second pass after clearing depth, so nothing in the room can hide one while
 * the cone still occludes its own shaft. The ring and dot skip the depth test as well, so a
 * neighbouring arrow never cuts them.
 */
export function createArrow(THREE: Three, color: Color) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const headGeometry = new THREE.ConeGeometry(0.17, 0.42, 32);
  headGeometry.rotateX(Math.PI);
  headGeometry.translate(0, 0.21, 0);
  const shaftGeometry = new THREE.CylinderGeometry(0.06, 0.06, 0.58, 24);
  shaftGeometry.translate(0, 0.71, 0);
  const solid = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.45, transparent: true });
  const head = new THREE.Mesh(headGeometry, solid);
  const shaft = new THREE.Mesh(shaftGeometry, solid);
  head.renderOrder = shaft.renderOrder = 1002;
  body.add(head, shaft);

  const ringGeometry = new THREE.RingGeometry(0.17, 0.215, 56);
  ringGeometry.rotateX(-Math.PI / 2);
  const flat = () =>
    new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  const ringMaterial = flat();
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.renderOrder = 1000;
  const dotGeometry = new THREE.CircleGeometry(0.05, 28);
  dotGeometry.rotateX(-Math.PI / 2);
  const dotMaterial = flat();
  const dot = new THREE.Mesh(dotGeometry, dotMaterial);
  dot.renderOrder = 1001;
  root.add(ring, dot);

  const yAxis = new THREE.Vector3(0, 1, 0);
  let emphasis: ArrowEmphasis = "normal";
  let provisional = false;
  let size = 1;

  return {
    object: root,
    /** `axis` points away from the surface: scene up for a pin, back along the view ray for a guess. */
    setPose(tip: Vector3, axis: Vector3, isProvisional: boolean) {
      root.position.copy(tip);
      root.quaternion.setFromUnitVectors(yAxis, axis);
      provisional = isProvisional;
      ring.visible = dot.visible = !isProvisional;
    },
    setEmphasis(next: ArrowEmphasis) {
      emphasis = next;
    },
    setSize(next: number) {
      size = next;
    },
    emphasisScale: () => EMPHASIS[emphasis].scale,
    /** Where the label sits: just above the top of the shaft at the height of its bob. */
    labelAnchor(target: Vector3) {
      return target.set(0, 1 + BOB + 0.08, 0).applyMatrix4(root.matrixWorld);
    },
    update(seconds: number) {
      const look = EMPHASIS[emphasis];
      root.scale.setScalar(size * look.scale);
      // The tip touches the point at the bottom of each bob.
      body.position.y = BOB * (0.5 - 0.5 * Math.cos(seconds * 2.4));
      solid.opacity = look.opacity * (provisional ? 0.6 : 1);
      solid.emissiveIntensity = look.glow;
      const pulse = (seconds * 0.7) % 1;
      ring.scale.setScalar(1 + pulse * 1.6);
      ringMaterial.opacity = look.opacity * (1 - pulse) * 0.9;
      dotMaterial.opacity = look.opacity;
    },
    dispose() {
      for (const geometry of [headGeometry, shaftGeometry, ringGeometry, dotGeometry]) geometry.dispose();
      for (const material of [solid, ringMaterial, dotMaterial]) material.dispose();
    },
  };
}

export type Arrow = ReturnType<typeof createArrow>;
