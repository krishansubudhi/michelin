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

## SWE-bench Lite: Gemma 4 26B vs Qwen 3.8 27B (2026-11-18)

One OpenCode run per model on the 5 `cujs/swe/` CUJs, then `michelin compare` (1 judge, both orders). Tests are
`swe/check.sh` on OpenCode's saved `opencode.patch`, applied to a clean base checkout (FAIL_TO_PASS / PASS_TO_PASS).

| CUJ          | gemma4:26b-mlx         | qwen3.8:27b           | judge | gemma time | qwen time |
| ------------ | ---------------------- | --------------------- | ----- | ---------- | --------- |
| pytest-11143 | 0/1, 114/114 (no edit) | 1/1, 114/114 resolved | qwen  | 252 s      | 273 s     |
| pytest-5227  | 0/3, 31/31 (no edit)   | 3/3, 31/31 resolved   | qwen  | 322 s      | 229 s     |
| pytest-6116  | 0/2, 69/69 (no edit)   | 0/2, 69/69            | qwen  | 174 s      | 611 s     |
| pytest-7168  | 9/11                   | 11/11 resolved        | qwen  | 132 s      | 448 s     |
| pytest-7432  | 0/1, 77/77 (no edit)   | 1/1, 77/77 resolved   | qwen  | 136 s      | 283 s     |

Qwen resolves 4/5 and Gemma 0/5. The judge went 5-0 for Qwen and agreed with the tests on 4/5: on 6116 neither model
resolves, and the judge credited Qwen's partial attempt. Judge cost: $0.36.
