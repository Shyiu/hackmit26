import type { Db } from "mongodb";
import { parseDocument } from "./errors";
import { newId, type CaregiverId, type DeviceId, type PatientId } from "./ids";
import { collection } from "./registry";
import {
  caregiverDocSchema,
  caregiverPreferencesSchema,
  DEFAULT_CAREGIVER_PREFERENCES,
  DEFAULT_PATIENT_SETTINGS,
  patientDocSchema,
  type CaregiverDoc,
  type CaregiverPreferences,
  type PatientDoc,
  type PatientSettings,
  type WearerAccount,
} from "./schema/tenancy";

// Cross-tenant operations: logging in, and creating wearers. Everything a
// logged-in caregiver does after that goes through tenantRepos.

export function findCaregiverByEmail(db: Db, email: string): Promise<CaregiverDoc | null> {
  return collection(db, "caregivers").findOne({ email: email.trim().toLowerCase() });
}

/** The wearer behind their own sign-in. Wearers a caregiver created have no account. */
export function findPatientByAccountEmail(db: Db, email: string): Promise<PatientDoc | null> {
  return collection(db, "patients").findOne({ "account.email": email.trim().toLowerCase() });
}

export function findCaregiverById(db: Db, id: CaregiverId): Promise<CaregiverDoc | null> {
  return collection(db, "caregivers").findOne({ _id: id });
}

export function caregiverPreferences(caregiver: Pick<CaregiverDoc, "preferences"> | null): CaregiverPreferences {
  return { ...DEFAULT_CAREGIVER_PREFERENCES, ...caregiver?.preferences };
}

/** Merges into the caregiver's own preferences; a missing document leaves null. */
export async function updateCaregiverPreferences(
  db: Db,
  id: CaregiverId,
  patch: Partial<CaregiverPreferences>,
): Promise<CaregiverDoc | null> {
  const current = await findCaregiverById(db, id);
  if (!current) return null;
  const preferences = caregiverPreferencesSchema.parse({ ...caregiverPreferences(current), ...patch });
  return collection(db, "caregivers").findOneAndUpdate(
    { _id: id },
    { $set: { preferences, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
}

export function findPatientById(db: Db, id: PatientId): Promise<PatientDoc | null> {
  return collection(db, "patients").findOne({ _id: id });
}

/** The device the wearer's account signs in on. Their old one stops being them. */
export async function setWearerAccountDevice(db: Db, id: PatientId, deviceId: DeviceId): Promise<void> {
  await collection(db, "patients").updateOne(
    { _id: id, account: { $exists: true } },
    { $set: { "account.deviceId": deviceId, updatedAt: new Date() } },
  );
}

/** Whether any caregiver has joined this wearer yet, which is what a pairing code buys. */
export async function patientHasCaregiver(db: Db, patientId: PatientId): Promise<boolean> {
  return (await collection(db, "caregivers").countDocuments({ patientIds: patientId }, { limit: 1 })) > 0;
}

export function listPatientsByIds(
  db: Db,
  ids: PatientId[],
): Promise<Array<Pick<PatientDoc, "_id" | "displayName">>> {
  return collection(db, "patients")
    .find({ _id: { $in: ids } })
    .project<Pick<PatientDoc, "_id" | "displayName">>({ _id: 1, displayName: 1 })
    .toArray();
}

export async function recordLogin(db: Db, id: CaregiverId, at = new Date()): Promise<void> {
  await collection(db, "caregivers").updateOne({ _id: id }, { $set: { lastLoginAt: at } });
}

export async function createPatient(
  db: Db,
  input: {
    displayName: string;
    /** Set only when the wearer signs themselves up and needs to sign back in. */
    account?: Omit<WearerAccount, "deviceId">;
    settings?: Partial<PatientSettings>;
    id?: PatientId;
  },
  now = new Date(),
): Promise<PatientDoc> {
  const doc = parseDocument(patientDocSchema, {
    _id: input.id ?? newId<PatientId>(),
    displayName: input.displayName,
    ...(input.account && {
      account: { ...input.account, email: input.account.email.trim().toLowerCase(), deviceId: null },
    }),
    settings: { ...DEFAULT_PATIENT_SETTINGS, ...input.settings },
    configVersion: 0,
    createdAt: now,
    updatedAt: now,
  });
  await collection(db, "patients").insertOne(doc);
  return doc;
}

export async function createCaregiver(
  db: Db,
  input: { email: string; name: string; patientIds: PatientId[]; passwordHash?: string; id?: CaregiverId },
  now = new Date(),
): Promise<CaregiverDoc> {
  const doc = parseDocument(caregiverDocSchema, {
    _id: input.id ?? newId<CaregiverId>(),
    email: input.email.trim().toLowerCase(),
    name: input.name,
    patientIds: input.patientIds,
    ...(input.passwordHash && { passwordHash: input.passwordHash }),
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await collection(db, "caregivers").insertOne(doc);
  return doc;
}
