// The runner's command line: usage text and parsing (util.parseArgs). runner.ts wires the result into a run.
//
// Test: node --test test/cli.test.ts

import { parseArgs } from "node:util";
import type { Tiebreak } from "./settings.ts";

/** Printed by --help, and as the error when no subject or no CUJ is given. */
export const USAGE = `usage: michelin [run] [options] [<subject> <cuj> [cuj ...]]
       michelin init
       michelin compare [--judges a,b@e] [--tiebreak speed|none] [--settings file] [--hide tok]... <run> <run> [<run> ...]
  init             write a starter michelin.json and copy the toy subject to ./subjects/toy (never overwrites)
  compare          blind head-to-head of finished runs: judges pick the better run per shared CUJ, in both orders
                   (docs/compare.md); each <run> is a run folder or name=folder, e.g. gemma=.runs/2026-11-17T10-00-00-000Z;
                   --judges as below (default the first pair_judges judges in michelin.json, 1 unless set);
                   --hide tok also scrubs tok from what the judges see (repeatable);
                   --tiebreak speed (default) gives a judged tie to the run 1.5x faster or more, none keeps it a tie
  run              run CUJs (the word is optional: michelin <subject> <cuj> works too)
  <subject>        folder with setup.md, howtorun.md and teardown.md, e.g. subjects/toy; default michelin.json's subject
  <cuj> ...        one or more CUJ yaml files or folders, e.g. subjects/toy/cujs/toy/country.yaml or subjects/toy/cujs/toy/;
                   a folder runs every *.yaml directly in it, sorted, each on a fresh start (its own setup/teardown);
                   default michelin.json's cujs (positionals given: both subject and CUJs come from the command line)
  --model m[@e]    the executor's model, e.g. claude-sonnet-5-5 or claude-sonnet-5-5@high (effort kept unless given)
  --judges a,b@e   the judge list, e.g. claude-opus-5-5,claude-sonnet-5-5@medium (effort high unless given)
  --runs n         run every CUJ n times (whole number >= 1, default 1)
  --settings file  read this file instead of ./michelin.json
  --all-judges     every judge in settings scores every CUJ (default: the first judge alone, the rest only when it
                   fails an expectation, gives no valid result, or differs from --baseline; then the majority wins)
  --baseline dir   an earlier run folder whose <cuj-id>/verdict.json is the baseline verdict (repeatable, first match wins)
  -h, --help       show this help
Settings come from flags, then ./michelin.json (any subset of constructor, executor, destructor, judge, subject, cujs,
runs, pair_judges, tiebreak), then the built-in defaults/settings.json; a --settings file replaces ./michelin.json.
A subject, CUJ or settings path that does not exist as given is looked up under each folder in MICHELIN_SUBJECTS
(colon-separated), e.g. MICHELIN_SUBJECTS=~/my-subjects michelin my-app my-app/cujs/smoke/`;

/** The error when no CUJ is named; a UsageError, so main prints it under USAGE and exits 2, before any setup. */
export const NO_CUJS = "no CUJs given; list CUJ yaml files after the subject, or set cujs in michelin.json";
export class UsageError extends Error {}

/**
 * Parse --runs.
 *
 * @param s The flag's value, e.g. "3"; undefined if not given.
 * @returns The number, e.g. 3; undefined if not given.
 * @throws  A UsageError unless it is a whole number >= 1.
 */
function parseRuns(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(s)) throw new UsageError(`--runs must be a whole number >= 1, got "${s}"`);
  return Number(s);
}

/**
 * The compare command's arguments, checked.
 *
 * @param runs   The run folders after "compare", e.g. ["a=.runs/1", ".runs/2"].
 * @param values parseArgs values; settings, judges, hide and tiebreak are read, e.g. {tiebreak: "none"}.
 * @returns      {command: "compare", runs, settingsPath, flags: {judges, tiebreak}, hide ([] if none)}.
 * @throws       A UsageError on fewer than two runs or a --tiebreak other than speed or none.
 */
function compareArgs(
  runs: string[],
  values: { settings?: string; judges?: string; hide?: string[]; tiebreak?: string },
) {
  if (runs.length < 2) throw new UsageError(`compare needs two or more run folders, got ${runs.length}`);
  const tiebreak = values.tiebreak;
  if (tiebreak !== undefined && tiebreak !== "speed" && tiebreak !== "none")
    throw new UsageError(`--tiebreak must be speed or none, got "${tiebreak}"`);
  const flags = { judges: values.judges, tiebreak: tiebreak as Tiebreak | undefined };
  return { command: "compare" as const, runs, settingsPath: values.settings, flags, hide: values.hide ?? [] };
}

/**
 * Parse the runner's command line.
 *
 * @param argv The arguments after `michelin`, i.e. process.argv.slice(2), e.g. ["run", "subjects/toy", "a.yaml"].
 * @returns    null if --help / -h was given; {command: "init"} for `michelin init`; for `michelin compare a b`
 *             {command: "compare", runs: ["a", "b"], settingsPath, flags: {judges, tiebreak}, hide: the --hide tokens, [] if none};
 *             otherwise command "run", subject (undefined if none given), picked (CUJ
 *             files, maybe []), settingsPath (undefined unless --settings is given), judging: all (true with
 *             --all-judges) and baselines (the --baseline folders in order, [] if none), and flags {model, judges, runs}.
 * @throws     On an unknown flag; a UsageError (exit 2) on a bad --runs, compare with under two runs, or --hide
 *             outside compare.
 */
export function parseCli(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      settings: { type: "string" },
      model: { type: "string" },
      judges: { type: "string" },
      runs: { type: "string" },
      "all-judges": { type: "boolean" },
      baseline: { type: "string", multiple: true },
      hide: { type: "string", multiple: true },
      tiebreak: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) return null;
  if (positionals[0] === "init") return { command: "init" as const };
  if (positionals[0] === "compare") return compareArgs(positionals.slice(1), values);
  if (values.hide || values.tiebreak) throw new UsageError("--hide and --tiebreak are only for michelin compare");
  const [subject, ...picked] = positionals[0] === "run" ? positionals.slice(1) : positionals;
  return {
    command: "run" as const,
    subject: subject as string | undefined,
    picked,
    settingsPath: values.settings,
    judging: { all: values["all-judges"] ?? false, baselines: values.baseline ?? [] },
    flags: { model: values.model, judges: values.judges, runs: parseRuns(values.runs) },
  };
}

/**
 * Pick the subject and CUJs to run: the command line's if it names a subject, else michelin.json's.
 *
 * @param cli  From parseCli, e.g. {subject: "subjects/toy", picked: ["a.yaml"]} or {subject: undefined, picked: []}.
 * @param file From loadConfig, e.g. {subject: "subjects/toy", cujs: ["subjects/toy/cujs/toy/"]}.
 * @returns    [subject, ...cujs], e.g. ["subjects/toy", "a.yaml"].
 * @throws     A UsageError (exit 2) when there is no subject, or no CUJ (NO_CUJS).
 */
export function pickTargets(cli: { subject?: string; picked: string[] }, file: { subject?: string; cujs: string[] }) {
  const [subject, picked] = cli.subject ? [cli.subject, cli.picked] : [file.subject, file.cujs];
  if (!subject) throw new UsageError("no subject given; name one, or set subject in michelin.json");
  if (!picked.length) throw new UsageError(NO_CUJS);
  return [subject, ...picked];
}

/**
 * Run the program and turn its failure into an exit code: a UsageError prints USAGE and the error and exits 2,
 * any other error prints its message and exits 1.
 *
 * @param main The program, e.g. runner.ts's main.
 */
export function runMain(main: () => Promise<unknown>): void {
  main().catch((e) => {
    const usage = e instanceof UsageError;
    console.error(usage ? `${USAGE}\nerror: ${e.message}` : e.message);
    process.exit(usage ? 2 : 1);
  });
}
