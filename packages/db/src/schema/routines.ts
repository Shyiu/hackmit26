import { z } from "zod";
import { idSchema, type PatientId, type RoutineId } from "../ids";
import { shortText, timestamps } from "./common";

export const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");

export const routineTriggerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("time"), at: clockTime }),
  z.strictObject({
    kind: z.literal("leaving"),
    itemName: shortText,
    windowMinutes: z.int().min(1).max(240),
  }),
]);

export const routineDocSchema = z.strictObject({
  _id: idSchema<RoutineId>(),
  patientId: idSchema<PatientId>(),
  active: z.boolean(),
  name: shortText,
  trigger: routineTriggerSchema,
  text: z.string().trim().min(1).max(200),
  lastFiredAt: z.date().nullable(),
  cooldownMinutes: z.int().min(0).max(1440),
  ...timestamps,
});

export type RoutineTrigger = z.infer<typeof routineTriggerSchema>;
export type RoutineDoc = z.infer<typeof routineDocSchema>;
