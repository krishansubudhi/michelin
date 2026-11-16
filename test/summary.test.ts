// Tests for summary.ts, no LLM: node --test test/summary.test.ts  (or npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { SKIPPED } from "../src/run/runner.ts";
import { summary } from "../src/run/summary.ts";

test("summary: a line per CUJ across runs, PASS only when every expectation passed, then the total", () => {
  const defs = {
    a: { path: "a.yaml", instruction: "", timeout_s: 1 },
    bb: { path: "bb.yaml", instruction: "", timeout_s: 1 },
  };
  const [one, two] = [
    {
      defs: { a: defs.a, bb: defs.bb },
      cujs: { a: "done", bb: "done" },
      scores: { a: "passed 2/2", bb: "passed 1/2" },
    },
    { defs: { c: defs.a }, cujs: { c: SKIPPED }, scores: {} },
  ];
  const s = summary([one, two]);
  assert.equal(
    s,
    [
      "PASS  a   passed 2/2  (done)",
      "FAIL  bb  passed 1/2  (done)",
      `FAIL  c   unjudged  (${SKIPPED})`,
      "total: 1/3 CUJs passed",
    ].join("\n"),
  );
});
