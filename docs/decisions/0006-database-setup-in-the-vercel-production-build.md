# 6. Database setup and seed run inside the Vercel production build

Date: 2026-09-19

Status: accepted.

## Context

The web app deploys to Vercel and reads a MongoDB Atlas cluster. Every stored schema in `packages/db` becomes its collection's validator (ADR 0002), so code that writes a new field fails against a database still holding the old validator. Locally `pnpm start` runs `pnpm db:setup` before the servers. Vercel has no step like that: it runs one build command and then serves.

## Decision

`apps/web/vercel.json` sets the build command to `scripts/vercel-build.sh`. When `VERCEL_ENV` is `production` and `MONGODB_URI` is set, the script runs `pnpm db:setup` and `pnpm db:seed`, then `pnpm build`. Both database steps do nothing when they have already run. A failure in either fails the build, and Vercel keeps serving the previous deployment.

Preview builds skip the database steps. Previews read the same cluster, and a branch with a changed schema would otherwise rewrite the validators production is running against.

## Consequences

Atlas has to accept connections from Vercel's build machines as well as its functions, which means allowing `0.0.0.0/0`. A schema change that breaks old code still needs care: the new validators land a minute or so before the new code is promoted. The seed only creates the demo wearer, so real families' data is untouched. If previews ever need their own data, give the preview environment its own `MONGODB_DB` and drop the production check.
