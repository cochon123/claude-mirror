#!/usr/bin/env bash
# Starts the identity-scrubbing proxy and the cli2api gateways:
#   :3927  Claude adapter -> bin/claude-arena            (room 1, Claude only)
#   :3928  Claude + Codex adapters -> bin/*-arena         (room 2, the open room with GPT)
# cli2api (https://github.com/cochon123/cli2api) is expected in ./cli2api, or set CLI2API_DIR.
cd "$(dirname "$0")/.."
ROOT="$PWD"
CLI2API_DIR="${CLI2API_DIR:-$ROOT/cli2api}"
[ -d "$CLI2API_DIR/src" ] || { echo "cli2api not found at $CLI2API_DIR: git clone https://github.com/cochon123/cli2api && (cd cli2api && npm install)"; exit 1; }
ss -ltn | grep -q ':8787 ' || setsid nohup node bin/scrub-proxy.mjs 8787 > runs/proxy.out 2>&1 < /dev/null &
export CLAUDE_ARENA_EFFORT="${CLAUDE_ARENA_EFFORT:-medium}" CODEX_ARENA_EFFORT="${CODEX_ARENA_EFFORT:-medium}"
ss -ltn | grep -q ':3927 ' || (cd "$CLI2API_DIR" && CLI2API_TOKEN=mirror-room setsid nohup npx tsx src/index.ts serve --adapter claude --port 3927 --claude-bin "$ROOT/bin/claude-arena" > "$ROOT/runs/cli2api.out" 2>&1 < /dev/null &)
ss -ltn | grep -q ':3928 ' || (cd "$CLI2API_DIR" && CLI2API_TOKEN=mirror-room setsid nohup npx tsx src/index.ts serve --adapter codex --port 3928 --claude-bin "$ROOT/bin/claude-arena" --codex-bin "$ROOT/bin/codex-arena" > "$ROOT/runs/cli2api-open.out" 2>&1 < /dev/null &)
sleep 4
for p in 3927 3928; do curl -s -H 'Authorization: Bearer mirror-room' http://127.0.0.1:$p/health | head -c 120; echo; done
