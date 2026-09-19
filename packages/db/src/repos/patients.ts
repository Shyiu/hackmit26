import { parseDocument } from "../errors";
import { collection } from "../registry";
import { patientSettingsSchema, type PatientDoc, type PatientSettings } from "../schema/tenancy";
import { tenantCollection, type RepoContext } from "./context";

/** The wearer's own document, their settings, and their capture state. */
export function patientRepo(ctx: RepoContext) {
  const patients = collection(ctx.db, "patients");
  const captureSessions = tenantCollection(ctx, "captureSessions");

  return {
    get(): Promise<PatientDoc | null> {
      return patients.findOne({ _id: ctx.patientId });
    },

    /** Merges and re-validates the whole settings object, then bumps `configVersion`. */
    async updateSettings(patch: Partial<PatientSettings>): Promise<PatientDoc | null> {
      const current = await patients.findOne({ _id: ctx.patientId });
      if (!current) return null;
      const settings = parseDocument(patientSettingsSchema, { ...current.settings, ...patch });
      return patients.findOneAndUpdate(
        { _id: ctx.patientId },
        { $set: { settings, updatedAt: ctx.now() }, $inc: { configVersion: 1 } },
        { returnDocument: "after" },
      );
    },

    /** The newest capture session, for the paused, live, or disconnected badge. */
    latestCaptureSession() {
      return captureSessions.findOne({}, { sort: { startedAt: -1 } });
    },
  };
}

export type PatientRepo = ReturnType<typeof patientRepo>;
