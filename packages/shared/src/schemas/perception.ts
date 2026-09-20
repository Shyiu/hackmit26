import { z } from "zod";
import { frameDetectionsSchema } from "./detection";

// The /ws/frames protocol between a capture page and the perception service.
// services/perception/app/protocol.py mirrors these, and the JSON files in
// packages/shared/fixtures/perception/ must parse on both sides.
//
// 1. The page opens the socket and sends `hello` with a token from
//    GET /api/perception/token. A browser can't set headers on a WebSocket.
// 2. The service answers `session`. Capture starts paused.
// 3. The page sends `capture` to go live or pause again.
// 4. While live, each frame is one binary message: a 4-byte big-endian header
//    length, the header as UTF-8 JSON, then the JPEG bytes.
// 5. The service answers each processed frame with `detections` for its `seq`.
// 6. When a frame shows a face, the service also sends `faces` for that `seq`, and one
//    empty `faces` when the last face leaves. It comes from its own worker, so it can
//    land before or after the same frame's `detections`.

export const PERCEPTION_PROTOCOL_VERSION = 1;

const objectIdHex = z.string().regex(/^[0-9a-f]{24}$/);

export const helloMessageSchema = z
  .object({ type: z.literal("hello"), v: z.literal(1), token: z.string().min(1).max(2048) })
  .strict();

export const captureCommandSchema = z
  .object({ type: z.literal("capture"), v: z.literal(1), state: z.enum(["live", "paused"]) })
  .strict();

export const clientMessageSchema = z.discriminatedUnion("type", [helloMessageSchema, captureCommandSchema]);

export const frameHeaderSchema = z
  .object({
    v: z.literal(1),
    sessionId: objectIdHex,
    seq: z.number().int().nonnegative(),
    // performance.now() on the page when the frame was grabbed and when it was
    // sent. The service only uses the difference, so the phone's wall clock
    // can be wrong without skewing capture times.
    capturedAtMs: z.number().nonnegative(),
    sentAtMs: z.number().nonnegative(),
    width: z.number().int().positive().max(4096),
    height: z.number().int().positive().max(4096),
    bytes: z.number().int().positive().max(2_000_000),
  })
  .strict();

export const captureStateSchema = z.enum(["paused", "live", "ended"]);

export const sessionMessageSchema = z
  .object({ type: z.literal("session"), v: z.literal(1), sessionId: objectIdHex, state: captureStateSchema })
  .strict();

export const detectionsMessageSchema = frameDetectionsSchema
  .extend({ type: z.literal("detections"), v: z.literal(1) })
  .strict();

// One enrolled person's raw similarity to a detected face, whether or not it
// won the match. Debug-only: never stored, only sent for a caregiver to see
// on a live capture page why a face did or didn't get named.
export const faceCandidateSchema = z.object({
  personId: objectIdHex,
  name: z.string().max(200),
  relation: z.string().max(200).nullable(),
  similarity: z.number().min(0).max(1),
});

// A face the service saw, matched only against the people this wearer's caregiver enrolled.
// personId, name, and relation are null for a face that matched nobody.
export const faceSchema = z.object({
  personId: objectIdHex.nullable(),
  name: z.string().max(200).nullable(),
  relation: z.string().max(200).nullable(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  confidence: z.number().min(0).max(1),
  matchConfidence: z.number().min(0).max(1).nullable(),
  // Every enrolled person's similarity to this face, best first. Optional and
  // defaulted so older messages without it still parse.
  candidates: z.array(faceCandidateSchema).default([]),
});

export const facesMessageSchema = z
  .object({
    type: z.literal("faces"),
    v: z.literal(1),
    seq: z.number().int().nonnegative(),
    faces: z.array(faceSchema),
  })
  .strict();

export const perceptionErrorCodeSchema = z.enum([
  "unauthorized",
  "bad_message",
  "bad_frame",
  "rate_limited",
  "server_error",
]);

export const errorMessageSchema = z
  .object({
    type: z.literal("error"),
    v: z.literal(1),
    code: perceptionErrorCodeSchema,
    message: z.string().max(500),
  })
  .strict();

export const serverMessageSchema = z.discriminatedUnion("type", [
  sessionMessageSchema,
  detectionsMessageSchema,
  facesMessageSchema,
  errorMessageSchema,
]);

// POST /config/classes on the perception service, called by the web app after a
// caregiver edits items. The tenant comes from the token, never the body.
export const reloadClassesRequestSchema = z
  .object({ version: z.number().int().nonnegative().optional() })
  .strict();
export const reloadClassesResponseSchema = z
  .object({
    patientId: objectIdHex,
    classes: z.array(z.string().min(1).max(200)),
    version: z.number().int().nonnegative(),
  })
  .strict();

export type HelloMessage = z.infer<typeof helloMessageSchema>;
export type CaptureCommand = z.infer<typeof captureCommandSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type FrameHeader = z.infer<typeof frameHeaderSchema>;
export type CaptureState = z.infer<typeof captureStateSchema>;
export type SessionMessage = z.infer<typeof sessionMessageSchema>;
export type DetectionsMessage = z.infer<typeof detectionsMessageSchema>;
export type FaceCandidate = z.infer<typeof faceCandidateSchema>;
export type Face = z.infer<typeof faceSchema>;
export type FacesMessage = z.infer<typeof facesMessageSchema>;
export type PerceptionErrorCode = z.infer<typeof perceptionErrorCodeSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type ReloadClassesRequest = z.infer<typeof reloadClassesRequestSchema>;
export type ReloadClassesResponse = z.infer<typeof reloadClassesResponseSchema>;
