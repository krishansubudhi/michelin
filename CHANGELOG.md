# Changelog

## 0.1.3

- Published to npm: `npm install -g michelin-eval`. `bin/michelin.js` is now executable in git, so `npm i -g <folder>` and `npm i -g github:krishansubudhi/michelin` no longer fail with "permission denied".
- The executor times each call as one command, `/usr/bin/time -p <command>`. The old `s=$(node -p Date.now()); ...; $(( ... ))` wrapper was blocked by Claude Code's Bash guard even under `bypassPermissions`, costing failed attempts on every CUJ.
- `michelin compare --hide tok` always scrubs `tok` (whole words), however short: `--hide v2` now hides `v2`. Automatic identifiers under 3 characters are still skipped.
- `skills/michelin/SKILL.md`: a Claude Code skill that teaches a coding agent to install Michelin, write a subject and CUJs, run them, read report.html, find the root cause, fix and rerun, and A/B with `michelin compare`. It ships in the package; the README says how to copy it into `~/.claude/skills`.
- README: says up front that Michelin requires Claude Code (`claude` CLI, logged in).
- Every report.html (run and compare) carries a slim grey credit line above the title, "Made with Michelin · npm i -g michelin-eval · GitHub", and a small footer, "Made with Michelin · github.com/krishansubudhi/michelin", both linking the repo.

## 0.1.2

- `--executor` names the executor's model (Michelin's own agent). It replaces `--model`, which still works as a silent alias.
- Per-command help: `michelin run --help`, `michelin compare --help` and `michelin init --help` each print only their own usage and flags, with one example. `michelin --help` is an overview with a Roles block (executor, judges, agent under test) and points to them. A usage error prints the help of the command it belongs to.
- Every path Michelin prints is absolute: the run dir and its llm.log, the compare dir, and what `michelin init` wrote or kept. `michelin compare` also prints its report.html as a clickable `file://` URL, like `run`.
- The README and docs/compare.md A/B now compare two versions of the agent under test, with the executor and judges fixed: the toy subject reads `TOY_VARIANT` (`v1` answers, `v2` is a broken build), and the compare picks v1 in both orders. docs/compare.md says runs pair by CUJ id.
- README: a Roles block, a safety note (every role runs `claude -p` with `bypassPermissions`), and two screenshots, "Evaluate one agent" and "Compare two".
- subjects/opencode/README.md: how to reproduce the Qwen 3.8 27B vs Gemma 4 26B SWE-bench Lite comparison end to end, the Gemma `todowrite` before/after, and a caveat on looking up the fix (git history, web, training data) with three best practices.

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
