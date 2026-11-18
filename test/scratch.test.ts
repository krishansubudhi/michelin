// Tests for scratch.ts, no LLM: node --test test/scratch.test.ts  (or npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import {
  SCRATCH_ROOT,
  TMP_ROOT,
  dropScratch,
  makeScratch,
  scratchFor,
  scratchNote,
  tmpRoot,
} from "../src/run/scratch.ts";

test("the temp folder is per OS user by default, never the shared /tmp/michelin; MICHELIN_TMP overrides", () => {
  assert.equal(tmpRoot({}, "/tmp", "ann"), "/tmp/michelin-ann");
  assert.equal(tmpRoot({ MICHELIN_TMP: "" }, "/tmp", "ann"), "/tmp/michelin-ann");
  assert.equal(tmpRoot({ MICHELIN_TMP: "/x/mt" }, "/tmp", "ann"), "/x/mt");
  assert.equal(TMP_ROOT, process.env.MICHELIN_TMP || join(tmpdir(), `michelin-${userInfo().username}`));
  assert.notEqual(TMP_ROOT, "/tmp/michelin");
});

test("a run's scratch folder is named by its run id under <tmp>/runs", () => {
  assert.equal(SCRATCH_ROOT, `${TMP_ROOT}/runs`);
  assert.equal(scratchFor(".runs/2026-11-10T02-58"), `${TMP_ROOT}/runs/2026-11-10T02-58`);
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
