Stop any server a CUJ left running, then report:

```bash
for f in "$RUNDIR"/.check/*.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; done; echo "teardown ok"
```
