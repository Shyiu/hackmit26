// Seeds one demo wearer, a caregiver login, three items, two open hazard
// events for the Alerts tab, and sightings that
// exercise the answer wording: one item seen resting, one picked up after it
// was put down, one still waiting for its description.
//
//   pnpm db:seed           seed once; a second run changes nothing
//   pnpm db:seed --reset   delete the demo wearer's data and seed again
//
// Every run also pins the demo items in the bundled 3D room, where a pin is missing.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  collection,
  collections,
  createCaregiver,
  createPatient,
  locationStatus,
  newId,
  parseDocument,
  parseId,
  scanPinDocSchema,
  tenantRepos,
  type CaregiverId,
  type Db,
  type PatientId,
  type ScanPinId,
} from "@memory-glasses/db";
import { seedDangerEvent, seedObservation } from "@memory-glasses/db/observations";
import { STATIC_SCAN_SCENE_ID } from "@memory-glasses/shared";
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

  const DAY = 24 * 60 * MINUTE;
  // History behind the usual spot: three days at the kitchen counter, one
  // elsewhere. Each is far enough apart to count as its own placement.
  for (const daysAgo of [1, 2, 3]) {
    await observe(keys, {
      lastSeenAt: new Date(now - daysAgo * DAY),
      state: "resting",
      description: {
        status: "ready",
        sentence: "on the kitchen counter, next to the coffee maker",
        room: "kitchen",
        surface: "counter",
        relation: "next to the coffee maker",
      },
    });
  }
  await observe(keys, {
    lastSeenAt: new Date(now - 4 * DAY),
    state: "resting",
    description: { status: "ready", sentence: "on the hallway table", room: "hallway", surface: "table" },
  });
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

  await tenant.items.recomputeUsualSpots(keys._id);
  await tenant.items.recomputeUsualSpots(wallet._id);

  for (const item of await tenant.items.list()) {
    const usual = item.usualSpots[0];
    console.log(
      `${item.name.padEnd(8)} ${locationStatus(item.lastSighting)}  ${item.lastSighting?.sentence ?? ""}` +
        (usual ? `  | usually ${usual.sentence} (${Math.round(usual.share * 100)}%, ${usual.samples}x)` : ""),
    );
  }
}

// By name, not by list position: an item the caregiver adds later must not shift the
// order and pick up a made-up pin. Same order the first version of this seed produced.
const ANCHOR_BY_NAME: Record<string, number> = { glasses: 0, keys: 1, wallet: 2 };

const SCENE_FILE = fileURLToPath(new URL("../apps/web/public/scan/room/scene.json", import.meta.url));

/**
 * One pin per seeded demo item in the bundled room, at the anchors its scene.json
 * lists. Insert only: a pin the caregiver moved by hand survives a reseed.
 */
async function seedScanPins(db: Db) {
  if (!existsSync(SCENE_FILE)) {
    console.log(`No ${SCENE_FILE}, so no 3D room pins were seeded.`);
    return;
  }
  const scene = JSON.parse(readFileSync(SCENE_FILE, "utf8")) as { anchors?: { position?: unknown }[] };
  const anchors = scene.anchors ?? [];
  const items = await tenantRepos(db, DEMO_PATIENT_ID).items.list();
  const now = new Date();
  let added = 0;
  for (const item of items) {
    const index = ANCHOR_BY_NAME[item.name];
    const anchor = index === undefined ? undefined : anchors[index];
    if (!anchor) continue;
    const { patientId, itemId, sceneId, ...rest } = parseDocument(scanPinDocSchema, {
      _id: newId<ScanPinId>(),
      patientId: DEMO_PATIENT_ID,
      itemId: item._id,
      sceneId: STATIC_SCAN_SCENE_ID,
      position: anchor.position,
      observation: null,
      source: "seed",
      seenAt: item.lastSighting?.lastSeenAt ?? now,
      updatedAt: now,
    });
    const result = await collection(db, "scanPins").updateOne(
      { patientId, itemId, sceneId },
      { $setOnInsert: rest },
      { upsert: true },
    );
    added += result.upsertedCount;
  }
  console.log(`3D room pins: ${added} added for ${items.length} item(s), ${anchors.length} anchor(s) in scene.json`);
}

await withDatabase(async (db) => {
  if (process.argv.includes("--reset")) await reset(db);
  if (await collection(db, "patients").findOne({ _id: DEMO_PATIENT_ID })) {
    console.log("The demo wearer is already seeded. Pass --reset to start over.");
  } else {
    await seed(db);
    console.log(`\nDemo wearer ${DEMO_PATIENT_ID.toHexString()}, caregiver login ${process.env.CAREGIVER_EMAIL || "caregiver@example.com"}`);
  }
  await seedScanPins(db);
});
