Prepares a throwaway workspace for Claude Code (Anthropic's terminal agent), Opus 5.5 at medium effort. The agent runs as this OS user with shell and curl.

Run this as one shell command:

```bash
command -v claude >/dev/null && echo ready || { echo "setup failed: claude not found on PATH"; exit 1; }
```

Setup does not say which agent or model runs, so the judges cannot see it. On "setup failed", return ok: false with its output as the notes.
