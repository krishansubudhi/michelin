// Tests for render.ts, no LLM: node --test test/render.test.ts  (or npm test)
// Whole-page rendering from run folders is covered in report.test.ts; these are the formatters, status and timeline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport, statusHtml } from "../src/report/render.ts";
import { esc, fmtMs, fmtUsd } from "../src/report/html.ts";
import { shortJudge } from "../src/report/cuj.ts";
import { TAILWIND_CSS } from "../src/report/tailwind.gen.ts";
import { compileCss } from "../scripts/build-css.ts";

test("formatters: milliseconds, dollars, HTML escaping", () => {
  assert.equal(fmtMs(120.4), "120 ms");
  assert.equal(fmtMs(1530), "1.5 s");
  assert.equal(fmtUsd(0.0123), "$0.0123");
  assert.equal(fmtUsd(null), "—");
  assert.equal(esc(`<b>&'"`), "&lt;b&gt;&amp;&#39;&quot;");
});

test("an empty view renders a page with no results and unknown cost", () => {
  const html = renderReport({
    dir: ".runs/x",
    run: {},
    constructor: null,
    destructor: null,
    sessions: {},
    cujs: [],
    raw: [],
    unknown: [],
  });
  assert.ok(html.startsWith("<!doctype html>"));
  assert.match(html, /<b>—<\/b>total cost/);
  assert.ok(!html.includes("<h2>Results</h2>"));
  assert.match(html, /http-equiv="refresh"/, "an unfinished run auto-refreshes");
});

test("a finished run's report stops refreshing", () => {
  const view = {
    dir: ".runs/x",
    run: { finished: "2026-11-10T00:00:00Z" },
    constructor: null,
    destructor: null,
    sessions: {},
    cujs: [],
    raw: [],
    unknown: [],
  };
  assert.ok(!renderReport(view).includes("http-equiv"));
});

test("run status pill: completed, running, not running", () => {
  const now = Date.parse("2026-11-10T00:01:00Z");
  assert.match(statusHtml({ finished: "2026-11-10T00:00:00Z" }, now), />completed</);
  assert.match(statusHtml({ started: "2026-11-10T00:00:00Z", heartbeat: "2026-11-10T00:00:50Z" }, now), />running</);
  assert.match(
    statusHtml({ started: "2026-11-10T00:00:00Z", heartbeat: "2026-11-10T00:00:10Z" }, now),
    />not running</,
  );
  assert.match(statusHtml({}, now), />not running</, "no start time at all");
});

/** A run view with two CUJs: setup done, c-one executed, c-two not yet, beat 5s before `now`. */
const now = Date.parse("2026-11-10T00:01:00Z");
const cuj = (id: string, status: string) => ({
  id,
  def: null,
  status,
  score: "",
  executor: null,
  outcomes: [],
  judges: {},
  sessions: [],
});
const liveView = () => ({
  dir: ".runs/x",
  run: {
    started: "2026-11-10T00:00:00Z",
    heartbeat: "2026-11-10T00:00:55Z",
    setup: "ok",
    defs: { "z-first": {}, "a-second": {} },
    cujs: { "z-first": "done" },
  },
  constructor: { ok: true as const, data: { ok: true, steps: ["s1"], notes: "" } },
  destructor: null,
  sessions: {},
  cujs: [cuj("a-second", ""), cuj("z-first", "done")],
  raw: [],
  unknown: [],
});

/** The <li class="node ..."> of a phase, e.g. node(html, "setup"). */
const node = (html: string, phase: string) =>
  html.match(new RegExp(`<li class="node [^"]*" data-phase="${phase}".*?</li>`))?.[0] ?? "";

test("timeline: one node per phase in run order", () => {
  const html = renderReport(liveView(), now);
  assert.match(html, /<ol class="timeline">/);
  const order = [...html.matchAll(/data-phase="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["setup", "cuj:z-first", "cuj:a-second", "teardown", "judges"], "defs order, not id order");
  assert.match(html, /@keyframes pulse/);
});

test("timeline: the running phase pulses, later ones are hollow, finished ones are solid", () => {
  const html = renderReport(liveView(), now);
  assert.match(node(html, "setup"), /class="node ok".*<span class="dot" aria-hidden="true"><\/span>/);
  assert.match(node(html, "cuj:a-second"), /class="node running".*class="dot pulse"/);
  assert.match(node(html, "teardown"), /class="node pending".*class="dot hollow"/);
  assert.equal(html.match(/dot pulse/g)?.length, 1, "only one node pulses");
});

test("timeline: a stale run pulses nothing; a finished run marks unreached phases skipped", () => {
  const stale = liveView();
  stale.run.heartbeat = "2026-11-10T00:00:01Z";
  assert.ok(!renderReport(stale, now).includes("dot pulse"));
  const done = liveView();
  Object.assign(done.run, { finished: "2026-11-10T00:02:00Z" });
  const html = renderReport(done, now);
  assert.ok(!html.includes("dot pulse") && !html.includes("dot hollow"));
  assert.match(node(html, "teardown"), /class="node skipped"/);
});

test("styling: Tailwind CSS is inlined; the page loads no external stylesheet or script", () => {
  const html = renderReport(liveView(), now);
  assert.match(html, /<style>\/\*! tailwindcss v4[^<]*MIT License/, "the precompiled tailwind build, banner included");
  assert.ok(!/<link\b/i.test(html), "no <link> tags");
  assert.ok(!/<script[^>]+src=/i.test(html), "no external scripts");
  assert.ok(!/(src|href)=["']?(https?:)?\/\//i.test(html), "no remote URLs");
  assert.match(html, /prefers-color-scheme:\s?dark/, "dark mode");
  assert.match(html, /prefers-reduced-motion/, "reduced motion respected");
  assert.match(html, /<main class="page">/);
});

test("verdicts: each judge's pass/fail and reason sit under its numbered expectation", () => {
  const view = liveView();
  const vote = (pass: boolean, why: string) => ({ pass, why });
  Object.assign(view.cujs[1], {
    outcomes: [
      {
        expectation: "says hi",
        pass: true,
        votes: { "claude-opus-5-5-high": vote(true, "greets"), "claude-sonnet-5-5-medium": vote(true, "waves") },
      },
      {
        expectation: "is brief",
        pass: false,
        votes: { "claude-opus-5-5-high": vote(false, "rambles"), "claude-sonnet-5-5-medium": null },
      },
    ],
  });
  const html = renderReport(view, now);
  assert.ok(html.includes('<abbr class="jn" title="claude-opus-5-5-high">opus·high</abbr>'));
  assert.ok(html.includes('<abbr class="jn" title="claude-sonnet-5-5-medium">sonnet·med</abbr>'));
  const at = (s: string) => html.indexOf(s);
  const one = at('<span class="n">1.</span> <span class="et">says hi</span> <span class="pill ok">pass</span>');
  const two = at('<span class="n">2.</span> <span class="et">is brief</span> <span class="pill bad">fail</span>');
  assert.ok(one > 0 && two > one, "expectations numbered in CUJ order, each with its majority pass/fail");
  for (const why of ["greets", "waves"]) assert.ok(at(why) > one && at(why) < two, `${why} sits under expectation 1`);
  assert.ok(at("rambles") > two, "rambles sits under expectation 2");
  assert.match(
    html,
    /sonnet·med<\/abbr> <span class="pill na">none<\/span><\/span><\/li>/,
    "a missing vote reads none",
  );
  assert.ok(!html.includes("Judge reasons"), "no second, detached list of reasons");
  assert.match(html, /class="tiles"/);
  assert.match(html, /1 of 2 passed|1\/2/);
});

test("shortJudge: family and effort, unknown names unchanged", () => {
  assert.equal(shortJudge("claude-opus-5-5-high"), "opus·high");
  assert.equal(shortJudge("claude-opus-5-5-medium"), "opus·med");
  assert.equal(shortJudge("claude-haiku-5-5"), "haiku");
  assert.equal(shortJudge("gpt-x"), "gpt-x");
});

test("styling: src/report/tailwind.gen.ts is up to date with src/report/report*.css (else run npm run css)", () => {
  assert.equal(TAILWIND_CSS, compileCss());
});
