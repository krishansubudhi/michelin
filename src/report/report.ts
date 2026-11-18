// Report: turns one run folder (.runs/<runid>/) into a single self-contained report.html.
//
//   node -e "import('./src/report/report.ts').then(m => m.writeReport('.runs/<runid>'))"
//
// loadRun() walks the folder and builds a typed RunView from its *.json files;
// renderReport() (render.ts) is pure and turns that view into HTML; writeReport() wires them and never throws.
// Raw text only appears in collapsible debug blocks; files it doesn't know are listed too: images as <img>, other
// binary files by name and size, never as text.
// Test: npm test (report.test.ts, no LLM).

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { Session } from "../llm/models.ts";
import type { Checked, Setup, Teardown, ExecutorResult, JudgeResult } from "../llm/schemas.ts";
import { esc } from "./html.ts";
import { renderReport } from "./render.ts";
import type { CujView, FileText, Loose, RunView } from "./view.ts";

/**
 * Parse JSON without throwing. Pure.
 *
 * @param text JSON text, e.g. '{"ok":true}'.
 * @returns    The value, or null if garbled.
 */
const tryJson = (text: string): Loose => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** File names shown as an image in the report, e.g. "shot.png". */
const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;

/**
 * Whether file contents are binary: a NUL byte in the first 8 KB, as git decides. Pure.
 *
 * @param buf The file's bytes.
 * @returns   true for e.g. a PNG, false for UTF-8 text.
 */
export const isBinary = (buf: Uint8Array) => buf.subarray(0, 8192).includes(0);

/**
 * A binary or image file's entry for the report, never its bytes as text. Pure.
 *
 * @param path Its path in the run, e.g. "c1/shot.png".
 * @param buf  Its bytes.
 * @returns    {path, kind: "image" | "binary", bytes}, or null for a text file.
 */
function binaryFile(path: string, buf: Uint8Array): FileText | null {
  if (!IMAGE.test(path) && !isBinary(buf)) return null;
  return { path, text: "", kind: IMAGE.test(path) ? "image" : "binary", bytes: buf.length };
}

/**
 * Read a role output json ({ok, data|error, sessionId, ms, raw}) as a Checked value, moving raw to debug. Pure.
 *
 * @param path Its path in the run, e.g. "constructor.json".
 * @param j    The parsed json, or null.
 * @param raw  Debug list to push the raw text onto.
 * @returns    {ok: true, data} or {ok: false, error}; null if not a role output.
 */
function checked<T>(path: string, j: Loose, raw: FileText[]): Checked<T> | null {
  if (!j || typeof j !== "object" || typeof j.ok !== "boolean") return null;
  if (typeof j.raw === "string" && j.raw) raw.push({ path: `${path} (raw)`, text: j.raw });
  return j.ok ? { ok: true, data: j.data } : { ok: false, error: String(j.error ?? "unknown error") };
}

/** A CUJ view with nothing known yet. Pure. */
const emptyCuj = (id: string): CujView => ({
  id,
  def: null,
  status: "",
  score: "",
  executor: null,
  outcomes: [],
  judges: {},
  sessions: [],
});

/**
 * List every file in a run folder, at any depth, as "/"-separated paths. Never throws.
 *
 * @param dir Run folder.
 * @returns   Sorted relative paths, e.g. ["chat-name/executor.json", "run.json"]; null if dir can't be read.
 */
function listFiles(dir: string): string[] | null {
  try {
    return readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => statSync(join(dir, f)).isFile())
      .sort()
      .map((f) => f.split(sep).join("/"));
  } catch {
    return null;
  }
}

/**
 * File one top-level run file into the view.
 *
 * @param view The view being built.
 * @param path Its path in the run, e.g. "constructor.json".
 * @param text Its contents.
 * @returns    true if it was recognised and filed.
 */
function topFile(view: RunView, path: string, text: string): boolean {
  if (path === "run.json") view.run = tryJson(text) ?? {};
  else if (path === "constructor.json") view.constructor = checked<Setup>(path, tryJson(text), view.raw);
  else if (path === "destructor.json") view.destructor = checked<Teardown>(path, tryJson(text), view.raw);
  else return false;
  return true;
}

/**
 * File one file of a CUJ folder into its CUJ view.
 *
 * @param c    Gets the CUJ's view; only called for a recognised file, so stray files make no CUJ.
 * @param path Its path in the run, e.g. "chat-name/verdict.json".
 * @param text Its contents.
 * @param raw  Debug list for raw replies.
 * @returns    true if it was recognised and filed.
 */
function cujFile(c: () => CujView, path: string, text: string, raw: FileText[]): boolean {
  const name = path.slice(path.indexOf("/") + 1);
  if (name === "executor.json") c().executor = checked<ExecutorResult>(path, tryJson(text), raw);
  else if (name === "verdict.json") {
    const v = tryJson(text);
    c().outcomes = Array.isArray(v) ? v.filter((o) => o && typeof o === "object") : [];
  } else if (/^judge-.*\.json$/.test(name)) {
    const j = checked<JudgeResult>(path, tryJson(text), raw);
    if (j) c().judges[name.slice(0, -5)] = j;
  } else return false;
  return true;
}

/**
 * run.json's sessions, or {} if absent or not an object. Pure.
 *
 * @param run The parsed run.json.
 * @returns   Sessions keyed by label, e.g. {"constructor": {...}, "chat-name/executor": {...}}.
 */
const runSessions = (run: Loose): Record<string, Session> =>
  run.sessions && typeof run.sessions === "object" ? run.sessions : {};

/**
 * Fill in what run.json says: top-level sessions, and each CUJ's def, status, score and sessions.
 *
 * @param view The view, with view.run already read.
 * @param cuj  Gets (or makes) the view of one CUJ id.
 * @param all  Every CUJ view, to fill once all are known.
 */
function applyRun(view: RunView, cuj: (id: string) => CujView, all: () => Iterable<CujView>): void {
  const run = view.run;
  const field = (key: string, id: string) => String(run[key]?.[id] ?? "");
  for (const id of Object.keys(run.cujs ?? {})) cuj(id);
  for (const [label, s] of Object.entries(runSessions(run))) {
    const i = label.indexOf("/");
    if (i < 0) view.sessions[label] = s;
    else cuj(label.slice(0, i)).sessions.push([label.slice(i + 1), s]);
  }
  for (const c of all()) {
    c.def = run.defs?.[c.id] ?? null;
    c.status = field("cujs", c.id);
    c.score = field("scores", c.id);
  }
}

/**
 * Read a run folder into a typed view. Never throws: missing or garbled files count as absent.
 *
 * @param dir Run folder, e.g. ".runs/2026-11-06T03-04-45-304Z".
 * @returns   The RunView.
 */
export function loadRun(dir: string): RunView {
  const view: RunView = {
    dir,
    run: {},
    constructor: null,
    destructor: null,
    sessions: {},
    cujs: [],
    raw: [],
    unknown: [],
  };
  const files = listFiles(dir);
  if (!files) return view;
  const cujs = new Map<string, CujView>();
  const cuj = (id: string) => cujs.get(id) ?? cujs.set(id, emptyCuj(id)).get(id)!;
  for (const path of files) {
    if (path === "report.html") continue;
    let buf: Buffer;
    try {
      buf = readFileSync(join(dir, path));
    } catch {
      continue;
    }
    const bin = binaryFile(path, buf);
    if (bin) {
      view.unknown.push(bin);
      continue;
    }
    const text = buf.toString("utf8");
    const parts = path.split("/");
    const filed = parts.length === 2 ? cujFile(() => cuj(parts[0]), path, text, view.raw) : topFile(view, path, text);
    if (filed) continue;
    if (path.endsWith(".txt") || path === "llm.log") view.raw.push({ path, text });
    else view.unknown.push({ path, text });
  }
  applyRun(view, cuj, () => cujs.values());
  view.cujs = [...cujs.values()].sort((a, b) => a.id.localeCompare(b.id));
  return view;
}

/**
 * The report's path as a file:// URL, so terminals make it clickable. Pure.
 *
 * @param dir The run folder, e.g. ".runs/2026-11-10T02-58-00-000Z"; resolved against the current folder.
 * @returns   e.g. "file:///home/me/proj/.runs/2026-11-10T02-58-00-000Z/report.html".
 */
export const reportUrl = (dir: string) => pathToFileURL(resolve(dir, "report.html")).href;

/**
 * The line a run prints first: its folder and llm.log, both as absolute paths. Pure (reads only the cwd).
 *
 * @param dir The run folder, e.g. ".runs/2026-11-10T02-58-00-000Z".
 * @returns   e.g. "run dir: /home/me/proj/.runs/2026-11-10T02-58-00-000Z (tail -f /home/me/proj/.runs/.../llm.log to follow)".
 */
export const runDirLine = (dir: string) => `run dir: ${resolve(dir)} (tail -f ${resolve(dir, "llm.log")} to follow)`;

/**
 * Write dir/report.html for a run folder. Never throws: on any error it writes a minimal page, and if
 * even that fails it gives up silently (the runner calls this in a finally).
 *
 * @param dir Run folder, e.g. ".runs/2026-11-06T03-04-45-304Z".
 */
export function writeReport(dir: string): void {
  let html: string;
  try {
    html = renderReport(loadRun(dir));
  } catch (e) {
    html = `<!doctype html><meta charset="utf-8"><title>report</title><p>Report failed: ${esc((e as Error)?.message ?? e)}</p>`;
  }
  try {
    writeFileSync(join(dir, "report.html"), html);
  } catch {
    /* nowhere to write */
  }
}
