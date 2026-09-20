# memory-glasses

A wearable camera that helps people with dementia find misplaced items, reminds them before they'd
forget something (medication before bed, keys before the door), recognizes caregiver-enrolled faces,
and alerts the caregiver if the wearer is out of the approved area. The hackathon build
runs on a phone worn on the chest (ADR 0003); Ray-Ban Meta is a later client. The chest page is
`/wear`; `/headset` redirects there. One Next.js app serves both the wearer
pages and the caregiver dashboard, behind real per-family accounts: face recognition and
proactive reminders are MVP scope now, not stretch goals, and every family's data is
isolated by `patientId`, never by a single seeded login. PLAN.md is the source of truth for the
spec, architecture, data model, current status, and build order. Read it first.

## Repo layout

pnpm workspace plus one uv project.

```text
apps/web/             Next.js 16 App Router: /wear chest page, /sim flat fallback, dashboard, API routes
apps/ios/             Capacitor 8 iOS shell (SPM, no CocoaPods); its WKWebView loads the deployed web app
packages/shared/      zod 3 wire contract: API bodies, the /ws/frames protocol, signed tokens, fixtures
packages/db/          zod 4 stored-document schemas, the collection registry, repositories, retention
services/perception/  Python FastAPI service: frame socket, sighting writes, description job queue
scripts/              db:setup, db:seed, db:sweep, bench:tts, run from the repo root with pnpm
docs/decisions/       ADRs
docs/research/        dated model and vision research, each ending with proposed PLAN.md changes
```

Wearer client code lives in `apps/web/src/hooks/` and `apps/web/src/lib/client/`. `useWearerClient`
composes the camera, recorder, voice turn (Deepgram or browser speech to text), ask-and-speak loop,
perception frame socket, caregiver message polling, wake lock, and stall watchdog. `/wear` and `/sim`
both render it with a different view, so a client feature added there reaches both capture paths.

## Commands

```bash
pnpm start            # scripts/start.sh: install, env files, db, seed, then web and perception
pnpm install
pnpm dev              # apps/web on :3000
pnpm build
pnpm lint
pnpm typecheck
pnpm test             # vitest in packages/shared and packages/db; the db tests need MongoDB
pnpm perception:serve # perception on :8000 behind a public https URL, for a deployed web app
pnpm db:up            # local MongoDB 8.0 with Atlas Search in Docker, on :27017
pnpm db:setup         # sync collections, validators, indexes; --search adds vector indexes
pnpm db:seed          # demo wearer, caregiver, 3 items with sightings; --reset starts over
pnpm db:sweep         # delete records past retention
cd services/perception && uv run pytest   # the Python tests, also against MongoDB
cloudflared tunnel --url http://localhost:3000   # HTTPS URL for testing on a phone
cd apps/ios && CAP_SERVER_URL=https://<host> pnpm sync   # point the iOS app at a URL; rerun on change
pnpm --filter @memory-glasses/ios build:sim             # simulator build, no signing
```

Copy `apps/web/.env.example` to `apps/web/.env.local`. The database needs `MONGODB_URI`; signing in
also needs `AUTH_SECRET`, `DEVICE_TOKEN_SECRET`, `CAREGIVER_EMAIL`, and `CAREGIVER_PASSWORD`. The root
scripts read the same file.

## Conventions

- API routes live under `apps/web/src/app/api/*/route.ts`, one file per resource, matching the
  table in PLAN.md "API sketch". A route that isn't built yet validates its input and returns 501.
- Wire shapes (request bodies, socket messages) are defined once, in `packages/shared/src/schemas/*.ts`.
  Stored documents are defined once, in `packages/db/src/schema/*.ts`, and each becomes its
  collection's MongoDB validator. See docs/decisions/0002. After changing a stored schema, run
  `pnpm db:setup` and `pnpm --filter @memory-glasses/db export-schema`, and commit
  `packages/db/generated/mongo-schema.json`; a test fails until you do.
- Route handlers go through `withTenant` in `apps/web/src/lib/server/api.ts`, which authenticates and
  hands over repositories scoped to one wearer. `patientId` never comes from a request body. Code
  that touches the database or secrets lives in `apps/web/src/lib/server/`.
- `services/perception` writes sightings and item snapshots itself. Its write rules (version checks,
  keyframe guards, job leases) live in `app/store.py`, tested against the generated validators.
- Dashboard pages live under `apps/web/src/app/dashboard/*`, one folder per nav item, including the
  newer `people` (face enrollment) and `routines` (proactive reminders)
  tabs from PLAN.md "Caregiver dashboard".
- The `notifications.kind` value `lost_alert` is pushed to the caregiver immediately
  over Web Push, not just queued for the normal two-second poll. Don't downgrade a new alert-like
  notification kind to poll-only without adding its push path too.
- A link that looks like a button is `next/link` styled with `buttonVariants()`. The Base UI
  `Button` is for actions: rendered as a link, it gets `role="button"`.
- `apps/web/CLAUDE.md` and `AGENTS.md` are regenerated by `next dev`. Keep them as generated, and
  commit them when they change.

## Gotchas

- A phone opens the camera and mic only on HTTPS, and an HTTPS page opens only `wss://` sockets.
  Test on a phone through a tunnel or a Vercel URL. `allowedDevOrigins` in `apps/web/next.config.ts`
  lists the tunnel hostnames `next dev` accepts.
- iPhone Safari has no element fullscreen, drops answer audio to the earpiece while the mic is open,
  and can switch rear lenses on its own. PLAN.md "What the page has to do" has the table and fixes.
- The React Compiler lint rules are on, including `set-state-in-effect`, `refs`, and `purity`.
  React 19.2 has `useEffectEvent`, which the wearer views use for window listeners.
- Hidden and headless browser tabs render about once a second, so `useFeedWatchdog` reports a
  stalled feed and `/wear` shows its stall card. Test the wear page in a visible tab, or shim
  `HTMLVideoElement.prototype.requestVideoFrameCallback`.
- Several agent sessions often edit this repo at once. Stage files by explicit path, and read
  `git diff --cached --stat` before committing: anything already staged, including a `git rm`,
  rides along in your commit.
- The db tests use `MONGODB_TEST_URI`, default `mongodb://127.0.0.1:27017/?directConnection=true`.
  Each test file creates and drops its own database, so they can share a server with dev data.
- `people` (face reference photos and embeddings) is consent-sensitive in a way `items` isn't: it
  identifies specific real people. Never send it to a third-party API, never widen a query to cross
  `patientId`, and never add a code path that matches against anything but that patient's own
  enrolled set. See PLAN.md "Faces and routines" and "Privacy and safety".
- Face enrollment lives in the perception service, which owns the embedder and the encryption key.
  Enrolling and adding photos go through `apps/web/src/lib/server/perception.ts`, at `PERCEPTION_URL`,
  else the socket's host, else `http://127.0.0.1:8000`. Listing, renaming, and removing people read
  and write the `people` collection directly (`tenant.people`), so the Faces page works when
  perception is down or unreachable from Vercel; the Add form reports the failure instead.
- `CAREGIVER_EMAIL`/`CAREGIVER_PASSWORD` only seed the one demo pair (`pnpm db:seed`). Real caregiver
  signup is a separate flow (`POST /api/auth/signup`); don't assume there's exactly one caregiver
  account when writing a route or a test.
- The iOS app has no Web Speech API, so speech to text there needs `DEEPGRAM_API_KEY`. It also
  needs an https `CAP_SERVER_URL`; a new tunnel means a new `pnpm sync` and maybe a new
  `allowedDevOrigins` entry. `apps/ios/ios/App/App/capacitor.config.json` is generated and ignored.
- Answers are spoken with the browser's `speechSynthesis` until server TTS lands. iPhone only speaks
  after a tap has spoken once, so `primeSpeech()` runs inside every tap that can lead to an answer.
- Buttons and inputs grow on `pointer-coarse`. A desktop preview reports a mouse, so check touch
  sizes on a phone.
