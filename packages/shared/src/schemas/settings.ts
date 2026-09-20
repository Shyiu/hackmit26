import { z } from "zod";

// The caregiver-edited wearer settings, README "Caregiver dashboard" > Settings.
// packages/db re-validates the merged result against the stored schema, which
// also checks the time zone name.
export const updateSettingsSchema = z
  .object({
    timezone: z.string().min(1).max(64),
    ttsProvider: z.enum(["elevenlabs", "deepgram"]),
    voiceId: z.string().min(1).max(100).nullable(),
    /** 1 is the voice's default. Slower than default is the point. */
    speakingRate: z.number().min(0.5).max(1.5),
    hudLevel: z.enum(["everything", "captions", "off"]),
    recordingAllowed: z.boolean(),
    retentionDays: z.number().int().min(1).max(365),
    staleAfterMinutes: z.number().int().min(1).max(24 * 60),
    geofence: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        radiusMeters: z.number().min(20).max(50_000),
      })
      .strict()
      .nullable(),
    locationStaleAfterMinutes: z.number().int().min(1).max(24 * 60),
    wakeWordEnabled: z.boolean(),
    wakeWordSensitivity: z.number().min(0).max(1),
  })
  .partial()
  .strict();

export type UpdateSettings = z.infer<typeof updateSettingsSchema>;
