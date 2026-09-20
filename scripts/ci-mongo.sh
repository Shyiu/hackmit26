#!/usr/bin/env bash
# Starts the MongoDB container CI runs its tests against. Docker Hub resets a
# pull now and then, which has nothing to do with the change under test, so the
# pull is retried before the container is waited on.
set -euo pipefail

for attempt in 1 2 3; do
  if docker compose pull --quiet mongo; then
    break
  fi
  if [ "$attempt" = 3 ]; then
    echo "Couldn't pull the MongoDB image after $attempt attempts." >&2
    exit 1
  fi
  echo "Pull attempt $attempt failed, retrying in $((attempt * 10))s." >&2
  sleep $((attempt * 10))
done

docker compose up -d --wait mongo
