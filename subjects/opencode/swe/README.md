Five SWE-bench Lite instances (princeton-nlp/SWE-bench_Lite, test split) for the OpenCode subject, picked to be quick: one-file fixes in pure-Python repos whose tests run in seconds. The CUJs are in `../cujs/swe/`.

| instance                 | Python | fix                                             |
| ------------------------ | ------ | ----------------------------------------------- |
| pallets__flask-4992      | 3.11   | `Config.from_file` takes a file mode (TOML)     |
| pytest-dev__pytest-11143 | 3.11   | assert rewrite: a number as first expression    |
| pytest-dev__pytest-5692  | 3.9    | junitxml writes hostname and timestamp          |
| pytest-dev__pytest-7373  | 3.9    | skipif string conditions are not cached by text |
| pytest-dev__pytest-7432  | 3.9    | `--runxfail` keeps the skip location            |

Each instance folder holds the issue (`problem.md`), the hidden test patch, the FAIL_TO_PASS and PASS_TO_PASS test ids, `env.sh` (repo, base commit, Python) and `requirements.txt` (old pins for old pytest). Set `MICHELIN_SWE` to this folder before a run, e.g. `MICHELIN_SWE=$PWD/subjects/opencode/swe michelin subjects/opencode subjects/opencode/cujs/swe/`.

- `prep.sh <instance> <work>` clones the repo at its base commit into `<work>/repo` and builds `<work>/venv`.
- `check.sh <instance> <work>` applies the test patch and runs `swecheck.py`, which prints e.g. `FAIL_TO_PASS 1/1 passed` and `PASS_TO_PASS 81/81 passed`. SWE-bench cuts a test id at its first space, so such an id matches by prefix.

With the reference fix applied, all five score full marks on both lists on macOS (checked 2026-11-17); without it every FAIL_TO_PASS test fails.
