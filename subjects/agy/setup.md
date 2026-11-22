Prepares a throwaway workspace for Antigravity's terminal agent (agy), Gemini 4 Neon at medium effort. The agent runs as this OS user with shell and curl.

Run this as one shell command:

```bash
command -v agy >/dev/null && echo ready || { echo "setup failed: agy not found on PATH"; exit 1; }
```

Setup does not say which agent or model runs, so the judges cannot see it. On "setup failed", return ok: false with its output as the notes.
