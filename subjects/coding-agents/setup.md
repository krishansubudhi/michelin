Prepares a throwaway workspace for a terminal coding agent, so the same CUJs can be run on different agents and models and the runs compared with `michelin compare`. Two CLIs are supported, both in headless print mode: Claude Code (`claude -p`) and Antigravity (`agy -p`).

The agent is picked by environment variables, read by `subjects/coding-agents/agent.sh`, never by the executor:

- AGENT: `claude` or `agy`.
- AGENT_MODEL: that CLI's model id, e.g. `claude-opus-5-5` for claude, or `claude-opus-5-5-medium` / `gemini-4-carbon-medium` for agy (`agy models` lists them; agy puts the effort in the id).
- AGENT_EFFORT (optional, claude only): its `--effort`, default `medium`.
- AGENT_RUNNER (optional): a command run instead of the CLI, with the same arguments, e.g. one that hands the call to another OS user who has that CLI logged in.
- AGENT_WORKROOT (optional): make the workspace in this folder, world-writable, instead of in the scratch folder. Use it with AGENT_RUNNER when the agent runs as another OS user.

TMP: the run's scratch folder named at the end of this prompt.

Run the block below as ONE shell command, with TMP filled in:

```bash
TMP=<scratch folder>
case "$AGENT" in claude|agy) ;; *) echo "setup failed: set AGENT=claude or AGENT=agy"; exit 1;; esac
[ -n "$AGENT_MODEL" ] || { echo "setup failed: AGENT_MODEL is not set"; exit 1; }
[ -n "$AGENT_RUNNER" ] || command -v "$AGENT" >/dev/null || { echo "setup failed: $AGENT not found on PATH"; exit 1; }
[ -f subjects/coding-agents/agent.sh ] || { echo "setup failed: run from the michelin folder"; exit 1; }
if [ -n "$AGENT_WORKROOT" ]; then WORK=$(mktemp -d "$AGENT_WORKROOT/work.XXXXXX") && chmod 777 "$WORK"; else WORK="$TMP/work" && mkdir -p "$WORK"; fi || { echo "setup failed: could not make the workspace"; exit 1; }
printf 'TMP=%s\nWORK=%s\n' "$TMP" "$WORK"
```

It prints TMP and WORK (the agent's workspace, an empty folder). Put both lines, verbatim, in your notes: the executor and teardown read them there. Setup deliberately does not print which agent or model runs, so the judges cannot see it. On "setup failed", return ok: false with its output as the notes.
