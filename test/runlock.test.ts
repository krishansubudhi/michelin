// Tests for runlock.ts, no LLM: node --test test/runlock.test.ts  (or npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUN_LOCK, acquireRunLock, alive } from "../src/run/runlock.ts";
import { TMP_ROOT } from "../src/run/scratch.ts";

const lockIn = () => join(mkdtempSync(join(tmpdir(), "runlock-")), "run.lock");
const deadPid = () => spawnSync("true").pid as number;

test("the lock lives in the temp folder (per user, or $MICHELIN_TMP); alive() knows a dead pid", () => {
  assert.equal(RUN_LOCK, `${TMP_ROOT}/run.lock`);
  assert.ok(alive(process.pid));
  assert.ok(!alive(deadPid()));
});

test("a second acquire waits until the first releases", async () => {
  const path = lockIn();
  const release1 = await acquireRunLock(path, 10);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).pid, process.pid);
  let got = false;
  const second = acquireRunLock(path, 10).then((r) => ((got = true), r));
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!got, "second acquire must wait while the first holds the lock");
  release1();
  const release2 = await second;
  assert.ok(got && existsSync(path));
  release2();
  release2(); // twice is fine
  assert.ok(!existsSync(path));
});

test("a stale lock (dead pid) is taken over", async () => {
  const path = lockIn();
  writeFileSync(path, JSON.stringify({ pid: deadPid(), user: "ghost", started: "2026-01-01T00:00:00Z" }));
  const release = await acquireRunLock(path, 10);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).pid, process.pid);
  release();
  assert.ok(!existsSync(path));
});

test("release leaves a lock that is no longer ours", async () => {
  const path = lockIn();
  const release = await acquireRunLock(path, 10);
  const other = JSON.stringify({ pid: 1, user: "root", started: "x" });
  writeFileSync(path, other);
  release();
  assert.equal(readFileSync(path, "utf8"), other);
});
