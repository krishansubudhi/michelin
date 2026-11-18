// Tests for judge.ts: prompt, parsing, majority vote, and judgeCuj with a fake LLM.
// Run: npm test (no LLM).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { judgePrompt, checkJudge, tally, judgeCuj, escalate, readBaseline, readEvidence } from "../src/llm/judge.ts";
import { JUDGE, type Vote } from "../src/llm/schemas.ts";

const yes: Vote = { pass: true, why: "a" };
const no: Vote = { pass: false, why: "b" };
const verdicts = (...p: boolean[]) => ({ verdicts: p.map((pass) => ({ pass, why: "w" })) });
/** A fake LlmResult carrying `data` as the structured output. */
const res = (data: unknown) => ({ text: "raw", data, sessionId: "sid", ms: 1, costUsd: 0.02, error: null });

test("judgePrompt numbers the expectations and includes the journey and reply", () => {
  const p = judgePrompt(["Says USA.\n", "Fast."], '{"input":"q"}', "done");
  assert.match(p, /1\. Says USA\.\n2\. Fast\./);
  assert.match(p, /\{"input":"q"\}[\s\S]*done[\s\S]*exactly 2/);
  assert.match(judgePrompt(["x"], "", ""), /\(empty: nothing was logged\)[\s\S]*\(empty\)/);
  assert.match(
    judgePrompt(["x"], "", "", { clock: "07:10" }),
    /What was true[\s\S]*07:10[\s\S]*not evidence[\s\S]*Journey/,
  );
  assert.ok(!judgePrompt(["x"], "", "").includes("What was true"));
});

test("checkJudge accepts a valid JudgeResult with the right count", () => {
  assert.deepEqual(checkJudge(verdicts(true, false), null, 2), { ok: true, data: verdicts(true, false) });
});

test("checkJudge turns a malformed result into an error", () => {
  const bad: [unknown, string | null, RegExp][] = [
    [null, null, /no structured output/],
    [verdicts(true), null, /expected 2 verdicts, got 1/],
    [
      {
        verdicts: [
          { pass: "yes", why: "w" },
          { pass: true, why: "w" },
        ],
      },
      null,
      /\$\.verdicts\[0\]\.pass: expected boolean/,
    ],
    [{ verdicts: [], extra: 1 }, null, /unexpected field/],
    [verdicts(true, true), "timeout after 300s", /timeout/],
  ];
  for (const [data, error, re] of bad) {
    const c = checkJudge(data, error, 2);
    assert.ok(!c.ok && re.test(c.error), JSON.stringify(c));
  }
});

test("tally: majority of usable votes; a tie fails; no usable votes is null", () => {
  const [a, b, c] = tally(["e1", "e2", "e3"], {
    A: [yes, yes, yes],
    B: [yes, no, no],
    C: [no, no, null as never],
    D: null,
  });
  assert.equal(a.pass, true); // 2 of 3
  assert.equal(b.pass, false); // 1 of 3
  assert.equal(c.pass, false); // 1 yes, 1 no (C has no vote), tie fails
  assert.equal(a.votes.D, null);
  assert.equal(tally(["e"], { A: null }).at(0)?.pass, null);
});

test("judgeCuj with all runs every judge on executor.json, writes their checked results, verdict.json and sessions", async () => {
  const out = mkdtempSync(join(tmpdir(), "judge-"));
  writeFileSync(
    join(out, "executor.json"),
    JSON.stringify({
      ok: true,
      data: { steps: [{ action: "run", input: "q", got: "USA", ms: 1 }], reply: "asked it" },
    }),
  );
  const seen: string[] = [];
  const llm = async ({ model: m }: { model: string }, p: string) => {
    seen.push(m);
    assert.match(p, /USA[\s\S]*asked it/);
    return res(m === "B" ? { verdicts: "garbage" } : verdicts(true, m === "A"));
  };
  const { score, sessions } = await judgeCuj(
    llm,
    { judge: ["A", "B", "C"].map((model) => ({ model, effort: "high" as const })), judging: { all: true } },
    out,
    { expectations: ["Says USA.", "Fast."] },
  );
  assert.equal(score, "passed 1/2");
  assert.deepEqual(seen.sort(), ["A", "B", "C"]);
  const b = JSON.parse(readFileSync(join(out, "judge-B-high.json"), "utf8"));
  assert.equal(b.ok, false);
  assert.equal(b.raw, "raw");
  assert.match(sessions["judge-B-high"].error ?? "", /expected array/);
  assert.equal(sessions["judge-A-high"].sessionId, "sid");
  const v = JSON.parse(readFileSync(join(out, "verdict.json"), "utf8"));
  assert.equal(v[1].pass, false); // A yes, C no: tie fails
  assert.equal(v[0].votes["B-high"], null);
});

test("judgeCuj with no valid judge result is unjudged; a missing executor.json is fine", async () => {
  const out = mkdtempSync(join(tmpdir(), "judge-"));
  const { score } = await judgeCuj(async () => res(null), { judge: [{ model: "A", effort: "high" }] }, out, {
    expectations: ["x"],
  });
  assert.equal(score, "unjudged");
});

test("judges run with no tools in a scratch folder, and their cost is recorded", async () => {
  const out = mkdtempSync(join(tmpdir(), "judge-"));
  let seen: unknown;
  const { sessions } = await judgeCuj(
    async (_p, _q, o) => ((seen = o), res(verdicts(true))),
    { judge: [{ model: "A", effort: "high" }] },
    out,
    { expectations: ["x"] },
  );
  assert.deepEqual(seen, { timeoutS: 300, schema: JUDGE, tools: "", scratch: true });
  assert.equal(sessions["judge-A-high"].costUsd, 0.02);
});

test("a garbled executor.json errors the CUJ without calling a judge", async () => {
  const out = mkdtempSync(join(tmpdir(), "judge-"));
  writeFileSync(join(out, "executor.json"), "{not json");
  let called = false;
  const r = await judgeCuj(
    async () => ((called = true), res(verdicts(true))),
    { judge: [{ model: "A", effort: "high" }] },
    out,
    {
      expectations: ["x"],
    },
  );
  assert.equal(called, false);
  assert.equal(r.score, "unjudged");
  assert.match(r.error ?? "", /executor\.json is not valid JSON/);
  assert.deepEqual(r.sessions, {});
});

test("readEvidence never shows a judge the executor's metrics", () => {
  const out = mkdtempSync(join(tmpdir(), "judge-"));
  const data = {
    steps: [{ action: "run", input: "q", got: "a", ms: 1 }],
    reply: "r",
    metrics: [{ name: "tokens", value: "98765" }],
  };
  writeFileSync(join(out, "executor.json"), JSON.stringify({ ok: true, ms: 5, data }));
  const ev = readEvidence(out);
  assert.equal(ev.error, undefined);
  assert.match(JSON.stringify(ev), /"journey":.*"reply":"r"/);
  assert.doesNotMatch(JSON.stringify(ev), /tokens|98765/);
});

test("escalate: on a missing result, any fail, or a flip from a known baseline verdict", () => {
  assert.equal(escalate(null), true);
  assert.equal(escalate([yes, yes]), false);
  assert.equal(escalate([yes, no]), true);
  assert.equal(escalate([yes, yes], [true, null]), false, "null baseline: nothing to differ from");
  assert.equal(escalate([yes, yes], [true, false]), true, "passes what the baseline failed");
});

/** A CUJ run folder holding a one-step executor.json. */
const runFolder = () => {
  const out = mkdtempSync(join(tmpdir(), "judge-"));
  const data = { steps: [{ action: "run", input: "q", got: "a", ms: 1 }], reply: "r" };
  writeFileSync(join(out, "executor.json"), JSON.stringify({ ok: true, data }));
  return out;
};
const ABC = { judge: ["A", "B", "C"].map((model) => ({ model, effort: "high" as const })) };

test("judgeCuj: a passing first judge scores alone; the others never run", async () => {
  const out = runFolder();
  const seen: string[] = [];
  const llm = async ({ model: m }: { model: string }) => (seen.push(m), res(verdicts(true, true)));
  const { score, sessions } = await judgeCuj(llm, ABC, out, { expectations: ["e1", "e2"] });
  assert.equal(score, "passed 2/2");
  assert.deepEqual(seen, ["A"]);
  assert.deepEqual(Object.keys(sessions), ["judge-A-high"]);
  assert.ok(!existsSync(join(out, "judge-B-high.json")));
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(out, "verdict.json"), "utf8"))[0].votes), ["A-high"]);
});

test("judgeCuj: a failing first judge brings in the others, and the majority overrules it", async () => {
  const out = runFolder();
  const seen: string[] = [];
  const llm = async ({ model: m }: { model: string }) => (seen.push(m), res(verdicts(true, m !== "A")));
  const { score, sessions } = await judgeCuj(llm, ABC, out, { expectations: ["e1", "e2"] });
  assert.equal(score, "passed 2/2", "B and C pass e2, A alone fails it");
  assert.deepEqual(seen, ["A", "B", "C"], "A first, then the other two");
  assert.deepEqual(Object.keys(sessions).sort(), ["judge-A-high", "judge-B-high", "judge-C-high"]);
});

test("judgeCuj: a first judge that differs from the baseline escalates even when it passes", async () => {
  const seen: string[] = [];
  const llm = async ({ model: m }: { model: string }) => (seen.push(m), res(verdicts(true)));
  /** Judge a fresh c1 folder whose baseline verdict for its one expectation was `prior`. */
  const judgedWith = async (prior: boolean) => {
    const runs = mkdtempSync(join(tmpdir(), "judge-")),
      base = mkdtempSync(join(tmpdir(), "base-"));
    mkdirSync(join(base, "c1"));
    writeFileSync(join(base, "c1", "verdict.json"), JSON.stringify([{ expectation: "e1", votes: {}, pass: prior }]));
    mkdirSync(join(runs, "c1"));
    writeFileSync(join(runs, "c1", "executor.json"), readFileSync(join(runFolder(), "executor.json")));
    seen.length = 0;
    await judgeCuj(llm, { ...ABC, judging: { baselines: [base] } }, join(runs, "c1"), { expectations: ["e1"] });
    return [...seen];
  };
  assert.deepEqual(await judgedWith(false), ["A", "B", "C"]);
  assert.deepEqual(await judgedWith(true), ["A"]);
});

test("readBaseline: the first folder with <id>/verdict.json, matched by expectation text", () => {
  const empty = mkdtempSync(join(tmpdir(), "base-"));
  const base = mkdtempSync(join(tmpdir(), "base-"));
  mkdirSync(join(base, "c1"));
  const prior = [
    { expectation: "Says USA.\n", votes: {}, pass: true },
    { expectation: "Fast.", votes: {}, pass: false },
  ];
  writeFileSync(join(base, "c1", "verdict.json"), JSON.stringify(prior));
  assert.deepEqual(readBaseline([empty, base], "c1", ["Fast.", "Says USA.", "New one."]), [false, true, null]);
  assert.equal(readBaseline([empty, base], "c2", ["x"]), undefined);
  mkdirSync(join(empty, "c1"));
  writeFileSync(join(empty, "c1", "verdict.json"), "{not json");
  assert.deepEqual(readBaseline([empty, base], "c1", ["Fast."]), [false], "an unreadable one is skipped");
});
