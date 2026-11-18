// Tests for pair.ts: the pairwise prompt, swap-consistent combining, the panel, and the blind test with a fake LLM.
// Run: npm test (no LLM).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pairPrompt, checkPair, combine, panel, judgePair, type Blind } from "../src/llm/pair.ts";
import { identifiers, variants } from "../src/llm/scrub.ts";
import { PAIR } from "../src/llm/schemas.ts";
import type { Llm } from "../src/llm/models.ts";

/** A fake LlmResult carrying `data` as the structured output. */
const res = (data: unknown) => ({ text: "raw", data, sessionId: "sid", ms: 1, costUsd: 0.01, error: null });
const J = [{ model: "J", effort: "high" as const }];
const task = { instruction: "Ask it 6+7.", expectations: ["The reply says 13."] };
/** A Blind run whose reply is `reply` and whose only identifier is `id`. */
const blind = (id: string, reply: string): Blind => ({ evidence: { journey: `{"input":"${id}"}`, reply }, ids: [id] });
const out = () => mkdtempSync(join(tmpdir(), "pair-"));

test("pairPrompt shows the task, the rubric, both programs' journeys and replies, and the answer shape", () => {
  const p = pairPrompt(task, { journey: '{"input":"a"}', reply: "ra" }, { journey: "", reply: "" });
  assert.match(p, /Ask it 6\+7\.[\s\S]*1\. The reply says 13\.[\s\S]*Program A[\s\S]*"a"[\s\S]*ra[\s\S]*Program B/);
  assert.match(p, /\(empty: nothing was logged\)[\s\S]*\(empty\)[\s\S]*"winner": "A", "B" or "tie"/);
});

test("checkPair: a valid winner passes; another winner, bad shape or a call error fails", () => {
  assert.deepEqual(checkPair({ winner: "tie", why: "w" }, null), { ok: true, data: { winner: "tie", why: "w" } });
  const bad: [unknown, string | null, RegExp][] = [
    [{ winner: "C", why: "w" }, null, /winner must be/],
    [{ winner: "A" }, null, /\$\.why: missing/],
    [null, null, /no structured output/],
    [{ winner: "A", why: "w" }, "timeout after 300s", /timeout/],
  ];
  for (const [data, error, re] of bad) {
    const c = checkPair(data, error);
    assert.ok(!c.ok && re.test(c.error), JSON.stringify(c));
  }
});

test("combine: a win only when both orders agree; disagreement is a tie; a missing verdict is null", () => {
  assert.equal(combine("A", "B"), "first");
  assert.equal(combine("B", "A"), "second");
  assert.equal(combine("A", "A"), "tie", "position bias");
  assert.equal(combine("tie", "B"), "tie");
  assert.equal(combine(null, "B"), null);
  assert.equal(combine("A", null), null);
});

test("panel: majority of the non-null results; equal is a tie; none is null", () => {
  assert.equal(panel(["first", "first", "second"]), "first");
  assert.equal(panel(["second", null, "tie"]), "second");
  assert.equal(panel(["first", "second", "tie"]), "tie");
  assert.equal(panel([null, null]), null);
  assert.equal(panel([]), null);
});

test("swap consistency: a judge that always says A gives a tie; one that sees the real winner gives first", async () => {
  const first = blind("alpha-run", "it said 13"),
    second = blind("beta-run", "it said 12");
  const biased = await judgePair(async () => res({ winner: "A", why: "w" }), J, out(), { task, first, second });
  assert.equal(biased.winner, "tie");
  assert.deepEqual(biased.judges["J-high"], { ab: "A", ba: "A", result: "tie", whyAB: "w", whyBA: "w" });
  // The fake picks whichever program said 13: A when first is shown first, B when swapped.
  const fair: Llm = async (_j, p) =>
    res({ winner: /Program A's final reply:\nit said 13/.test(p) ? "A" : "B", why: "13" });
  const r = await judgePair(fair, J, out(), { task, first, second });
  assert.equal(r.winner, "first");
  assert.equal(r.judges["J-high"].result, "first");
  assert.equal(r.costUsd, 0.02);
});

test("an invalid reply is null, never a win; judgePair writes prompts and each judge's results with no tools", async () => {
  const dir = join(out(), "c1", "a-vs-b");
  const seen: unknown[] = [];
  const llm: Llm = async ({ model }, _p, o) => (seen.push(o), res(model === "bad" ? { winner: "C", why: "w" } : null));
  const r = await judgePair(llm, [{ model: "bad", effort: "low" }], dir, {
    task,
    first: blind("aaa", "x"),
    second: blind("bbb", "y"),
  });
  assert.equal(r.winner, null);
  assert.equal(r.judges["bad-low"].result, null);
  assert.match(r.judges["bad-low"].whyAB, /winner must be/);
  for (const f of ["prompt-AB.txt", "prompt-BA.txt", "pair-bad-low-AB.json", "pair-bad-low-BA.json"])
    assert.ok(existsSync(join(dir, f)), f);
  const ab = JSON.parse(readFileSync(join(dir, "pair-bad-low-AB.json"), "utf8"));
  assert.equal(ab.ok, false);
  assert.equal(ab.raw, "raw");
  assert.equal(ab.costUsd, 0.01);
  assert.deepEqual(seen[0], { timeoutS: 300, schema: PAIR, tools: "", scratch: true });
});

test("THE BLIND TEST: no identifier of either run, in any case, reaches any judge prompt", async () => {
  const root = out();
  /** A fake run: its folder, run.json and setup notes, with this subject and models. */
  const fakeRun = (runId: string, executor: string, setupModel: string) => {
    const dir = join(root, runId);
    mkdirSync(dir);
    const run = {
      subject: "subjects/opencode",
      settings: {
        constructor: { model: "claude-sonnet-5-5", effort: "low" },
        executor: { model: executor, effort: "high" },
        destructor: { model: "claude-sonnet-5-5", effort: "low" },
        judge: [{ model: "claude-opus-5-5", effort: "high" }],
      },
    };
    return identifiers(dir, run, `installed it\nMODEL=${setupModel}\n`);
  };
  const idsA = fakeRun("2026-11-17T10-00-00-000Z", "ollama/gemma4:26b-mlx", "ollama/gemma4:26b-mlx");
  const idsB = fakeRun("2026-11-17T11-00-00-000Z", "ollama/qwen3.8:27b", "ollama/qwen3.8:27b");
  const all = [...idsA, ...idsB];
  const mention = `run ${root}/2026-11-17T10-00-00-000Z and 2026-11-17t11-00-00-000z; SUBJECTS/OpenCode via opencode;
    Ollama/Gemma4:26B-MLX, gemma4, GEMMA, ollama/QWEN3.8:27b, Qwen3.8, qwen; Claude-Sonnet-5-5 judged by CLAUDE-opus-5-5`;
  const side = (ids: string[]): Blind => ({
    evidence: { journey: JSON.stringify({ action: "run", input: mention, got: mention }), reply: `${mention} 13` },
    ids,
  });
  const t = {
    instruction: `Use OpenCode (gemma or Qwen) to add 6+7. ${mention}`,
    expectations: [`It says 13. ${mention}`],
  };
  const prompts: string[] = [];
  await judgePair(async (_j, p) => (prompts.push(p), res({ winner: "tie", why: "w" })), J, out(), {
    task: t,
    first: side(idsA),
    second: side(idsB),
  });
  assert.equal(prompts.length, 2);
  const forms = [...new Set(all.flatMap(variants))];
  assert.ok(
    forms.includes("gemma") && forms.includes("qwen") && forms.includes("opencode") && forms.includes("claude"),
  );
  for (const p of prompts) {
    for (const f of forms) assert.ok(!p.toLowerCase().includes(f.toLowerCase()), `${f} leaked into:\n${p}`);
    assert.match(p, /Program A/);
    assert.match(p, /Program B/);
    assert.match(p, /the program/);
  }
});
