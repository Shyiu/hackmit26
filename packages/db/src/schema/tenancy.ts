import { z } from "zod";
import {
  idSchema,
  type CaregiverId,
  type CaregiverPairingCodeId,
  type DeviceId,
  type PairingCodeId,
  type PatientId,
} from "../ids";
import { captureSource, shortText, timestamps, unitInterval } from "./common";

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const hudLevel = z.enum(["everything", "captions", "off"]);
export const ttsProvider = z.enum(["elevenlabs", "deepgram"]);

/** Per-wearer settings the caregiver edits. PLAN.md "Caregiver dashboard" > Settings. */
export const patientSettingsSchema = z.strictObject({
  /** IANA zone. "This morning" means the wearer's morning. */
  timezone: z.string().refine(isTimeZone, "Unknown IANA time zone"),
  ttsProvider,
  voiceId: z.string().min(1).max(100).nullable(),
  /** 1 is the provider default. Slower than default is the point. */
  speakingRate: z.number().min(0.5).max(1.5),
  hudLevel,
  recordingAllowed: z.boolean(),
  retentionDays: z.int().min(1).max(365),
  /** Observations older than this get the stale wording. */
  staleAfterMinutes: z.int().min(1).max(24 * 60),
  wakeWordEnabled: z.boolean(),
  wakeWordSensitivity: unitInterval,
  /** Off by default: a recognized face is always a silent notification; this only
   * adds a short chime on top. Never speech -- see PLAN.md "Faces, danger, and routines". */
  faceAnnounceSoundEnabled: z.boolean(),
});

export type PatientSettings = z.infer<typeof patientSettingsSchema>;

export const DEFAULT_PATIENT_SETTINGS: PatientSettings = {
  timezone: "America/New_York",
  ttsProvider: "elevenlabs",
  voiceId: null,
  speakingRate: 0.9,
  hudLevel: "everything",
  recordingAllowed: false,
  retentionDays: 30,
  staleAfterMinutes: 15,
  wakeWordEnabled: false,
  wakeWordSensitivity: 0.5,
  faceAnnounceSoundEnabled: false,
};

/** The wearer. Every tenant-owned document points here through `patientId`. */
export const patientDocSchema = z.strictObject({
  _id: idSchema<PatientId>(),
  /** What the family calls them, for the dashboard. Never spoken to the wearer. */
  displayName: shortText,
  settings: patientSettingsSchema,
  /** Bumped by every item, room, or settings write. Caches key on it. */
  configVersion: z.int().nonnegative(),
  ...timestamps,
});

export type PatientDoc = z.infer<typeof patientDocSchema>;

/**
 * A caregiver login. Accounts made through signup carry a scrypt password hash;
 * the seeded demo caregiver has none and signs in with the env credentials.
 */
export const caregiverDocSchema = z.strictObject({
  _id: idSchema<CaregiverId>(),
  email: z.email().max(254),
  name: shortText,
  /** `scrypt$N$r$p$salt$hash`, base64url. Never leaves the server. */
  passwordHash: z.string().min(40).max(300).optional(),
  patientIds: z.array(idSchema<PatientId>()).min(1).max(20),
  lastLoginAt: z.date().nullable(),
  ...timestamps,
});

export type CaregiverDoc = z.infer<typeof caregiverDocSchema>;

/**
 * A capture client: the headset page, the /sim page, or later the glasses app.
 * Tokens carry `tokenVersion`; bumping it revokes every token already issued.
 */
export const deviceDocSchema = z.strictObject({
  _id: idSchema<DeviceId>(),
  patientId: idSchema<PatientId>(),
  kind: captureSource,
  label: shortText,
  tokenVersion: z.int().nonnegative(),
  lastSeenAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
  ...timestamps,
});

export type DeviceDoc = z.infer<typeof deviceDocSchema>;

// A caregiver joining an existing wearer, PLAN.md "What /wear and /sim call on
// first run" adjacent: same hash/timing-safe-compare/expiry shape as a device
// pairing code (see redeemCaregiverPairingCode in ../pairing.ts), but redeemed
// by a second caregiver's own account instead of minting a device token.
export const PAIRING_CODE_LENGTH = 6;
export const PAIRING_CODE_MAX_ATTEMPTS = 5;
export const CAREGIVER_PAIRING_CODE_LENGTH = PAIRING_CODE_LENGTH;
export const CAREGIVER_PAIRING_CODE_MAX_ATTEMPTS = PAIRING_CODE_MAX_ATTEMPTS;

export const caregiverPairingCodeDocSchema = z.strictObject({
  _id: idSchema<CaregiverPairingCodeId>(),
  patientId: idSchema<PatientId>(),
  /** sha256 hex of the 6 digits. The plain code is shown once and never stored. */
  codeHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Wrong guesses seen while this code was live. At the max attempts it is burned. */
  attempts: z.int().nonnegative(),
  expiresAt: z.date(),
  redeemedAt: z.date().nullable(),
  redeemedBy: idSchema<CaregiverId>().nullable(),
  createdAt: z.date(),
});

export type CaregiverPairingCodeDoc = z.infer<typeof caregiverPairingCodeDocSchema>;

export const pairingCodeDocSchema = z.strictObject({
  _id: idSchema<PairingCodeId>(),
  patientId: idSchema<PatientId>(),
  /** sha256 hex of the 6 digits. The plain code is shown once and never stored. */
  codeHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Wrong guesses seen while this code was live. At the max attempts it is burned. */
  attempts: z.int().nonnegative(),
  expiresAt: z.date(),
  redeemedAt: z.date().nullable(),
  redeemedBy: idSchema<DeviceId>().nullable(),
  kind: captureSource,
  createdAt: z.date(),
});

export type PairingCodeDoc = z.infer<typeof pairingCodeDocSchema>;
