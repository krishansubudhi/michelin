#!/usr/bin/env node
// The runner: one program that takes a subject from construction to destruction.
//
//   node src/run/runner.ts subjects/toy subjects/toy/cujs/toy/country.yaml   (--help for usage; `michelin` via bin/michelin.js; a folder instead of the .yaml runs every *.yaml in it, sorted, each a fresh run)
// Test: npm test (no LLM, ~1 s). Live: the command above (one CUJ end to end). `michelin init`: init.ts; `michelin compare`: compare.ts.
// CUJ files or folders come from the command line or michelin.json's cujs; with none it prints usage and an error to stderr and exits 2 before any setup. Steps (spec line 4):
//   a. constructor LLM reads <subject>/setup.md, runs it, seeds the CUJs' given (once; Setup, schemas.ts; given.ts)
//   b. executor LLM gets howtorun.md + one CUJ instruction       (per CUJ, killed at timeout_s; ExecutorResult; runs in a fresh temp folder, told where the repo is so howtorun's relative paths resolve)
//   c. destructor LLM reads <subject>/teardown.md and cleans up  (once, always; Teardown)
//   d. settings.judge scores each CUJ that ran, in parallel with c (judge.ts: first judge, all + majority on a fail or flip)
// Every role returns typed JSON (claude --json-schema), validated on arrival; an invalid result is an error. A failed setup skips every CUJ (no executor, no judge), still destructs, and exits 1.
//
// CUJ files are found and checked in cujs.ts. The runner itself has no LLM. Only the judges see a CUJ's expectations; they run alongside teardown, reading saved outputs, never the subject. Models come from flags, ./michelin.json, then defaults/settings.json via settings.ts (--runs n repeats it all n times).
// The subject's own install and temp state go in <tmp>/michelin-<user>/runs/<runid>/ (scratch.ts): made before setup, named in the constructor's and destructor's prompts, deleted after the run. Everything else lands in .runs/<runid>/ (spec line 5):
//   run.json                    the typed index: subject, settings, claude version, setup, statuses, scores, sessions, outputs, times
//   constructor.json / destructor.json   their checked results ({ok, data} or {ok:false, error}, plus raw text)
//   <cuj-id>/executor.json      the executor's checked result: steps [{action, input, got, ms}], reply and metrics [{name, value}]; files a step saved for the record (screenshots) sit beside it
//   <cuj-id>/judge-<model>-<effort>.json  each judge's checked result
//   <cuj-id>/verdict.json       per expectation: every vote, the majority
//   report.html                 everything above as one page (report.ts)
//   llm.log                     a timestamped line per step (run start, role, model start/end, errors), every CLI stderr line, and stdout when a call fails

import { setupReport } from "./setup-report.ts";
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type Settings } from "./settings.ts";
import { USAGE, parseCli, pickTargets, runMain } from "./cli.ts";
import { PKG_ROOT, init } from "./init.ts";
import { llm, claudeVersion, toSession, type Llm, type Pick, type Session } from "../llm/models.ts";
import { judgeCuj } from "../llm/judge.ts";
import {
  SETUP,
  EXECUTOR,
  TEARDOWN,
  check,
  type Checked,
  type Schema,
  type Setup,
  type ExecutorResult,
  type Teardown,
} from "../llm/schemas.ts";
import { reportUrl, writeReport } from "../report/report.ts";
import { checkUniqueIds, cujId, expandCujs, loadCuj, resolveArg, runGroups, type Cuj } from "./cujs.ts";
import { playNote, seedNote, sharedGiven, unseeded, type Given } from "./given.ts";
import { exitCode, summary } from "./summary.ts";
import { dropScratch, makeScratch, scratchFor, scratchNote } from "./scratch.ts";
import { acquireRunLock } from "./runlock.ts";

/**
 * Build the constructor's prompt.
 *
 * @param setup   Contents of <subject>/setup.md.
 * @param scratch The run's scratch folder, e.g. "/tmp/michelin/runs/x"; "" to leave it out.
 * @param given   The run's CUJ given state, to seed after setup; omitted if none.
 * @returns       The full prompt text.
 */
export const constructorPrompt = (setup: string, scratch = "", given?: Given) =>
  [
    setup,
    ...(scratch ? [scratchNote(scratch)] : []),
    ...(given ? seedNote(given) : []),
    "Do the steps above. Return ok, the steps you ran, and notes.",
    'If any step fails, stop and return ok: false with notes giving the reason, e.g. "harness not found: <path>".',
  ].join("\n\n");

/** The browser skill shipped in this package, e.g. "/usr/lib/node_modules/michelin-eval/skills/browser/SKILL.md". */
const BROWSER_SKILL = fileURLToPath(new URL("../../skills/browser/SKILL.md", import.meta.url));

/**
 * Build the executor's prompt. It holds the instruction but never the expectations.
 *
 * @param howtorun    Contents of <subject>/howtorun.md.
 * @param cuj         The CUJ: its instruction, and its given (seeded by setup) if any.
 * @param root        Absolute path of the michelin folder, e.g. "/srv/michelin"; howtorun's relative paths start there.
 * @param opts        setup: what setup reported (same text teardown gets), e.g. its PORT and TOKEN; "" if none.
 *                    out: absolute path of this CUJ's run folder, e.g. "/repo/.runs/<runid>/chat-name"; "" to leave it out.
 *                    skill: the browser skill file, e.g. "/pkg/skills/browser/SKILL.md"; default this package's.
 * @returns           The full prompt text.
 */
export const executorPrompt = (
  howtorun: string,
  cuj: { instruction: string; given?: Given },
  root: string,
  { setup = "", out = "", skill = BROWSER_SKILL }: { setup?: string; out?: string; skill?: string } = {},
) =>
  [
    "You are testing a program. How to run it:",
    howtorun,
    ...(setup ? [`Setup output (use these values; this is your instance):\n${setup}`] : []),
    ...(cuj.given ? [playNote(cuj.given)] : []),
    `The michelin folder is ${root}. Your working directory is a scratch folder; cd to ${root} to run the program.`,
    "Your task:",
    cuj.instruction,
    'Return steps: one per call you made to the program, each {action: what you did, e.g. "run"; input: what you sent; got: what it printed, verbatim and in full (never shorten it, summarise it or elide any part with "..." or "{...}": a judge sees only what you put here); ms: how long it took}.',
    'Measure ms, never estimate it: time each call, e.g. s=$(node -p Date.now()); <command>; echo $(( $(node -p Date.now()) - s )) (portable: never date +%s%N, which macOS lacks).\n\nReturn metrics: [] unless the how-to-run above names metrics to record (cost, tokens, steps, anything); then one {name, value} per metric it names, read the way it says, value as a string (e.g. {name: "tokens", value: "48210"}).',
    `If a step needs a browser, read ${skill} first.`,
    ...(out ? [`Save files for the record (e.g. screenshots) in ${out}; name each path in its step's got.`] : []),
    "Then reply: a short account of what happened.",
  ].join("\n\n");

/**
 * Build the destructor's prompt.
 *
 * @param teardown Contents of <subject>/teardown.md.
 * @param setup    What the constructor returned (its steps and notes as JSON), so teardown knows what setup started; "" if none.
 * @param scratch  The run's scratch folder, e.g. "/tmp/michelin/runs/x"; "" to leave it out.
 * @returns        The full prompt text.
 */
export const destructorPrompt = (teardown: string, setup = "", scratch = "") =>
  `${teardown}\n\n` +
  (scratch ? `${scratchNote(scratch)}\n\n` : "") +
  (setup ? `What setup reported:\n${setup}\n\n` : "") +
  "Do the steps above and clean up anything left running. Return ok, what you cleaned, and notes.";

/** What every step of one run needs. */
export type Ctx = {
  /** Models per role. */
  settings: Settings;
  /** Read a file from the subject folder, e.g. read("setup.md"). */
  read: (file: string) => string;
  /** This run's output folder, .runs/<runid>. */
  dir: string;
  /** How to call an LLM; the real one is llm(), tests pass a fake. */
  llm: Llm;
  /** `claude --version`, recorded in run.json; null or omitted if unknown. */
  claudeVersion?: string | null;
  /** The subject's scratch folder, <tmp>/michelin-<user>/runs/<runid>; omitted in tests. */
  scratch?: string;
};

/** run.json: the single typed index of one run. */
export type Run = {
  /** Subject folder, e.g. "subjects/toy". */
  subject: string;
  /** Models per role. */
  settings: Settings;
  /** `claude --version` of the CLI that ran every call, e.g. "2.1.318 (Claude Code)"; null if unknown. */
  claudeVersion: string | null;
  /** ISO start time. */
  started: string;
  /** ISO end time; null while running. */
  finished: string | null;
  heartbeat?: string; // ISO time of the runner's last sign of life, every 10s; stale means it died
  /** "ok", "failed", or "" before the constructor returns. */
  setup: "" | "ok" | "failed";
  /** Why setup failed (the call's error or the constructor's notes); null if it worked. */
  setupError: string | null;
  /** Per-CUJ definition: its file and instruction, e.g. {"toy-country": {path: "subjects/toy/cujs/toy/country.yaml", ...}}. */
  defs: Record<string, { path: string; instruction: string; timeout_s: number }>;
  /** Per-CUJ run status: "done", "error: ...", or "skipped (setup failed)". */
  cujs: Record<string, string>;
  /** Per-CUJ "passed k/n" or "unjudged". */
  scores: Record<string, string>;
  /** Every LLM call: "constructor", "destructor", "<cuj>/executor", "<cuj>/judge-<model>-<effort>". */
  sessions: Record<string, Session>;
  /** Each role's output file, relative to the run folder, keyed like sessions. */
  outputs: Record<string, string>;
};
/** Status of a CUJ that never ran because setup failed. */
export const SKIPPED = "skipped (setup failed)";

/** One role call: who, what, and where its output goes. */
type RoleCall = {
  /** Session key, e.g. "constructor" or "chat-name/executor". */
  label: string;
  /** The model for this role. */
  pick: Pick;
  /** The role's prompt. */
  prompt: string;
  /** The role's output schema, e.g. SETUP. */
  schema: Schema;
  /** Output path relative to ctx.dir, e.g. "constructor.json". */
  file: string;
  /** Seconds before the call is killed; default llm()'s. */
  timeoutS?: number;
  /** Run in a fresh temp folder (the executor), not the runner's. */
  scratch?: boolean;
};

/**
 * Call one role's LLM, validate its typed output, and record it: session in run.sessions,
 * output file in run.outputs, the checked result (plus raw text) written to `role.file`.
 *
 * @param ctx  The run context.
 * @param run  The run index being built.
 * @param role The call, e.g. {label: "constructor", pick, prompt, schema: SETUP, file: "constructor.json"}.
 * @returns    The checked output: {ok: true, data} or {ok: false, error}.
 */
async function callRole<T>(ctx: Ctx, run: Run, role: RoleCall): Promise<Checked<T>> {
  const { label, pick, prompt, schema, file, timeoutS, scratch } = role;
  appendFileSync(join(ctx.dir, "llm.log"), `${new Date().toISOString()} role ${label}\n`);
  const r = await ctx.llm(pick, prompt, { timeoutS, schema, ...(scratch ? { scratch } : {}) });
  const c = check<T>(schema, r.data, r.error);
  run.sessions[label] = toSession(pick, r, c.ok ? null : c.error);
  run.outputs[label] = file;
  writeFileSync(join(ctx.dir, file), JSON.stringify({ ...c, sessionId: r.sessionId, ms: r.ms, raw: r.text }, null, 2));
  return c;
}

/**
 * a. Construct: the constructor LLM runs setup.md and seeds the given. Sets run.setup and run.setupError (failed if a
 * given key is not reported seeded).
 *
 * @param ctx   The run context.
 * @param run   The run index; writes constructor.json.
 * @param given The run's CUJ given state; omitted if none.
 */
async function construct(ctx: Ctx, run: Run, given?: Given): Promise<void> {
  const c = await callRole<Setup>(ctx, run, {
    label: "constructor",
    pick: ctx.settings.constructor,
    prompt: constructorPrompt(ctx.read("setup.md"), ctx.scratch, given),
    schema: SETUP,
    file: "constructor.json",
  });
  run.setup = c.ok && c.data.ok ? "ok" : "failed";
  run.setupError = !c.ok ? c.error : c.data.ok ? null : c.data.notes || "constructor returned ok: false";
  const missing = unseeded(given, c.ok ? c.data.notes : "");
  if (run.setup === "ok" && missing.length) [run.setup, run.setupError] = ["failed", `given not seeded: ${missing}`];
}

/**
 * b. Execute one CUJ: the executor LLM follows its instruction, killed at timeout_s.
 *
 * @param ctx  The run context.
 * @param run  The run index.
 * @param path The CUJ file; its id names the output folder.
 * @param cuj  The loaded CUJ.
 * @returns    "done", or "error: <why>" if the executor gave no valid result. Writes <id>/executor.json.
 */
async function execute(ctx: Ctx, run: Run, path: string, cuj: Cuj): Promise<string> {
  const id = cujId(path);
  mkdirSync(join(ctx.dir, id));
  const opts = { setup: setupReport(ctx.dir), out: resolve(ctx.dir, id) };
  const c = await callRole<ExecutorResult>(ctx, run, {
    label: `${id}/executor`,
    pick: ctx.settings.executor,
    prompt: executorPrompt(ctx.read("howtorun.md"), cuj, resolve("."), opts),
    schema: EXECUTOR,
    file: join(id, "executor.json"),
    timeoutS: cuj.timeout_s,
    scratch: true,
  });
  return c.ok ? "done" : `error: ${c.error}`;
}

/**
 * c. Destruct: the destructor LLM runs teardown.md and cleans up.
 *
 * @param ctx The run context.
 * @param run The run index; writes destructor.json.
 */
async function destruct(ctx: Ctx, run: Run): Promise<void> {
  await callRole<Teardown>(ctx, run, {
    label: "destructor",
    pick: ctx.settings.destructor,
    prompt: destructorPrompt(ctx.read("teardown.md"), setupReport(ctx.dir), ctx.scratch),
    schema: TEARDOWN,
    file: "destructor.json",
  });
}

/**
 * Run one subject end to end: construct, execute each CUJ, then destruct (always) and judge each CUJ that ran, all at once.
 * A failed setup skips every CUJ: no executor and no judge is called. run.json and report.html are rewritten after each
 * step, and once more at the end, even if a step threw.
 *
 * @param ctx     The run context; ctx.dir must exist.
 * @param subject Subject folder name, recorded in run.json.
 * @param cujs    [path, cuj] pairs to execute, in order; all with one given, or none (else it throws before setup).
 * @returns       The final run.json contents.
 */
export async function runSubject(ctx: Ctx, subject: string, cujs: (readonly [string, Cuj])[]): Promise<Run> {
  const given = sharedGiven(cujs);
  const run: Run = {
    subject,
    settings: ctx.settings,
    claudeVersion: ctx.claudeVersion ?? null,
    started: new Date().toISOString(),
    finished: null,
    setup: "",
    setupError: null,
    defs: Object.fromEntries(
      cujs.map(([path, c]) => [cujId(path), { path, instruction: c.instruction.trim(), timeout_s: c.timeout_s }]),
    ),
    cujs: {},
    scores: {},
    sessions: {},
    outputs: {},
  };
  // report.html is rewritten with run.json so it can be watched mid-run; it auto-refreshes until finished.
  const save = () => {
    writeFileSync(join(ctx.dir, "run.json"), JSON.stringify(run, null, 2));
    writeReport(ctx.dir);
  };
  const judge = async (path: string, cuj: Cuj) => {
    const id = cujId(path);
    appendFileSync(join(ctx.dir, "llm.log"), `${new Date().toISOString()} role ${id}/judges\n`);
    const { score, sessions, error } = await judgeCuj(ctx.llm, ctx.settings, join(ctx.dir, id), cuj);
    run.scores[id] = score;
    if (error) run.cujs[id] = `error: ${error}`;
    for (const [k, s] of Object.entries(sessions)) {
      run.sessions[`${id}/${k}`] = s;
      run.outputs[`${id}/${k}`] = join(id, `${k}.json`);
    }
    save();
  };
  const beat = setInterval(() => ((run.heartbeat = new Date().toISOString()), save()), 10_000).unref();
  try {
    await construct(ctx, run, given);
    save();
    let crash: { e: unknown } | null = null;
    try {
      for (const [path, cuj] of cujs) {
        run.cujs[cujId(path)] = run.setup === "ok" ? await execute(ctx, run, path, cuj) : SKIPPED;
        save();
      }
    } catch (e) {
      crash = { e };
    }
    // c ∥ d. Teardown (always, even if a CUJ threw) and every judge of a CUJ that ran start together: judges read
    // only the CUJ outputs saved in the run dir, never the subject. Each result is saved as it lands.
    const judges = (crash ? [] : cujs).filter(([p]) => run.cujs[cujId(p)] !== SKIPPED).map(([p, c]) => judge(p, c));
    const done = await Promise.allSettled([destruct(ctx, run).finally(save), ...judges]);
    const bad = done.find((r) => r.status === "rejected");
    if (crash) throw crash.e; // only after teardown and every result is in
    if (bad) throw bad.reason;
    return run;
  } finally {
    clearInterval(beat);
    run.finished = new Date().toISOString();
    save();
  }
}

/**
 * One run: make .runs/<runid>/ and its scratch folder, run the subject on `cujs`, print the run folder, statuses
 * and report path.
 *
 * @param subject  Subject folder, e.g. "subjects/toy".
 * @param settings Models per role.
 * @param cujs     [path, cuj] pairs for this run, in order.
 * @returns        The final run.json contents.
 */
async function runOnce(subject: string, settings: Settings, cujs: (readonly [string, Cuj])[]): Promise<Run> {
  const dir = join(".runs", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(dir, { recursive: true });
  console.log(`run dir: ${dir} (tail -f ${join(dir, "llm.log")} to follow)`);
  const read = (f: string) => readFileSync(join(subject, f), "utf8");
  const logPath = join(dir, "llm.log"); // CLI stderr (and stdout on failure) plus a start/end line per call, for tail -f
  const log = (line: string) => appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
  log(`run started: ${subject}, ${cujs.length} CUJ(s)`);
  const logged: Ctx["llm"] = async (m, p, o) => {
    log(`start ${m.model}/${m.effort}`);
    const r = await llm(m, p, { ...o, logPath });
    log(`end ${m.model}/${m.effort} ${r.ms}ms${r.error ? ` error: ${r.error}` : ""}`);
    return r;
  };
  const scratch = scratchFor(dir);
  makeScratch(scratch);
  const ctx = { settings, dir, read, claudeVersion: claudeVersion(), llm: logged, scratch };
  const run = await runSubject(ctx, subject, cujs).finally(() => dropScratch(scratch));
  const { setup, setupError, cujs: status, scores } = run;
  console.log(`${JSON.stringify({ setup, setupError, status, scores }, null, 2)}\n${reportUrl(dir)}`);
  return run;
}

/**
 * The program: parse args (init and compare go to init.ts and compare.ts), load config and CUJs, then one run (one per CUJ for a folder: runGroups), all `runs` times.
 * Holds the run lock (<tmp>/michelin-<user>/run.lock, or $MICHELIN_TMP/run.lock) for all of it, waiting for any other live run first (runlock.ts).
 * Ends with a PASS/FAIL line per CUJ and the total; exits 1 if any setup failed.
 */
async function main() {
  const args = parseCli(process.argv.slice(2));
  if (!args) return console.log(USAGE);
  if (args.command === "init") return void init(process.cwd(), PKG_ROOT);
  if (args.command === "compare") return void (await (await import("./compare.ts")).compareMain(args, llm));
  const settingsPath = args.settingsPath && resolveArg(args.settingsPath);
  const { settings, runs: times, ...file } = loadConfig({ ...args, settingsPath, cwd: process.cwd() });
  const [subject, ...picked] = pickTargets(args, file).map((p) => resolveArg(p)); // or under MICHELIN_SUBJECTS
  const files = expandCujs(picked);
  checkUniqueIds(files);
  const loaded = files.map((p) => [p, loadCuj(p)] as const);
  const groups = runGroups(picked, loaded);
  for (const g of groups) sharedGiven(g); // refuse mixed givens before any setup
  const runs: Run[] = [];
  const release = await acquireRunLock(); // one run at a time: setup picks ports by scanning, which races (runlock.ts)
  try {
    for (let i = 0; i < times; i++) for (const group of groups) runs.push(await runOnce(subject, settings, group));
  } finally {
    release();
  }
  console.log(summary(runs));
  process.exitCode = Math.max(...runs.map(exitCode));
}

/** The program with its exit codes (runMain): 2 on a usage error, 1 on any other. bin/michelin.js calls it. */
export const cli = () => runMain(main);
if (import.meta.main) cli(); // only when run as a program: tests import the helpers
