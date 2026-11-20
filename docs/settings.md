# Settings

Each setting comes from the first place that has it: command-line flags, then `./michelin.json` (or the file named by `--settings`), then the built-in [`defaults/settings.json`](../defaults/settings.json). The merge is field by field, so a `michelin.json` that names only `judge` keeps the default executor.

## michelin.json

Any subset of these keys. An unknown or mistyped key is an error.

| key           | value                                                                                                                                                                                  | default                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `constructor` | `{"model", "effort"}`: runs the subject's setup.md                                                                                                                                     | `claude-haiku-5-5`, `low`                   |
| `executor`    | `{"model", "effort"}`: carries out the CUJ and records evidence                                                                                                                        | `claude-sonnet-5-5`, `medium`               |
| `destructor`  | `{"model", "effort"}`: runs teardown.md                                                                                                                                                | `claude-haiku-5-5`, `low`                   |
| `judge`       | a list of `{"model", "effort"}`; the first scores alone, the rest join only when it fails an expectation, gives no valid result, or differs from `--baseline` (then the majority wins) | Opus 5.5, Sonnet 5.5, Fable 5.2, all `high` |
| `subject`     | the subject folder `michelin run` uses when none is given, e.g. `subjects/toy`                                                                                                         | none                                        |
| `cujs`        | CUJ yaml files or folders used when none are given                                                                                                                                     | none                                        |
| `runs`        | run every CUJ this many times                                                                                                                                                          | `1`                                         |
| `pair_judges` | how many of `judge` (from the top) `michelin compare` uses                                                                                                                             | `1`                                         |
| `tiebreak`    | `michelin compare`: `speed` gives a judged tie to the run 1.5x faster or more, `none` keeps it a tie                                                                                   | `speed`                                     |

`effort` is one of the Claude Code CLI's effort levels. Every role is a `claude -p` call, and model ids go straight to `claude --model`. `michelin init` writes a starter file holding only what differs from the defaults: the toy subject and its CUJ folder.

```json
{
  "subject": "subjects/toy",
  "cujs": ["subjects/toy/cujs/toy/"]
}
```

## Flags

`michelin run`:

- `<subject> <cuj> [cuj ...]`: names them, overriding `subject` and `cujs` (give both, or neither). The word `run` is optional.
- `--executor m[@effort]`: the executor's model (Michelin's own agent, not the agent under test), e.g. `claude-sonnet-5-5@high`. Its effort is kept unless given.
- `--judges a,b[@effort]`: the judge list, e.g. `claude-opus-5-5,claude-sonnet-5-5@medium`. Effort is `high` unless given.
- `--runs n`: repeats every CUJ n times (a whole number, 1 or more).
- `--settings file`: reads this file instead of `./michelin.json`.
- `--all-judges`: every judge scores every CUJ.
- `--baseline dir`: an earlier run folder whose `<cuj-id>/verdict.json` is the baseline verdict (repeatable, first match wins).

`michelin compare` takes `--judges`, `--tiebreak speed|none`, `--settings` and `--hide tok` (repeatable; also scrubs `tok` from what the judges see). See [compare.md](compare.md).

Each command prints its own flags and an example: `michelin run --help`, `michelin compare --help`, `michelin init --help`.

## Environment variables

- `MICHELIN_SUBJECTS`: colon-separated folders. A subject, CUJ or `--settings` path that does not exist as given is looked up under each, e.g. `MICHELIN_SUBJECTS=~/my-subjects michelin my-app my-app/cujs/smoke/`.
- `MICHELIN_TMP`: the folder for the run lock and scratch space, instead of the per-user `<os temp>/michelin-<user>` (e.g. `/tmp/michelin-agent`). Only one michelin runs at a time per lock folder; to hold one lock across OS users, point every user's `MICHELIN_TMP` at one shared folder made `chmod 1777`.

A subject can read its own environment variables in setup.md. Every role inherits the environment michelin runs in, so export them before `michelin run`. The toy subject reads `TOY_VARIANT`: `v1` (the default) answers, `v2` is a broken build, for trying an A/B ([compare.md](compare.md)). The OpenCode subject (`subjects/opencode`) reads:

- `OPENCODE_MODEL` (required): OpenCode's model in `provider/model` form, e.g. `ollama/<model>`.
- `OLLAMA_API_BASE`: the Ollama server, default `http://localhost:11434`.
- `OPENCODE_TOOLS_OFF`: a comma-separated list of OpenCode tools to turn off for the run, e.g. `todowrite`.
