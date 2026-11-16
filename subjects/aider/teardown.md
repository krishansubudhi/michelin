Aider leaves no process running. Delete its workspace, with TMP from setup's notes (or the scratch folder named at the end of this prompt if setup printed nothing):

```bash
TMP=<TMP from setup>
rm -rf "$TMP/work" && echo "teardown ok"
```

The runner deletes TMP itself after teardown. uv's download cache stays, so the next run starts faster.
