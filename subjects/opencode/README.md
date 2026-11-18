The checked-in example: [OpenCode](https://opencode.ai) on two local models, Qwen 3.8 27B and Gemma 4 26B, on five SWE-bench Lite tasks (`cujs/swe/`), compared by a blind judge that never sees the tests, then checked against the hidden tests. Results and limits: [RESULTS.md](RESULTS.md). The tasks and scripts: [swe/README.md](swe/README.md).

Run everything from the root of a clone of this repo (the npm package ships only the toy subject). `michelin` is the installed command; from a clone without it, use `node bin/michelin.js`.

## Prerequisites

- Michelin's own prerequisites (Node 22.18+, `git`, `python3`, the `claude` CLI logged in), plus `python3.9` and `python3.11` for the pytest checkouts (`swe/<instance>/env.sh` names which; `prep.sh` falls back to `python3`).
- OpenCode on PATH: `npm install -g opencode-ai`.
- [Ollama](https://ollama.com) running, with both models pulled:

  ```sh
  ollama pull qwen3.8:27b
  ollama pull gemma4:26b-mlx
  ```

- Memory: each model is 26-27B parameters. On a 32 GB Mac only one fits at a time, so unload one before running the other, e.g. `ollama stop qwen3.8:27b` before the Gemma run (`ollama ps` lists what is loaded).

## Run both models

Each CUJ runs on a fresh start, as its own run folder; `michelin run` prints a `run dir:` line (an absolute path) for each. Keep those lines: `tee` saves them.

```sh
export MICHELIN_SWE=$PWD/subjects/opencode/swe
OPENCODE_MODEL=ollama/qwen3.8:27b OPENCODE_TOOLS_OFF=todowrite michelin run subjects/opencode subjects/opencode/cujs/swe/ | tee qwen.log
ollama stop qwen3.8:27b
OPENCODE_MODEL=ollama/gemma4:26b-mlx OPENCODE_TOOLS_OFF=todowrite michelin run subjects/opencode subjects/opencode/cujs/swe/ | tee gemma.log
```

Time: on an M-series Mac mini, the five tasks took about 35 minutes for Qwen and 20 for Gemma (2026-11-18), plus model load. Michelin's own roles cost about $0.19 in `claude` calls per task, so about $1 per model; OpenCode on Ollama costs nothing.

## Compare them

A plain compare pairs runs that share a CUJ id. Each run folder here holds one task, so this compares one task, and the judge also reads `check.sh`'s test counts from the journey:

```sh
michelin compare qwen=<qwen run dir for pytest-7432> gemma=<gemma run dir for pytest-7432>
```

To judge all five at once with the tests hidden (how RESULTS.md was judged), build one folder per model whose only evidence is the issue and the model's diff (`swe/blind.py`), then compare those:

```sh
cujdirs() { sed -n 's/^run dir: \([^ ]*\) .*/\1/p' "$1" | while read -r d; do echo "$d"/swe-*; done; }
python3 subjects/opencode/swe/blind.py /tmp/blind/qwen ollama/qwen3.8:27b $(cujdirs qwen.log)
python3 subjects/opencode/swe/blind.py /tmp/blind/gemma ollama/gemma4:26b-mlx $(cujdirs gemma.log)
michelin compare qwen=/tmp/blind/qwen gemma=/tmp/blind/gemma
```

The compare prints the win table, the judge cost (about $0.25 for one judge) and its report as a `file://` URL.

## Optional: the hidden tests

After judging, score each saved diff on the benchmark's hidden tests, on a clean base checkout (`swe/hidden.sh`):

```sh
for c in $(cujdirs qwen.log); do
  i=pytest-dev__pytest-${c##*swe-pytest-}
  bash subjects/opencode/swe/hidden.sh "$i" "$c/opencode.patch" "/tmp/hidden/qwen-$i"
done
```

Each prints `FAIL_TO_PASS n/m passed` and `PASS_TO_PASS n/m passed`; a task is resolved when both are full. Repeat with `gemma.log`.

## Expected result

Qwen wins 4-0-1 against Gemma (one tie, on pytest-5227, where both patches pass every hidden test), and resolves 4 of 5 by the hidden tests; Gemma resolves 2 of 5. A model on a local machine is not deterministic, so expect the same shape, not the same numbers. Details and limits: [RESULTS.md](RESULTS.md).

## Michelin found a setup bug and showed the fix

Gemma's first run made no edit on 4 of the 5 tasks and resolved none. The run reports showed OpenCode ending mid-task after a turn with no tool call. The Ollama server log said why: Ollama 0.40's gemma4 tool-call parser could not read Gemma's `todowrite` calls (`gemma4 tool call parsing failed`) and dropped them silently. The fix is a subject setting, not a model change: `OPENCODE_TOOLS_OFF=todowrite` makes setup.md turn that tool off in OpenCode's config, so Gemma is never offered it.

To reproduce, run Gemma with the tool on, then off, and compare the two:

```sh
export MICHELIN_SWE=$PWD/subjects/opencode/swe
OPENCODE_MODEL=ollama/gemma4:26b-mlx michelin run subjects/opencode subjects/opencode/cujs/swe/ | tee gemma-before.log
OPENCODE_MODEL=ollama/gemma4:26b-mlx OPENCODE_TOOLS_OFF=todowrite michelin run subjects/opencode subjects/opencode/cujs/swe/ | tee gemma-after.log
python3 subjects/opencode/swe/blind.py /tmp/blind/gemma-before ollama/gemma4:26b-mlx $(cujdirs gemma-before.log)
python3 subjects/opencode/swe/blind.py /tmp/blind/gemma-after ollama/gemma4:26b-mlx $(cujdirs gemma-after.log)
michelin compare gemma-before=/tmp/blind/gemma-before gemma-after=/tmp/blind/gemma-after
```

Gemma's numbers in RESULTS.md, before and after (hidden tests: FAIL_TO_PASS, then PASS_TO_PASS):

| task         | patch, `todowrite` on | tests, `todowrite` on | patch, `todowrite` off | tests, `todowrite` off |
| ------------ | --------------------- | --------------------- | ---------------------- | ---------------------- |
| pytest-11143 | 0 B (no edit)         | 0/1, 114/114          | 627 B                  | 1/1, 114/114 resolved  |
| pytest-5227  | 0 B (no edit)         | 0/3, 31/31            | 514 B                  | 3/3, 31/31 resolved    |
| pytest-6116  | 0 B (no edit)         | 0/2, 69/69            | 0 B                    | 0/2, 69/69             |
| pytest-7168  | 576 B                 | 9/11                  | 0 B (hit 600 s)        | 0/11                   |
| pytest-7432  | 0 B (no edit)         | 0/1, 77/77            | 0 B                    | 0/1, 77/77             |
| resolved     |                       | 0 of 5                |                        | 2 of 5                 |

With the tool off the parser drop is gone, and Gemma resolves 2 of 5 instead of 0 of 5. Its three remaining empty patches are its own behaviour (RESULTS.md says which). The published "after" run was driven by a plain script (setup.md's block, `prep.sh`, `opencode run` with a 600 s limit) rather than `michelin run`; the commands above are the Michelin way to run the same comparison.

## Caveat: the fix can be looked up

An agent could find the upstream fix (git history, web, or training data). We checked every run's log and found no sign of that.

Best practice:

- Strip the repo's git history after checkout.
- Turn off web tools (`OPENCODE_TOOLS_OFF=todowrite,webfetch`) or run offline.
- Use fresh, unpublished tasks to rule out memorized fixes.
