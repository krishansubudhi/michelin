OpenCode is a terminal AI coding agent: you give it a message, and it reads, edits and runs things in the folder it is started in. Use WORK, CONFIG and MODEL from setup's output: that is this run's workspace.

Send OpenCode one message per call, with this command (fill in WORK, CONFIG, MODEL and the message):

```bash
cd WORK && OPENCODE_CONFIG=CONFIG NO_COLOR=1 opencode run --model MODEL "MESSAGE" < /dev/null 2>&1 | sed 's/\x1b\[[0-9;]*m//g'
```

The `sed` strips terminal colour codes; keep it in the command.

- Add `--agent plan` before the message only when the CUJ says to ask without editing. The plan agent is OpenCode's read-only mode: it may read files but not edit them.
- Each call is a fresh OpenCode session; files in WORK carry over between calls.
- One call can take several minutes on a local model: run it with a shell timeout of 10 minutes (600000 ms).
- OpenCode's reply is what it prints: the tool calls it made (Read, Edit, shell commands) and then its answer. Time each call, from start to exit, and report ms=<that time> plus the reply.

To check the result, use plain shell commands in WORK (cat, python3, shasum, git status) as the CUJ asks. Do not fix OpenCode's work yourself.

Record EVERY command as its own step, in order, with its output verbatim in `got`: each file you write, each check before and after, and each OpenCode call. The judges trust only what a step recorded, never your summary.
