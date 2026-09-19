import type { Db } from "mongodb";
import { parseDocument } from "./errors";
import { newId, type CaregiverId, type PatientId } from "./ids";
import { collection } from "./registry";
import {
  caregiverDocSchema,
  DEFAULT_PATIENT_SETTINGS,
  patientDocSchema,
  type CaregiverDoc,
  type PatientDoc,
  type PatientSettings,
} from "./schema/tenancy";

// Cross-tenant operations: logging in, and creating wearers. Everything a
// logged-in caregiver does after that goes through tenantRepos.

export function findCaregiverByEmail(db: Db, email: string): Promise<CaregiverDoc | null> {
  return collection(db, "caregivers").findOne({ email: email.trim().toLowerCase() });
}

export async function recordLogin(db: Db, id: CaregiverId, at = new Date()): Promise<void> {
  await collection(db, "caregivers").updateOne({ _id: id }, { $set: { lastLoginAt: at } });
}

export async function createPatient(
  db: Db,
  input: { displayName: string; settings?: Partial<PatientSettings>; id?: PatientId },
  now = new Date(),
): Promise<PatientDoc> {
  const doc = parseDocument(patientDocSchema, {
    _id: input.id ?? newId<PatientId>(),
    displayName: input.displayName,
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
  input: { email: string; name: string; patientIds: PatientId[]; id?: CaregiverId },
  now = new Date(),
): Promise<CaregiverDoc> {
  const doc = parseDocument(caregiverDocSchema, {
    _id: input.id ?? newId<CaregiverId>(),
    email: input.email.trim().toLowerCase(),
    name: input.name,
    patientIds: input.patientIds,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await collection(db, "caregivers").insertOne(doc);
  return doc;
}
