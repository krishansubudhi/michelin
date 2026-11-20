The agent leaves no process running once its call exits. Delete its workspace, with TMP and WORK from setup's notes (if setup printed nothing, there is nothing to delete):

```bash
WORK=<WORK from setup>
rm -rf "$WORK" && echo "teardown ok"
```

The runner deletes TMP itself after teardown.
