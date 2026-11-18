# OpenCode: results from a real run

One run of `subjects/opencode/cujs/opencode/` on 2026-11-16, each CUJ on a fresh start.

- Subject: OpenCode 1.19.5 (`npm install -g opencode-ai`), headless `opencode run`.
- OpenCode's model: Gemma 4 26B on a local Ollama (`OPENCODE_MODEL=ollama/gemma4:26b-mlx`), so OpenCode itself cost $0.
- Michelin's roles: the default `settings.json` (Haiku constructor and destructor, Sonnet executor, a panel of three judges at high effort). The whole run cost $0.82 in `claude` calls.

| CUJ                     | Result | Expectations | Judge votes per expectation | OpenCode call |
| ----------------------- | ------ | ------------ | --------------------------- | ------------- |
| `opencode-fix_test`     | PASS   | passed 2/2   | 3/3, 3/3                    | 45.9 s        |
| `opencode-ask_repo`     | PASS   | passed 2/2   | 3/3, 3/3                    | 44.6 s        |
| `opencode-fail_control` | FAIL   | passed 0/2   | 0/3, 0/3                    | 58.5 s        |

```
PASS  opencode-ask_repo      passed 2/2  (done)
FAIL  opencode-fail_control  passed 0/2  (done)
PASS  opencode-fix_test      passed 2/2  (done)
total: 2/3 CUJs passed
```

That is the healthy outcome:

- **fix_test**: the unit test failed before (`AssertionError: 3.0 != 4`). OpenCode read both files, ran the test itself, changed `(len(xs) + 1)` to `len(xs)` in `calc.py`, and the test passed. `test_calc.py` kept the same shasum.
- **ask_repo**: with the read-only `plan` agent, OpenCode answered that `total(["apple", "pear", "pear"])` returns 13 and that `prices.py` holds the prices. Both files kept their shasums.
- **fail_control**: OpenCode did the task right (`hello.py` printed `Hello, world.`, reply in English), so every judge failed both deliberately wrong expectations. The panel is checking the evidence, not rubber-stamping.

## SWE-bench Lite: Gemma 4 26B vs Qwen 3.8 27B, judged blind to the tests (2026-11-18)

One OpenCode run per model on the 5 `cujs/swe/` CUJs, then `michelin compare` with 1 judge (Sonnet 5.5, high effort),
both orders, model and run names scrubbed. The judge saw only the issue and each model's diff: `swe/blind.py` builds the
compared run folders from the issue (`problem.md`) and the saved `opencode.patch`, with no `check.sh` output, no
FAIL_TO_PASS / PASS_TO_PASS counts and no hidden test patch. The judge call has no tools and runs in an empty temp folder.
Only after judging were the hidden tests run on each saved patch, on a clean base checkout (`swe/hidden.sh`).

| CUJ          | gemma4:26b-mlx patch | qwen3.8:27b patch | judge, A/B and B/A | gemma tests  | qwen tests            | judge vs tests      |
| ------------ | -------------------- | ----------------- | ------------------ | ------------ | --------------------- | ------------------- |
| pytest-11143 | 0 B (no edit)        | 557 B             | qwen, qwen         | 0/1, 114/114 | 1/1, 114/114 resolved | agree               |
| pytest-5227  | 0 B (no edit)        | 1604 B            | qwen, qwen         | 0/3, 31/31   | 3/3, 31/31 resolved   | agree               |
| pytest-6116  | 0 B (no edit)        | 367 B             | qwen, qwen         | 0/2, 69/69   | 0/2, 69/69            | tests cannot decide |
| pytest-7168  | 576 B                | 1452 B            | qwen, qwen         | 9/11         | 11/11 resolved        | agree               |
| pytest-7432  | 0 B (no edit)        | 1876 B            | qwen, qwen         | 0/1, 77/77   | 1/1, 77/77 resolved   | agree               |

The judge preferred Qwen on all 5, and both orders agreed every time. It agreed with the hidden tests on 4 of 4 tasks
the tests can decide; on 6116 neither model resolves the issue, so the tests cannot decide it. Judge cost: $0.25.

**Gemma made no edit on 4 of the 5, and that is mostly not about the model.** Two of the four (11143, 6116) are a setup
fault: Ollama 0.40.13's gemma4 tool-call parser failed on OpenCode's `todowrite` call and dropped it silently
(`gemma4 tool call parsing failed` in the server log), so OpenCode saw a turn with no tool call and ended the session
mid-task. Those runs are being redone with `todowrite` off (`OPENCODE_TOOLS_OFF=todowrite`, see `setup.md`). The other
two (5227, 7432) are model stalls: Gemma described its next step in prose and stopped without calling a tool.

**Limits.** This is not a model ranking. It is 5 easy tasks (the 5 easiest pytest instances of SWE-bench Lite), one
run per model, one judge and a two-line rubric. Three of the four agreements are an edit against an empty diff, which
any judge gets right. The only informative task is pytest-7168, the one where both models edited: the judge picked the
patch the tests favour, 1 of 1. That says the blind judge points the same way as the tests here, nothing more about
its accuracy. The models' checkouts had full git history, so the upstream fix was reachable through `git log`; nothing
shows either model looked.
