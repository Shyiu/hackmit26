export const SESSION_COOKIE = "mg_session";

export const SESSION_TTL_SECONDS = 12 * 60 * 60;
// Device tokens are short lived: the page re-fetches one before it opens a socket.
export const DEVICE_TOKEN_TTL_SECONDS = 10 * 60;
export const FRAMES_TOKEN_TTL_SECONDS = 10 * 60;
// Deepgram's grant endpoint defaults to 30 s; the client asks for one per turn.
export const STT_TOKEN_TTL_SECONDS = 60;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

export function demoPatientId(): string {
  return process.env.DEMO_PATIENT_ID ?? "demo-patient";
}

// Constant-time-ish comparison so a wrong password doesn't leak its prefix length.
export function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
