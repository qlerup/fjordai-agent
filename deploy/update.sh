#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Install/update from the source files already present. No Git provider is required.
docker compose -p "${FJORDAGENT_COMPOSE_PROJECT:-fjordagent}" up -d --build
docker compose -p "${FJORDAGENT_COMPOSE_PROJECT:-fjordagent}" ps
