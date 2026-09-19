#!/usr/bin/env bash
# Vercel's build command (apps/web/vercel.json). A production build first brings the database up
# to this commit's schema and seeds the demo wearer, so a deploy never serves code ahead of its
# validators and indexes. Both steps change nothing when they have already run.
#
# Preview builds skip it: they share production's database, and a branch's schema must not
# rewrite the validators production is running against.

set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${VERCEL_ENV:-}" = production ]; then
  if [ -z "${MONGODB_URI:-}" ]; then
    echo "MONGODB_URI is not set for production, so the database steps are skipped."
  else
    pnpm db:setup
    pnpm db:seed
  fi
fi

pnpm build
