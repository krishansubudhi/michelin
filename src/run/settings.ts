// Settings: which model plays each role, and at what effort. The built-in defaults are defaults/settings.json in
// this package (found from import.meta.url, never the current folder), or the file given with --settings <file> (runner.ts).
// Every entry is {"model": "<id>", "effort": "<low|medium|high|xhigh|max>"}.
//
//   constructor  runs <subject>/setup.md         (one entry)
//   executor     drives the subject through CUJs (one entry)
//   destructor   runs <subject>/teardown.md      (one entry)
//   judge        scores the journeys             (list of entries: the first alone, all + majority vote on a fail)
//
// loadSettings throws if a role is missing or an entry is mistyped, naming the file it came from,
// so a typo fails at start instead of mid-run.
//
// Test: node --test test/settings.test.ts

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EFFORTS, type Pick } from "../llm/models.ts";
import type { Judging } from "../llm/judge.ts";

/** Which model plays each role in a run. */
export type Settings = {
  /** Runs <subject>/setup.md. */
  constructor: Pick;
  /** Drives the subject through each CUJ. */
  executor: Pick;
  /** Runs <subject>/teardown.md. */
  destructor: Pick;
  /** Score the journeys: the first alone; on its fail, error or baseline flip, all of them and the majority wins. */
  judge: Pick[];
  /** How the judges are used this run, from the command line, never the file; recorded in run.json. */
  judging?: Judging;
};

/** The built-in defaults: defaults/settings.json in this package, wherever it is installed. */
export const DEFAULTS = fileURLToPath(new URL("../../defaults/settings.json", import.meta.url));

/** True if `p` is {model: string, effort: one of EFFORTS} and nothing else. */
const isPick = (p: unknown): p is Pick =>
  typeof p === "object" &&
  p !== null &&
  !Array.isArray(p) &&
  Object.keys(p).length === 2 &&
  typeof (p as Pick).model === "string" &&
  (EFFORTS as readonly unknown[]).includes((p as Pick).effort);

/** Every top-level field a settings file may hold. */
const FIELDS = ["constructor", "executor", "destructor", "judge"];

/**
 * Read a JSON file.
 *
 * @param path File to read, e.g. "defaults/settings.json".
 * @returns    Its parsed value.
 * @throws     ENOENT if missing; a SyntaxError naming the file if it isn't valid JSON.
 */
function readJson(path: string): unknown {
  const text = readFileSync(path, "utf8");
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new SyntaxError(`${path}: ${(e as Error).message}`, { cause: e });
  }
}

/**
 * Check every field of a parsed settings file.
 *
 * @param s    The parsed file, e.g. {constructor: {model: "claude-opus-5-5", effort: "high"}, ...}.
 * @param path The file it came from, named in every error, e.g. "defaults/settings.json".
 * @throws     If a field is missing or mistyped. Model ids are not checked: claude refuses a wrong one at its call.
 */
function checkFields(s: unknown, path: string): void {
  const get = (k: string): unknown =>
    typeof s === "object" && s !== null ? (s as Record<string, unknown>)[k] : undefined;
  const ok = FIELDS.every((k) => {
    const v = get(k);
    return k === "judge" ? Array.isArray(v) && v.length > 0 && v.every(isPick) : isPick(v);
  });
  if (!ok)
    throw new Error(
      `${path}: needs constructor, executor, destructor ({model, effort}) and judge (non-empty list of {model, effort}); effort is one of ${EFFORTS.join(", ")}`,
    );
}

/**
 * Read and check the settings file.
 *
 * @param path    Settings file to read, e.g. "my-settings.json". Default the package's defaults/settings.json.
 * @param judging How the judges are used, from the command line, e.g. {all: false, baselines: []}; omitted: not added.
 * @returns       The settings, with every role checked (any model id is accepted), plus judging if given.
 * @throws     If the file isn't valid JSON, or a role is missing or mistyped; the error names the file.
 */
export function loadSettings(path = DEFAULTS, judging?: Judging): Settings {
  const s = readJson(path);
  checkFields(s, path);
  return judging ? { ...(s as Settings), judging } : (s as Settings);
}
