#!/usr/bin/env bash
# Static server for the labs that need HTTP (07, 11, 12, 13) — and harmless for the rest.
# Usage: ./serve.sh [port]
set -euo pipefail
PORT="${1:-8080}"
cd "$(dirname "$0")"
echo "Serving $(pwd) at http://localhost:${PORT}"
echo "Labs needing HTTP: 07-render-blocking-js, 11-image-disaster, 12-network-waterfall, 13-css-blocking-first-paint"
exec python3 -m http.server "$PORT"
