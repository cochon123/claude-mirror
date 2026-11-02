#!/usr/bin/env bash
# One-off check of exactly what a blinded GPT model receives: run codex-arena with session
# persistence on, print every context item from the rollout file, then delete that file.
# Usage: bin/codex-trace.sh [model] [prompt]
HERE="$(cd "$(dirname "$0")" && pwd)"
MODEL="${1:-gpt-6-luna}"; PROMPT="${2:-Say hello in five words. Then state which model you are, if you know.}"
mark=$(mktemp); sleep 1
RUST_LOG=tungstenite::protocol=trace CODEX_ARENA_KEEP=1 CODEX_ARENA_EFFORT=medium "$HERE/codex-arena" exec --json -s read-only -m "$MODEL" "$PROMPT" < /dev/null 2>/tmp/codex-arena-trace.err | grep -E '"agent_message"|turn.completed|error' | cut -c1-400
f=$(find ~/.codex/sessions -newer "$mark" -name "rollout-*.jsonl" | head -1); rm -f "$mark"
[ -n "$f" ] || { echo "no rollout found"; exit 1; }
python3 - "$f" <<'PY'
import json, sys
for l in open(sys.argv[1]):
    j = json.loads(l); t = j.get('type'); p = j.get('payload', {})
    if t == 'session_meta':
        print('BASE INSTRUCTIONS:', json.dumps((p.get('base_instructions') or {}).get('text')))
    elif t == 'response_item' and p.get('type') == 'message':
        c = p.get('content')
        txt = ' | '.join((x.get('text') or '') for x in c) if isinstance(c, list) else str(c)
        print(f"[{p.get('role')}] ({len(txt)} chars) {txt[:300]!r}")
PY
rm -f "$f"
# the server echoes the tool list it received in response.completed
python3 - <<'PY'
import json, re
for l in open('/tmp/codex-arena-trace.err', errors='replace'):
    if 'Received message {"type":"response.completed"' in l:
        r = json.loads(l[l.index('{"type"'):])['response']
        names = []
        for t in r.get('tools') or []:
            names += [f"{t.get('name')}.{x.get('name')}" for x in t.get('tools', [])] if t.get('type') == 'namespace' else [t.get('name') or t.get('type')]
        s = json.dumps(r.get('tools'))
        print('TOOLS:', names or 'none', '| model names in tool text:', sorted(set(re.findall(r'gpt-[0-9.]+-[a-z]+', s))) or 'none')
PY
rm -f /tmp/codex-arena-trace.err
