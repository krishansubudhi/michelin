The program is a terminal AI agent. Each call blocks until the agent is done and prints its reply. Give each call a 15-minute shell timeout.

## New session

```bash
cd $RUNDIR && claude -p --model claude-opus-5-5 --effort medium --permission-mode bypassPermissions --strict-mcp-config "MESSAGE" < /dev/null 2>&1
```

## Same session

```bash
cd $RUNDIR && claude -p --model claude-opus-5-5 --effort medium --permission-mode bypassPermissions --strict-mcp-config --continue "MESSAGE" < /dev/null 2>&1
```

Never fix the agent's work yourself.
