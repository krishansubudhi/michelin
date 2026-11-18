# Michelin

**Michelin evaluates a whole agent system on real user journeys: you write what a user does and what should be true afterwards, an LLM drives your agent through it, and blind LLM judges score the recorded evidence.**

[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![node >=22.18](https://img.shields.io/badge/node-%3E%3D22.18-brightgreen)](https://nodejs.org)

![A Michelin report: pass rate, cost, and each step of one OpenCode run](docs/report.png)

## Why it is different

- **Whole systems, real journeys.** A CUJ (critical user journey) is a few lines of yaml: what a user does and what should be true afterwards. Your agent runs as it really runs (CLI, server, chat app); an LLM sets it up, drives it, and tears it down. No harness code inside your agent.
- **Must-fail controls.** Every suite ships a CUJ whose expectations are deliberately wrong. If it ever passes, the judges are rubber-stamping and the run can't be trusted.
- **Blind judges.** Judges score each expectation from the recorded evidence alone, never the subject itself. `michelin compare` goes further: it replaces run ids, subject names and model names before judges pick the better of two runs, in both orders.
- **Any metric you care about.** A subject can name metrics (cost, tokens, steps) for the executor to record; `michelin compare` tables them beside wall time, and judges never see them.

## Quickstart

Needs Node 22.18+, `git`, `python3` (for the toy subject) and the [`claude` CLI](https://docs.anthropic.com/en/docs/claude-code), logged in. Every role is a `claude -p` call, so runs use your Claude plan or API credit.

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

**Settings.** Flags override `./michelin.json`, which overrides the built-in defaults. For example, `michelin run --runs 3` runs every CUJ three times. Every key, flag and environment variable: [docs/settings.md](docs/settings.md).

## A real result: OpenCode

[OpenCode](https://opencode.ai) on Gemma 4 26B (local Ollama), one run per CUJ (n=1), Sonnet 5.5 executor, three judges (Opus 5.5, Sonnet 5.5, Fable 5.2):

| CUJ                     | Result | Expectations | Judge votes |
| ----------------------- | ------ | ------------ | ----------- |
| `opencode-fix_test`     | PASS   | 2/2          | 3/3, 3/3    |
| `opencode-ask_repo`     | PASS   | 2/2          | 3/3, 3/3    |
| `opencode-fail_control` | FAIL   | 0/2          | 0/3, 0/3    |

The control failing is the healthy outcome. Details: [RESULTS.md](subjects/opencode/RESULTS.md).

**Blind compare vs real tests.** On 5 SWE-bench Lite tasks, a judge that saw only the issue and each diff, never the test output, preferred Qwen 3.8 27B over Gemma 4 26B on all 5; the hidden tests, run afterwards, agree on 4 of 4 decidable tasks, but only 1 task had edits from both models. Not a model ranking: see the limits in [RESULTS.md](subjects/opencode/RESULTS.md#swe-bench-lite-gemma-4-26b-vs-qwen-38-27b-judged-blind-to-the-tests-2026-11-18).

## Docs

- [Concepts](docs/concepts.md)
- [Settings](docs/settings.md)
- [Write a subject](docs/write-a-subject.md)
- [Subjects outside this repo](docs/external-subjects.md)
- [Evaluate OpenCode](docs/opencode.md)
- [Contributing](CONTRIBUTING.md)

MIT licensed.
