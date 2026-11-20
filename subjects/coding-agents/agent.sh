#!/bin/sh
# One message to the coding agent under test, run inside WORK:  sh agent.sh WORK "MESSAGE"
# AGENT picks the CLI (claude or agy), AGENT_MODEL its model id, AGENT_EFFORT claude's --effort (default medium).
# AGENT_RUNNER, if set, is run instead with the same two arguments (and this environment), e.g. a runner that
# hands the call to another OS user who has that CLI logged in.
# Prints the agent's final reply, then one line of metrics:
#   agent_ms=<wall ms> cost_usd=<as the CLI reports it, or n/a> tokens_in=<n> tokens_out=<n> turns=<n> status=<ok|error>
set -u
WORK=$1
MSG=$2
[ -n "${AGENT_RUNNER:-}" ] && exec "$AGENT_RUNNER" "$WORK" "$MSG"
cd "$WORK" || { echo "agent.sh: no such WORK: $WORK"; exit 1; }
OUT=$(mktemp)
T0=$(python3 -c 'import time; print(int(time.time() * 1000))')
case "${AGENT:-}" in
  claude) claude -p --model "$AGENT_MODEL" --effort "${AGENT_EFFORT:-medium}" --permission-mode bypassPermissions \
            --strict-mcp-config --output-format json "$MSG" < /dev/null > "$OUT" 2>&1 ;;
  agy) agy --model "$AGENT_MODEL" --dangerously-skip-permissions --output-format json -p "$MSG" < /dev/null > "$OUT" 2>&1 ;;
  *) echo "agent.sh: AGENT must be claude or agy, got '${AGENT:-}'"; rm -f "$OUT"; exit 2 ;;
esac
python3 - "$OUT" "$T0" <<'PY'
import json, sys, time
path, t0 = sys.argv[1], int(sys.argv[2])
ms = int(time.time() * 1000) - t0
raw = open(path, errors="replace").read()
try:
    d = json.loads(raw[raw.index("{"):])
except ValueError:
    print(raw[-2000:])
    print(f"agent_ms={ms} cost_usd=n/a tokens_in=0 tokens_out=0 turns=0 status=error")
    sys.exit(0)
u = d.get("usage") or {}
reply = d.get("result", d.get("response", "")) or d.get("error", "")
tin = sum(int(u.get(k) or 0) for k in ("input_tokens", "cache_read_input_tokens",
                                       "cache_creation_input_tokens", "cache_read_tokens"))
tout = int(u.get("output_tokens") or 0)
ok = not d.get("is_error") and d.get("status", "SUCCESS") == "SUCCESS"
cost = d.get("total_cost_usd")
print(reply.strip())
print(f"agent_ms={ms} cost_usd={'n/a' if cost is None else round(cost, 4)} tokens_in={tin} "
      f"tokens_out={tout} turns={d.get('num_turns', 0)} status={'ok' if ok else 'error'}")
PY
rm -f "$OUT"
