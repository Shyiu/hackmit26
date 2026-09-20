import type { NotificationDoc } from "@memory-glasses/db";
import { MessageSquare } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { MessageForm } from "@/components/dashboard/message-form";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { EmptyState, Section, listBlockClass } from "@/components/dashboard/section";
import { Badge } from "@/components/ui/badge";
import { dayAndTime } from "@/lib/format";
import { dashboardTenant } from "@/lib/server/dashboard";

function statusBadge(notification: NotificationDoc, now: Date) {
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
    <>
      <AutoRefresh intervalMs={5000} />
      <PageHeader
        title="Messages"
        icon={MessageSquare}
        description="The wear page reads these to the wearer, one at a time, never over an answer."
      />
      <PageBody>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="New">
          <MessageForm />
        </Section>

        <Section title="Recent">
          {notifications.length === 0 ? (
            <EmptyState>Nothing sent yet.</EmptyState>
          ) : (
            <ol className={listBlockClass}>
              {notifications.map((notification) => (
                <li
                  key={notification._id.toHexString()}
                  className="flex flex-col gap-1 px-3 py-2.5 transition-colors hover:bg-row-hover"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {notification.kind === "reminder" ? "Reminder for " : "Message, "}
                      {dayAndTime(notification.showAt, settings.timezone)}
                    </span>
                    {statusBadge(notification, now)}
                  </div>
                  <p className="text-sm">{notification.text}</p>
                  {notification.shownAt && (
                    <p className="text-xs text-muted-foreground">
                      Spoken {dayAndTime(notification.shownAt, settings.timezone)}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>
      </PageBody>
    </>
  );
}
