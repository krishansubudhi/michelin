// Recount: n and passes per agent, model and CUJ, from run.json files alone, so a results row can be checked against
// the runs behind it. The agent is run.json's `agent` (AGENT, AGENT_MODEL; runner.ts records it). A run made before
// that field existed counts only if a provenance.json beside its run.json names the agent per CUJ, with the trace that
// proves it; otherwise its CUJs count under "unverified".
// Run: node scripts/recount.ts .runs [more .runs folders] [--json]      Tests: test/recount.test.ts
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

/** The agent under test, as run.json or provenance.json names it. */
type Agent = { AGENT: string; AGENT_MODEL: string; AGENT_EFFORT?: string };
/** The parts of run.json a recount reads. */
export type RunLike = {
  agent?: Agent | null;
  defs?: Record<string, { path: string }>;
  scores?: Record<string, string>;
};
/** provenance.json: per CUJ id, the agent a trace outside run.json proves ran it, and that trace. */
export type Provenance = { cujs: Record<string, Agent & { evidence: string }> };
/** One recounted row: an agent and model on one CUJ, e.g. {agent: "agy", model: "gemini-4-neon-medium", cuj: "peculiar/dst_cron", n: 2, passed: 1}. */
export type Row = { agent: string; model: string; cuj: string; n: number; passed: number };

/**
 * The suite-style CUJ name of a run's CUJ. Pure.
 *
 * @param id   The CUJ id in run.json, e.g. "peculiar-dst_cron".
 * @param path Its file from run.json defs, e.g. "subjects/coding-agents/cujs/peculiar/dst_cron.yaml"; undefined if absent.
 * @returns    The folder and file name without .yaml, e.g. "peculiar/dst_cron"; the id if there is no path.
 */
export function cujName(id: string, path?: string): string {
  const parts = (path ?? "").replace(/\.ya?ml$/, "").split("/");
  return parts.length >= 2 ? parts.slice(-2).join("/") : id;
}

/**
 * Whether a run.json score is a full pass. Pure.
 *
 * @param score e.g. "passed 2/2", "passed 1/2" or "unjudged".
 * @returns     true only for "passed k/k" with k > 0.
 */
export function fullPass(score: string): boolean {
  const m = /^passed (\d+)\/(\d+)$/.exec(score);
  return !!m && m[1] === m[2] && Number(m[2]) > 0;
}

/**
 * The agent and model a row is grouped under. Pure.
 *
 * @param a The recorded agent, e.g. {AGENT: "claude", AGENT_MODEL: "claude-opus-5-5", AGENT_EFFORT: "medium"}; null if none.
 * @returns e.g. {agent: "claude", model: "claude-opus-5-5@medium"}; {agent: "unverified", model: ""} for null.
 */
function label(a: Agent | null): { agent: string; model: string } {
  if (!a) return { agent: "unverified", model: "" };
  return { agent: a.AGENT, model: a.AGENT_MODEL + (a.AGENT_EFFORT ? `@${a.AGENT_EFFORT}` : "") };
}

/**
 * Count runs and full passes per agent, model and CUJ. Pure.
 *
 * @param runs Each run's run.json and its provenance.json, if any.
 * @returns    Rows sorted by agent, model, CUJ; a CUJ with no recorded agent counts under agent "unverified", model "".
 */
export function recount(runs: { run: RunLike; provenance?: Provenance | null }[]): Row[] {
  const rows = new Map<string, Row>();
  for (const { run, provenance } of runs) {
    for (const [id, score] of Object.entries(run.scores ?? {})) {
      const row = { ...label(run.agent ?? provenance?.cujs[id] ?? null), cuj: cujName(id, run.defs?.[id]?.path) };
      const key = [row.agent, row.model, row.cuj].join("\t");
      const seen = rows.get(key) ?? { ...row, n: 0, passed: 0 };
      rows.set(key, { ...seen, n: seen.n + 1, passed: seen.passed + Number(fullPass(score)) });
    }
  }
  const order = (r: Row) => `${r.agent}\t${r.model}\t${r.cuj}`;
  return [...rows.values()].sort((x, y) => order(x).localeCompare(order(y)));
}

/**
 * Read every run.json (and provenance.json beside it) one level under each folder.
 *
 * @param dirs .runs folders, e.g. [".runs"].
 * @returns    The parsed pairs; unreadable or unparseable run.json files are skipped.
 */
function readRuns(dirs: string[]): { run: RunLike; provenance: Provenance | null }[] {
  const json = (p: string) => {
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  };
  return dirs.flatMap((d) =>
    readdirSync(d)
      .filter((r) => existsSync(join(d, r, "run.json")))
      .map((r) => ({ run: json(join(d, r, "run.json")) as RunLike, provenance: json(join(d, r, "provenance.json")) }))
      .filter((x) => x.run && typeof x.run === "object"),
  );
}

/** CLI: print one tab-separated line per row (agent, model, CUJ, n, passed), or --json. */
function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { json: { type: "boolean" }, help: { type: "boolean" } },
  });
  if (values.help || !positionals.length) {
    console.log("usage: node scripts/recount.ts <.runs folder>... [--json]");
    return;
  }
  const rows = recount(readRuns(positionals));
  if (values.json) console.log(JSON.stringify(rows, null, 1));
  else for (const r of rows) console.log([r.agent, r.model || "-", r.cuj, `n=${r.n}`, `passed=${r.passed}`].join("\t"));
}

if (import.meta.main) main();
