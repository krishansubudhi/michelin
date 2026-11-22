`michelin compare` puts finished runs head to head. It answers "which subject did the job better?", where a normal run only answers "did it pass?".

    michelin compare [--judges a,b@e] [--tiebreak speed|none] [--settings file] [--hide tok]... <run> <run> [<run> ...]

`michelin compare --help` prints the flags and an example.

Each `<run>` is a run folder, or `name=folder` to choose the name used in the results, e.g. `gemma=.runs/2026-11-17T10-00-00-000Z`. Unnamed runs are called after their subject folder, with `#n` added when two share a subject.

Every pair of runs meets on every CUJ that both ran (a round robin). Runs are paired by CUJ id, the CUJ file's path after `cujs/` (e.g. `swe/pytest-7432.yaml` is `swe-pytest-7432`), not by its text: each subject may word its own copy of a CUJ differently (steps adapted to that program), and the shared name is what pairs them. The judges read each run's journey and reply from `<cuj>/executor.json`, with the CUJ's instruction and its expectations as the rubric. They never see the subject itself.

**Blind A/B.** Before a judge sees anything, every string that could name a run is replaced: the run id and folder, the subject, every model in its settings, each `NAME=value` in the constructor's setup notes, the run's name and any `--hide` token, along with short forms such as `gemma4` for `ollama/gemma4:26b-mlx`. In the evidence these become "Program A" and "Program B". In the task text they become "the program".

**Both orders.** Each judge sees every pair twice, once as A/B and once swapped. A run wins only if the judge picks it both times. Any other pair of answers is a tie, so a judge that always favours one position can't hand out a win.

**Panel size.** By default only the first judge in settings is asked. Set `pair_judges: n` in michelin.json to use the first n judges, or pass `--judges` to use exactly the judges you list. The game goes to whichever result most judges gave, and an even split is a tie.

**Outputs** go in `.runs/compare-<ISO time>/`:

- `compare.md`: the win-rate table (W-L-T, win rate = (wins + ties/2) / decided games, Elo starting at 1000 with K 32), the total judge cost, then each game's winner and each judge's reasons for both orders, with run names put back in.
- `compare.json`: the same data, machine-readable.
- `report.html`: a one-page "Head-to-head" report.
- `<cuj>/<x>-vs-<y>/`: the exact prompts the judges saw, plus each judge's raw verdicts.

At the end, the table, the total cost, the output folder's absolute path and report.html as a clickable `file://` URL are printed.

Speed counts too. Each game records both runs' program time (the sum of the executor's measured step `ms`), shown in a
per-CUJ time table in compare.md and on each game in report.html. A judged tie goes to the run that took 1.5x less time
or better (`--tiebreak speed`, the default); `--tiebreak none` or `"tiebreak": "none"` in michelin.json keeps it a tie.

**An A/B, end to end.** An A/B compares two versions of the agent under test: run the same CUJ on each, with the executor and the judges kept the same, then compare the two run folders (each run prints `run dir: .runs/<id>/<cuj>`; pass `.runs/<id>`, and several folders for one side go comma-separated). Changing `--executor` instead would measure Michelin's own agent, not yours.

The toy subject has two versions, picked by `TOY_VARIANT`: `v1` (the default) answers, `v2` is a broken build that replies "I am not sure".

```sh
TOY_VARIANT=v1 michelin run subjects/toy subjects/toy/cujs/toy/country.yaml
TOY_VARIANT=v2 michelin run subjects/toy subjects/toy/cujs/toy/country.yaml
michelin compare v1=.runs/<v1 run id> v2=.runs/<v2 run id>
```

v1 passes 2/2, v2 passes 1/2, and the judge picks v1 in both orders:

```
| run | W-L-T | win rate | Elo |
| --- | --- | --- | --- |
| v1 | 1-0-0 | 100% | 1016 |
| v2 | 0-1-0 | 0% | 984 |
```

With OpenCode from the source repo, the two versions are two models, set through the subject's `OPENCODE_MODEL`:

```sh
OPENCODE_MODEL=ollama/<model A> michelin run subjects/opencode subjects/opencode/cujs/opencode/fix_test.yaml
OPENCODE_MODEL=ollama/<model B> michelin run subjects/opencode subjects/opencode/cujs/opencode/fix_test.yaml
michelin compare a=.runs/<run A id> b=.runs/<run B id>
```

A full worked example, five SWE-bench Lite tasks judged blind to the tests: [subjects/opencode/README.md](../subjects/opencode/README.md).

`--baseline <run folder>` is a different tool: in a normal run it calls in the other judges whenever the first judge's verdict differs from that earlier run's, a regression check rather than a head-to-head.
