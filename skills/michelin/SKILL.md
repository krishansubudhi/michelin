---
name: michelin
description: Evaluate an agent or program end to end with Michelin (npm michelin-eval): write a subject and CUJ yaml files, run them, read report.html, find the root cause of a failure, fix and rerun, and A/B two versions with michelin compare. Use when asked to eval, test or compare an agent on real user journeys.
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

## Write a subject

A subject is a folder of plain markdown (no `#` title line) the LLM roles follow, e.g. `subjects/myapp/`:

- `setup.md`: install and start the program; print the handles later steps need (`PORT=8123`, `TOKEN=...`).
- `howtorun.md`: how to talk to it: a command, a URL, a chat. Name any metrics to record (cost, tokens).
- `teardown.md`: what to stop and delete.

CUJs live in `subjects/myapp/cujs/`. Keys: `instruction`, `timeout_s` and `expectations` are required; `story` and
`given` are optional; any other key is an error. Write each expectation so a judge can check it from recorded output
alone. Add one must-fail control: a journey the program handles, with deliberately wrong expectations. If it ever
passes, the judges are rubber-stamping.

```yaml
instruction: |
  Ask "What is my country?"
timeout_s: 60
expectations:
  - The reply says USA.
```

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
