import { parseDocument } from "../errors";
import { newId, type CaregiverId, type NotificationId } from "../ids";
import { notificationDocSchema, type NotificationDoc } from "../schema/notifications";
import { expiresAt, tenantCollection, type RepoContext } from "./context";

export type NewNotification = {
  kind: NotificationDoc["kind"];
  text: string;
  /** Reminders only. A caregiver message is due at once. */
  showAt?: Date;
  createdBy?: CaregiverId | null;
};

/** Caregiver messages and reminders for the HUD. Optional after M3. */
export function notificationsRepo(ctx: RepoContext) {
  const notifications = tenantCollection(ctx, "notifications");

  return {
    async create(input: NewNotification): Promise<NotificationDoc> {
      const now = ctx.now();
      const showAt = input.kind === "reminder" && input.showAt ? input.showAt : now;
      const doc = parseDocument(notificationDocSchema, {
        _id: newId<NotificationId>(),
        patientId: ctx.patientId,
        kind: input.kind,
        text: input.text,
        createdBy: input.createdBy ?? null,
        showAt,
        status: "queued",
        shownAt: null,
        createdAt: now,
        expiresAt: expiresAt(ctx, showAt),
      });
      await notifications.insertOne(doc);
      return doc;
    },

    /** The one notification the HUD should show next. One at a time, oldest due first. */
    nextDue(): Promise<NotificationDoc | null> {
      const now = ctx.now();
      return notifications.findOne(
        { status: "queued", showAt: { $lte: now }, expiresAt: { $gt: now } },
        { sort: { showAt: 1 } },
      );
    },

    /** Queued to shown, once. A second device marking the same one gets null back. */
    markShown(id: NotificationId): Promise<NotificationDoc | null> {
      return notifications.findOneAndUpdate(
        { _id: id, status: "queued" },
        { $set: { status: "shown", shownAt: ctx.now() } },
      );
    },

    listRecent({ limit = 50 }: { limit?: number } = {}): Promise<NotificationDoc[]> {
      return notifications
        .find({ expiresAt: { $gt: ctx.now() } })
        .sort({ showAt: -1 })
        .limit(Math.min(limit, 200))
        .toArray();
    },
  };
}

export type NotificationsRepo = ReturnType<typeof notificationsRepo>;
