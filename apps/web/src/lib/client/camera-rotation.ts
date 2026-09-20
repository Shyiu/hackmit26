// Some chest mounts hold the phone sideways, so what the camera reports as
// "landscape" is really portrait to a person looking at the wearer, and vice
// versa. This rotates both what the wearer/caregiver sees (LiveVideo) and what
// gets sent to perception for detection (grabJpeg in use-perception.ts), so a
// detection's bbox lines up with the rotated frame it was found in without any
// extra transform on the label overlay. 0, -90, 90, or 180.
export const CAMERA_ROTATE_DEG = -90;

export function isSidewaysRotation(deg: number): boolean {
  return Math.abs(((deg % 180) + 180) % 180) === 90;
}

/** The on-screen aspect ratio after rotation, for sizing the video's container. */
export function rotatedAspect(aspect: number, deg: number): number {
  return isSidewaysRotation(deg) ? 1 / aspect : aspect;
}
