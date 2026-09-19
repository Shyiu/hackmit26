# web

The Next.js 16 app: the `/wear` chest page, the flat `/sim` fallback, the caregiver dashboard, and the API. The root README is the spec; this file only says where things are.

## Run it

From the repo root, after copying `.env.example` to `.env.local` here and filling it in:

```bash
pnpm db:up && pnpm db:setup && pnpm db:seed   # a local database with the demo wearer
pnpm dev                                      # http://localhost:3000, sign in at /login
pnpm lint && pnpm typecheck
```

## Where things are

- `src/app/api/*/route.ts`: one file per resource, matching the root README "API sketch".
- `src/lib/server/`: code that touches the database or secrets. `api.ts` has `withTenant`, which every tenant route goes through: it checks the session cookie or device token and hands the handler repositories scoped to one wearer. `auth.ts` signs and checks credentials, `views.ts` turns stored documents into JSON, and `answer.ts` words the fast-path answer.
- `src/proxy.ts`: sends signed-out visitors from `/dashboard` to `/login`.
- `src/hooks/`, `src/lib/client/`, and `src/components/wearer/`: the camera, recorder, speech to text, ask-and-speak loop, frame upload, and HUD shared by `/wear` and `/sim` through `useWearerClient`.

The app reaches MongoDB only through `@memory-glasses/db` in `packages/db`.
