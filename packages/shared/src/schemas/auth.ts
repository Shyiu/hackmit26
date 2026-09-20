import { z } from "zod";

// Signing in: a signed-up caregiver, or the demo pair from env.
export const loginRequestSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(200),
  })
  .strict();

// A new family: the caregiver's account and the wearer they look after.
export const signupRequestSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name").max(60),
    email: z.string().trim().email("Enter a valid email").max(254),
    password: z.string().min(10, "Use at least 10 characters").max(200),
    /** What the family calls the wearer. Shown on the dashboard, never spoken to them. */
    wearerName: z.string().trim().min(1, "Enter the wearer's name").max(60),
  })
  .strict();

// The wearer exists on its own first, with no caregiver yet -- it gets a pairing
// code back that a caregiver enters (attachPatientRequestSchema) to join it.
export const wearerSignupRequestSchema = z
  .object({
    /** What the family calls the wearer. Shown on the dashboard, never spoken to them. */
    wearerName: z.string().trim().min(1, "Enter the wearer's name").max(60),
  })
  .strict();

// An already-signed-in caregiver joining a second wearer they didn't create.
export const attachPatientRequestSchema = z
  .object({
    code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
  })
  .strict();

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type SignupRequest = z.infer<typeof signupRequestSchema>;
export type WearerSignupRequest = z.infer<typeof wearerSignupRequestSchema>;
export type AttachPatientRequest = z.infer<typeof attachPatientRequestSchema>;
