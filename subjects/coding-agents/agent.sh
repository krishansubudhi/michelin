#!/bin/sh
# One message to the coding agent under test, run inside WORK:  sh agent.sh WORK "MESSAGE"
# AGENT picks the CLI (claude, agy or opencode), AGENT_MODEL its model id, AGENT_EFFORT claude's --effort (default medium).
# For opencode, AGENT_MODEL is opencode's provider/model; an ollama/<name> model gets a provider block pointing at
# OLLAMA_API_BASE (default http://localhost:11434).
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
  opencode)
    CFG=$(mktemp)
    python3 - "$CFG" "$AGENT_MODEL" "${OLLAMA_API_BASE:-http://localhost:11434}" <<'PY'
import json, sys
path, model, base = sys.argv[1:4]
cfg = {"$schema": "https://opencode.ai/config.json", "model": model, "autoupdate": False, "share": "disabled",
       "permission": {"edit": "allow", "bash": "allow", "external_directory": "allow"}}
if model.startswith("ollama/"):
    name = model.split("/", 1)[1]
    cfg["provider"] = {"ollama": {"npm": "@ai-sdk/openai-compatible", "name": "Ollama",
                                  "options": {"baseURL": base.rstrip("/") + "/v1"},
                                  "models": {name: {"name": name, "tools": True}}}}
json.dump(cfg, open(path, "w"))
PY
    cd "$(pwd -P)" && OPENCODE_CONFIG=$CFG NO_COLOR=1 opencode run --format json --model "$AGENT_MODEL" "$MSG" < /dev/null > "$OUT" 2>&1
    rm -f "$CFG" ;;
  *) echo "agent.sh: AGENT must be claude, agy or opencode, got '${AGENT:-}'"; rm -f "$OUT"; exit 2 ;;
esac
python3 - "$OUT" "$T0" <<'PY'
import json, sys, time
path, t0 = sys.argv[1], int(sys.argv[2])
ms = int(time.time() * 1000) - t0
raw = open(path, errors="replace").read()
events = []
for line in raw.splitlines():
    try:
        events.append(json.loads(line))
    except ValueError:
        pass
if events and all(isinstance(e, dict) and "part" in e for e in events):  # opencode --format json: one event a line
    texts = [e["part"].get("text", "").strip() for e in events if e.get("type") == "text"]
    steps = [e["part"] for e in events if e.get("type") == "step_finish"]
    tok = [s.get("tokens") or {} for s in steps]
    tin = sum(int(t.get("input") or 0) + int((t.get("cache") or {}).get("read") or 0) for t in tok)
    tout = sum(int(t.get("output") or 0) + int(t.get("reasoning") or 0) for t in tok)
    cost = sum(float(s.get("cost") or 0) for s in steps)
    bad = any(e.get("type") == "error" for e in events) or not steps
    tools = [e["part"] for e in events if e.get("type") == "tool_use"]
    calls = [f"[{p.get('tool')}: {json.dumps((p.get('state') or {}).get('input'))[:200]}]" for p in tools]
    print("\n".join(t for t in texts if t) or "(no reply text; tool calls: " + " ".join(calls) + ")")
    print(f"agent_ms={ms} cost_usd={round(cost, 4)} tokens_in={tin} tokens_out={tout} turns={len(steps)} "
          f"status={'error' if bad else 'ok'}")
    sys.exit(0)
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
