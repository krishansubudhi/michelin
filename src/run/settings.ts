// Settings: which model plays each role, and at what effort, plus the run's subject, CUJs and repeat count.
// Each top-level field comes from the first that has it: command-line flags (--executor, --judges, --runs), then
// ./michelin.json (or the file given with --settings <file> instead), then the built-in defaults/settings.json in
// this package (found from import.meta.url, never the current folder). michelin.json may hold any subset of the
// roles below plus subject (string), cujs (list of strings), runs (whole number >= 1) and pair_judges (whole
// number >= 1: how many of the first judges `michelin compare` asks, default 1) and tiebreak ("speed" or "none":
// whether `michelin compare` breaks a judged tie by wall time, default "speed").
// Every entry is {"model": "<id>", "effort": "<low|medium|high|xhigh|max>"}.
//
//   constructor  runs <subject>/setup.md         (one entry)
//   executor     drives the subject through CUJs (one entry)
//   destructor   runs <subject>/teardown.md      (one entry)
//   judge        scores the journeys             (list of entries: the first alone, all + majority vote on a fail)
//
// loadSettings and loadConfig throw if a role is missing, a field unknown or an entry mistyped, naming the file it
// came from, so a typo fails at start instead of mid-run.
//
// Test: node --test test/settings.test.ts

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
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

/** What the command line may set: --executor "m" or "m@effort", --judges "a,b@effort", --runs N. */
export type Flags = { executor?: string; judges?: string; runs?: number; tiebreak?: Tiebreak };

/** How `michelin compare` breaks a judged tie: "speed" (the run 1.5x faster or more wins) or "none". */
export type Tiebreak = "speed" | "none";

/** A resolved run: models per role, and the subject, CUJs and repeat count from michelin.json or flags. */
export type Config = {
  /** Models per role, checked, plus judging when given. */
  settings: Settings;
  /** Subject folder from michelin.json, e.g. "subjects/toy"; undefined if it names none. */
  subject?: string;
  /** CUJ files or folders from michelin.json, e.g. ["subjects/toy/cujs/toy/"]; [] if none. */
  cujs: string[];
  /** How many times to run every CUJ, e.g. 3; default 1. */
  runs: number;
  /** How many of the first judges `michelin compare` asks when --judges isn't given, e.g. 3; default 1. */
  pairJudges: number;
  /** How `michelin compare` breaks a judged tie, e.g. "none"; default "speed". */
  tiebreak: Tiebreak;
};

/** Per extra michelin.json field: a check of its value and what it must be. */
const EXTRA: Record<string, [(v: unknown) => boolean, string]> = {
  subject: [(v) => typeof v === "string" && v !== "", "a non-empty string"],
  cujs: [(v) => Array.isArray(v) && v.every((c) => typeof c === "string"), "a list of strings"],
  runs: [(v) => Number.isInteger(v) && (v as number) >= 1, "a whole number >= 1"],
  pair_judges: [(v) => Number.isInteger(v) && (v as number) >= 1, "a whole number >= 1"],
  tiebreak: [(v) => v === "speed" || v === "none", '"speed" or "none"'],
};

/**
 * Check one field of a michelin.json-style file.
 *
 * @param k    The field, e.g. "runs".
 * @param v    Its value, e.g. 3.
 * @param path The file, named in the error, e.g. "michelin.json".
 * @throws     If the field is unknown or its value has the wrong type; the error names the file and the field.
 */
function checkField(k: string, v: unknown, path: string): void {
  if (Object.hasOwn(EXTRA, k)) {
    const [ok, what] = EXTRA[k];
    if (!ok(v)) throw new Error(`${path}: field "${k}" must be ${what}`);
  } else if (!FIELDS.includes(k)) {
    throw new Error(`${path}: unknown field "${k}"; allowed: ${[...FIELDS, ...Object.keys(EXTRA)].join(", ")}`);
  } else if (k === "judge" ? !(Array.isArray(v) && v.length > 0 && v.every(isPick)) : !isPick(v)) {
    const what = k === "judge" ? "a non-empty list of {model, effort}" : "{model, effort}";
    throw new Error(`${path}: field "${k}" must be ${what}; effort is one of ${EFFORTS.join(", ")}`);
  }
}

/**
 * Parse an --executor or --judges entry.
 *
 * @param s      "model" or "model@effort", e.g. "claude-sonnet-5-5@high".
 * @param effort The effort when none is given, e.g. "medium".
 * @param flag   The flag it came from, named in the error, e.g. "--executor".
 * @returns      The pick, e.g. {model: "claude-sonnet-5-5", effort: "high"}.
 * @throws       If the model is empty or the effort isn't one of EFFORTS.
 */
function parsePick(s: string, effort: Pick["effort"], flag: string): Pick {
  const [model, e = effort] = s.trim().split("@");
  const p = { model, effort: e };
  if (!model || !isPick(p))
    throw new Error(`${flag}: "${s}" must be model or model@effort; effort is one of ${EFFORTS.join(", ")}`);
  return p;
}

/**
 * The non-role fields of a resolved config, each from flags, then the file, then its default. Pure.
 *
 * @param f     The checked file, e.g. {subject: "subjects/toy", runs: 2, pair_judges: 3}.
 * @param flags From the command line, e.g. {runs: 5}; only runs and tiebreak are read.
 * @returns     subject (undefined if none), cujs ([] if none), runs (default 1), pairJudges (default 1) and tiebreak
 *              (default "speed").
 */
function extras(f: Record<string, unknown>, flags: Flags): Omit<Config, "settings"> {
  return {
    subject: f.subject as string | undefined,
    cujs: (f.cujs as string[]) ?? [],
    runs: flags.runs ?? (f.runs as number) ?? 1,
    pairJudges: (f.pair_judges as number) ?? 1,
    tiebreak: flags.tiebreak ?? (f.tiebreak as Tiebreak) ?? "speed",
  };
}

/**
 * Merge the three sources of settings, field by field: flags win over the file, the file over the defaults.
 * Pure: reads nothing.
 *
 * @param defaults The built-in settings, e.g. loadSettings() of defaults/settings.json.
 * @param file     The parsed michelin.json (or --settings file), any subset of fields, e.g. {runs: 2, pair_judges: 3}; {} if none.
 * @param flags    From the command line, e.g. {executor: "claude-sonnet-5-5@high", judges: "claude-opus-5-5", runs: 3}.
 * @param path     The file, named in every error, e.g. "michelin.json".
 * @returns        The merged config; settings carry no judging (loadConfig adds it).
 * @throws         If the file isn't an object, holds an unknown or mistyped field, or a flag entry is malformed.
 */
export function resolveSettings(defaults: Settings, file: unknown, flags: Flags, path: string): Config {
  if (typeof file !== "object" || file === null || Array.isArray(file))
    throw new Error(`${path}: must be a JSON object`);
  const f = file as Record<string, unknown>;
  for (const [k, v] of Object.entries(f)) checkField(k, v, path);
  const roles = Object.fromEntries(
    FIELDS.map((k) => [k, Object.hasOwn(f, k) ? f[k] : defaults[k as keyof Settings]]),
  ) as Settings;
  if (flags.executor) roles.executor = parsePick(flags.executor, roles.executor.effort, "--executor");
  if (flags.judges) roles.judge = flags.judges.split(",").map((j) => parsePick(j, "high", "--judges"));
  checkFields(roles, path);
  return { settings: roles, ...extras(f, flags) };
}

/**
 * Read the defaults and ./michelin.json (or the --settings file instead), then merge in the flags (resolveSettings).
 *
 * @param opts settingsPath: the --settings file, e.g. "my.json" (relative to cwd); omitted: cwd/michelin.json if it
 *             exists, else defaults alone. flags: from the command line, e.g. {runs: 2}. cwd: the folder holding
 *             michelin.json, e.g. process.cwd(). judging: how the judges are used, e.g. {all: false, baselines: []}.
 * @returns    The resolved config, with judging on its settings if given.
 * @throws     If a file is missing (only a named --settings file), not valid JSON, or holds a bad field.
 */
export function loadConfig(opts: { settingsPath?: string; flags: Flags; cwd: string; judging?: Judging }): Config {
  const { settingsPath, flags, cwd, judging } = opts;
  const path = settingsPath ? resolve(cwd, settingsPath) : resolve(cwd, "michelin.json");
  const file = settingsPath || existsSync(path) ? readJson(path) : {};
  const c = resolveSettings(loadSettings(), file, flags, path);
  return judging ? { ...c, settings: { ...c.settings, judging } } : c;
}
