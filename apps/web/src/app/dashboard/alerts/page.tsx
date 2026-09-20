import type { DangerEventDoc } from "@memory-glasses/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { AcknowledgeAlertButton } from "@/components/dashboard/acknowledge-alert-button";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { dayAndTime } from "@/lib/format";
import { dashboardTenant } from "@/lib/server/dashboard";

export const metadata = { title: "Alerts" };

const KIND_LABELS: Record<DangerEventDoc["kind"], string> = {
  unknown_face: "Unknown person",
  weapon_visible: "Weapon visible",
  medication_or_chemical_visible: "Medication or chemical",
  hot_surface_visible: "Hot surface",
  hazard_visible: "Hazard",
};

const VERIFICATION_LABELS: Record<DangerEventDoc["verification"], string> = {
  unverified: "Not yet verified",
  model_confirmed: "Confirmed by model",
  model_rejected: "Rejected by model",
};

function severityBadge(severity: DangerEventDoc["severity"]) {
  if (severity === "high") return <Badge variant="destructive">High</Badge>;
  if (severity === "medium") return <Badge>Medium</Badge>;
  return <Badge variant="secondary">Low</Badge>;
}

function statusBadge(status: DangerEventDoc["status"]) {
  if (status === "open") return <Badge variant="destructive">Open</Badge>;
  if (status === "escalated") return <Badge>Escalated</Badge>;
  return <Badge variant="outline">{status[0]?.toUpperCase() + status.slice(1)}</Badge>;
}

export default async function AlertsPage() {
  const { tenant, settings } = await dashboardTenant("/dashboard/alerts");
  const [events, notifications] = await Promise.all([
    tenant.dangerEvents.listRecent({ limit: 50 }),
    tenant.notifications.listRecent({ limit: 50 }),
  ]);
  const alerts = notifications.filter((notification) => notification.kind === "danger_alert");
  const open = events.filter((event) => event.status === "open").length;

  return (
    <div className="flex flex-col gap-8">
      <AutoRefresh intervalMs={5000} />
      <PageHeader
        title="Alerts"
        description={
          open === 0
            ? "Hazards the camera has raised. Nothing is waiting on you."
            : `${open} open ${open === 1 ? "alert needs" : "alerts need"} a look.`
        }
      />
      <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
        <section className="flex min-w-0 flex-col gap-3">
          <h2 className="text-lg font-semibold">Hazards</h2>
          {events.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              No hazards seen. Events show up here when the camera spots something risky.
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {events.map((event) => (
                <li
                  key={event._id.toHexString()}
                  className="flex flex-col gap-2 rounded-xl p-4 ring-1 ring-foreground/10"
                  data-status={event.status}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold">{KIND_LABELS[event.kind]}</span>
                      {event.hazardLabel && <span className="text-sm text-muted-foreground">{event.hazardLabel}</span>}
                      {severityBadge(event.severity)}
                    </div>
                    {statusBadge(event.status)}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs text-muted-foreground">Confidence</dt>
                      <dd>{Math.round(event.confidence * 100)}%</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Verification</dt>
                      <dd>{VERIFICATION_LABELS[event.verification]}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">First seen</dt>
                      <dd>{dayAndTime(event.firstSeenAt, settings.timezone)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Last seen</dt>
                      <dd>{dayAndTime(event.lastSeenAt, settings.timezone)}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {event.acknowledgedAt
                        ? `Acknowledged ${dayAndTime(event.acknowledgedAt, settings.timezone)}`
                        : event.status === "open"
                          ? "Nobody has acknowledged this yet."
                          : ""}
                    </p>
                    {event.status === "open" && <AcknowledgeAlertButton id={event._id.toHexString()} />}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="flex min-w-0 flex-col gap-3">
          <h2 className="text-lg font-semibold">Recent alert notifications</h2>
          {alerts.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              No alerts have been sent yet.
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {alerts.map((notification) => (
                <li
                  key={notification._id.toHexString()}
                  className="flex flex-col gap-1 rounded-xl p-4 ring-1 ring-foreground/10"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                    <span>Danger alert, {dayAndTime(notification.showAt, settings.timezone)}</span>
                    <Badge variant="outline">{notification.status === "shown" ? "Spoken" : notification.status}</Badge>
                  </div>
                  <p className="text-base">{notification.text}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
