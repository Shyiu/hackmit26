// Seeds one demo wearer, a caregiver login, three items, two open hazard
// events for the Alerts tab, and sightings that
// exercise the answer wording: one item seen resting, one picked up after it
// was put down, one still waiting for its description.
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
    console.log(`${item.name.padEnd(8)} ${locationStatus(item.lastSighting)}  ${item.lastSighting?.sentence ?? ""}`);
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
