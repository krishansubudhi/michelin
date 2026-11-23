---
name: michelin
description: Evaluate an agent or program end to end with Michelin (npm michelin-eval): write a new subject or CUJ yaml files ($RUNDIR, michelin-sandboxed), run them, read report.html, find the root cause of a failure, fix and rerun, and A/B two versions with michelin compare. Use when asked to eval, test or compare an agent on real user journeys.
---

# Michelin

Michelin runs critical user journeys (CUJs) against a program. Each role is a `claude -p` call: a constructor follows
setup, the executor drives the program and records evidence, a destructor tears down, and blind judges score each
expectation from that evidence alone. It needs Node 22.18+ and the `claude` CLI, logged in. Every role runs with
`bypassPermissions`, so run subjects you don't trust in a sandbox.

## Install

```sh
npm install -g michelin-eval
mkdir my-evals && cd my-evals && michelin init   # michelin.json + the toy subject in subjects/toy
michelin run                                     # toy-country passes; toy-name, the must-fail control, fails
```

## Words

- **Subject**: the program under test, as a folder of three markdown files (`setup.md`, `howtorun.md`,
  `teardown.md`) plus any helper scripts.
- **CUJ**: one journey, one yaml file: what to do and what must be true afterwards. Also called a case.
- **`$RUNDIR`**: this CUJ's own scratch folder. Empty at setup, deleted after teardown. The agent works in it, and
  everything a subject or a case creates goes in it. Every role is told its real path.
- **`michelin-sandboxed`**: a wrapper for the command that starts the agent. Inside it the agent cannot read or
  write the michelin folder (the one you run `michelin` from), other runs' folders or `$RUNDIR/.check`. Its own
  `$RUNDIR` stays open. Without it the agent can read the case file and the expectations.
- **A case's private files**: what the agent must never see. Two places, both behind the sandbox. DATA is the
  case's own folder in the michelin folder, `<cujs folder>/<suite>/data/<case>/` (a fake website, a template): the
  executor runs it from there and never copies it into `$RUNDIR`. `$RUNDIR/.check` is for what a run makes (pid
  files of servers the case started, hidden codes).

## Write a subject

Plain markdown, no `#` title line, in `subjects/<name>/`. Copy `subjects/claude_code` for a command-line agent or
`subjects/toy` for a small program.

1. `setup.md`: install and start the program inside `$RUNDIR`, and print the handles later steps need
   (`PORT=8123`, `TOKEN=...`). Give it one shell command that prints `ready` or `setup failed: <why>`. Do not name
   the agent or its model in anything setup prints, or a blind compare is no longer blind.
2. `howtorun.md`: the exact command for each need, under its heading. Shared suites need `## New session` (one
   message, no memory of earlier calls) and `## Same session` (a follow-up in the previous call's session). Start
   each command with `cd $RUNDIR && michelin-sandboxed`, put `MESSAGE` where the text goes, and say what shell
   timeout to give a call. Name any metrics to record (cost, tokens). End with "Never fix the agent's work yourself."
3. Where the wrapper goes: on the command that **starts** the agent. For a one-shot command that is the line in
   `howtorun.md`. For a server it is the start line in `setup.md`. Never wrap a case's own helpers.
4. `teardown.md`: stop what setup started and any server a case left behind:
   `for f in "$RUNDIR"/.check/*.pid; do [ -f "$f" ] && kill "$(cat "$f")"; done`.
5. Everything specific to one agent (flags, session handling, model) lives in the subject, never in a CUJ.
   Otherwise two agents are not given the same test.

## Write a CUJ

A CUJ for one subject goes in `subjects/<name>/cujs/`. A suite any agent can take goes in `cujs/<suite>/` and runs
against any subject: `michelin run subjects/claude_code cujs/sanity/`.

Keys: `instruction`, `timeout_s` and `expectations` are required. `story` (a note for humans), `given` (state setup seeds
before the CUJ starts, never told to the program) and `needs` (names from `<cujs folder>/needs.md` that a subject
answers with the same `##` heading in `howtorun.md`) are optional. Any other key is an error.

```yaml
story: The user asks for the default country.
instruction: |
  Send the agent this one message in a NEW session:

      What is my country?
timeout_s: 60
expectations:
  - The reply says USA.
```

1. Write the instruction as numbered steps for the executor. Say "send the agent this one message in a NEW
   session", never a command: how to send it is the subject's job.
2. Put the agent's files in `$RUNDIR` with their exact lines. Keep the answer out of them when finding it is the
   test.
3. A case that needs a server keeps it in DATA and starts it from there
   (`python3 DATA/site.py $RUNDIR > /dev/null 2>&1 &`). The server writes its pid to `$RUNDIR/.check/<name>.pid`.
4. End with a step where the executor checks the world itself and records the output (`cat` a file, `curl` a page,
   `ls` a folder). Judges trust that step, not the agent's word.
5. Write each expectation in plain words, so a judge can decide it from the recorded output alone. One fact per
   expectation. Only the judges read expectations.
6. Write the message as a real person would. No hints, no names of the route you hope the agent finds.
7. Add a must-fail control to every new suite: a case the program handles, with expectations wrong on purpose. If it
   passes, the judges are rubber-stamping.

A full example with a server and hidden data: `cujs/personal-agents/krishan_hard1/tool_broken_find_route.yaml`.

## Check your work

```sh
michelin run subjects/<name> cujs/sanity/   # p_ cases must pass, f_ cases must fail
michelin run subjects/<name> <your cuj>.yaml
```

`f_sandbox` passing means the agent started without `michelin-sandboxed`. Then read `executor.json`: did the
executor do every step, and does the last step's output show what the expectations ask about? Run a new case once
on a strong agent and once on a weak one. A case both pass or both fail tells you nothing yet.

## Run

```sh
michelin run subjects/myapp subjects/myapp/cujs/          # every *.yaml in the folder, each on a fresh start
michelin run subjects/myapp subjects/myapp/cujs/login.yaml --runs 3
```

It prints one `PASS`/`FAIL` line per CUJ, the `run dir:` and report.html as a `file://` URL. `michelin run --help`
lists the flags (`--executor`, `--judges`, `--all-judges`, `--baseline`, `--settings`).

## Read the result and fix

1. Open `.runs/<runid>/report.html`: per CUJ, each expectation's verdict with the judges' reasons, and the
   executor's steps (what it sent, what came back, ms).
2. For the raw evidence read `.runs/<runid>/<cuj-id>/executor.json` (steps and reply) and `verdict.json`
   (per-expectation votes); `constructor.json` and `destructor.json` in the run dir hold setup and teardown output,
   and `llm.log` is the timeline of every role call.
3. Classify the failure before fixing: a real bug in the program, a setup/teardown problem (the constructor's notes
   say so), a vague or wrong expectation, or a CUJ the executor could not follow. Fix the program for the first, the
   subject files for the second and fourth, the CUJ for the third. Never loosen an expectation just to pass.
4. Rerun the same CUJ. With `--baseline .runs/<earlier runid>`, the other judges join wherever the first judge's
   verdict differs from that run's.

## A/B with compare

Keep the executor and judges fixed and change only the agent under test (a build, a prompt, a model the subject
reads from an environment variable), run the same CUJs on each, then:

```sh
michelin compare old=.runs/<run A id> new=.runs/<run B id> [--hide tok]...
```

Judges see both runs with names, models and setup values scrubbed (add more with `--hide`), in both orders; a run
wins only when picked both times. Results go to `.runs/compare-<time>/`: `compare.md` (W-L-T, win rate, Elo, each
judge's reasons) and `report.html`.
