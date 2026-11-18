Five SWE-bench Lite instances (princeton-nlp/SWE-bench_Lite, test split) for the OpenCode subject, picked as the easiest
there are: a one-file gold fix of at most three changed lines in pytest (pure Python, no build step), whose tests run in
seconds. The CUJs are in `../cujs/swe/`.

| instance                 | Python | gold fix | fix                                                 |
| ------------------------ | ------ | -------- | --------------------------------------------------- |
| pytest-dev__pytest-11143 | 3.11   | 1 line   | assert rewrite: a number as first expression        |
| pytest-dev__pytest-6116  | 3.9    | 1 line   | `--co` as a short form of `--collect-only`          |
| pytest-dev__pytest-5227  | 3.9    | 2 lines  | the default log format shows the module name        |
| pytest-dev__pytest-7168  | 3.9    | 2 lines  | saferepr survives an object whose `__repr__` raises |
| pytest-dev__pytest-7432  | 3.9    | 3 lines  | `--runxfail` keeps the skip location                |

Each instance folder holds the issue (`problem.md`), the hidden test patch, the FAIL_TO_PASS and PASS_TO_PASS test ids, `env.sh` (repo, base commit, Python) and `requirements.txt` (old pins for old pytest). Set `MICHELIN_SWE` to this folder before a run, e.g. `MICHELIN_SWE=$PWD/subjects/opencode/swe michelin subjects/opencode subjects/opencode/cujs/swe/`.

- `prep.sh <instance> <work>` clones the repo at its base commit into `<work>/repo` and builds `<work>/venv`.
- `check.sh <instance> <work>` applies the test patch and runs `swecheck.py`, which prints e.g. `FAIL_TO_PASS 1/1 passed` and `PASS_TO_PASS 81/81 passed`. SWE-bench cuts a test id at its first space, so such an id matches by prefix.

With the reference fix applied, all five score full marks on both lists on macOS (checked 2026-11-18); without it every FAIL_TO_PASS test fails. pytest-5227's PASS_TO_PASS list drops three ids that are SWE-bench log-parsing debris (`[100%]`, `[`), not tests. Each CUJ also saves OpenCode's diff as `opencode.patch` in its run folder, so the tests can be rerun on it outside the run.
