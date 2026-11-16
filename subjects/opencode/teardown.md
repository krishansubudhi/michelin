OpenCode leaves no process running once `opencode run` exits. Delete its workspace and config, with TMP from setup's notes (or the scratch folder named at the end of this prompt if setup printed nothing):

```bash
TMP=<TMP from setup>
rm -rf "$TMP/work" "$TMP/opencode.json" && echo "teardown ok"
```

The runner deletes TMP itself after teardown. OpenCode's own cache (its provider packages) stays, so the next run starts faster.
