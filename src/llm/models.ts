// Models: every model runs through the Claude Code CLI (`claude -p`).
//
// settings.json names models by id, passed straight to `claude --model`; there is no allowlist, so a new
// model needs no code change. A wrong id fails at its first call with an error naming it. Other providers come back later.
// Every call asks for --output-format json with the role's --json-schema (schemas.ts), so a
// reply carries its typed data, the session id (`claude --resume <id>`) and its cost.
// Every call is near-hermetic: user settings only (--setting-sources user, for login env), no project/local settings and no MCP servers
// (--strict-mcp-config). Judges get no tools at all; executor and judges run in a fresh temp folder.
//
// Test: npm test (models.test.ts, no LLM).

import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Schema } from "./schemas.ts";

/** Reasoning effort: claude's --effort flag. */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];

/** One model at one reasoning effort: a settings.json entry, passed to llm() as one argument. */
export type Pick = { model: string; effort: Effort };

/** How one call may act, beyond its model and prompt. */
export type CallOpts = {
  /** The role's output schema (schemas.ts), passed as --json-schema; omit for free text. */
  schema?: Schema;
  /** Built-in tools it may use, passed as --tools: "" for none (judges), e.g. "Bash,Read"; omit for the default set. */
  tools?: string;
  /** Run in a fresh temp folder instead of the current one, so it can't wander into the repo by accident. */
  scratch?: boolean;
};

/**
 * The claude CLI command for one pick: the program, then its arguments.
 *
 * @param pick   Model and effort, e.g. {model: "claude-opus-5-5", effort: "high"}.
 * @param opts   schema and tools, e.g. {schema: JUDGE, tools: ""}.
 * @returns      ["claude", args], always hermetic (no settings files, no MCP) with --output-format json.
 */
export function command({ model, effort }: Pick, opts: CallOpts = {}): [string, string[]] {
  const args = [
    "-p",
    "--model",
    model,
    "--effort",
    effort,
    "--permission-mode",
    "bypassPermissions",
    "--setting-sources",
    "user",
    "--strict-mcp-config",
    "--output-format",
    "json",
  ];
  if (opts.tools !== undefined) args.push("--tools", opts.tools);
  if (opts.schema) args.push("--json-schema", JSON.stringify(opts.schema));
  return ["claude", args];
}

/**
 * The installed claude CLI's version, for run.json.
 *
 * @returns e.g. "2.1.318 (Claude Code)", or null if `claude --version` fails.
 */
export function claudeVersion(): string | null {
  try {
    return execFileSync("claude", ["--version"], { encoding: "utf8", timeout: 30_000 }).trim();
  } catch {
    return null;
  }
}

/** What one llm() call gave back. */
export type LlmResult = {
  /** The final reply text (claude's `result`), trimmed; "" if none. */
  text: string;
  /** The structured output (claude's `structured_output`); null if none came back. */
  data: unknown;
  /** The claude session id, for `claude --resume <id>`; null if the call never started. */
  sessionId: string | null;
  /** Wall time of the call in milliseconds. */
  ms: number;
  /** What the call cost in USD (claude's `total_cost_usd`); null if not reported. */
  costUsd: number | null;
  /** The folder it ran in, when that isn't the runner's (scratch); `claude --resume` must run there. */
  cwd?: string;
  /** Why the call failed, e.g. "timeout after 60s" or "exit 1"; null if it ran fine. */
  error: string | null;
};

/**
 * The error for a reply the CLI flagged is_error. Pure.
 *
 * @param subtype The reply's subtype, e.g. "error_max_turns"; an unknown model id comes back as "success".
 * @param text    The reply's result text, e.g. "There's an issue with the selected model (x)...".
 * @returns       e.g. "claude error: error_max_turns", or the result text when the subtype says nothing.
 */
const cliError = (subtype: unknown, text: string): string =>
  `claude error: ${subtype && subtype !== "success" ? String(subtype) : text || "unknown"}`;

/**
 * Read `claude -p --output-format json` stdout. Pure.
 *
 * @param stdout The CLI's stdout, e.g. '{"result":"hi","session_id":"abc","total_cost_usd":0.01,"structured_output":{...}}'.
 * @returns      text, data, sessionId, costUsd and error (null when the CLI reported success).
 */
export function parseCliOutput(stdout: string): Omit<LlmResult, "ms" | "cwd"> {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(stdout.trim());
  } catch {
    return { text: stdout.trim(), data: null, sessionId: null, costUsd: null, error: "stdout is not JSON" };
  }
  const text = typeof j.result === "string" ? j.result.trim() : "";
  const sessionId = typeof j.session_id === "string" ? j.session_id : null;
  const costUsd = typeof j.total_cost_usd === "number" && Number.isFinite(j.total_cost_usd) ? j.total_cost_usd : null;
  const data = j.structured_output ?? null;
  return {
    text,
    data,
    sessionId,
    costUsd,
    error: j.is_error ? cliError(j.subtype, text) : null,
  };
}

/** One finished LLM call, as run.json records it under "sessions". */
export type Session = {
  /** Model id, e.g. "claude-opus-5-5". */
  model: string;
  /** Effort it ran at. */
  effort: Effort;
  /** The claude session id; null if the call never started. */
  sessionId: string | null;
  /** Wall time in milliseconds. */
  ms: number;
  /** Cost in USD as the CLI reported it; null if it didn't. */
  costUsd: number | null;
  /** The folder it ran in, if not the runner's; resume it with `cd <cwd> && claude --resume <id>`. */
  cwd?: string;
  /** Why the call or its output was refused; null if it was valid. */
  error: string | null;
};

/**
 * The Session run.json records for one call. Pure.
 *
 * @param pick  The model and effort it ran at.
 * @param r     What the call gave back.
 * @param error Why its output was refused (the call's own error or a schema mismatch); null if valid.
 * @returns     {model, effort, sessionId, ms, costUsd, error}, plus cwd if it ran in a scratch folder.
 */
export const toSession = (pick: Pick, r: LlmResult, error: string | null): Session => ({
  ...pick,
  sessionId: r.sessionId,
  ms: r.ms,
  costUsd: r.costUsd ?? null,
  ...(r.cwd ? { cwd: r.cwd } : {}),
  error,
});

/** Runs one LLM: the real llm() in a run, a fake in tests. */
export type Llm = (pick: Pick, prompt: string, opts?: CallOpts & { timeoutS?: number }) => Promise<LlmResult>;

/** Options for one llm() call. */
export type LlmOpts = CallOpts & {
  /** Seconds before the subprocess is killed. Default 600. */
  timeoutS?: number;
  /** File that stderr (and stdout on failure) is appended to. Default "llm.log". */
  logPath?: string;
};

/**
 * Run one model via the claude CLI.
 *
 * @param pick   Model and effort from settings.json, e.g. {model: "claude-opus-5-5", effort: "high"}.
 * @param prompt The whole task; the model sees nothing else.
 * @param opts   Timeout, log file, output schema, tools and whether to run in a scratch folder.
 * @returns      The LlmResult. Never rejects: a timeout, spawn failure or non-zero exit sets error;
 *               a CLI-reported error (e.g. an unknown model) is prefixed with the model id and logged.
 */
/**
 * Why one call failed, from how its process ended. Pure.
 *
 * @param model The model id, e.g. "claude-opus-5-5"; it names a CLI-reported error, so a wrong id is plain.
 * @param end   How it ended: spawnError (e.g. "spawn failed: ENOENT"), killed by the timeout of timeoutS seconds,
 *              exit code, and cliError, the CLI's own error from parseCliOutput (e.g. an unknown model: exit 1).
 * @returns     null if it ran fine; e.g. "timeout after 60s", "exit 1, claude-x: claude error: There's an issue...".
 */
function callError(
  model: string,
  end: { spawnError: string | null; killed: boolean; timeoutS: number; code: number | null; cliError: string | null },
): string | null {
  if (end.spawnError) return end.spawnError;
  if (end.killed) return `timeout after ${end.timeoutS}s`;
  const named = end.cliError && `${model}: ${end.cliError}`;
  if (end.code !== 0) return named ? `exit ${end.code}, ${named}` : `exit ${end.code}`;
  return named;
}

/** Process groups of claude CLIs still running; killed if michelin exits first, so none outlives it. */
const live = new Set<number>();
process.on("exit", () => live.forEach(killGroup));

/** SIGKILL a whole process group: the claude CLI and everything it spawned (e.g. playwright-cli browsers). */
function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // the group is already gone
  }
}

export function llm(pick: Pick, prompt: string, opts: LlmOpts = {}): Promise<LlmResult> {
  const { timeoutS = 600, logPath = "llm.log" } = opts;
  const { model } = pick;
  const [bin, args] = command(pick, opts);
  // Kept after the call: claude stores the session under this folder, so `claude --resume` needs it.
  const cwd = opts.scratch ? mkdtempSync(join(tmpdir(), "michelin-")) : undefined;
  const t0 = Date.now();
  return new Promise((done) => {
    // The env var silences claude's "model isn't in this version's catalog" warning for 5.5 ids.
    const env = { ...process.env, CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: "1" };
    // The prompt goes over stdin, never argv: argv is world-readable in /proc and teardown-style sweeps match on it.
    // detached: the CLI leads its own process group, so a timeout can kill its children too.
    const p = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], env, cwd, detached: true });
    if (p.pid) live.add(p.pid);
    p.stdin.on("error", () => {}); // a CLI that dies before reading stdin is reported by "close", not here
    p.stdin.end(prompt);
    let out = "";
    let killed = false;
    let spawnError: string | null = null;
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => appendFileSync(logPath, `[${model}] ${d}`));
    p.on("error", (err) => {
      spawnError = `spawn failed: ${err.message}`;
      appendFileSync(logPath, `[${model}] ${spawnError}\n`);
    });
    const timer = setTimeout(() => {
      killed = true;
      if (p.pid) killGroup(p.pid);
    }, timeoutS * 1000);
    p.on("close", (code) => {
      clearTimeout(timer);
      if (p.pid) live.delete(p.pid);
      // CLIs print API errors to stdout and exit non-zero, so keep stdout when that happens.
      if (code !== 0) appendFileSync(logPath, `[${model}] exit ${code}: ${out}\n`);
      const r = parseCliOutput(out);
      const error = callError(model, { spawnError, killed, timeoutS, code, cliError: r.error });
      if (code === 0 && error) appendFileSync(logPath, `[${model}] ${error}\n`);
      done({ ...r, error, ms: Date.now() - t0, ...(cwd ? { cwd } : {}) });
    });
  });
}
