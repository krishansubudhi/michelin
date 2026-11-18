# Changelog

## 0.1.1

- `--runs n` keeps every run in the end-of-run summary: each CUJ line names every run's score, and a CUJ passes only when every run did (only the last run was shown before).
- `michelin compare`'s blind scrub hides names as whole tokens only, so code and diffs around a hidden name stay intact.
- The executor times calls with `node -p Date.now()`, not the GNU-only `date +%s%N` that macOS lacks.
- Reports show image files as `<img>` and other binary files as a note, never as text.
- The run lock and scratch space default to a per-user folder, `<os temp>/michelin-<user>`, so a `/tmp/michelin` owned by another user no longer fails with EACCES. `MICHELIN_TMP` still overrides; point every user at one shared folder to lock across users.
- The report path is printed as a clickable `file://` URL.
- `michelin init` writes only what differs from the defaults: `subject` and `cujs`.
- README: a short "Your own eval" section (subject layout, a CUJ, an A/B with `michelin compare`).

## 0.1.0

- First release.
