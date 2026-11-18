// Tests for report.ts: builds run folders in temp dirs and checks the rendered HTML.
//
// Run: npm test (or node --test test/report.test.ts). No LLM, no reads of test/fixtures/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { isBinary, loadRun, reportUrl, writeReport } from "../src/report/report.ts";
import { esc } from "../src/report/html.ts";
import { renderReport } from "../src/report/render.ts";

/**
 * Make a temp run folder holding the given files.
 *
 * @param files Map of relative path to content; objects are written as JSON, e.g. {"run.json": {...}}.
 * @returns     The folder path.
 */
function runDir(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "report-"));
  for (const [p, v] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), typeof v === "string" ? v : JSON.stringify(v));
  }
  return dir;
}

const pick = { model: "m", effort: "low" };
const settings = { constructor: pick, executor: pick, destructor: pick, judge: [pick] };

/**
 * A new-format run with one CUJ "c1".
 *
 * @param extra Files to add or override, e.g. {"notes/extra.xyz": "hi"}.
 * @returns     The folder path.
 */
function newRun(extra: Record<string, unknown> = {}): string {
  const vote = (pass: boolean) => ({ "m-low": { pass, why: `why ${pass}` } });
  return runDir({
    "run.json": {
      subject: "test/fixtures/subjects/x",
      settings,
      started: "2026-11-06T00:00:00Z",
      finished: "2026-11-06T00:01:00Z",
      setup: "ok",
      setupError: null,
      cujs: { c1: "done" },
      scores: { c1: "passed 2/3" },
      sessions: {
        constructor: { ...pick, sessionId: "abc-123", ms: 100, costUsd: 0.25, error: null },
        "c1/executor": { ...pick, sessionId: null, ms: 50, costUsd: 0.5, error: null },
      },
      outputs: {},
    },
    "constructor.json": {
      ok: true,
      data: { ok: true, steps: ["s1"], notes: "" },
      sessionId: "abc-123",
      ms: 100,
      raw: "RAWTEXT",
    },
    "c1/executor.json": {
      ok: true,
      data: { steps: [{ action: "run", input: "hi", got: "yo", ms: 5 }], reply: "<script>alert(1)</script>" },
      sessionId: null,
      ms: 50,
      raw: "",
    },
    "c1/verdict.json": [
      { expectation: "a", votes: vote(true), pass: true },
      { expectation: "b", votes: vote(true), pass: true },
      { expectation: "c", votes: vote(false), pass: false },
    ],
    ...extra,
  });
}

test("esc escapes HTML and a reply with a script tag is escaped in the report", () => {
  assert.equal(esc(`<script>&"'`), "&lt;script&gt;&amp;&quot;&#39;");
  const html = renderReport(loadRun(newRun()));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!html.includes("<script>alert(1)</script>"));
});

test("pass counts: 2 of 3 shows the pill and the summary", () => {
  const html = renderReport(loadRun(newRun()));
  assert.match(html, /class="pill bad">passed 2\/3</);
  assert.match(html, /<b>2\/3<\/b>/);
});

test("session ids render a resume hint, null renders a dash", () => {
  const html = renderReport(loadRun(newRun()));
  assert.ok(html.includes('<code class="copy" title="click to copy">claude --resume abc-123</code>'));
  assert.equal(html.match(/claude --resume/g)?.length, 1);
  assert.match(html, /<td>executor<\/td><td>m · low<\/td><td>50 ms<\/td><td>\$0\.5000<\/td><td>—<\/td>/);
});

test("an unknown file shows in a details block with its path", () => {
  const html = renderReport(loadRun(newRun({ "notes/extra.xyz": "mystery" })));
  assert.match(html, /<details><summary>notes\/extra\.xyz<\/summary><pre>mystery<\/pre><\/details>/);
});

test("binary files are never dumped as text: an image shows as <img>, other binary as a note", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  const dir = newRun();
  mkdirSync(join(dir, "c1"), { recursive: true });
  writeFileSync(join(dir, "c1/shot 1.png"), png);
  writeFileSync(join(dir, "blob.bin"), Buffer.from([1, 2, 0, 3, 0xff]));
  const html = renderReport(loadRun(dir));
  assert.match(html, /<summary>c1\/shot 1\.png<\/summary><img src="c1\/shot%201\.png" alt="c1\/shot 1\.png"/);
  assert.match(html, /<summary>blob\.bin<\/summary><p>binary file, 5 bytes, not shown<\/p>/);
  assert.ok(!html.includes("PNG\r\n"), "no PNG bytes in the page");
  assert.ok(isBinary(png) && !isBinary(Buffer.from("plain text ✓")));
});

test("a failed setup shows a banner with the error", () => {
  const dir = runDir({
    "run.json": {
      subject: "s",
      settings,
      setup: "failed",
      setupError: "harness <missing>",
      cujs: { c1: "skipped (setup failed)" },
      scores: {},
      sessions: {},
      outputs: {},
    },
  });
  const html = renderReport(loadRun(dir));
  assert.match(html, /Setup failed: harness &lt;missing&gt;/);
  assert.match(html, /pill na">skipped \(setup failed\)/);
});

test("text files land in the debug section", () => {
  const dir = runDir({
    "run.json": { subject: "s", settings, setup: "ok", cujs: { c1: "done" }, scores: { c1: "passed 1/1" } },
    "constructor.txt": "SETUP OK",
    "c1/judge-x.txt": "judge said",
    "c1/verdict.json": [{ expectation: "e", votes: { x: { pass: true, why: "w" } }, pass: true }],
  });
  const html = renderReport(loadRun(dir));
  assert.match(html, /passed 1\/1/);
  assert.match(html, /<summary>c1\/judge-x\.txt<\/summary>/);
});

test("writeReport on an empty or missing folder writes a page and doesn't throw", () => {
  const dir = mkdtempSync(join(tmpdir(), "report-"));
  writeReport(dir);
  assert.ok(readFileSync(join(dir, "report.html"), "utf8").startsWith("<!doctype html>"));
  writeReport(join(dir, "nope"));
  assert.ok(!existsSync(join(dir, "nope")));
});

test("CUJ card names the CUJ: id, file, timeout and instruction", () => {
  const dir = runDir({
    "run.json": {
      subject: "s",
      setup: "ok",
      cujs: { c1: "done" },
      scores: {},
      defs: { c1: { path: "s/cujs/c1.yaml", instruction: "Ask <name>", timeout_s: 60 } },
    },
  });
  writeReport(dir);
  const html = readFileSync(join(dir, "report.html"), "utf8");
  for (const t of [
    'CUJ <span class="cid">c1</span>',
    "s/cujs/c1.yaml · timeout 60 s",
    "<blockquote>Ask &lt;name&gt;</blockquote>",
  ])
    assert.ok(html.includes(t), t);
});

test("costs add up into a tile; a scratch session's resume hint changes folder first", () => {
  const dir = runDir({
    "run.json": {
      subject: "s",
      setup: "ok",
      cujs: { c1: "done" },
      scores: {},
      sessions: {
        "c1/judge-x": {
          model: "m",
          effort: "low",
          sessionId: "j-1",
          ms: 1,
          costUsd: 0.125,
          cwd: "/tmp/michelin-a",
          error: null,
        },
        constructor: { model: "m", effort: "low", sessionId: "c-1", ms: 1, costUsd: 0.25, error: null },
      },
    },
  });
  const html = renderReport(loadRun(dir));
  assert.match(html, /<b>\$0\.3750<\/b>total cost/);
  assert.ok(html.includes("cd /tmp/michelin-a &amp;&amp; claude --resume j-1"));
});

test("the report path is printed as a clickable file:// URL", () => {
  assert.equal(reportUrl("/a b/.runs/r1"), "file:///a%20b/.runs/r1/report.html");
  assert.match(reportUrl(".runs/r1"), /^file:\/\/\/.*\/\.runs\/r1\/report\.html$/);
});
