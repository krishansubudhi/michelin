The subject is a terminal coding agent: you give it a message, and it reads, edits and runs things in the folder it is started in. Use WORK from setup's notes. Run every command from the michelin folder (the prompt gives its path).

Send the agent one message per call, with this command (fill in WORK and the message; keep the quotes):

```bash
sh subjects/coding-agents/agent.sh WORK "MESSAGE"
```

- Each call is a fresh agent session; files in WORK carry over between calls.
- Run it with a shell timeout of 10 minutes (600000 ms).
- It prints the agent's final reply, then one metrics line: `agent_ms=… cost_usd=… tokens_in=… tokens_out=… turns=… status=…`. Report ms=<agent_ms> for that step, and record the step's full output.
- Record these metrics, from the agent calls, summed over the CUJ if there is more than one call: `agent_ms`, `cost_usd` (write `n/a` if the line says n/a), `tokens_in`, `tokens_out`, `turns`.

To check the result, use plain shell commands in WORK (cat, python3, shasum, ls) as the CUJ asks. Do not fix the agent's work yourself, and never edit a file after the agent's call unless the CUJ says to.

Record EVERY command as its own step, in order, with its output verbatim in `got`: each file you write, each check before and after, and each agent call. The judges trust only what a step recorded, never your summary.
