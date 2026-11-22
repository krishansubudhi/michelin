// CUJs: critical user journeys, one .yaml file each under a subject's cujs/ folder. Finding, loading,
// checking and naming them; the runner only consumes the result.
//
// Test: npm test (cujs.test.ts, no LLM).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse } from "yaml";

/** Where subjects live, relative to the repo root: real ones, and test-only ones. Each is <dir>/<name>/ with its .md files and cujs/. */
export const SUBJECT_DIRS = ["subjects", "test/fixtures/subjects"];

/**
 * Extra subject folders outside this repo, from MICHELIN_SUBJECTS: a colon-separated list, like PATH. Pure.
 *
 * @param env The environment, e.g. {MICHELIN_SUBJECTS: "/srv/private-subjects:/opt/more"}.
 * @returns   The folders in order, e.g. ["/srv/private-subjects", "/opt/more"]; [] when unset or empty.
 */
export const externalSubjectDirs = (env: NodeJS.ProcessEnv = process.env): string[] =>
  (env.MICHELIN_SUBJECTS ?? "").split(":").filter(Boolean);

/**
 * Resolve a subject, CUJ or settings path from the command line: as given if it exists, else under the first
 * MICHELIN_SUBJECTS folder that has it, so private subjects can live in a repo of their own.
 *
 * @param arg  The path as typed, e.g. "my-app/cujs/smoke/" or "settings/my-app.json".
 * @param dirs Folders to try, e.g. ["/srv/private-subjects"]; defaults to externalSubjectDirs().
 * @returns    The first existing path, e.g. "/srv/private-subjects/my-app/cujs/smoke/"; arg itself if none exists,
 *             so the caller's own "not found" error names what was typed.
 */
export function resolveArg(arg: string, dirs: string[] = externalSubjectDirs()): string {
  if (existsSync(arg)) return arg;
  return dirs.map((d) => join(d, arg)).find((p) => existsSync(p)) ?? arg;
}

/** One critical user journey, one .yaml file under <subject>/cujs/. */
export type Cuj = {
  /** What the executor is told to do, in plain words. */
  instruction: string;
  /** Seconds the executor gets before it is killed. */
  timeout_s: number;
  /** What a good journey shows. Only the judge reads these, never the executor. */
  expectations: string[];
  /** The world before the CUJ starts, e.g. {memory: ["..."], health: {sleep_h: 5}}: setup seeds it, the executor and
   *  judges are told it, the subject never is. */
  /** The world before the CUJ starts, e.g. {memory: ["..."], health: {sleep_h: 5}}: setup seeds it, the executor and
   *  judges are told it, the subject never is. */
  given?: Record<string, unknown>;
  /** Names of what the subject's howtorun.md must explain for this CUJ to run, e.g. ["New session", "Local port"].
   *  The yaml lists names defined in the CUJ root's needs.md; loadCuj adds that file's always-required ones. */
  needs?: string[];
};

/** The "## Name" headings of a markdown text, lower-cased, e.g. ["new session", "local port"]. Pure. */
const headings = (md: string) =>
  md
    .split("\n")
    .filter((l) => l.startsWith("## "))
    .map((l) => l.slice(3).trim().toLowerCase());

/**
 * Read the needs a CUJ may name: needs.md in the CUJ root (the cujs/ folder above the file), each need a "## Name"
 * heading plus a line saying what a subject must explain. Those under a "# Always ..." heading apply to every CUJ.
 *
 * @param path A CUJ file, e.g. "subjects/personal-agents/cujs/hard/a.yaml" (reads subjects/personal-agents/cujs/needs.md).
 * @returns    e.g. {always: ["New session"], all: ["new session", "local port"]}; both empty when there is no needs.md.
 */
export function readNeeds(path: string): { always: string[]; all: string[] } {
  const full = resolve(path);
  const file = join(full.slice(0, full.lastIndexOf("/cujs/") + 5), "needs.md");
  if (!full.includes("/cujs/") || !existsSync(file)) return { always: [], all: [] };
  const md = readFileSync(file, "utf8");
  const always = md.split(/^# /m).filter((s) => /^always/i.test(s));
  return { always: always.flatMap((s) => s.match(/^## .+$/gm) ?? []).map((l) => l.slice(3).trim()), all: headings(md) };
}

/**
 * The needs a subject's howtorun.md does not answer. A need is answered by a "## <name>" heading (any letter case):
 * a text match, so the same CUJ is never run one day and left out the next. Pure.
 *
 * @param howtorun Contents of <subject>/howtorun.md.
 * @param cuj      The loaded CUJ.
 * @returns        The missing names, e.g. ["Same session"]; [] if all are answered or the CUJ needs nothing.
 */
export const unanswered = (howtorun: string, cuj: { needs?: string[] }): string[] =>
  (cuj.needs ?? []).filter((n) => !headings(howtorun).includes(n.toLowerCase()));

/**
 * The status of a CUJ this subject cannot run, or null if it can. Pure.
 *
 * @param howtorun Contents of <subject>/howtorun.md.
 * @param cuj      The CUJ.
 * @returns        e.g. "unsupported: howtorun.md has no section: Same session, Local port"; null if nothing is missing.
 */
export const unsupported = (howtorun: string, cuj: { needs?: string[] }): string | null => {
  const missing = unanswered(howtorun, cuj);
  return missing.length ? `unsupported: howtorun.md has no section: ${missing.join(", ")}` : null;
};

/** Every key a CUJ yaml may have; story is a note for humans, nothing reads it. */
const CUJ_KEYS = ["instruction", "timeout_s", "expectations", "story", "given", "needs"];

/** True if c has instruction (string), timeout_s (number) and expectations (list of strings). Pure. */
const hasCujTypes = (c: Record<string, unknown> | null | undefined): c is Cuj =>
  typeof c?.instruction === "string" &&
  typeof c?.timeout_s === "number" &&
  Array.isArray(c?.expectations) &&
  c.expectations.every((e: unknown) => typeof e === "string");

/** True if v is a map ({key: value}), not a list, null or a scalar. */
const isMap = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);

/** True if a CUJ's needs is absent or a list of non-empty strings, e.g. ["Local port"]. */
const needsOk = (v: unknown) =>
  v === undefined || (Array.isArray(v) && v.every((n: unknown) => typeof n === "string" && !!n.trim()));

/**
 * What's wrong with a parsed CUJ, if anything. Pure.
 *
 * @param c The parsed yaml, e.g. {instruction: "Ask ...", timeout_s: 60, expectations: ["The reply says USA."]}.
 * @returns null if it's a valid CUJ, else the problem, e.g. "timeout_s must be a positive number, got 0".
 */
function cujProblem(c: Record<string, unknown> | null | undefined): string | null {
  if (!hasCujTypes(c)) return "needs instruction (string), timeout_s (number), expectations (list of strings)";
  const unknown = Object.keys(c).filter((k) => !CUJ_KEYS.includes(k));
  if (unknown.length) return `unknown field: ${unknown.join(", ")} (allowed: ${CUJ_KEYS.join(", ")})`;
  if (!(c.timeout_s > 0 && Number.isFinite(c.timeout_s)))
    return `timeout_s must be a positive number, got ${c.timeout_s}`;
  if (!c.expectations.length || c.expectations.some((e) => !e.trim())) {
    return "expectations must be a non-empty list of non-empty strings";
  }
  if ("given" in c && !isMap(c.given)) return "given must be a map of key: value, e.g. given: {memory: [...]}";
  return needsOk(c.needs) ? null : "needs must be a list of names from needs.md, e.g. needs: [Local port]";
}

/**
 * Read one CUJ yaml file and check every field.
 *
 * @param path Path to the .yaml file, e.g. "test/fixtures/subjects/toy-v1/cujs/chat/name.yaml".
 * @returns    The parsed CUJ; its needs are the always-required ones from the CUJ root's needs.md, then its own.
 * @throws     If a field is missing, has the wrong type, is empty or non-positive, or names a need that needs.md
 *             does not define, naming the file.
 */
export function loadCuj(path: string): Cuj {
  const c = parse(readFileSync(path, "utf8"));
  const problem = cujProblem(c);
  if (problem) throw new Error(`${path}: ${problem}`);
  const { always, all } = readNeeds(path);
  const unknown = (c.needs ?? []).filter((n: string) => !all.includes(n.toLowerCase()));
  if (unknown.length) throw new Error(`${path}: need not defined in the CUJ root's needs.md: ${unknown.join(", ")}`);
  const needs = [...new Set([...always, ...(c.needs ?? [])])];
  return needs.length ? { ...c, needs } : c;
}

/** True if `path` is an existing folder, e.g. "cujs/chat/". */
const isFolder = (path: string) => !!statSync(path, { throwIfNoEntry: false })?.isDirectory();

/**
 * Group CUJ files into runs: every CUJ gets a fresh start, a run of its own with its own setup, RUNDIR and teardown,
 * however it was named on the command line. Pure.
 *
 * @param files The CUJs, expanded by expandCujs, e.g. ["cujs/chat/a.yaml", "cujs/chat/b.yaml"].
 * @returns     The runs in order, each a list of files, e.g. [["cujs/chat/a.yaml"], ["cujs/chat/b.yaml"]].
 */
export const runGroups = <T>(files: T[]): T[][] => files.map((f) => [f]);

/**
 * Expand CUJ arguments: a folder becomes every *.yaml directly in it, sorted; a file stays as given.
 *
 * @param args CUJ files or folders from the command line, e.g. ["cujs/chat/", "x/one.yaml"].
 * @returns    CUJ files in order, e.g. ["cujs/chat/a.yaml", "cujs/chat/country.yaml", ..., "x/one.yaml"].
 * @throws     If a folder holds no .yaml file, naming it. A missing path is left for loadCuj to refuse.
 */
export function expandCujs(args: string[]): string[] {
  return args.flatMap((a) => {
    if (!isFolder(a)) return [a];
    const files = readdirSync(a, { withFileTypes: true })
      .filter((f) => f.isFile() && f.name.endsWith(".yaml"))
      .map((f) => join(a, f.name))
      .sort();
    if (!files.length) throw new Error(`${a}: no .yaml CUJ files in this folder`);
    return files;
  });
}

/**
 * Check no two CUJ files map to the same id (and so the same output folder). Pure.
 *
 * @param paths CUJ files, e.g. ["s/cujs/chat/name.yaml", "s/cujs/chat-name.yaml"].
 * @throws      Naming the id and every file that shares it, e.g. "duplicate CUJ id chat-name: a.yaml, b.yaml".
 */
export function checkUniqueIds(paths: string[]): void {
  const byId = new Map<string, string[]>();
  for (const p of paths) byId.set(cujId(p), [...(byId.get(cujId(p)) ?? []), p]);
  const dup = [...byId].find(([, ps]) => ps.length > 1);
  if (dup)
    throw new Error(
      `duplicate CUJ id ${dup[0]}: ${dup[1].join(", ")} (each CUJ may be given once, and ids must be unique)`,
    );
}

/**
 * Turn a CUJ path into the id used for its output folder. Pure.
 *
 * @param path CUJ file, e.g. "cujs/chat/country.yaml", or one outside any cujs/ folder, e.g. "suite/hi.yaml".
 * @returns    Its path under the last cujs/ folder without .yaml, slashes as dashes, e.g. "country" or "chat-name" for
 *             ".../toy-v1/cujs/chat/name.yaml"; a file outside any cujs/ is named by its path from the current folder,
 *             leading "../" dropped, e.g. "suite-hi".
 */
export const cujId = (path: string) => {
  const rel = relative(".", path);
  const under = /(?:.*\/|^)cujs\/(.+)$/.exec(rel)?.[1];
  return (under ?? rel.replace(/^(\.\.\/)+/, "")).replace(/\.yaml$/, "").replaceAll("/", "-");
};
