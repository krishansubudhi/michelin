// Measures: each run's program time, wall time and free-form metrics per CUJ, for `michelin compare`'s
// times-and-metrics table. Pure.
//
// A subject's howtorun.md may name any metric (cost, tokens, steps, ...); the executor records each as {name, value}
// in executor.json data.metrics. These are only tabled here, never shown to a judge (judge.ts readEvidence).
//
// Test: npm test (measures.test.ts and compare.test.ts, no LLM).

import type { Loose } from "../report/view.ts";
import type { Side } from "./compare.ts";

/** One run's times and metrics on one CUJ, e.g. {cuj: "toy-country", run: "gemma", ms: 4000, wall: 9000, metrics: {}}. */
export type Measure = { cuj: string; run: string; ms?: number; wall?: number; metrics: Record<string, string> };

/**
 * Milliseconds as seconds for a table. Pure.
 *
 * @param ms e.g. 41234, or undefined.
 * @returns  e.g. "41.2 s", or "?" when unknown.
 */
export const secs = (ms?: number) => (ms === undefined ? "?" : `${(ms / 1000).toFixed(1)} s`);

/**
 * A CUJ's wall time: the executor call's own measured time, the top-level ms of its executor.json. Pure.
 *
 * @param executor The parsed executor.json, e.g. {ok: true, ms: 61234, data: {...}}; undefined if unreadable.
 * @returns        The ms, e.g. 61234, or undefined when missing or not a non-negative number.
 */
export function wallMs(executor: Loose): number | undefined {
  const ms = executor?.ms;
  return typeof ms === "number" && Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

/**
 * A CUJ's free-form metrics: executor.json data.metrics as a name to value map; malformed entries are skipped. Pure.
 *
 * @param executor The parsed executor.json, e.g. {ok: true, data: {metrics: [{name: "tokens", value: "48210"}]}}.
 * @returns        e.g. {tokens: "48210"}, or {} when there are none.
 */
export function readMetrics(executor: Loose): Record<string, string> {
  const list = executor?.data?.metrics;
  if (!Array.isArray(list)) return {};
  const ok = list.filter((m) => typeof m?.name === "string" && m.name !== "" && typeof m?.value === "string");
  return Object.fromEntries(ok.map((m) => [m.name, m.value]));
}

/**
 * Every run's times and metrics, one per run per CUJ. Pure.
 *
 * @param sides The loaded runs, e.g. [{name: "gemma", cujs: {"toy-country": {ms: 4000, wall: 9000, metrics: {}}}}].
 * @returns     CUJs sorted, runs in side order within each, e.g. [{cuj: "toy-country", run: "gemma", ms: 4000, ...}].
 */
export function measures(sides: Side[]): Measure[] {
  const cujs = [...new Set(sides.flatMap((s) => Object.keys(s.cujs)))].sort();
  return cujs.flatMap((cuj) =>
    sides
      .filter((s) => cuj in s.cujs)
      .map((s) => {
        const { ms, wall, metrics } = s.cujs[cuj];
        return { cuj, run: s.name, ms, wall, metrics };
      }),
  );
}

/**
 * The distinct metric names across measures, in first-seen order. Pure.
 *
 * @param ms The measures, e.g. [{metrics: {tokens: "1"}}, {metrics: {cost: "2", tokens: "3"}}].
 * @returns  e.g. ["tokens", "cost"].
 */
export function metricNames(ms: Measure[]): string[] {
  return [...new Set(ms.flatMap((m) => Object.keys(m.metrics)))];
}

/**
 * A markdown table cell: | escaped, newlines flattened to spaces. Pure.
 *
 * @param v e.g. "a|b".
 * @returns e.g. "a\|b".
 */
const cell = (v: string) => v.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/**
 * The times-and-metrics table as markdown: program time, wall time, then one column per metric name. Pure.
 *
 * @param ms The measures, e.g. [{cuj: "toy-country", run: "gemma", ms: 4000, wall: 9000, metrics: {tokens: "123"}}].
 * @returns  e.g. "| CUJ | run | program time | wall time | tokens |" ... "| toy-country | gemma | 4.0 s | 9.0 s | 123 |";
 *           a missing metric is "?".
 */
export function metricsTable(ms: Measure[]): string {
  const names = metricNames(ms);
  const head = ["CUJ", "run", "program time", "wall time", ...names].map(cell);
  const line = (m: Measure) =>
    `| ${[m.cuj, m.run, secs(m.ms), secs(m.wall), ...names.map((n) => m.metrics[n] ?? "?")].map(cell).join(" | ")} |`;
  return [`| ${head.join(" | ")} |`, `|${" --- |".repeat(head.length)}`, ...ms.map(line)].join("\n");
}
