The program is a terminal AI agent. Each call blocks until the agent is done and prints its reply. Give each call a 15-minute shell timeout.

## New session

```bash
cd $RUNDIR && michelin-sandboxed agy --model gemini-4-neon-medium --dangerously-skip-permissions -p "MESSAGE" < /dev/null 2>&1
```

## Same session

```bash
cd $RUNDIR && michelin-sandboxed agy --model gemini-4-neon-medium --dangerously-skip-permissions --continue -p "MESSAGE" < /dev/null 2>&1
```

`michelin-sandboxed` keeps the agent out of the michelin folder, other runs' folders and $RUNDIR/.check. Keep it on every call.

Never fix the agent's work yourself.
