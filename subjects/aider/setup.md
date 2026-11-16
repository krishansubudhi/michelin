Prepares a throwaway workspace for Aider (https://aider.chat), the open-source AI pair programmer in your terminal, and checks that it starts. Aider runs through `uvx`, so nothing is installed globally; the first run downloads it (about 20 seconds), later runs reuse uv's cache.

Aider needs a model of its own, named by the environment variable AIDER_MODEL, e.g. `ollama_chat/qwen2.5-coder:7b` (free, local Ollama) or `anthropic/<model>` (with ANTHROPIC_API_KEY set). Michelin's own roles still run on the `claude` CLI.

TMP: the run's scratch folder named at the end of this prompt. Aider's workspace goes in it, and teardown deletes it.

Run the block below as ONE shell command, with TMP filled in, and a shell timeout of at least 3 minutes:

```bash
TMP=<scratch folder>
[ -n "$AIDER_MODEL" ] || { echo "setup failed: AIDER_MODEL is not set, e.g. export AIDER_MODEL=ollama_chat/qwen2.5-coder:7b"; exit 1; }
command -v uvx >/dev/null || { echo "setup failed: uvx not found; install uv from https://docs.astral.sh/uv/"; exit 1; }
command -v git >/dev/null || { echo "setup failed: git not found"; exit 1; }
mkdir -p "$TMP/work" && git -C "$TMP/work" init -q || { echo "setup failed: could not make $TMP/work"; exit 1; }
V=$(uvx --python 3.12 --from aider-chat aider --version 2>&1) || { echo "setup failed: aider did not start"; echo "$V" | tail -5; exit 1; }
printf 'TMP=%s\nWORK=%s\nMODEL=%s\nAIDER=%s\n' "$TMP" "$TMP/work" "$AIDER_MODEL" "$(echo "$V" | tail -1)"
```

On success it prints TMP, WORK (Aider's workspace, an empty git repo), MODEL and AIDER (its version). Put all four lines, verbatim, in your notes: the executor and teardown read them there. On "setup failed", return ok: false with its output as the notes.
