import { parseDocument } from "../errors";
import { newId, type DeviceId } from "../ids";
import type { CaptureSource } from "../schema/common";
import { deviceDocSchema, type DeviceDoc } from "../schema/tenancy";
import { tenantCollection, type RepoContext } from "./context";

/** Capture clients. Tokens embed `tokenVersion`, so revoking bumps it. */
export function devicesRepo(ctx: RepoContext) {
  const devices = tenantCollection(ctx, "devices");

  return {
    async register(input: { kind: CaptureSource; label: string }): Promise<DeviceDoc> {
      const now = ctx.now();
      const doc = parseDocument(deviceDocSchema, {
        _id: newId<DeviceId>(),
        patientId: ctx.patientId,
        kind: input.kind,
        label: input.label,
        tokenVersion: 0,
        lastSeenAt: null,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      await devices.insertOne(doc);
      return doc;
    },

    /** A device that can still get tokens. Revoked devices come back null. */
    getActive(id: DeviceId): Promise<DeviceDoc | null> {
      return devices.findOne({ _id: id, revokedAt: null });
    },

    list(): Promise<DeviceDoc[]> {
      return devices.find().sort({ createdAt: -1 }).toArray();
    },

    async touch(id: DeviceId): Promise<void> {
      await devices.updateOne({ _id: id }, { $set: { lastSeenAt: ctx.now() } });
    },

    revoke(id: DeviceId): Promise<DeviceDoc | null> {
      const now = ctx.now();
      return devices.findOneAndUpdate(
        { _id: id },
        { $set: { revokedAt: now, updatedAt: now }, $inc: { tokenVersion: 1 } },
      );
    },
  };
}

export type DevicesRepo = ReturnType<typeof devicesRepo>;
