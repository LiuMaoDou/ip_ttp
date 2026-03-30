#!/bin/bash
set -euo pipefail

echo "Starting TTP Web Development Environment"
echo "========================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_HOST="127.0.0.1"
BACKEND_PORT="8000"
FRONTEND_HOST="127.0.0.1"
FRONTEND_PORT="5173"
BACKEND_PID=""
FRONTEND_PID=""

check_port_in_use() {
  python3 - "$1" "$2" <<'PY'
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.settimeout(1)
    sys.exit(0 if sock.connect_ex((host, port)) == 0 else 1)
PY
}

check_url_ok() {
  python3 - "$1" <<'PY'
import sys
import urllib.request

url = sys.argv[1]
try:
    with urllib.request.urlopen(url, timeout=2) as response:
        sys.exit(0 if 200 <= response.status < 300 else 1)
except Exception:
    sys.exit(1)
PY
}

cleanup() {
  if [[ -n "$BACKEND_PID" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ -n "$FRONTEND_PID" ]]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
}

trap cleanup INT TERM EXIT

if check_port_in_use "$BACKEND_HOST" "$BACKEND_PORT"; then
  echo ""
  echo "Error: port $BACKEND_PORT is already in use."
  echo "Stop the old backend process first so the frontend does not connect to stale code."
  exit 1
fi

if check_port_in_use "$FRONTEND_HOST" "$FRONTEND_PORT"; then
  echo ""
  echo "Error: port $FRONTEND_PORT is already in use."
  echo "Stop the old frontend process first."
  exit 1
fi

echo "Starting backend server on http://$BACKEND_HOST:$BACKEND_PORT"
(
  cd "$SCRIPT_DIR/backend"
  python3 -m uvicorn app.main:app --reload --host "$BACKEND_HOST" --port "$BACKEND_PORT"
) &
BACKEND_PID=$!

BACKEND_READY=0
for _ in {1..20}; do
  if check_url_ok "http://$BACKEND_HOST:$BACKEND_PORT/api/patterns" \
    && check_url_ok "http://$BACKEND_HOST:$BACKEND_PORT/api/templates" \
    && check_url_ok "http://$BACKEND_HOST:$BACKEND_PORT/api/generation/templates"; then
    BACKEND_READY=1
    break
  fi
  sleep 1
done

if [[ "$BACKEND_READY" -ne 1 ]]; then
  echo ""
  echo "Error: backend did not become ready with all required API routes."
  echo "Expected endpoints: /api/patterns, /api/templates, /api/generation/templates"
  exit 1
fi

echo "Starting frontend dev server on http://$FRONTEND_HOST:$FRONTEND_PORT"
(
  cd "$SCRIPT_DIR/frontend"
  npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT"
) &
FRONTEND_PID=$!

echo ""
echo "========================================="
echo "TTP Web is running!"
echo "Backend:  http://$BACKEND_HOST:$BACKEND_PORT"
echo "Frontend: http://$FRONTEND_HOST:$FRONTEND_PORT"
echo "API Docs: http://$BACKEND_HOST:$BACKEND_PORT/docs"
echo "========================================="
echo ""
echo "Press Ctrl+C to stop both servers"

wait
