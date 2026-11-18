// Scrub: hide what could name a run's subject (run id, folder, subject, models, setup values) from a judge.
//
// A head-to-head judge must not know which program is which, so every identifier of each run, and its short
// forms ("ollama/gemma4:26b-mlx" -> "gemma4:26b-mlx", "gemma4", "gemma"), is replaced by a neutral tag such as
// "Program A". Paths are only ever replaced whole, so a folder ".../work" never hides the word "work", and every form
// matches whole tokens only: "gemma" never eats into "gemmatology" nor "qwen" into "qwen_utils". Pure.
//
// Test: npm test (scrub.test.ts, no LLM).

import { basename, resolve } from "node:path";

/** A role's model in run.json, e.g. {model: "ollama/gemma4:26b-mlx", effort: "high"}; only model is read. */
type Role = { model?: unknown };

/** The parts of a run.json that can name its subject: the subject folder and the models of every role. */
export type RunInfo = {
  subject?: unknown;
  settings?: { constructor?: Role; executor?: Role; destructor?: Role; judge?: Role[] };
};

/**
 * Every role's model in a run.json. Pure.
 *
 * @param run The run's run.json, e.g. {settings: {executor: {model: "ollama/x"}, judge: [{model: "claude-opus-5-5"}]}}.
 * @returns   The model of constructor, executor, destructor and every judge, as found (non-strings dropped later).
 */
function models(run: RunInfo): unknown[] {
  const s = run.settings;
  // A settings object without a constructor key still has Object's; its .model is undefined, so it drops out.
  const roles = [s?.constructor, s?.executor, s?.destructor, ...(Array.isArray(s?.judge) ? s.judge : [])];
  return roles.map((p) => p?.model);
}

/**
 * The value of every NAME=value line in the constructor's setup notes, quotes stripped. Pure.
 *
 * @param notes The setup notes, e.g. "installed\nMODEL=ollama/gemma4:26b-mlx".
 * @returns     The values, e.g. ["ollama/gemma4:26b-mlx"].
 */
function setupValues(notes: string): string[] {
  return [...notes.matchAll(/^\s*[A-Za-z_][A-Za-z0-9_]*=(.*)$/gm)].map((m) => m[1].trim().replace(/^["']|["']$/g, ""));
}

/**
 * The strings that could name a run's subject. Pure.
 *
 * @param dir   The run folder, e.g. ".runs/2026-11-17T10-00-00-000Z"; its name (the run id) and absolute path count.
 * @param run   The run's run.json, e.g. {subject: "subjects/opencode", settings: {executor: {model: "ollama/x"}}};
 *              subject and its folder name count, and the model of constructor, executor, destructor and every judge.
 * @param notes The constructor's setup notes; each NAME=value line's value counts, e.g. "MODEL=ollama/gemma4:26b-mlx".
 * @param more  extra: more strings that could name the run, e.g. its compare name ["gemma"]; under 3 characters
 *              dropped like the rest. hide: what the user asked to hide (--hide), e.g. ["my-laptop", "v2"]; kept
 *              whatever its length.
 * @returns     The distinct identifiers: empty ones dropped, and those under 3 characters unless in hide.
 */
export function identifiers(
  dir: string,
  run: RunInfo,
  notes = "",
  { extra = [], hide = [] }: { extra?: string[]; hide?: string[] } = {},
): string[] {
  const subject = typeof run.subject === "string" ? [run.subject, basename(run.subject)] : [];
  const all = [basename(dir), resolve(dir), ...subject, ...models(run), ...setupValues(notes), ...extra];
  const found = all.filter((x): x is string => typeof x === "string" && x.trim().length >= 3);
  return [...new Set([...found, ...hide].map((x) => x.trim()).filter(Boolean))];
}

/**
 * The forms of one identifier to hide. Pure.
 *
 * @param id An identifier, e.g. "ollama/gemma4:26b-mlx"; a path ("/x/y", "./y") is only ever hidden whole.
 * @returns  id itself whatever its length (an explicit --hide "v2" stays), then for a non-path its part after the last
 *           "/", that part before ":", and its leading letters if 4 or more, each only if 3 characters or more,
 *           e.g. ["ollama/gemma4:26b-mlx", "gemma4:26b-mlx", "gemma4", "gemma"].
 */
export function variants(id: string): string[] {
  if (id.startsWith("/") || id.startsWith(".")) return [id];
  const tail = id.slice(id.lastIndexOf("/") + 1);
  const name = tail.split(":")[0];
  const letters = /^[a-z]*/i.exec(name)![0];
  const short = [tail, name, letters.length >= 4 ? letters : ""].filter((v) => v.length >= 3);
  return [...new Set([id, ...short].filter(Boolean))];
}

/** A letter, digit or underscore: what a hidden form may not touch on either side, so only whole tokens match. */
const WORD = "[\\p{L}\\p{N}_]";

/**
 * Replace every form of every identifier with its group's tag, case-insensitively, longest first, whole tokens only
 * (no letter, digit or underscore right before or after a match). Pure.
 *
 * @param text   The text to scrub, e.g. "gemma4 answered 13".
 * @param groups Identifiers and the tag that replaces them, e.g. [[["ollama/gemma4:26b-mlx"], "Program A"]];
 *               an earlier group wins a form that two groups share.
 * @returns      The scrubbed text, e.g. "Program A answered 13".
 */
export function scrub(text: string, groups: [ids: string[], tag: string][]): string {
  const tags = new Map<string, string>();
  for (const [ids, tag] of groups)
    for (const v of ids.flatMap(variants)) if (!tags.has(v.toLowerCase())) tags.set(v.toLowerCase(), tag);
  if (!tags.size) return text;
  const alts = [...tags.keys()]
    .sort((a, b) => b.length - a.length)
    .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(?<!${WORD})(?:${alts.join("|")})(?!${WORD})`, "giu");
  return text.replace(re, (m) => tags.get(m.toLowerCase())!);
}
