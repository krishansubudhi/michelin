// Tests for scratch.ts, no LLM: node --test test/scratch.test.ts  (or npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { SCRATCH_ROOT, dropScratch, makeScratch, scratchFor, scratchNote } from "../src/run/scratch.ts";

test("a run's scratch folder is named by its run id under /tmp/michelin/runs", () => {
  assert.equal(SCRATCH_ROOT, "/tmp/michelin/runs");
  assert.equal(scratchFor(".runs/2026-11-10T02-58"), "/tmp/michelin/runs/2026-11-10T02-58");
  assert.ok(scratchNote("/tmp/michelin/runs/x").includes("/tmp/michelin/runs/x"));
});

test("the scratch folder is made, then dropped", () => {
  const d = scratchFor(`.runs/test-${process.pid}`);
  makeScratch(d);
  assert.ok(existsSync(d));
  dropScratch(d);
  dropScratch(d); // twice is fine
  assert.ok(!existsSync(d));
});
