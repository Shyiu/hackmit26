import type { DangerEventId } from "../ids";
import type { DangerEventDoc } from "../schema/safety";
import { tenantCollection, type RepoContext } from "./context";

export type DangerEventQuery = {
  status?: DangerEventDoc["status"];
  limit?: number;
};

/**
 * Hazard events the perception service raised for this wearer. Perception
 * writes them (services/perception/app/safety/store.py); the dashboard reads
 * and acknowledges them here.
 */
export function dangerEventsRepo(ctx: RepoContext) {
  const events = tenantCollection(ctx, "dangerEvents");

  return {
    listRecent({ status, limit = 50 }: DangerEventQuery = {}): Promise<DangerEventDoc[]> {
      return events
        .find({ ...(status && { status }), expiresAt: { $gt: ctx.now() } })
        .sort({ lastSeenAt: -1 })
        .limit(Math.min(limit, 200))
        .toArray();
    },

    get(id: DangerEventId): Promise<DangerEventDoc | null> {
      return events.findOne({ _id: id });
    },

    countOpen(): Promise<number> {
      return events.countDocuments({ status: "open", expiresAt: { $gt: ctx.now() } });
    },

    /** Open to acknowledged, once. Any other status, or another wearer's event, gets null. */
    acknowledge(id: DangerEventId, { by }: { by: string }): Promise<DangerEventDoc | null> {
      const now = ctx.now();
      return events.findOneAndUpdate(
        { _id: id, status: "open" },
        { $set: { status: "acknowledged", acknowledgedAt: now, acknowledgedBy: by, updatedAt: now } },
      );
    },
  };
}

export type DangerEventsRepo = ReturnType<typeof dangerEventsRepo>;
