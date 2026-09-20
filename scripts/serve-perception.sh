#!/usr/bin/env bash
# Runs the perception service on this machine and puts it behind a public https URL, so a
# deployed web app (Vercel) can reach it. Vercel can't host perception itself: it is a
# long-lived WebSocket server with model adapters, not a serverless function.
#
#   pnpm perception:serve            start the service and print the two Vercel variables
#   pnpm perception:serve --url-only assume something already serves :8000, just tunnel it
#
# PERCEPTION_PORT moves the service off :8000. The tunnel is outbound, so any network with
# internet works; no hotspot, port forwarding, or public IP is needed.

set -euo pipefail
cd "$(dirname "$0")/.."

PERCEPTION_DIR=services/perception
PERCEPTION_ENV=$PERCEPTION_DIR/.env
PERCEPTION_PORT=${PERCEPTION_PORT:-8000}

url_only=false
for arg in "$@"; do
  case "$arg" in
    --url-only) url_only=true ;;
    -h | --help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" > /dev/null 2>&1; }

env_get() {
  [ -f "$2" ] || return 0
  sed -n "s/^$1=//p" "$2" | head -n 1 | sed 's/[[:space:]]*#.*$//'
}

have cloudflared || have ssh || die "This needs cloudflared or ssh. Run: brew install cloudflared"

if ! $url_only; then
  have uv || die "uv is not installed. Install: https://docs.astral.sh/uv/"
  [ -f "$PERCEPTION_ENV" ] || die "$PERCEPTION_ENV is missing. Run pnpm start --setup-only first."

  # The deployed app signs its tokens with the Vercel DEVICE_TOKEN_SECRET and reads the Atlas
  # database, so this process has to be pointed at both or every call comes back 401 or empty.
  [ -n "$(env_get DEVICE_TOKEN_SECRET "$PERCEPTION_ENV")" ] || die "Set DEVICE_TOKEN_SECRET in $PERCEPTION_ENV to the same value as Vercel's."
  case "$(env_get MONGODB_URI "$PERCEPTION_ENV")" in
    *localhost* | *127.0.0.1*)
      warn "MONGODB_URI in $PERCEPTION_ENV points at a local MongoDB. The deployed app uses Atlas, so set the Atlas URI there or nothing this writes will show up."
      ;;
  esac

  step "Installing Python dependencies"
  # --inexact keeps the optional model stacks (yoloe, faces) that a plain sync would uninstall.
  (cd "$PERCEPTION_DIR" && uv sync --inexact)
fi

pids=()
cleanup() {
  trap - EXIT INT TERM
  local pid
  for pid in ${pids[@]+"${pids[@]}"}; do
    pkill -TERM -P "$pid" 2> /dev/null || true
    kill "$pid" 2> /dev/null || true
  done
  wait 2> /dev/null || true
}
trap cleanup EXIT INT TERM

if ! $url_only; then
  step "Starting the perception service on :$PERCEPTION_PORT"
  (cd "$PERCEPTION_DIR" && exec uv run uvicorn app.main:app --port "$PERCEPTION_PORT") &
  pids+=($!)
fi

# cloudflared prints a URL before it has connected, and some networks block its port 7844,
# so wait for the connection and fall back to an SSH tunnel through localhost.run.
tunnel_provider=cloudflared
have cloudflared || tunnel_provider=ssh
open_tunnel() {
  local port=$1 log pid url pattern ready tries
  tunnel_result=
  log=$(mktemp)
  if [ "$tunnel_provider" = cloudflared ]; then
    cloudflared tunnel --url "http://localhost:$port" > "$log" 2>&1 &
    pattern='https://[a-z0-9-]*\.trycloudflare\.com'
    ready='Registered tunnel connection'
    tries=40
  else
    ssh -T -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \
      -R "80:localhost:$port" nokey@localhost.run > "$log" 2>&1 &
    pattern='https://[a-z0-9]*\.lhr\.life'
    ready=$pattern
    tries=60
  fi
  pid=$!
  for _ in $(seq 1 "$tries"); do
    if grep -q "$ready" "$log"; then
      url=$(grep -o "$pattern" "$log" | head -n 1 || true)
      if [ -n "$url" ]; then
        pids+=("$pid")
        tunnel_result=$url
        return 0
      fi
    fi
    kill -0 "$pid" 2> /dev/null || break
    sleep 0.5
  done
  kill "$pid" 2> /dev/null || true
  if [ "$tunnel_provider" = cloudflared ]; then
    warn "cloudflared could not connect, this network likely blocks port 7844. Using localhost.run over SSH."
    tunnel_provider=ssh
    open_tunnel "$port"
    return
  fi
  die "No tunnel for port $port. The log is at $log"
}

step "Opening the tunnel"
open_tunnel "$PERCEPTION_PORT"
url=$tunnel_result

cat <<EOF

The perception service is at $url

Set these in the Vercel project (Settings -> Environment Variables), then redeploy:

  PERCEPTION_URL=$url
  NEXT_PUBLIC_PERCEPTION_WS_URL=wss://${url#https://}/ws/frames

Vercel's DEVICE_TOKEN_SECRET, MONGODB_URI, and MONGODB_DB have to match $PERCEPTION_ENV.
The URL changes every run, so it has to be updated in Vercel each time.

Leave this running. Ctrl-C stops the service and the tunnel.
EOF

wait
