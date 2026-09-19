# 2. One zod schema per collection, enforced by MongoDB

Date: 2026-09-19

Status: accepted

## Context

Two services write to the same database. The Next.js app writes configuration and interactions; the Python perception service writes sightings, item snapshots, capture sessions, and description jobs. README "API sketch" asks for one canonical definition of each shape, so the two can't drift.

The hot path is one read. "Where are my keys" has to resolve the spoken name and return the latest observation in about 30 ms, and a stale or wrong answer is worse than a slow one. Late vision results and out-of-order frames must never overwrite newer evidence.

## Decision

`packages/db` holds one zod schema per stored document. Each schema does two jobs:

- TypeScript parses documents with it before writing.
- `pnpm db:setup` turns it into the collection's `$jsonSchema` validator with `validationAction: "error"`. A bad write from either service fails at the database.

`packages/db/src/registry.ts` lists every collection with its schema and its indexes. `pnpm db:setup` syncs a database to it and is safe to rerun. The same plan is exported to `packages/db/generated/mongo-schema.json` for the Python tests, and a test fails if that file falls behind.

Other rules:

- Every id is an ObjectId, branded per collection in TypeScript, so an ItemId can't be passed as a PatientId.
- Repositories only get a `TenantCollection`, which writes `patientId` onto every filter after the caller's own fields.
- Items store `lookupKeys`, their normalized names and aliases, under a unique index over active items. The fast path sends every short word run of the transcript to that index in one `$in` query. No alias cache to invalidate, and two items can't answer to the same word.
- The item snapshot carries `observationVersion`. Perception replaces a snapshot only with newer evidence, by compare-and-set on the version. A description result applies to the item only while the version and keyframe revision still match.
- `locationStatus` is derived when read, from the snapshot's state and description status, instead of stored next to it.
- Records past retention are filtered out of reads right away. `pnpm db:sweep` deletes them and clears snapshots that pointed at them. TTL indexes on `expiresAt` run a day later as a backstop, and any collection with an `expiresAt` field gets one automatically.
- Wire shapes, meaning API bodies and the frame socket protocol, stay in `packages/shared`. Stored shapes live in `packages/db` and take their enum values from shared.

## Consequences

- Changing a stored field means editing the zod schema, running `pnpm db:setup`, and regenerating `mongo-schema.json`. Forget the sync and writes of the new field fail loudly, which is the point. `/api/health` reports `schema: "stale"` until the sync runs.
- The db tests need a real MongoDB (`pnpm db:up`). They're slower than mocks, but they test the validators, unique indexes, and races that mocks can't.
- `packages/shared` is still on zod 3 and `packages/db` on zod 4. Only enum values cross between them. Moving shared to zod 4 is a separate change.
- The unique lookup key rule means a caregiver can't give two items the same alias; the API answers 409 and names the clash.
- The Python service has to follow the write rules by hand. The validators catch shape errors, but not a snapshot write that skips the version check, so `services/perception/app/store.py` has tests for each rule.
