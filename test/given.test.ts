// Tests for given.ts, no LLM: node --test test/given.test.ts  (or npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { playNote, seedNote, sharedGiven, unseeded } from "../src/run/given.ts";

const c = (given?: Record<string, unknown>) => ({ instruction: "i", timeout_s: 5, expectations: ["e"], given });

test("CUJs sharing a run must share one given; none counts as one", () => {
  assert.deepEqual(
    sharedGiven([
      ["a.yaml", c({ m: 1 })],
      ["b.yaml", c({ m: 1 })],
    ]),
    { m: 1 },
  );
  assert.equal(
    sharedGiven([
      ["a.yaml", c()],
      ["b.yaml", c()],
    ]),
    undefined,
  );
  assert.equal(sharedGiven([]), undefined);
  assert.throws(
    () =>
      sharedGiven([
        ["a.yaml", c({ m: 1 })],
        ["b.yaml", c()],
      ]),
    /a\.yaml and b\.yaml have different given/,
  );
});

test("a given key counts as seeded only with its own 'given <key>: seeded' line", () => {
  const g = { memory: [], clock: "07:10" };
  assert.deepEqual(unseeded(g, "given memory: seeded\ngiven clock: FAIL no fake clock"), ["clock"]);
  assert.deepEqual(unseeded(g, "given memory: seeded\ngiven clock: seeded"), []);
  assert.deepEqual(unseeded(undefined, ""), []);
});

test("setup is told to seed and report each key; the executor plays the user with the same state", () => {
  assert.match(seedNote({ clock: "07:10" }).join("\n"), /07:10[\s\S]*Seed given[\s\S]*given <key>: seeded/);
  assert.match(playNote({ clock: "07:10" }), /you play the user[\s\S]*07:10/);
});
