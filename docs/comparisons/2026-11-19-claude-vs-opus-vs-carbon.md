Claude Code (Opus 5.5) vs Antigravity CLI with Opus 5.5 vs Antigravity CLI with Gemini 4 Carbon, on the same four small coding tasks, run with Michelin on 2026-11-19. Same machine, same tasks, same executor and judge. Only the agent under test changed.

TL;DR: all three solved all four tasks. A blind judge could not tell their work apart on 11 of 12 head-to-head games. What separated them was time: Claude Code took about 8 s per task, Antigravity with the same Opus model about 11 to 12 s, and Antigravity with Carbon 21 to 51 s. Four tiny tasks, one run each, so read this as a smoke test, not a ranking.

## Setup

- Subject: [`subjects/coding-agents`](../../subjects/coding-agents), which drives a terminal coding agent in headless print mode through `agent.sh`. The agent is picked by `AGENT` and `AGENT_MODEL`, which setup never prints, so per-run judges don't see which agent ran.
- Agents under test:
  - **claude**: Claude Code 2.1.322, `claude -p --model claude-opus-5-5 --effort medium`, no MCP servers.
  - **agy-opus**: Antigravity CLI (`agy`) 1.5.12, `--model claude-opus-5-5-medium`, no MCP servers.
  - **agy-carbon**: the same `agy`, `--model gemini-4-carbon-medium`.
- CUJs (`subjects/coding-agents/cujs/coding-agents/`), each a single agent call on a fresh empty folder:
  - `fix_test`: fix an off-by-one in `calc.py` so its unit test passes, without touching the test.
  - `ask_repo`: answer a question about a two-file repo without changing any file.
  - `json_fix`: repair a `config.json` with trailing commas without changing any key or value.
  - `add_flag`: add a `--name` option to a one-line script and keep its old output.
- Michelin roles: the default `settings.json`. Haiku 5.5 constructor and destructor, Sonnet 5.5 executor, Opus 5.5 judge at high effort (the other two judges join only on a fail).
- Head to head: `michelin compare claude=… agy-opus=… agy-carbon=…`, one compare per CUJ, Opus 5.5 judge, both orders, run names, models and setup values scrubbed before the judge sees anything. A judged tie goes to the run that was 1.5x faster or better (the default `--tiebreak speed`).

## Results

Pass rate (each expectation judged from the recorded evidence):

| agent      | CUJs passed | expectations passed |
| ---------- | ----------- | ------------------- |
| claude     | 4/4         | 8/8                 |
| agy-opus   | 4/4         | 8/8                 |
| agy-carbon | 4/4         | 8/8                 |

Blind head to head, summed over the four CUJs (12 games, each played in both orders):

| agent      | W-L-T | judged on quality alone | won on the speed tiebreak |
| ---------- | ----- | ----------------------- | ------------------------- |
| claude     | 6-0-2 | 1 win, 7 ties           | 5                         |
| agy-opus   | 4-2-2 | 1 loss, 7 ties          | 4                         |
| agy-carbon | 0-8-0 | 8 ties                  | 0 (lost 8 on speed)       |

The one game decided on quality (`json_fix`, claude over agy-opus) was decided mostly on the executor's notes, not the agent's fix: both agents produced the same valid file.

Agent time and tokens per CUJ, as `agent.sh` measured them (one call each):

| CUJ      | claude         | agy-opus        | agy-carbon      |
| -------- | -------------- | --------------- | --------------- |
| fix_test | 9.2 s, 55k/466 | 11.3 s, 42k/491 | 46.8 s, 38k/493 |
| ask_repo | 7.9 s, 55k/402 | 10.8 s, 42k/413 | 22.5 s, 28k/517 |
| json_fix | 8.4 s, 56k/495 | 11.5 s, 42k/540 | 21.1 s, 37k/490 |
| add_flag | 7.7 s, 55k/407 | 11.8 s, 42k/651 | 51.1 s, 38k/692 |

Tokens are input/output as each CLI reports them. Claude Code counts cache reads and writes as input; agy counts uncached input plus cache reads. Close enough to compare in size, not to the token.

## Cost

| what                                                     | USD  |
| -------------------------------------------------------- | ---- |
| claude: the agent's own calls (Claude Code's own figure) | 0.31 |
| agy-opus and agy-carbon: the agent's own calls           | n/a  |
| Michelin roles, claude runs                              | 0.43 |
| Michelin roles, agy-opus runs                            | 0.38 |
| Michelin roles, agy-carbon runs                          | 0.37 |
| blind compare judges (4 compares)                        | 1.09 |

agy ran on a Google AI subscription and reports tokens, not dollars, so its agent cost is not comparable here. A first agy-opus attempt was thrown away (another $0.54 in Michelin calls, see caveats).

## Caveats

- Four tasks, one run each (n=1). The tasks are deliberately tiny. All three agents pass them, so this says nothing about long or hard work, where these agents are known to differ.
- Speed decided almost every game. On quality the judge called 11 of 12 games a tie. If you only care about the result on tasks this small, these three are equal.
- Time includes each CLI's start-up. Claude Code ran as the same OS user as the harness. agy ran as a second OS user that has it logged in, through a small file-queue runner (`AGENT_RUNNER`), which adds up to about a second per call. That does not explain a 3 s gap, let alone 40 s.
- The first agy-opus attempt hit a bug in that runner, not in agy: files the executor wrote were read-only to the second user, so agy found the fix but could not save it. That run was discarded, the runner was fixed, and both agy arms were rerun from scratch.
- One judge model (Opus 5.5), and it is from the same family as two of the three agents. Compares scrub names and models, but an agent's style can still give it away.
- No must-fail control was run in this comparison to save cost. The subject ships one (`fail_control.yaml`).
- agy reports `turns=1` per call however many tool calls it made, so turns are not compared.
- Antigravity's model picker says which model it asked for. This run can't verify which model actually served each call.

## Reproduce

```sh
C=subjects/coding-agents/cujs/coding-agents/
AGENT=claude AGENT_MODEL=claude-opus-5-5 michelin run subjects/coding-agents $C
AGENT=agy AGENT_MODEL=claude-opus-5-5-medium michelin run subjects/coding-agents $C
AGENT=agy AGENT_MODEL=gemini-4-carbon-medium michelin run subjects/coding-agents $C
michelin compare claude=.runs/<claude run> agy-opus=.runs/<agy-opus run> agy-carbon=.runs/<agy-carbon run>
```

Each CUJ gets its own run folder; compare the three folders of one CUJ at a time (run names must be unique in one compare).
