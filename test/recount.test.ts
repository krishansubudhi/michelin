// Tests for scripts/recount.ts: n and passes per agent, model and CUJ from run.json files.
// Run: node --test test/recount.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { cujName, fullPass, recount, type RunLike } from "../scripts/recount.ts";

const def = (p: string) => ({ path: `subjects/coding-agents/cujs/${p}.yaml` });
const run = (agent: RunLike["agent"], id: string, path: string, score: string): RunLike => ({
  agent,
  defs: { [id]: def(path) },
  scores: { [id]: score },
});
const neon = { AGENT: "agy", AGENT_MODEL: "gemini-4-neon-medium" };

test("a CUJ's name is its folder and file, falling back to the run.json id", () => {
  assert.equal(cujName("peculiar-dst_cron", "subjects/x/cujs/peculiar/dst_cron.yaml"), "peculiar/dst_cron");
  assert.equal(cujName("peculiar-dst_cron"), "peculiar-dst_cron");
});

test("only passed k/k counts as a pass", () => {
  assert.equal(fullPass("passed 2/2"), true);
  assert.equal(fullPass("passed 1/2"), false);
  assert.equal(fullPass("unjudged"), false);
  assert.equal(fullPass("passed 0/0"), false);
});

test("runs group by AGENT and AGENT_MODEL from run.json, with n and full passes per CUJ", () => {
  const rows = recount([
    { run: run(neon, "peculiar-dst_cron", "peculiar/dst_cron", "passed 2/2") },
    { run: run(neon, "peculiar-dst_cron", "peculiar/dst_cron", "passed 1/2") },
    {
      run: run(
        { ...neon, AGENT: "claude", AGENT_EFFORT: "medium" },
        "peculiar-dst_cron",
        "peculiar/dst_cron",
        "passed 1/1",
      ),
    },
  ]);
  assert.deepEqual(rows, [
    { agent: "agy", model: "gemini-4-neon-medium", cuj: "peculiar/dst_cron", n: 2, passed: 1 },
    { agent: "claude", model: "gemini-4-neon-medium@medium", cuj: "peculiar/dst_cron", n: 1, passed: 1 },
  ]);
});

test("an older run counts under its provenance.json agent, and as unverified without one", () => {
  const old = run(undefined, "coding-agents-add_flag", "coding-agents/add_flag", "passed 3/3");
  const proven = { cujs: { "coding-agents-add_flag": { ...neon, evidence: "agy conversation log" } } };
  assert.deepEqual(recount([{ run: old, provenance: proven }, { run: old }]), [
    { agent: "agy", model: "gemini-4-neon-medium", cuj: "coding-agents/add_flag", n: 1, passed: 1 },
    { agent: "unverified", model: "", cuj: "coding-agents/add_flag", n: 1, passed: 1 },
  ]);
});

test("run.json's own agent wins over a provenance.json", () => {
  const r = run(neon, "peculiar-wrong_test", "peculiar/wrong_test", "passed 1/1");
  const other = { cujs: { "peculiar-wrong_test": { AGENT: "x", AGENT_MODEL: "y", evidence: "" } } };
  assert.equal(recount([{ run: r, provenance: other }])[0].agent, "agy");
});
