// The runner's command line: per-command help text and parsing (util.parseArgs). runner.ts wires the result into a run.
//
// Test: node --test test/cli.test.ts

import { parseArgs } from "node:util";
import type { Tiebreak } from "./settings.ts";

/** The commands with their own --help text. */
export type Topic = "run" | "compare" | "init";
const TOPICS: readonly string[] = ["run", "compare", "init"];

/** Who does what in an eval; part of the overview. */
const ROLES = `Roles:
  executor          Michelin's agent: carries out the CUJ against the subject and records the evidence (--executor)
  judges            score that evidence against the CUJ's expectations (--judges); compare's judges pick the better run
  agent under test  the subject; its own model is the subject's setting (e.g. OPENCODE_MODEL), not --executor`;

/** The overview: printed by `michelin --help`, and under a usage error that belongs to no one command. */
export const USAGE = `usage: michelin <command> [options]
  run      run CUJs against a subject and judge them (the word is optional: michelin <subject> <cuj> works too)
  compare  blind head-to-head of finished runs: judges pick the better run per shared CUJ, in both orders
  init     write a starter michelin.json and copy the toy subject to ./subjects/toy (never overwrites)
${ROLES}
Run michelin <command> --help for its flags and an example, e.g. michelin run --help.`;

/** Printed by `michelin run --help`, and under a run usage error. */
export const RUN_USAGE = `usage: michelin run [options] [<subject> <cuj> [cuj ...]]
  <subject>         folder with setup.md, howtorun.md and teardown.md, e.g. subjects/toy;
                    default michelin.json's subject
  <cuj> ...         one or more CUJ yaml files or folders, e.g. subjects/toy/cujs/toy/country.yaml or
                    subjects/toy/cujs/toy/;
                    a folder runs every *.yaml in it, sorted; each CUJ gets its own setup/teardown;
                    default michelin.json's cujs (positionals given: both subject and CUJs come from the command line)
  --executor m[@e]  the executor's model, e.g. claude-sonnet-5-5 or claude-sonnet-5-5@high (effort kept unless given)
  --judges a,b@e    the judge list, e.g. claude-opus-5-5,claude-sonnet-5-5@medium (effort high unless given)
  --runs n          run every CUJ n times (whole number >= 1, default 1)
  --settings file   read this file instead of ./michelin.json
  --all-judges      every judge in settings scores every CUJ (default: the first judge alone, the rest only when it
                    fails an expectation, gives no valid result, or differs from --baseline; then the majority wins)
  --baseline dir    an earlier run folder whose <cuj-id>/verdict.json is the baseline verdict
                    (repeatable, first match wins)
  -h, --help        show this help
Settings come from flags, then ./michelin.json (any subset of constructor, executor, destructor, judge, subject, cujs,
runs, pair_judges, tiebreak, sandbox_hide), then the built-in defaults/settings.json; a --settings file replaces
./michelin.json.
A subject, CUJ or settings path that does not exist as given is looked up under each folder in MICHELIN_SUBJECTS
(colon-separated), e.g. MICHELIN_SUBJECTS=~/my-subjects michelin run my-app my-app/cujs/smoke/
example: michelin run subjects/toy subjects/toy/cujs/toy/country.yaml --executor claude-sonnet-5-5@high`;

/** Printed by `michelin compare --help`, and under a compare usage error. */
export const COMPARE_USAGE = `usage: michelin compare [--judges a,b@e] [--tiebreak speed|none] [--settings file] [--hide tok]...
                        <run> <run> [<run> ...]
  blind head-to-head of finished runs: judges pick the better run per shared CUJ, in both orders (docs/compare.md)
  <run> ...              a run folder or name=folder, e.g. gemma=.runs/2026-11-17T10-00-00-000Z (two or more)
  --judges a,b@e         the judge panel, e.g. claude-opus-5-5,claude-sonnet-5-5@medium (effort high unless given);
                         default the first pair_judges judges in michelin.json (1 unless set)
  --tiebreak speed|none  speed (default) gives a judged tie to the run 1.5x faster or more, none keeps it a tie
  --settings file        read this file instead of ./michelin.json
  --hide tok             also scrub tok from what the judges see (repeatable)
  -h, --help             show this help
example: michelin compare v1=.runs/<run A id> v2=.runs/<run B id>`;

/** Printed by `michelin init --help`. */
export const INIT_USAGE = `usage: michelin init
  start a project in the current folder: writes a starter michelin.json (the toy subject and its CUJs) and copies the
  toy subject to ./subjects/toy; never overwrites, an existing michelin.json or subjects/toy is kept
example: mkdir my-evals && cd my-evals && michelin init`;

/**
 * The help text for a command, or the overview.
 *
 * @param topic The command, e.g. "compare"; undefined for the overview.
 * @returns     RUN_USAGE, COMPARE_USAGE, INIT_USAGE, or USAGE when topic is undefined.
 */
export function helpText(topic?: Topic): string {
  return topic === "run" ? RUN_USAGE : topic === "compare" ? COMPARE_USAGE : topic === "init" ? INIT_USAGE : USAGE;
}

/** The error when no CUJ is named; a UsageError, so main prints it under RUN_USAGE and exits 2, before any setup. */
export const NO_CUJS = "no CUJs given; list CUJ yaml files after the subject, or set cujs in michelin.json";

/** A bad command line: main prints the error under the help of `topic` (the overview if none) and exits 2. */
export class UsageError extends Error {
  /** The command whose help to print, e.g. "compare"; undefined for the overview. */
  readonly topic?: Topic;
  /**
   * @param message What was wrong, e.g. "--runs must be a whole number >= 1, got \"0\"".
   * @param topic   The command whose help to print, e.g. "compare"; undefined for the overview.
   */
  constructor(message: string, topic?: Topic) {
    super(message);
    this.topic = topic;
  }
}

/**
 * Parse --runs.
 *
 * @param s The flag's value, e.g. "3"; undefined if not given.
 * @returns The number, e.g. 3; undefined if not given.
 * @throws  A UsageError unless it is a whole number >= 1.
 */
function parseRuns(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(s)) throw new UsageError(`--runs must be a whole number >= 1, got "${s}"`, "run");
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
  if (runs.length < 2) throw new UsageError(`compare needs two or more run folders, got ${runs.length}`, "compare");
  const tiebreak = values.tiebreak;
  if (tiebreak !== undefined && tiebreak !== "speed" && tiebreak !== "none")
    throw new UsageError(`--tiebreak must be speed or none, got "${tiebreak}"`, "compare");
  const flags = { judges: values.judges, tiebreak: tiebreak as Tiebreak | undefined };
  return { command: "compare" as const, runs, settingsPath: values.settings, flags, hide: values.hide ?? [] };
}

/**
 * The help topic named by the first word.
 *
 * @param word The first positional, e.g. "compare"; undefined if none.
 * @returns    The word if it is run, compare or init, e.g. "compare"; else undefined.
 */
const helpTopic = (word: string | undefined) => (TOPICS.includes(word ?? "") ? (word as Topic) : undefined);

/**
 * Parse the runner's command line.
 *
 * @param argv The arguments after `michelin`, i.e. process.argv.slice(2), e.g. ["run", "subjects/toy", "a.yaml"].
 * @returns    {command: "help", topic} if --help / -h was given (topic: the first word if it is run, compare or init,
 *             else undefined); {command: "init"} for `michelin init`; for `michelin compare a b`
 *             {command: "compare", runs: ["a", "b"], settingsPath, flags: {judges, tiebreak}, hide: the --hide tokens, [] if none};
 *             otherwise command "run", subject (undefined if none given), picked (CUJ
 *             files, maybe []), settingsPath (undefined unless --settings is given), judging: all (true with
 *             --all-judges) and baselines (the --baseline folders in order, [] if none), and flags {executor, judges, runs};
 *             --model is a silent alias of --executor.
 * @throws     On an unknown flag; a UsageError (exit 2) on a bad --runs, compare with under two runs, or --hide
 *             outside compare.
 */
export function parseCli(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      settings: { type: "string" },
      executor: { type: "string" },
      model: { type: "string" }, // the old name of --executor, still accepted, in no help text
      judges: { type: "string" },
      runs: { type: "string" },
      "all-judges": { type: "boolean" },
      baseline: { type: "string", multiple: true },
      hide: { type: "string", multiple: true },
      tiebreak: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) return { command: "help" as const, topic: helpTopic(positionals[0]) };
  if (positionals[0] === "init") return { command: "init" as const };
  if (positionals[0] === "compare") return compareArgs(positionals.slice(1), values);
  if (values.hide || values.tiebreak)
    throw new UsageError("--hide and --tiebreak are only for michelin compare", "run");
  const [subject, ...picked] = positionals[0] === "run" ? positionals.slice(1) : positionals;
  return {
    command: "run" as const,
    subject: subject as string | undefined,
    picked,
    settingsPath: values.settings,
    judging: { all: values["all-judges"] ?? false, baselines: values.baseline ?? [] },
    flags: { executor: values.executor ?? values.model, judges: values.judges, runs: parseRuns(values.runs) },
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
  if (!subject) throw new UsageError("no subject given; name one, or set subject in michelin.json", "run");
  if (!picked.length) throw new UsageError(NO_CUJS, "run");
  return [subject, ...picked];
}

/**
 * Run the program and turn its failure into an exit code: a UsageError prints its topic's help and the error and exits 2,
 * any other error prints its message and exits 1.
 *
 * @param main The program, e.g. runner.ts's main.
 */
export function runMain(main: () => Promise<unknown>): void {
  main().catch((e) => {
    const usage = e instanceof UsageError;
    console.error(usage ? `${helpText(e.topic)}\nerror: ${e.message}` : e.message);
    process.exit(usage ? 2 : 1);
  });
}
