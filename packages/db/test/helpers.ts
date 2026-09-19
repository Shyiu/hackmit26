import { randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import { createPatient } from "../src/accounts";
import type { PatientId } from "../src/ids";
import { tenantRepos, type TenantOptions } from "../src/repos";
import { syncDatabase } from "../src/setup";

const uri = process.env.MONGODB_TEST_URI ?? "mongodb://127.0.0.1:27017/?directConnection=true";

/** A fresh database on a real MongoDB, synced unless asked not to, dropped by `close`. */
export async function openTestDb({ sync = true }: { sync?: boolean } = {}): Promise<{
  db: Db;
  /** The same database through more clients, each with its own pool, for race tests. */
  moreConnections: (count: number) => Promise<Db[]>;
  close: () => Promise<void>;
}> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3_000 });
  try {
    await client.connect();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The db tests need MongoDB at ${uri}. Run \`pnpm db:up\` or set MONGODB_TEST_URI. (${reason})`,
    );
  }
  const db = client.db(`mg_test_${randomUUID().slice(0, 8)}`);
  if (sync) await syncDatabase(db);
  const extraClients: MongoClient[] = [];
  return {
    db,
    moreConnections: async (count) => {
      const opened = await Promise.all(Array.from({ length: count }, () => new MongoClient(uri).connect()));
      extraClients.push(...opened);
      return opened.map((extra) => extra.db(db.databaseName));
    },
    close: async () => {
      await db.dropDatabase();
      await Promise.all([client, ...extraClients].map((each) => each.close()));
    },
  };
}

export async function newTenant(db: Db, options: TenantOptions = {}) {
  const patient = await createPatient(db, { displayName: `Wearer ${randomUUID().slice(0, 4)}` });
  return tenantRepos(db, patient._id, options);
}

/** A controllable clock for repos. */
export function fixedClock(start: Date) {
  let now = start;
  return {
    now: () => now,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

export type { PatientId };
