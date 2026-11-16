// Tests for schemas.ts, no LLM: node --test test/schemas.test.ts
// Every role's schema accepts a valid result and turns a malformed one into an error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SETUP, EXECUTOR, TEARDOWN, JUDGE, validate, check } from "../src/llm/schemas.ts";

const valid = [
  [SETUP, { ok: false, steps: ["checked python"], notes: "harness not found: x.py" }],
  [EXECUTOR, { steps: [{ action: "run", input: "q", got: "a", ms: 12 }], reply: "asked once" }],
  [TEARDOWN, { ok: true, cleaned: [], notes: "" }],
  [JUDGE, { verdicts: [{ pass: true, why: "it said USA" }] }],
] as const;

test("each role's valid result passes", () => {
  for (const [schema, v] of valid) assert.equal(validate(schema, v), null, JSON.stringify(v));
});

test("a malformed result names the first bad field", () => {
  assert.equal(validate(SETUP, { ok: "yes", steps: [], notes: "" }), "$.ok: expected boolean");
  assert.equal(validate(SETUP, { ok: true, steps: [] }), "$.notes: missing");
  assert.equal(validate(TEARDOWN, { ok: true, cleaned: [], notes: "", extra: 1 }), "$.extra: unexpected field");
  assert.equal(
    validate(EXECUTOR, { steps: [{ action: "run", input: "q", got: "a", ms: "12" }], reply: "" }),
    "$.steps[0].ms: expected number",
  );
  assert.equal(validate(EXECUTOR, { steps: {}, reply: "" }), "$.steps: expected array");
  assert.equal(validate(JUDGE, "text"), "$: expected object");
  assert.equal(validate(JUDGE, [1]), "$: expected object");
});

test("check: valid data is ok; an error, no data or invalid data is never ok", () => {
  assert.deepEqual(check(TEARDOWN, valid[2][1], null), { ok: true, data: valid[2][1] });
  assert.deepEqual(check(TEARDOWN, valid[2][1], "exit 1"), { ok: false, error: "exit 1" });
  assert.deepEqual(check(TEARDOWN, null, null), { ok: false, error: "no structured output" });
  assert.deepEqual(check(TEARDOWN, { ok: 1, cleaned: [], notes: "" }, null), {
    ok: false,
    error: "invalid output: $.ok: expected boolean",
  });
});
