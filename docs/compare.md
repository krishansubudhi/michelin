`michelin compare` puts finished runs head to head. It answers "which subject did the job better?", where a normal run only answers "did it pass?".

    michelin compare [--judges a,b@e] [--settings file] [--hide tok]... <run> <run> [<run> ...]

Each `<run>` is a run folder, or `name=folder` to choose the name used in the results, e.g. `gemma=.runs/2026-11-17T10-00-00-000Z`. Unnamed runs are called after their subject folder, with `#n` added when two share a subject.

Every pair of runs meets on every CUJ that both ran (a round robin). The judges read each run's journey and reply from `<cuj>/executor.json`, with the CUJ's instruction and its expectations as the rubric. They never see the subject itself.

**Blind A/B.** Before a judge sees anything, every string that could name a run is replaced: the run id and folder, the subject, every model in its settings, each `NAME=value` in the constructor's setup notes, the run's name and any `--hide` token, along with short forms such as `gemma4` for `ollama/gemma4:26b-mlx`. In the evidence these become "Program A" and "Program B". In the task text they become "the program".

**Both orders.** Each judge sees every pair twice, once as A/B and once swapped. A run wins only if the judge picks it both times. Any other pair of answers is a tie, so a judge that always favours one position can't hand out a win.

**Panel size.** By default only the first judge in settings is asked. Set `pair_judges: n` in michelin.json to use the first n judges, or pass `--judges` to use exactly the judges you list. The game goes to whichever result most judges gave, and an even split is a tie.

**Outputs** go in `.runs/compare-<ISO time>/`:

- `compare.md`: the win-rate table (W-L-T, win rate = (wins + ties/2) / decided games, Elo starting at 1000 with K 32), the total judge cost, then each game's winner and each judge's reasons for both orders, with run names put back in.
- `compare.json`: the same data, machine-readable.
- `report.html`: a one-page "Head-to-head" report.
- `<cuj>/<x>-vs-<y>/`: the exact prompts the judges saw, plus each judge's raw verdicts.

At the end, the table, the total cost and the output folder are printed.

Speed counts too. Each game records both runs' program time (the sum of the executor's measured step `ms`), shown in a
per-CUJ time table in compare.md and on each game in report.html. A judged tie goes to the run that took 1.5x less time
or better (`--tiebreak speed`, the default); `--tiebreak none` or `"tiebreak": "none"` in michelin.json keeps it a tie.

**An A/B, end to end.** Run the same CUJ twice with one thing changed, then compare the two run folders (each run prints its `run dir:`). With OpenCode from the source repo, the change is the model:

```sh
OPENCODE_MODEL=ollama/<model A> michelin run subjects/opencode subjects/opencode/cujs/opencode/fix_test.yaml
OPENCODE_MODEL=ollama/<model B> michelin run subjects/opencode subjects/opencode/cujs/opencode/fix_test.yaml
michelin compare a=.runs/<run A id> b=.runs/<run B id>
```

`--baseline <run folder>` is a different tool: in a normal run it calls in the other judges whenever the first judge's verdict differs from that earlier run's, a regression check rather than a head-to-head.
