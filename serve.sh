#!/usr/bin/env bash
# Lab server for every course in this repo.
#
#   http://localhost:8080   app origin  — open the labs here
#   http://localhost:8081   alt origin  — cross-origin target for the CORS / hint labs
#   http://127.0.0.1:8080   a third origin, same server
#
# Usage: ./serve.sh [appPort] [altPort]
set -euo pipefail
cd "$(dirname "$0")"
exec node server.mjs "${1:-8080}" "${2:-8081}"
