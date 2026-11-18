# Michelin

**Michelin evaluates a whole agent system on real user journeys: you write what a user does and what should be true afterwards, an LLM drives your agent through it, and blind LLM judges score the recorded evidence.**

[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![node >=22.18](https://img.shields.io/badge/node-%3E%3D22.18-brightgreen)](https://nodejs.org)

**Evaluate one agent**

![A Michelin run report: OpenCode on Qwen 3.8 27B, one SWE-bench Lite task, pass rate, cost and each step](docs/run-report.png)

**Compare two**

![A Michelin compare report: Qwen 3.8 27B beats Gemma 4 26B 4-0-1 on five SWE-bench Lite tasks, judged blind](docs/compare-report.png)

OpenCode on Qwen 3.8 27B vs Gemma 4 26B, five SWE-bench Lite tasks, judged blind to the tests: [results](subjects/opencode/RESULTS.md), [reproduce it](subjects/opencode/README.md).

## Why it is different

- **Whole systems, real journeys.** A CUJ (critical user journey) is a few lines of yaml: what a user does and what should be true afterwards. Your agent runs as it really runs (CLI, server, chat app); an LLM sets it up, drives it, and tears it down. No harness code inside your agent.
- **Must-fail controls.** Every suite ships a CUJ whose expectations are deliberately wrong. If it ever passes, the judges are rubber-stamping and the run can't be trusted.
- **Blind judges.** Judges score each expectation from the recorded evidence alone, never the subject itself. `michelin compare` goes further: it replaces run ids, subject names and model names before judges pick the better of two runs, in both orders.
- **Any metric you care about.** A subject can name metrics (cost, tokens, steps) for the executor to record; `michelin compare` tables them beside wall time, and judges never see them.

## Quickstart

Needs Node 22.18+, `git`, `python3` (for the toy subject) and the [`claude` CLI](https://docs.anthropic.com/en/docs/claude-code), logged in. Every role is a `claude -p` call, so runs use your Claude plan or API credit.

**Safety.** Every role runs `claude -p --permission-mode bypassPermissions`: it can run any command and edit any file your user can, with no prompt. Run subjects you don't trust in a sandbox or a VM.

```sh
npm install -g github:krishansubudhi/michelin   # installs the `michelin` command
mkdir my-evals && cd my-evals
michelin init                                   # writes michelin.json and copies the toy subject
michelin run                                    # the first judge scores alone; the others join only on a fail
```

Expected ending (about a minute):

```
PASS  toy-country  passed 2/2  (done)
FAIL  toy-name     passed 0/1  (done)
total: 1/2 CUJs passed
```

`toy-name` is the must-fail control: the toy always answers "USA", so a healthy judge fails "The reply says Alice". Each CUJ leaves `.runs/<runid>/report.html`.

**Roles.**

- **executor**: Michelin's agent. It carries out the CUJ against your program and records the evidence (`--executor`).
- **judges**: score that evidence against the CUJ's expectations (`--judges`); in `michelin compare` they pick the better run.
- **agent under test**: the subject. Its own model is the subject's setting (e.g. `OPENCODE_MODEL` for OpenCode), never `--executor`.

`michelin --help` gives an overview; `michelin run --help`, `michelin compare --help` and `michelin init --help` give each command's flags and an example.

**Settings.** Flags override `./michelin.json`, which overrides the built-in defaults. For example, `michelin run --runs 3` runs every CUJ three times. Every key, flag and environment variable: [docs/settings.md](docs/settings.md).

## Your own eval

A subject is a folder of three plain-English files the LLM roles follow:

- `setup.md`: install and start your program; print the handles (ports, tokens) later steps need.
- `howtorun.md`: how to talk to it (a command, a URL, a chat).
- `teardown.md`: what to stop and delete afterwards.

A CUJ is a yaml file in `<subject>/cujs/`:

```yaml
instruction: |
  Ask "What is my country?"
timeout_s: 60
expectations:
  - The reply says USA.
```

An A/B compares two versions of the agent under test, with the executor and the judges kept the same. The toy has two: `TOY_VARIANT=v1` (the default) answers, `TOY_VARIANT=v2` is a broken build that replies "I am not sure". Run the same CUJ on each, then blind judges pick the better run. Each `michelin run` prints its `run dir:`.

```sh
TOY_VARIANT=v1 michelin run subjects/toy subjects/toy/cujs/toy/country.yaml
TOY_VARIANT=v2 michelin run subjects/toy subjects/toy/cujs/toy/country.yaml
michelin compare v1=.runs/<first run id> v2=.runs/<second run id>
```

v1 passes 2/2 and v2 1/2, and the compare picks v1 in both orders:

```
| run | W-L-T | win rate | Elo |
| --- | --- | --- | --- |
| v1 | 1-0-0 | 100% | 1016 |
| v2 | 0-1-0 | 0% | 984 |
```

For your own agent, the two versions are whatever you are testing: two builds, two prompts, or two models set through the subject (for OpenCode, `OPENCODE_MODEL`).

More: [Write a subject](docs/write-a-subject.md), [Compare](docs/compare.md).

## A real result: OpenCode

[OpenCode](https://opencode.ai) on Gemma 4 26B (local Ollama), one run per CUJ (n=1), Sonnet 5.5 executor, three judges (Opus 5.5, Sonnet 5.5, Fable 5.2):

| CUJ                     | Result | Expectations | Judge votes |
| ----------------------- | ------ | ------------ | ----------- |
| `opencode-fix_test`     | PASS   | 2/2          | 3/3, 3/3    |
| `opencode-ask_repo`     | PASS   | 2/2          | 3/3, 3/3    |
| `opencode-fail_control` | FAIL   | 0/2          | 0/3, 0/3    |

The control failing is the healthy outcome. Details: [RESULTS.md](subjects/opencode/RESULTS.md).

**Blind compare vs real tests.** On 5 SWE-bench Lite tasks, a judge that saw only the issue and each diff, never the test output, preferred Qwen 3.8 27B over Gemma 4 26B on every task with a winner. The hidden tests, run afterwards, agree wherever they can decide, but across two runs only 3 tasks had edits from both models, and the tests decide only 1 of those (agree, 1 of 1). Not a model ranking: see the before/after and limits in [RESULTS.md](subjects/opencode/RESULTS.md#swe-bench-lite-gemma-4-26b-vs-qwen-38-27b-judged-blind-to-the-tests-2026-11-18).

## Docs

- [Concepts](docs/concepts.md)
- [Settings](docs/settings.md)
- [Compare runs (A/B)](docs/compare.md)
- [Write a subject](docs/write-a-subject.md)
- [Subjects outside this repo](docs/external-subjects.md)
- [Evaluate OpenCode](docs/opencode.md)
- [Contributing](CONTRIBUTING.md)

MIT licensed.
