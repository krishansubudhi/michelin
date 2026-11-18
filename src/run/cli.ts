// The runner's command line: usage text and parsing (util.parseArgs). runner.ts wires the result into a run.
//
// Test: node --test test/cli.test.ts

import { parseArgs } from "node:util";

/** Printed by --help, and as the error when no subject or no CUJ is given. */
export const USAGE = `usage: node src/run/runner.ts [--settings file] [--all-judges] [--baseline dir ...] <subject> <cuj> [cuj ...]
  <subject>        folder with setup.md, howtorun.md and teardown.md, e.g. subjects/toy
  <cuj> ...        one or more CUJ yaml files or folders (required), e.g. subjects/toy/cujs/toy/country.yaml or subjects/toy/cujs/toy/;
                   a folder runs every *.yaml directly in it, sorted, each on a fresh start (its own setup/teardown)
  --settings file  models per role (default: defaults/settings.json in the michelin package)
  --all-judges     every judge in settings scores every CUJ (default: the first judge alone, the rest only when it
                   fails an expectation, gives no valid result, or differs from --baseline; then the majority wins)
  --baseline dir   an earlier run folder whose <cuj-id>/verdict.json is the baseline verdict (repeatable, first match wins)
  -h, --help       show this help
A subject, CUJ or settings path that does not exist as given is looked up under each folder in MICHELIN_SUBJECTS
(colon-separated), e.g. MICHELIN_SUBJECTS=~/my-subjects michelin my-app my-app/cujs/smoke/`;

/** The error when no CUJ is named; a UsageError, so main prints it under USAGE and exits 2, before any setup. */
export const NO_CUJS = "no CUJs given; list CUJ yaml files after the subject";
export class UsageError extends Error {}

/**
 * Parse the runner's command line.
 *
 * @param argv The arguments after `node src/run/runner.ts`, i.e. process.argv.slice(2).
 * @returns    null if --help / -h was given; otherwise subject (folder holding setup.md, howtorun.md, teardown.md),
 *             picked (CUJ files to run, at least one), settingsPath (undefined unless --settings is given),
 *             judging: all (true with --all-judges) and baselines (the --baseline folders in order, [] if none).
 * @throws     On an unknown flag; a UsageError (exit 2) when no subject or no CUJ (NO_CUJS) is given.
 */
export function parseCli(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      settings: { type: "string" },
      "all-judges": { type: "boolean" },
      baseline: { type: "string", multiple: true },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) return null;
  const [subject, ...picked] = positionals;
  if (!subject) throw new UsageError("no subject given");
  if (!picked.length) throw new UsageError(NO_CUJS);
  return {
    subject,
    picked,
    settingsPath: values.settings,
    judging: { all: values["all-judges"] ?? false, baselines: values.baseline ?? [] },
  };
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
