Prepares a throwaway workspace for OpenCode (https://opencode.ai), the open-source AI coding agent for the terminal, and checks that it starts. OpenCode must already be on PATH: `npm install -g opencode-ai` (a user-level npm prefix such as `~/.local` is enough).

OpenCode needs a model of its own, named by the environment variable OPENCODE_MODEL in OpenCode's `provider/model` form, e.g. `ollama/<model>` (free, local Ollama; pick a model that supports tool calls, small ones often fumble them) or `anthropic/<model>` (with ANTHROPIC_API_KEY set). For an `ollama/...` model, setup writes the provider block itself, pointing at OLLAMA_API_BASE (default http://localhost:11434). Michelin's own roles still run on the `claude` CLI.

OPENCODE_TOOLS_OFF (optional) is a comma-separated list of OpenCode tools to turn off for this run, e.g. `OPENCODE_TOOLS_OFF=todowrite`. Setup writes it into opencode.json as `"tools": {"todowrite": false}`, OpenCode's own setting, so the model is never offered that tool. Use it when a model's tool calls for one tool fail to parse: Gemma 4 26B on Ollama 0.40 (`gemma4:26b-mlx`) writes `todowrite` calls (an array of objects) that Ollama's gemma4 parser cannot repair (`gemma4 tool call parsing failed` in the Ollama server log); the call is dropped, OpenCode sees a turn with no tool call and ends the session mid-task. Unset, every tool stays on.

TMP: the run's scratch folder named at the end of this prompt. OpenCode's workspace and config go in it, and teardown deletes them.

Run the block below as ONE shell command, with TMP filled in, and a shell timeout of at least 3 minutes:

```bash
TMP=<scratch folder>
[ -n "$OPENCODE_MODEL" ] || { echo "setup failed: OPENCODE_MODEL is not set, e.g. export OPENCODE_MODEL=ollama/<model>"; exit 1; }
command -v opencode >/dev/null || { echo "setup failed: opencode not found; npm install -g opencode-ai"; exit 1; }
command -v git >/dev/null || { echo "setup failed: git not found"; exit 1; }
mkdir -p "$TMP/work" && git -C "$TMP/work" init -q || { echo "setup failed: could not make $TMP/work"; exit 1; }
python3 - "$TMP/opencode.json" "$OPENCODE_MODEL" "${OLLAMA_API_BASE:-http://localhost:11434}" "${OPENCODE_TOOLS_OFF:-}" <<'PY' || { echo "setup failed: could not write opencode.json"; exit 1; }
import json, sys
path, model, ollama, off = sys.argv[1:5]
cfg = {"$schema": "https://opencode.ai/config.json", "model": model, "autoupdate": False, "share": "disabled"}
if off.strip():
    cfg["tools"] = {t.strip(): False for t in off.split(",") if t.strip()}
if model.startswith("ollama/"):
    name = model.split("/", 1)[1]
    cfg["provider"] = {"ollama": {"npm": "@ai-sdk/openai-compatible", "name": "Ollama",
                                  "options": {"baseURL": ollama.rstrip("/") + "/v1"},
                                  "models": {name: {"name": name, "tools": True}}}}
json.dump(cfg, open(path, "w"), indent=2)
PY
V=$(opencode --version 2>&1) || { echo "setup failed: opencode did not start"; echo "$V" | tail -5; exit 1; }
printf 'TMP=%s\nWORK=%s\nCONFIG=%s\nMODEL=%s\nOPENCODE=%s\n' "$TMP" "$TMP/work" "$TMP/opencode.json" "$OPENCODE_MODEL" "$(echo "$V" | tail -1)"
```

On success it prints TMP, WORK (OpenCode's workspace, an empty git repo), CONFIG (its config file), MODEL and OPENCODE (its version). Put all five lines, verbatim, in your notes: the executor and teardown read them there. On "setup failed", return ok: false with its output as the notes.
