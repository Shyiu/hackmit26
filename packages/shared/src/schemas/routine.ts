import { z } from "zod";

export const routineTriggerSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("time"),
      at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("leaving"),
      itemName: z.string().trim().min(1).max(60),
      windowMinutes: z.number().int().min(1).max(240),
    })
    .strict(),
]);

export const createRoutineSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    trigger: routineTriggerSchema,
    text: z.string().trim().min(1).max(200),
    cooldownMinutes: z.number().int().min(0).max(1440).default(120),
    active: z.boolean().default(true),
  })
  .strict();

export const updateRoutineSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    trigger: routineTriggerSchema.optional(),
    text: z.string().trim().min(1).max(200).optional(),
    cooldownMinutes: z.number().int().min(0).max(1440).optional(),
    active: z.boolean().optional(),
  })
  .strict();

export type RoutineTrigger = z.infer<typeof routineTriggerSchema>;
export type CreateRoutine = z.infer<typeof createRoutineSchema>;
export type UpdateRoutine = z.infer<typeof updateRoutineSchema>;
