import { ConflictError, duplicateKeyOf, parseDocument } from "../errors";
import { newId, type RoomId } from "../ids";
import { normalizeLookupKey } from "../lookup";
import { roomDocSchema, type RoomDoc } from "../schema/rooms";
import { bumpConfigVersion, tenantCollection, type RepoContext } from "./context";

const roomPatch = roomDocSchema
  .pick({ name: true, normalizedName: true, private: true, updatedAt: true })
  .partial({ name: true, normalizedName: true, private: true });

function rethrowNameConflict(error: unknown): never {
  const duplicate = duplicateKeyOf(error);
  if (duplicate?.index === "name_unique") {
    const name = String(duplicate.keyValue.normalizedName ?? "");
    throw new ConflictError(`A room called "${name}" already exists`, "name", name);
  }
  throw error;
}

/** Caregiver-named rooms. Optional after M3; the MVP lets the vision model name room types. */
export function roomsRepo(ctx: RepoContext) {
  const rooms = tenantCollection(ctx, "rooms");

  return {
    list(): Promise<RoomDoc[]> {
      return rooms.find().sort({ name: 1 }).toArray();
    },

    async create(input: { name: string; private?: boolean }): Promise<RoomDoc> {
      const now = ctx.now();
      const doc = parseDocument(roomDocSchema, {
        _id: newId<RoomId>(),
        patientId: ctx.patientId,
        name: input.name.trim(),
        normalizedName: normalizeLookupKey(input.name),
        private: input.private ?? false,
        createdAt: now,
        updatedAt: now,
      });
      await rooms.insertOne(doc).catch(rethrowNameConflict);
      await bumpConfigVersion(ctx);
      return doc;
    },

    async update(id: RoomId, patch: { name?: string; private?: boolean }): Promise<RoomDoc | null> {
      const changes = parseDocument(roomPatch, {
        updatedAt: ctx.now(),
        ...(patch.name !== undefined && { name: patch.name.trim(), normalizedName: normalizeLookupKey(patch.name) }),
        ...(patch.private !== undefined && { private: patch.private }),
      });
      const updated = await rooms.findOneAndUpdate({ _id: id }, { $set: changes }).catch(rethrowNameConflict);
      if (updated) await bumpConfigVersion(ctx);
      return updated;
    },
  };
}

export type RoomsRepo = ReturnType<typeof roomsRepo>;
