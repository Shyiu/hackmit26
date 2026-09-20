import { parseDocument } from "../errors";
import { newId, type CaregiverId, type PushSubscriptionId } from "../ids";
import { collection } from "../registry";
import { pushSubscriptionDocSchema, type PushSubscriptionDoc } from "../schema/push";
import { tenantCollection, type RepoContext } from "./context";

/** A subscription nobody has pushed to or refreshed for this long is dropped. */
export const PUSH_SUBSCRIPTION_TTL_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

export type NewPushSubscription = {
  caregiverId: CaregiverId;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
};

/** Caregiver browsers that get danger and lost alerts over Web Push. */
export function pushSubscriptionsRepo(ctx: RepoContext) {
  const subscriptions = tenantCollection(ctx, "pushSubscriptions");

  return {
    /**
     * Registers a browser, or refreshes it if that endpoint is already known.
     * An endpoint identifies one browser profile, so one that last subscribed
     * for another wearer is moved to this one rather than left paging both.
     */
    async upsertByEndpoint(input: NewPushSubscription): Promise<PushSubscriptionDoc> {
      const now = ctx.now();
      const doc = parseDocument(pushSubscriptionDocSchema, {
        _id: newId<PushSubscriptionId>(),
        patientId: ctx.patientId,
        caregiverId: input.caregiverId,
        endpoint: input.endpoint,
        keys: input.keys,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
        createdAt: now,
        lastUsedAt: null,
        expiresAt: new Date(now.getTime() + PUSH_SUBSCRIPTION_TTL_DAYS * DAY_MS),
      });
      await collection(ctx.db, "pushSubscriptions").deleteOne({
        endpoint: input.endpoint,
        patientId: { $ne: ctx.patientId },
      });
      const { doc: saved } = await subscriptions.upsertOne(
        { endpoint: input.endpoint },
        {
          $set: { caregiverId: doc.caregiverId, keys: doc.keys, userAgent: doc.userAgent, expiresAt: doc.expiresAt },
          $setOnInsert: { _id: doc._id, createdAt: doc.createdAt, lastUsedAt: null },
        },
      );
      return saved;
    },

    listForPatient(): Promise<PushSubscriptionDoc[]> {
      return subscriptions
        .find({ expiresAt: { $gt: ctx.now() } })
        .sort({ createdAt: -1 })
        .toArray();
    },

    /** True when a subscription of this wearer was removed. */
    async deleteByEndpoint(endpoint: string): Promise<boolean> {
      const result = await subscriptions.deleteMany({ endpoint });
      return result.deletedCount === 1;
    },

    /** After a successful send: keeps the subscription from ageing out. */
    async markUsed(id: PushSubscriptionId): Promise<void> {
      const now = ctx.now();
      await subscriptions.updateOne(
        { _id: id },
        { $set: { lastUsedAt: now, expiresAt: new Date(now.getTime() + PUSH_SUBSCRIPTION_TTL_DAYS * DAY_MS) } },
      );
    },
  };
}

export type PushSubscriptionsRepo = ReturnType<typeof pushSubscriptionsRepo>;
