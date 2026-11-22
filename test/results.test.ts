// Tests for scripts/results.ts: the results-file check, the row summary and the leaderboard HTML.
// Run: node --test test/results.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { esc, load, renderSuite, resultErrors, summarize, type Result, type Suite } from "../scripts/results.ts";

const suite: Suite = {
  title: "T",
  about: "A",
  subject: "subjects/x",
  setup: "run() { :; }",
  cujs: ["a", "b", "ctl"],
  controls: ["ctl"],
};
const task = (cuj: string, passed: number, agent_s = [2], cost_usd: number | null = 0.1) => ({
  cuj,
  runs: 1,
  passed,
  agent_s,
  cost_usd,
});
const row = (over: Partial<Result> = {}): Result =>
  ({
    format: "michelin-results/1",
    suite: "t",
    agent: "Agent <x>",
    AGENT: "x",
    AGENT_MODEL: "m<1>",
    agent_version: "1",
    model: "M",
    date: "2026-11-20",
    submitted_by: "me",
    reproduce: "run",
    evidence: ["docs/x.md"],
    tasks: [task("a", 1, [1]), task("b", 0, [3]), task("ctl", 0, [9])],
    ...over,
  }) as Result;

test("a valid file has no errors", () => assert.deepEqual(resultErrors(row(), { t: suite }), []));

test("a file must cover the whole suite, once each", () => {
  const errs = resultErrors(row({ tasks: [task("a", 1), task("a", 1), task("ctl", 0)] }), { t: suite });
  assert.match(errs.join("\n"), /missing b/);
  assert.match(errs.join("\n"), /repeated a/);
});

test("a passing control, bad counts and bad fields are refused", () => {
  const bad = row({
    date: "20 Nov",
    suite: "t",
    tasks: [task("a", 2), { ...task("b", 0), agent_s: [1, 2] }, task("ctl", 1)],
  });
  const errs = resultErrors(bad, { t: suite }).join("\n");
  for (const want of [/date/, /tasks\[a\]\.passed/, /tasks\[b\]\.agent_s/, /must-fail control passed/])
    assert.match(errs, want);
  assert.match(resultErrors(row({ suite: "nope" }), { t: suite }).join(), /suite: one of t/);
});

test("summarize leaves controls out of the pass rate and time, but sums every cost", () =>
  assert.deepEqual(summarize(row(), suite), { passed: 1, runs: 2, median: 2, cost: 0.30000000000000004 }));

test("summarize reports null time and cost when none were measured", () => {
  const r = row({ tasks: [task("a", 1, [], null), task("b", 1, [], null), task("ctl", 0, [], null)] });
  assert.deepEqual(summarize(r, suite), { passed: 2, runs: 2, median: null, cost: null });
});

test("a row without the AGENT and AGENT_MODEL its runs record is refused", () => {
  assert.deepEqual(resultErrors(row({ AGENT: "", AGENT_MODEL: " " }), { t: suite }), [
    "AGENT: a non-empty string",
    "AGENT_MODEL: a non-empty string",
  ]);
});

test("renderSuite escapes text, shows each row's AGENT and AGENT_MODEL, and ranks the best pass rate first", () => {
  const best = row({ agent: "Best", tasks: [task("a", 1), task("b", 1), task("ctl", 0)] });
  const html = renderSuite("t", suite, [row(), best]);
  assert.ok(html.indexOf("Best") < html.indexOf("Agent &lt;x&gt;"));
  assert.match(html, /failed, as it must/);
  assert.match(html, /AGENT=x AGENT_MODEL=m&lt;1&gt;/);
  assert.equal(esc(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
});

test("every published results file passes the check", () => {
  const { rows } = load("results");
  assert.ok(Object.values(rows).flat().length >= 2);
});
