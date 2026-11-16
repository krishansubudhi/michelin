Aider is a command-line AI pair programmer: you give it a message and the files it may touch, and it edits them. Use WORK and MODEL from setup's output: that is this run's workspace.

Send Aider one message per call, with this command (fill in WORK, MODEL, the files and the message):

```bash
cd WORK && OLLAMA_API_BASE="${OLLAMA_API_BASE:-http://localhost:11434}" uvx --python 3.12 --from aider-chat aider \
  --model MODEL --yes-always --no-auto-commits --no-check-update --no-show-model-warnings --no-analytics --no-pretty \
  FILE ... --message "MESSAGE" 2>&1 | sed '/► \*\*THINKING\*\*/,/► \*\*ANSWER\*\*/d'
```

The `sed` drops the model's THINKING block, which reasoning models print before the answer; keep it in the command. It is not the reply and is not evidence.

- Name the files the message is about (FILE ...) so Aider adds them to its chat; a file that doesn't exist yet may be named too.
- Add `--chat-mode ask` before `--message` only when the CUJ says to ask without editing.
- Each call is a fresh Aider session; files in WORK carry over between calls.
- One call can take several minutes on a local model: run it with a shell timeout of 10 minutes (600000 ms).
- Aider's reply is what it prints. Time each call, from start to exit, and report ms=<that time> plus the reply.

To check the result, use plain shell commands in WORK (cat, python3, shasum, git status) as the CUJ asks. Do not fix Aider's work yourself.

Record EVERY command as its own step, in order, with its output verbatim in `got`: each file you write, each check before and after, and each Aider call. The judges trust only what a step recorded, never your summary.
