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
