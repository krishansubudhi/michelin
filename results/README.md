One JSON file per agent and model on one suite. The [results page](https://krishansubudhi.github.io/michelin/) is built from this folder on every merge to main, and the `Results` check runs `node scripts/results.ts --check` on every pull request that touches it.

## Suites

`suites.json` lists them. A suite is a fixed set of CUJs; a row must cover every CUJ in its suite, from an unedited `cujs/` folder. CUJs listed under `controls` must fail: a passing control means the judges aren't reading the evidence, and the check refuses the file.

To propose a new suite, add it to `suites.json` in the same pull request as its first two rows.

## Format

| Field           | Type             | Meaning                                                                          |
| --------------- | ---------------- | -------------------------------------------------------------------------------- |
| `format`        | string           | always `"michelin-results/1"`                                                    |
| `suite`         | string           | a key of `suites.json`, e.g. `"coding-agents"`                                   |
| `agent`         | string           | the harness under test, e.g. `"Claude Code"`, `"OpenCode"`                       |
| `AGENT`         | string           | the run's `AGENT` as run.json records it, e.g. `"agy"`; rows are recounted by it |
| `AGENT_MODEL`   | string           | the run's `AGENT_MODEL` as run.json records it, e.g. `"claude-opus-5-5-medium"`  |
| `agent_version` | string           | its version, e.g. `"2.1.322"`                                                    |
| `model`         | string           | the model behind it, with effort or quantisation, e.g. `"Qwen 3.8 27B, local"`   |
| `date`          | string           | `YYYY-MM-DD` of the runs                                                         |
| `submitted_by`  | string           | your GitHub handle                                                               |
| `reproduce`     | string           | the command, after the suite's `setup` line, that reruns this row                |
| `evidence`      | string[]         | links (or repo paths) to the `report.html` / `verdict.json` files behind it      |
| `notes`         | string, optional | anything a reader needs: unequal settings, reruns, setup faults                  |
| `tasks`         | object[]         | one entry per CUJ of the suite, below                                            |

Each task:

| Field      | Type             | Meaning                                                                                                          |
| ---------- | ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `cuj`      | string           | the CUJ path under the subject's `cujs/`, without `.yaml`, e.g. `"peculiar/dst_cron"`                            |
| `runs`     | integer ≥ 1      | judged runs of this CUJ                                                                                          |
| `passed`   | integer          | runs where every expectation passed, 0 to `runs`                                                                 |
| `agent_s`  | number[]         | the agent's own wall time per run in seconds (`agent_ms` / 1000 from the run's metrics), or `[]` if not measured |
| `cost_usd` | number or null   | the agent CLI's own reported cost over all runs; `null` if it reports tokens only                                |
| `note`     | string, optional | e.g. extra reruns, or why a run is unusual                                                                       |
| `run_id`   | string, optional | the run folder name(s), so a reader can match the evidence                                                       |

The page ranks rows by runs passed over runs, controls left out, and shows the median agent time and the summed agent cost.

## Where the numbers come from

Every `michelin run` CUJ folder has a `verdict.json` (one entry per expectation, each with `pass`) and an `executor.json` whose `data.metrics` carries the subject's metrics line (`agent_ms`, `cost_usd`, tokens). A CUJ run passed if every expectation in `verdict.json` passed.

Check locally before opening the pull request:

```sh
node scripts/results.ts --check
node scripts/results.ts --out _site && open _site/index.html
```
