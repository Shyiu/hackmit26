// Seeds one demo wearer, a caregiver login, rooms, the items a person with
// dementia loses most, a caregiver message, a reminder, and two open hazard
// events for the Alerts tab. The first three items' sightings exercise the
// answer wording: one seen resting, one picked up after it was put down, one
// still waiting for its description.
//
// It seeds no `people`. Face records are written by services/perception, which
// encrypts the embeddings, and each one records a real person's consent.
//
//   pnpm db:seed           seed once; a second run changes nothing
//   pnpm db:seed --reset   delete the demo wearer's data and seed again

import {
  collection,
  collections,
  createCaregiver,
  createPatient,
  locationStatus,
  parseId,
  tenantRepos,
  type CaregiverId,
  type Db,
  type PatientId,
} from "@memory-glasses/db";
import { seedDangerEvent, seedObservation } from "@memory-glasses/db/observations";
import { withDatabase } from "./lib/env";

function fixedId<TId extends PatientId | CaregiverId>(hex: string): TId {
  const id = parseId<TId>(hex);
  if (!id) throw new Error(`Bad fixed id ${hex}`);
  return id;
}

// Fixed ids so reseeding finds the same wearer, and so a dev token can name it.
const DEMO_PATIENT_ID = fixedId<PatientId>("5eed00000000000000000001");
const DEMO_CAREGIVER_ID = fixedId<CaregiverId>("5eed000000000000000000ca");
const MINUTE = 60_000;

async function reset(db: Db) {
  for (const spec of Object.values(collections)) {
    if ("patientId" in spec.schema.shape) {
      await db.collection(spec.name).deleteMany({ patientId: DEMO_PATIENT_ID });
    }
  }
  await collection(db, "patients").deleteOne({ _id: DEMO_PATIENT_ID });
  await collection(db, "caregivers").deleteOne({ _id: DEMO_CAREGIVER_ID });
}

async function seed(db: Db) {
  const now = Date.now();
  await createPatient(db, { id: DEMO_PATIENT_ID, displayName: "Demo wearer" });
  await createCaregiver(db, {
    id: DEMO_CAREGIVER_ID,
    email: process.env.CAREGIVER_EMAIL || "caregiver@example.com",
    name: "Demo caregiver",
    patientIds: [DEMO_PATIENT_ID],
  });

  const tenant = tenantRepos(db, DEMO_PATIENT_ID);
  const keys = await tenant.items.create({ name: "keys", aliases: ["car keys", "house keys", "key ring"] });
  const wallet = await tenant.items.create({ name: "wallet", aliases: ["billfold"] });
  const glasses = await tenant.items.create({ name: "glasses", aliases: ["eyeglasses", "reading glasses"] });
  const observe = (item: typeof keys, rest: Omit<Parameters<typeof seedObservation>[1], "patientId" | "itemId" | "label">) =>
    seedObservation(db, { patientId: DEMO_PATIENT_ID, itemId: item._id, label: item.name, ...rest });

  await observe(keys, {
    lastSeenAt: new Date(now - 20 * MINUTE),
    state: "resting",
    description: {
      status: "ready",
      sentence: "on the kitchen counter, next to the coffee maker",
      room: "kitchen",
      surface: "counter",
      relation: "next to the coffee maker",
    },
  });
  await observe(wallet, {
    lastSeenAt: new Date(now - 3 * 60 * MINUTE),
    state: "resting",
    description: { status: "ready", sentence: "on the hallway table", room: "hallway", surface: "table" },
  });
  await observe(wallet, { lastSeenAt: new Date(now - 10 * MINUTE), state: "held", description: { status: "pending" } });
  await observe(glasses, { lastSeenAt: new Date(now - 2 * MINUTE), state: "unknown", description: { status: "pending" } });

  for (const name of ["kitchen", "hallway", "bedroom", "living room"]) await tenant.rooms.create({ name });
  await tenant.rooms.create({ name: "bathroom", private: true });

  const phone = await tenant.items.create({ name: "phone", aliases: ["cell phone", "mobile", "iphone"] });
  const pills = await tenant.items.create({
    name: "pill organizer",
    aliases: ["pills", "medication", "medicine", "pill box"],
    detectorPrompts: ["pill organizer", "pill box"],
  });
  const remote = await tenant.items.create({ name: "remote", aliases: ["tv remote", "remote control", "clicker"] });
  const hearingAids = await tenant.items.create({
    name: "hearing aids",
    aliases: ["hearing aid"],
    detectorPrompts: ["hearing aid", "hearing aid case"],
    plural: true,
  });
  const cane = await tenant.items.create({ name: "cane", aliases: ["walking stick", "walking cane"] });

  await observe(phone, {
    lastSeenAt: new Date(now - 45 * MINUTE),
    state: "resting",
    description: {
      status: "ready",
      sentence: "on the arm of the couch, under a newspaper",
      room: "living room",
      surface: "couch",
      relation: "under a newspaper",
    },
  });
  await observe(pills, {
    lastSeenAt: new Date(now - 6 * 60 * MINUTE),
    state: "resting",
    description: {
      status: "ready",
      sentence: "on the kitchen table, beside the fruit bowl",
      room: "kitchen",
      surface: "table",
      relation: "beside the fruit bowl",
    },
  });
  await observe(remote, {
    lastSeenAt: new Date(now - 90 * MINUTE),
    state: "resting",
    description: { status: "ready", sentence: "on the coffee table", room: "living room", surface: "coffee table" },
  });
  await observe(hearingAids, {
    lastSeenAt: new Date(now - 11 * 60 * MINUTE),
    state: "resting",
    description: {
      status: "ready",
      sentence: "in their case on the nightstand",
      room: "bedroom",
      surface: "nightstand",
      relation: "in their case",
    },
  });
  await observe(cane, {
    lastSeenAt: new Date(now - 30 * MINUTE),
    state: "resting",
    description: {
      status: "ready",
      sentence: "leaning against the wall by the front door",
      room: "hallway",
      relation: "leaning against the wall by the front door",
    },
  });

  await tenant.notifications.create({
    kind: "caregiver_message",
    text: "Hi Mom, I'm coming by at four with groceries.",
    createdBy: DEMO_CAREGIVER_ID,
  });
  await tenant.notifications.create({
    kind: "reminder",
    text: "Time for your evening pills. They are on the kitchen table.",
    showAt: new Date(now + 2 * 60 * MINUTE),
    createdBy: DEMO_CAREGIVER_ID,
  });

  await seedDangerEvent(db, {
    patientId: DEMO_PATIENT_ID,
    kind: "hot_surface_visible",
    hazardLabel: "stove burner",
    severity: "high",
    confidence: 0.91,
    verification: "model_confirmed",
    lastSeenAt: new Date(now - 6 * MINUTE),
  });
  await seedDangerEvent(db, {
    patientId: DEMO_PATIENT_ID,
    kind: "medication_or_chemical_visible",
    hazardLabel: "pill bottle",
    severity: "medium",
    confidence: 0.72,
    lastSeenAt: new Date(now - 45 * MINUTE),
  });
  await tenant.notifications.create({ kind: "danger_alert", text: "The stove looks hot and nobody is nearby." });

  for (const item of await tenant.items.list()) {
    console.log(`${item.name.padEnd(14)} ${locationStatus(item.lastSighting)}  ${item.lastSighting?.sentence ?? ""}`);
  }
}

await withDatabase(async (db) => {
  if (process.argv.includes("--reset")) await reset(db);
  if (await collection(db, "patients").findOne({ _id: DEMO_PATIENT_ID })) {
    console.log("The demo wearer is already seeded. Pass --reset to start over.");
    return;
  }
  await seed(db);
  console.log(`\nDemo wearer ${DEMO_PATIENT_ID.toHexString()}, caregiver login ${process.env.CAREGIVER_EMAIL || "caregiver@example.com"}`);
});
