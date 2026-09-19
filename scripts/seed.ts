import { MongoClient, ObjectId } from "mongodb";

// Seeds one demo wearer, a few items, and a sighting per item, matching the
// shapes in README.md "Data model". Enough for the dashboard and /api/ask
// fast path to have something to read once those are wired up.
async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB ?? "memory_glasses");

  const patientId = "demo-patient";
  const retentionMs = 30 * 24 * 60 * 60 * 1000; // 30 day default retention

  await db.collection<{ _id: string; name: string }>("patients").updateOne(
    { _id: patientId },
    { $set: { name: "Demo wearer" } },
    { upsert: true }
  );

  await db
    .collection<{ _id: string; patientId: string; name: string }>("caregivers")
    .updateOne(
      { _id: "demo-caregiver" },
      { $set: { patientId, name: "Demo caregiver" } },
      { upsert: true }
    );

  const now = new Date();
  const sessionId = new ObjectId().toString();
  const items = [
    {
      name: "keys",
      aliases: ["car keys", "house keys", "key ring"],
      detectorPrompts: ["keys", "key ring"],
      sentence: "on the kitchen counter, next to the coffee maker",
      room: "kitchen",
    },
    {
      name: "wallet",
      aliases: ["billfold"],
      detectorPrompts: ["wallet"],
      sentence: "on the hallway table",
      room: "hallway",
    },
    {
      name: "glasses",
      aliases: ["eyeglasses", "reading glasses"],
      detectorPrompts: ["glasses", "eyeglasses"],
      sentence: "on the nightstand",
      room: "bedroom",
    },
  ];

  for (const item of items) {
    const itemId = new ObjectId();
    const sightingId = new ObjectId();
    const lastSeenAt = new Date(now.getTime() - 20 * 60 * 1000);
    const observationVersion = 1;
    const keyframeRevision = 1;

    const sighting = {
      _id: sightingId,
      patientId,
      itemId,
      label: item.name,
      status: "closed" as const,
      firstSeenAt: new Date(lastSeenAt.getTime() - 5 * 1000),
      lastSeenAt,
      expiresAt: new Date(lastSeenAt.getTime() + retentionMs),
      sessionId,
      eventId: new ObjectId().toString(),
      observationVersion,
      keyframeRevision,
      descriptionStatus: "ready" as const,
      confidence: 0.92,
      bbox: [0.4, 0.5, 0.08, 0.06],
      frameSize: [1280, 720],
      room: { id: item.room, name: item.room, confidence: 0.9 },
      state: "resting" as const,
      sentence: item.sentence,
      nearbyObjects: [],
      source: "simulator" as const,
    };

    await db.collection("sightings").insertOne(sighting);

    const sightingSummary = {
      sightingId: sightingId.toString(),
      observationVersion,
      keyframeRevision,
      sentence: item.sentence,
      room: item.room,
      state: "resting" as const,
      lastSeenAt,
      descriptionStatus: "ready" as const,
    };

    await db.collection("items").updateOne(
      { _id: itemId },
      {
        $set: {
          patientId,
          name: item.name,
          aliases: item.aliases,
          detectorPrompts: item.detectorPrompts,
          referenceImages: [],
          lastSighting: sightingSummary,
          lastRestingSighting: sightingSummary,
          locationStatus: "observed",
          usualSpots: [{ sentence: item.sentence, share: 1 }],
        },
      },
      { upsert: true }
    );

    console.log(`seeded ${item.name}`);
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
