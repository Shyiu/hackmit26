import "server-only";
import type { RoutineDoc, TenantRepos } from "@memory-glasses/db";

/** Minutes since local midnight of `date` in `timeZone`, and the local day key. */
export function localClock(date: Date, timeZone: string): { dayKey: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    dayKey: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

function scheduledMinutes(routine: RoutineDoc): number | null {
  // `leaving` routines are stored and shown but never fire yet: they need the
  // enrolled "door" room and recent sightings of the named item (README
  // "Proactive reminders"), neither of which exists in the pipeline so far.
  if (routine.trigger.kind !== "time") return null;
  const [hours, minutes] = routine.trigger.at.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Active time routines due today in the wearer's zone and outside cooldown. */
export function dueRoutines(routines: RoutineDoc[], now: Date, timeZone: string): RoutineDoc[] {
  const today = localClock(now, timeZone);
  return routines.filter((routine) => {
    const atMinutes = scheduledMinutes(routine);
    if (!routine.active || atMinutes === null || today.minutes < atMinutes) return false;
    if (routine.lastFiredAt) {
      const fired = localClock(routine.lastFiredAt, timeZone);
      const firedSinceScheduled =
        fired.dayKey > today.dayKey || (fired.dayKey === today.dayKey && fired.minutes >= atMinutes);
      if (firedSinceScheduled) return false;
      if (now.getTime() - routine.lastFiredAt.getTime() < routine.cooldownMinutes * 60_000) return false;
    }
    return true;
  });
}

/** Fires due routines once, even when multiple device polls race. */
export async function fireDueRoutines(tenant: TenantRepos, timeZone: string, now = new Date()): Promise<number> {
  const due = dueRoutines(await tenant.routines.list(), now, timeZone);
  let fired = 0;
  for (const routine of due) {
    const updated = await tenant.routines.markFired(routine._id, routine.lastFiredAt);
    if (!updated) continue;
    await tenant.notifications.create({ kind: "proactive_reminder", text: routine.text, createdBy: null });
    fired += 1;
  }
  return fired;
}
