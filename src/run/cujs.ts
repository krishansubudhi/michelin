// CUJs: critical user journeys, one .yaml file each under a subject's cujs/ folder. Finding, loading,
// checking and naming them; the runner only consumes the result.
//
// Test: npm test (cujs.test.ts, no LLM).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
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
  given?: Record<string, unknown>;
};

/** Every key a CUJ yaml may have; story is a note for humans, nothing reads it. */
const CUJ_KEYS = ["instruction", "timeout_s", "expectations", "story", "given"];

/** True if c has instruction (string), timeout_s (number) and expectations (list of strings). Pure. */
const hasCujTypes = (c: Record<string, unknown> | null | undefined): c is Cuj =>
  typeof c?.instruction === "string" &&
  typeof c?.timeout_s === "number" &&
  Array.isArray(c?.expectations) &&
  c.expectations.every((e: unknown) => typeof e === "string");

/** True if v is a map ({key: value}), not a list, null or a scalar. */
const isMap = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);

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
  return null;
}

/**
 * Read one CUJ yaml file and check every field.
 *
 * @param path Path to the .yaml file, e.g. "test/fixtures/subjects/toy-v1/cujs/chat/name.yaml".
 * @returns    The parsed CUJ.
 * @throws     If a field is missing, has the wrong type, or is empty or non-positive, naming the file.
 */
export function loadCuj(path: string): Cuj {
  const c = parse(readFileSync(path, "utf8"));
  const problem = cujProblem(c);
  if (problem) throw new Error(`${path}: ${problem}`);
  return c;
}

/** True if `path` is an existing folder, e.g. "cujs/chat/". */
const isFolder = (path: string) => !!statSync(path, { throwIfNoEntry: false })?.isDirectory();

/**
 * Group CUJ files into runs. Files listed one by one share one run (one setup, one teardown); once any argument
 * is a folder, every CUJ gets a fresh start: a run of its own, with its own setup and teardown.
 *
 * @param args  The command-line CUJ arguments, e.g. ["cujs/chat/"].
 * @param files The same, expanded by expandCujs, e.g. ["cujs/chat/a.yaml", "cujs/chat/b.yaml"].
 * @returns     The runs in order, each a list of files, e.g. [["cujs/chat/a.yaml"], ["cujs/chat/b.yaml"]].
 */
export const runGroups = <T>(args: string[], files: T[]): T[][] =>
  args.some(isFolder) ? files.map((f) => [f]) : [files];

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
