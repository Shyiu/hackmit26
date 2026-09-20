import { parseDocument } from "../errors";
import { newId, type RoutineId } from "../ids";
import { routineDocSchema, type RoutineDoc, type RoutineTrigger } from "../schema/routines";
import { tenantCollection, type RepoContext } from "./context";

export type NewRoutine = {
  name: string;
  trigger: RoutineTrigger;
  text: string;
  cooldownMinutes?: number;
  active?: boolean;
};

export type RoutinePatch = Partial<NewRoutine>;

const routinePatch = routineDocSchema
  .pick({ name: true, trigger: true, text: true, cooldownMinutes: true, active: true, updatedAt: true })
  .partial({ name: true, trigger: true, text: true, cooldownMinutes: true, active: true });

export function routinesRepo(ctx: RepoContext) {
  const routines = tenantCollection(ctx, "routines");

  return {
    list(): Promise<RoutineDoc[]> {
      return routines.find().sort({ name: 1 }).toArray();
    },

    get(id: RoutineId): Promise<RoutineDoc | null> {
      return routines.findOne({ _id: id });
    },

    async create(input: NewRoutine): Promise<RoutineDoc> {
      const now = ctx.now();
      const doc = parseDocument(routineDocSchema, {
        _id: newId<RoutineId>(),
        patientId: ctx.patientId,
        active: input.active ?? true,
        name: input.name.trim(),
        trigger: input.trigger,
        text: input.text.trim(),
        lastFiredAt: null,
        cooldownMinutes: input.cooldownMinutes ?? 120,
        createdAt: now,
        updatedAt: now,
      });
      await routines.insertOne(doc);
      return doc;
    },

    async update(id: RoutineId, patch: RoutinePatch): Promise<RoutineDoc | null> {
      const changes = parseDocument(routinePatch, {
        updatedAt: ctx.now(),
        ...(patch.name !== undefined && { name: patch.name.trim() }),
        ...(patch.trigger !== undefined && { trigger: patch.trigger }),
        ...(patch.text !== undefined && { text: patch.text.trim() }),
        ...(patch.cooldownMinutes !== undefined && { cooldownMinutes: patch.cooldownMinutes }),
        ...(patch.active !== undefined && { active: patch.active }),
      });
      return routines.findOneAndUpdate({ _id: id }, { $set: changes });
    },

    markFired(id: RoutineId, expected: Date | null): Promise<RoutineDoc | null> {
      const now = ctx.now();
      return routines.findOneAndUpdate(
        { _id: id, active: true, lastFiredAt: expected },
        { $set: { lastFiredAt: now, updatedAt: now } },
      );
    },
  };
}

export type RoutinesRepo = ReturnType<typeof routinesRepo>;
