#!/usr/bin/env bash
# Sets up a fresh checkout and starts both servers: Next.js on :3000 and the
# perception service on :8000. Safe to rerun; every step skips what is already done.
#
#   pnpm start                  set up, then run both servers until Ctrl-C
#   pnpm start --setup-only     set up and exit
#   pnpm start --no-perception  skip the Python service
#   pnpm start --reset          reseed the demo wearer from scratch
#   pnpm start --tunnel         also open cloudflared tunnels, for testing on a phone
#
# PORT and PERCEPTION_PORT move the servers off :3000 and :8000 when another checkout has them.

set -euo pipefail
cd "$(dirname "$0")/.."

WEB_ENV=apps/web/.env.local
PERCEPTION_DIR=services/perception
PERCEPTION_ENV=$PERCEPTION_DIR/.env
LOCAL_MONGO_URI="mongodb://127.0.0.1:27017/?directConnection=true"
WEB_PORT=${PORT:-3000}
PERCEPTION_PORT=${PERCEPTION_PORT:-8000}

setup_only=false
perception=true
tunnel=false
seed_args=()
for arg in "$@"; do
  case "$arg" in
    --setup-only) setup_only=true ;;
    --no-perception) perception=false ;;
    --tunnel) tunnel=true ;;
    --reset) seed_args+=(--reset) ;;
    -h | --help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" > /dev/null 2>&1; }

# Reads KEY from an env file, without the trailing comment some lines carry.
env_get() {
  [ -f "$2" ] || return 0
  sed -n "s/^$1=//p" "$2" | head -n 1 | sed 's/[[:space:]]*#.*$//'
}

# Sets KEY=value in an env file, replacing the line if it exists.
env_set() {
  local key=$1 value=$2 file=$3 tmp
  tmp=$(mktemp)
  awk -v key="$key" -v value="$value" '
    index($0, key "=") == 1 { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

# Sets KEY only when it is empty, so a rerun never overwrites a value someone chose.
env_default() {
  [ -n "$(env_get "$1" "$3")" ] || env_set "$1" "$2" "$3"
}

secret() { openssl rand -base64 32 | tr -d '\n'; }

step "Checking tools"
have node || die "node is not installed. Install Node 24: https://nodejs.org"
have pnpm || die "pnpm is not installed. Run: corepack enable pnpm"
have openssl || die "openssl is not installed."
if $perception && ! have uv; then
  warn "uv is not installed, so the perception service is skipped. Install: https://docs.astral.sh/uv/"
  perception=false
fi
if $tunnel && ! have cloudflared; then
  die "cloudflared is not installed. Run: brew install cloudflared"
fi

step "Installing JavaScript dependencies"
pnpm install

step "Writing env files"
if [ ! -f "$WEB_ENV" ]; then
  cp apps/web/.env.example "$WEB_ENV"
  echo "Created $WEB_ENV"
fi
env_default MONGODB_URI "$LOCAL_MONGO_URI" "$WEB_ENV"
env_default AUTH_SECRET "$(secret)" "$WEB_ENV"
env_default DEVICE_TOKEN_SECRET "$(secret)" "$WEB_ENV"
env_default CAREGIVER_PASSWORD "$(openssl rand -hex 8)" "$WEB_ENV"
env_default NEXT_PUBLIC_PERCEPTION_WS_URL "ws://localhost:8000/ws/frames" "$WEB_ENV"

if $perception; then
  if [ ! -f "$PERCEPTION_ENV" ]; then
    cp "$PERCEPTION_DIR/.env.example" "$PERCEPTION_ENV"
    echo "Created $PERCEPTION_ENV"
  fi
  # The service checks socket tokens the web app signs, and reads the same database.
  env_set DEVICE_TOKEN_SECRET "$(env_get DEVICE_TOKEN_SECRET "$WEB_ENV")" "$PERCEPTION_ENV"
  env_set MONGODB_URI "$(env_get MONGODB_URI "$WEB_ENV")" "$PERCEPTION_ENV"
  env_set MONGODB_DB "$(env_get MONGODB_DB "$WEB_ENV")" "$PERCEPTION_ENV"
fi

mongo_uri=$(env_get MONGODB_URI "$WEB_ENV")
case "$mongo_uri" in
  *localhost* | *127.0.0.1*)
    step "Starting local MongoDB"
    # Another checkout's container may already hold the port; compose names projects by directory.
    if nc -z 127.0.0.1 27017 > /dev/null 2>&1; then
      echo "MongoDB is already listening on :27017, using it."
    else
      have docker || die "docker is not installed. Install Docker Desktop, or set MONGODB_URI in $WEB_ENV to an Atlas cluster."
      docker info > /dev/null 2>&1 || die "Docker is installed but not running. Start Docker Desktop and rerun."
      pnpm db:up
    fi
    ;;
  *) step "Using the remote MongoDB in $WEB_ENV" ;;
esac

step "Syncing collections, validators, and indexes"
pnpm db:setup

step "Seeding the demo wearer"
pnpm db:seed ${seed_args[@]+"${seed_args[@]}"}

if $perception; then
  step "Installing Python dependencies"
  (cd "$PERCEPTION_DIR" && uv sync)
fi

login="Sign in at http://localhost:$WEB_PORT/login as $(env_get CAREGIVER_EMAIL "$WEB_ENV") / $(env_get CAREGIVER_PASSWORD "$WEB_ENV")"

if $setup_only; then
  step "Setup done"
  echo "$login"
  echo "Start the servers with: pnpm start"
  exit 0
fi

# next dev moves to the next free port without failing, which leaves you on someone else's server.
port_free() {
  ! nc -z 127.0.0.1 "$1" > /dev/null 2>&1 || die "Port $1 is in use (pid $(lsof -ti ":$1" -sTCP:LISTEN | head -n 1)). Stop it, or set $2 to another port."
}
port_free "$WEB_PORT" PORT
! $perception || port_free "$PERCEPTION_PORT" PERCEPTION_PORT

pids=()
cleanup() {
  trap - EXIT INT TERM
  local pid
  for pid in ${pids[@]+"${pids[@]}"}; do
    # pnpm and uv run their server as a child, so signal the children too.
    pkill -TERM -P "$pid" 2> /dev/null || true
    kill "$pid" 2> /dev/null || true
  done
  wait 2> /dev/null || true
}
trap cleanup EXIT INT TERM

# Opens a quick tunnel to a local port and leaves its https URL in $tunnel_result.
# It sets a variable instead of printing, because $(...) would lose the pid in a subshell.
open_tunnel() {
  local port=$1 log url
  tunnel_result=
  log=$(mktemp)
  cloudflared tunnel --url "http://localhost:$port" > "$log" 2>&1 &
  pids+=($!)
  for _ in $(seq 1 60); do
    url=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$log" | head -n 1 || true)
    if [ -n "$url" ]; then
      tunnel_result=$url
      return 0
    fi
    sleep 0.5
  done
  die "cloudflared gave no URL for port $port. Its log is at $log"
}

web_url=
if $tunnel; then
  step "Opening tunnels"
  open_tunnel "$WEB_PORT"
  web_url=$tunnel_result
  if $perception; then
    # The phone page opens the frame socket itself, so next dev has to start with the public wss:// URL.
    open_tunnel "$PERCEPTION_PORT"
    export NEXT_PUBLIC_PERCEPTION_WS_URL="wss://${tunnel_result#https://}/ws/frames"
  fi
fi

step "Starting servers"
if $perception; then
  (cd "$PERCEPTION_DIR" && exec uv run uvicorn app.main:app --port "$PERCEPTION_PORT") &
  pids+=($!)
fi
if [ "$PERCEPTION_PORT" != 8000 ] && ! $tunnel; then
  export NEXT_PUBLIC_PERCEPTION_WS_URL="ws://localhost:$PERCEPTION_PORT/ws/frames"
fi
PORT=$WEB_PORT pnpm dev &
pids+=($!)

echo "$login"
[ -z "$web_url" ] || echo "On the phone, open $web_url/wear"

# Stop everything when either server exits, so a crash is not hidden behind the other's logs.
all_running() {
  local pid
  for pid in "${pids[@]}"; do kill -0 "$pid" 2> /dev/null || return 1; done
}
while all_running; do sleep 1; done
warn "A server exited. Stopping the rest."
exit 1
