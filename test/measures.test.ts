// Tests for measures.ts: wall time and metrics read from executor.json, and the times-and-metrics table.
// Run: npm test (no LLM).

import { test } from "node:test";
import assert from "node:assert/strict";
import { measures, metricNames, metricsTable, readMetrics, secs, wallMs, type Measure } from "../src/run/measures.ts";
import type { Side } from "../src/run/compare.ts";

test("wallMs: the executor.json top-level ms, else undefined", () => {
  assert.equal(wallMs({ ok: true, ms: 61234 }), 61234);
  for (const e of [undefined, {}, { ms: "5" }, { ms: -1 }]) assert.equal(wallMs(e), undefined);
});

test("readMetrics: data.metrics as a map; malformed entries skipped; none is {}", () => {
  const data = {
    metrics: [{ name: "tokens", value: "1" }, { name: "x" }, { value: "2" }, null, { name: "c", value: "$1" }],
  };
  assert.deepEqual(readMetrics({ ok: true, data }), { tokens: "1", c: "$1" });
  assert.deepEqual(readMetrics({ ok: false }), {});
  assert.deepEqual(readMetrics(undefined), {});
});

test("measures: CUJs sorted, runs in side order; metricsTable adds a column per metric in first-seen order", () => {
  const side = (name: string, cujs: Record<string, Partial<Side["cujs"][string]>>) =>
    ({ name, cujs }) as unknown as Side;
  const ms = measures([
    side("x", { b: { ms: 1000, metrics: { tokens: "5" } }, a: { metrics: {} } }),
    side("y", { a: { wall: 2500, metrics: { cost: "1|2", tokens: "7" } } }),
  ]);
  assert.deepEqual(
    ms.map((m: Measure) => [m.cuj, m.run]),
    [
      ["a", "x"],
      ["a", "y"],
      ["b", "x"],
    ],
  );
  assert.deepEqual(metricNames(ms), ["cost", "tokens"]);
  assert.deepEqual(metricsTable(ms).split("\n"), [
    "| CUJ | run | program time | wall time | cost | tokens |",
    "| --- | --- | --- | --- | --- | --- |",
    "| a | x | ? | ? | ? | ? |",
    "| a | y | ? | 2.5 s | 1\\|2 | 7 |",
    "| b | x | 1.0 s | ? | ? | 5 |",
  ]);
  assert.equal(secs(41234), "41.2 s");
});
