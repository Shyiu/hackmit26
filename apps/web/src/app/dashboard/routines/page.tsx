import type { RoutineDoc } from "@memory-glasses/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { RoutineForm } from "@/components/dashboard/routine-form";
import { RoutineToggle } from "@/components/dashboard/routine-toggle";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { dayAndTime } from "@/lib/format";
import { dashboardTenant } from "@/lib/server/dashboard";

function triggerLabel(trigger: RoutineDoc["trigger"]) {
  if (trigger.kind === "leaving") return `When leaving with ${trigger.itemName}, ${trigger.windowMinutes} min window`;
  const [hour, minute] = trigger.at.split(":").map(Number);
  return `Daily at ${new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(
    new Date(Date.UTC(2020, 0, 1, hour, minute)),
  )}`;
}

export default async function RoutinesPage() {
  const { tenant, settings } = await dashboardTenant("/dashboard/routines");
  const routines = await tenant.routines.list();

  return (
    <div className="flex flex-col gap-8">
      <AutoRefresh intervalMs={5000} />
      <PageHeader
        title="Routines"
        description="Reminders the system speaks on its own. Time routines fire at the set time in the wearer's day; leaving-the-house routines are saved but not evaluated yet."
      />
      <div className="grid gap-8 lg:grid-cols-2">
        <section className="flex max-w-xl flex-col gap-3">
          <h2 className="text-lg font-semibold">New routine</h2>
          <RoutineForm />
        </section>
        <section className="flex min-w-0 flex-col gap-3">
          <h2 className="text-lg font-semibold">Saved routines</h2>
          {routines.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No routines yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {routines.map((routine) => (
                <li key={routine._id.toHexString()} className="flex flex-col gap-3 rounded-xl p-4 ring-1 ring-foreground/10">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-lg font-semibold">{routine.name}</h3>
                      <Badge variant="secondary">{triggerLabel(routine.trigger)}</Badge>
                    </div>
                    <RoutineToggle id={routine._id.toHexString()} active={routine.active} />
                  </div>
                  <p>{routine.text}</p>
                  <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                    <span>{routine.lastFiredAt ? `Last fired ${dayAndTime(routine.lastFiredAt, settings.timezone)}` : "Never fired"}</span>
                    <span>Cooldown {routine.cooldownMinutes} minutes</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
