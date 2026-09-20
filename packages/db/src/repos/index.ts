import type { Db } from "mongodb";
import type { PatientId } from "../ids";
import { DEFAULT_PATIENT_SETTINGS } from "../schema/tenancy";
import type { RepoContext } from "./context";
import { devicesRepo } from "./devices";
import { interactionsRepo } from "./interactions";
import { itemsRepo } from "./items";
import { notificationsRepo } from "./notifications";
import { patientRepo } from "./patients";
import { roomsRepo } from "./rooms";
import { routinesRepo } from "./routines";
import { sightingsRepo } from "./sightings";

export type TenantOptions = {
  /** From the wearer's settings. Defaults to 30 days. */
  retentionDays?: number;
  /** Injected for tests. */
  now?: () => Date;
};

/**
 * Every repository for one wearer. `patientId` must come from an authenticated
 * session or device token, never a request body; see apps/web/src/lib/auth.
 */
export function tenantRepos(db: Db, patientId: PatientId, options: TenantOptions = {}) {
  const ctx: RepoContext = {
    db,
    patientId,
    retentionDays: options.retentionDays ?? DEFAULT_PATIENT_SETTINGS.retentionDays,
    now: options.now ?? (() => new Date()),
  };
  return {
    patientId,
    patient: patientRepo(ctx),
    items: itemsRepo(ctx),
    sightings: sightingsRepo(ctx),
    interactions: interactionsRepo(ctx),
    rooms: roomsRepo(ctx),
    routines: routinesRepo(ctx),
    notifications: notificationsRepo(ctx),
    devices: devicesRepo(ctx),
  };
}

export type TenantRepos = ReturnType<typeof tenantRepos>;
