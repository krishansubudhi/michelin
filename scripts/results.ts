// The public results page: checks every results/*.json against results/suites.json, then builds site/index.html
// into a static folder with the leaderboard filled in. Format: results/README.md.
// Check only: node scripts/results.ts --check     Build: node scripts/results.ts --out _site
// Tests: test/results.test.ts
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

/** A fixed set of CUJs that every row of one leaderboard runs in full; `controls` must fail. */
export type Suite = {
  title: string;
  about: string;
  subject: string;
  setup: string;
  cujs: string[];
  controls: string[];
};
/** One CUJ in a results file: runs, how many passed, agent seconds per run, agent cost in USD or null. */
export type Task = {
  cuj: string;
  runs: number;
  passed: number;
  agent_s: number[];
  cost_usd: number | null;
  note?: string;
};
type Text =
  "suite" | "agent" | "AGENT" | "AGENT_MODEL" | "agent_version" | "model" | "date" | "submitted_by" | "reproduce";
/** One results file: one agent and model on one suite. */
export type Result = Record<Text, string> & { evidence: string[]; notes?: string; tasks: Task[] };

const REPO = "https://github.com/krishansubudhi/michelin";
const TEXT: Text[] = [
  "suite",
  "agent",
  "AGENT",
  "AGENT_MODEL",
  "agent_version",
  "model",
  "date",
  "submitted_by",
  "reproduce",
];
const na = (x: number | null, f: (x: number) => string) => (x === null ? "n/a" : f(x));

/** Lists what is wrong with a task, e.g. {cuj, runs: 1, passed: 1, agent_s: [8.1], cost_usd: 0.04}. @param t the task @param control it must fail @returns problems; [] when valid */
export function taskErrors(t: Task, control: boolean): string[] {
  const secs = Array.isArray(t.agent_s) ? t.agent_s : [-1];
  const checks: [boolean, string][] = [
    [Number.isInteger(t.runs) && t.runs >= 1, "runs: a whole number of at least 1"],
    [Number.isInteger(t.passed) && t.passed >= 0 && t.passed <= t.runs, "passed: 0 to runs"],
    [secs.every((s) => typeof s === "number" && s >= 0) && [0, t.runs].includes(secs.length), "agent_s: [] or per run"],
    [t.cost_usd === null || (typeof t.cost_usd === "number" && t.cost_usd >= 0), "cost_usd: a number of USD, or null"],
    [!control || t.passed === 0, "passed: a must-fail control passed, so the judges are not reading evidence"],
  ];
  return checks.filter(([ok]) => !ok).map(([, why]) => `tasks[${t.cuj}].${why}`);
}

/** Lists what is wrong with one results file. @param x the parsed JSON @param suites suites.json by id @returns problems naming a field; [] when valid */
export function resultErrors(x: Result, suites: Record<string, Suite>): string[] {
  const errs = TEXT.filter((k) => typeof x[k] !== "string" || !x[k].trim()).map((k) => `${k}: a non-empty string`);
  if ((x as { format?: string }).format !== "michelin-results/1") errs.push(`format: "michelin-results/1"`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(x.date))) errs.push("date: YYYY-MM-DD");
  if (!Array.isArray(x.evidence) || !x.evidence.length) errs.push("evidence: a list of at least one link or path");
  const suite = suites[x.suite];
  if (!suite) return [...errs, `suite: one of ${Object.keys(suites).join(", ")}`];
  if (!Array.isArray(x.tasks)) return [...errs, "tasks: a list"];
  const got = x.tasks.map((t) => t.cuj);
  const missing = suite.cujs.filter((c) => !got.includes(c));
  const extra = got.filter((c, i) => !suite.cujs.includes(c) || got.indexOf(c) !== i);
  if (missing.length) errs.push(`tasks: missing ${missing.join(", ")} (rows need the suite's full CUJ set)`);
  if (extra.length) errs.push(`tasks: unknown or repeated ${extra.join(", ")}`);
  return [...errs, ...x.tasks.flatMap((t) => taskErrors(t, suite.controls.includes(t.cuj)))];
}

/** Sums a row, controls left out of passed/runs and median seconds. @param r the row @param suite its suite @returns e.g. {passed: 10, runs: 11, median: 7.9, cost: 0.47}, null when unreported */
export function summarize(r: Result, suite: Suite) {
  const ts = r.tasks.filter((t) => !suite.controls.includes(t.cuj));
  const secs = ts.flatMap((t) => t.agent_s).sort((a, b) => a - b);
  const mid = secs.length >> 1;
  const median = secs.length ? (secs.length % 2 ? secs[mid] : (secs[mid - 1] + secs[mid]) / 2) : null;
  const costs = r.tasks.map((t) => t.cost_usd).filter((c): c is number => c !== null);
  const cost = costs.length ? costs.reduce((a, b) => a + b, 0) : null;
  return { passed: ts.reduce((a, t) => a + t.passed, 0), runs: ts.reduce((a, t) => a + t.runs, 0), median, cost };
}

/** Escapes text for HTML. @param s e.g. `a < "b"` @returns text safe in an element or a quoted attribute */
export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** One per-CUJ line of a detail table. @param t the task @param control it must fail @returns a <tr> */
function taskRow(t: Task, control: boolean): string {
  const ok = control ? t.passed === 0 : t.passed === t.runs;
  const word = control ? "failed, as it must" : t.runs > 1 ? `${t.passed}/${t.runs}` : ok ? "pass" : "FAIL";
  const secs = t.agent_s.length ? t.agent_s.map((s) => s.toFixed(1)).join(", ") + " s" : "n/a";
  const note = t.note ? `<div class="note">${esc(t.note)}</div>` : "";
  const cost = na(t.cost_usd, (c) => `$${c.toFixed(3)}`);
  return `<tr><td>${esc(t.cuj)}${note}</td><td class="${ok ? "ok" : "bad"}">${word}</td><td>${secs}</td><td>${cost}</td></tr>`;
}

/** A row's hidden detail: per-CUJ results, reproduce command, evidence. @param r the row @param suite its suite */
function detailRow(r: Result, suite: Suite): string {
  const link = (e: string) => `<a href="${esc(e.startsWith("http") ? e : `${REPO}/blob/main/${e}`)}">${esc(e)}</a>`;
  const tasks = r.tasks.map((t) => taskRow(t, suite.controls.includes(t.cuj))).join("");
  return `<tr class="detail" hidden><td colspan="6">${r.notes ? `<p>${esc(r.notes)}</p>` : ""}<table class="tasks">
<thead><tr><th>CUJ</th><th>Result</th><th>Agent time</th><th>Agent cost</th></tr></thead><tbody>${tasks}</tbody></table>
<p>Reproduce:</p><pre><code>${esc(suite.setup)}\n${esc(r.reproduce)}</code></pre>
<p>Evidence: ${r.evidence.map(link).join(" · ")} · submitted by ${esc(r.submitted_by)}</p></td></tr>`;
}

/** One suite's sortable leaderboard, best pass rate first. @param id e.g. "coding-agents" @param suite the suite @param rows its rows @returns a <section> */
export function renderSuite(id: string, suite: Suite, rows: Result[]): string {
  const rate = (s: { passed: number; runs: number }) => s.passed / s.runs;
  const ranked = rows.map((r) => ({ r, s: summarize(r, suite) })).sort((a, b) => rate(b.s) - rate(a.s));
  const body = ranked.map(({ r, s }, i) => {
    const pct = `<b>${s.passed}/${s.runs}</b> <span class="pct">${Math.round(rate(s) * 100)}%</span>`;
    return `<tbody data-rate="${rate(s)}" data-time="${s.median ?? ""}" data-cost="${s.cost ?? ""}" id="${id}-${i + 1}">
<tr><td><button class="open" aria-expanded="false">${esc(r.agent)} <span class="v">${esc(r.agent_version)}</span></button>
<div class="m">${esc(r.model)}</div><div class="env">AGENT=${esc(r.AGENT)} AGENT_MODEL=${esc(r.AGENT_MODEL)}</div></td><td class="model">${esc(r.model)}</td><td>${pct}</td><td>${na(s.median, (m) => `${m.toFixed(1)} s`)}</td>
<td>${na(s.cost, (c) => `$${c.toFixed(2)}`)}</td><td class="date">${esc(r.date)}</td></tr>${detailRow(r, suite)}</tbody>`;
  });
  return `<section class="suite" id="${id}"><h3>${esc(suite.title)}</h3><p>${esc(suite.about)}
<a href="${REPO}/tree/main/${esc(suite.subject)}">CUJs</a>.</p><div class="scroll"><table class="board"><thead><tr>
<th>Agent</th><th class="model">Model</th><th data-sort="rate">Passed</th><th data-sort="time">Median time</th>
<th data-sort="cost">Agent cost</th><th class="date">Date</th></tr></thead>${body.join("")}</table></div></section>`;
}

/** Reads, checks and groups every results file. @param dir e.g. "results" @returns suites and valid rows by suite id @throws Error listing every problem by file */
export function load(dir: string): { suites: Record<string, Suite>; rows: Record<string, Result[]> } {
  const suites = JSON.parse(readFileSync(join(dir, "suites.json"), "utf8")) as Record<string, Suite>;
  const rows: Record<string, Result[]> = {};
  const errs: string[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "suites.json")) {
    let r: Result | string;
    try {
      r = JSON.parse(readFileSync(join(dir, f), "utf8")) as Result;
    } catch (e) {
      r = `not JSON (${(e as Error).message})`;
    }
    const bad = typeof r === "string" ? [r] : resultErrors(r, suites);
    if (!bad.length && typeof r !== "string") (rows[r.suite] ??= []).push(r);
    errs.push(...bad.map((b) => `${f}: ${b}`));
  }
  if (errs.length) throw new Error(errs.join("\n"));
  return { suites, rows };
}

/** CLI: check the results folder; with --out DIR also write index.html and results.json there. */
function main() {
  const opts = { check: { type: "boolean" }, out: { type: "string" }, help: { type: "boolean" } } as const;
  const { values } = parseArgs({ options: opts });
  if (values.help || (!values.check && !values.out))
    return console.log("usage: node scripts/results.ts --check | --out DIR");
  const { suites, rows } = load("results");
  console.log(`results: ${Object.values(rows).flat().length} valid files in ${Object.keys(rows).length} suites`);
  if (!values.out) return;
  const boards = Object.keys(suites).filter((id) => rows[id]);
  const html = boards.map((id) => renderSuite(id, suites[id], rows[id])).join("\n");
  mkdirSync(values.out, { recursive: true });
  writeFileSync(
    join(values.out, "index.html"),
    readFileSync("site/index.html", "utf8").replace("<!--LEADERBOARD-->", html),
  );
  writeFileSync(join(values.out, "results.json"), JSON.stringify(rows, null, 1));
}

if (import.meta.main) main();
