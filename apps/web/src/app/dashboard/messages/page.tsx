import type { NotificationDoc } from "@memory-glasses/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { MessageForm } from "@/components/dashboard/message-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { dayAndTime } from "@/lib/format";
import { dashboardTenant } from "@/lib/server/dashboard";

function statusBadge(notification: NotificationDoc, now: Date) {
  if (notification.kind === "lost_alert") return <Badge variant="destructive">Lost alert</Badge>;
  if (notification.status === "shown") return <Badge variant="outline">Spoken</Badge>;
  if (notification.status === "expired") return <Badge variant="outline">Expired</Badge>;
  if (notification.showAt > now) return <Badge variant="secondary">Scheduled</Badge>;
  return <Badge>Waiting to be spoken</Badge>;
}

export default async function MessagesPage() {
  const { tenant, settings } = await dashboardTenant("/dashboard/messages");
  const notifications = await tenant.notifications.listRecent({ limit: 30 });
  const now = new Date();

  return (
    <div className="flex flex-col gap-8">
      <AutoRefresh intervalMs={5000} />
      <PageHeader
        title="Messages"
        description="The wear page reads these to the wearer, one at a time, never over an answer."
      />
      <div className="grid gap-8 lg:grid-cols-2">
        <section className="flex max-w-xl flex-col gap-3">
          <h2 className="text-lg font-semibold">New</h2>
          <MessageForm />
        </section>

        <section className="flex min-w-0 flex-col gap-3">
          <h2 className="text-lg font-semibold">Recent</h2>
          {notifications.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nothing sent yet.
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {notifications.map((notification) => (
                <li
                  key={notification._id.toHexString()}
                  className="flex flex-col gap-2 rounded-xl p-4 ring-1 ring-foreground/10"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                    <span>
                      {notification.kind === "reminder"
                        ? "Reminder for "
                        : notification.kind === "lost_alert"
                          ? "Lost alert, "
                          : "Message, "}
                      {dayAndTime(notification.showAt, settings.timezone)}
                    </span>
                    {statusBadge(notification, now)}
                  </div>
                  <p className="text-base">{notification.text}</p>
                  {notification.shownAt && (
                    <p className="text-xs text-muted-foreground">
                      Spoken {dayAndTime(notification.shownAt, settings.timezone)}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
