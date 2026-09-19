import { z } from "zod";

// The one caregiver login from env, README open decision 7.
export const loginRequestSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(200),
  })
  .strict();

export type LoginRequest = z.infer<typeof loginRequestSchema>;
