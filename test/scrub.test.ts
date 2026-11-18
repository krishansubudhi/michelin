// Tests for scrub.ts: which identifiers a run has, their short forms, and replacing them with tags.
// Run: npm test (no LLM).

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { identifiers, variants, scrub } from "../src/llm/scrub.ts";

test("identifiers: run id, folder, subject, every model, setup NAME=value values and extras; short ones dropped", () => {
  const run = {
    subject: "subjects/opencode",
    settings: {
      constructor: { model: "claude-sonnet-5-5", effort: "low" },
      executor: { model: "ollama/gemma4:26b-mlx", effort: "high" },
      destructor: { model: "claude-sonnet-5-5", effort: "low" },
      judge: [{ model: "claude-opus-5-5", effort: "high" }],
    },
  };
  const ids = identifiers(".runs/r1-2026", run, "set up ok\nMODEL=ollama/qwen3.8:27b\n  PORT = no\nX=ab", {
    extra: ["laptop", "zz"],
  });
  assert.deepEqual(ids, [
    "r1-2026",
    resolve(".runs/r1-2026"),
    "subjects/opencode",
    "opencode",
    "claude-sonnet-5-5",
    "ollama/gemma4:26b-mlx",
    "claude-opus-5-5",
    "ollama/qwen3.8:27b",
    "laptop",
  ]);
  assert.deepEqual(identifiers("/tmp/abc", {}), ["abc", "/tmp/abc"]);
});

test("an explicit --hide token is scrubbed whatever its length, whole words only; short automatic ones are not", () => {
  const ids = identifiers("/tmp/abc", { subject: "v2" }, "X=v1", { extra: ["ab"], hide: ["v2", " v1 ", ""] });
  assert.deepEqual(ids, ["abc", "/tmp/abc", "v2", "v1"]);
  assert.deepEqual(variants("v2"), ["v2"]);
  assert.equal(
    scrub("TOY_VARIANT=v2 is broken; v20 and xv2 stay", [[["v2"], "Program B"]]),
    "TOY_VARIANT=Program B is broken; v20 and xv2 stay",
  );
  assert.equal(
    scrub("v1 vs V2", [
      [["v1"], "A"],
      [["v2"], "B"],
    ]),
    "A vs B",
  );
});

test("variants: short forms of a model id; a path only whole", () => {
  assert.deepEqual(variants("ollama/gemma4:26b-mlx"), ["ollama/gemma4:26b-mlx", "gemma4:26b-mlx", "gemma4", "gemma"]);
  assert.deepEqual(variants("subjects/opencode"), ["subjects/opencode", "opencode"]);
  assert.deepEqual(variants("/x/y/work"), ["/x/y/work"]);
  assert.deepEqual(variants("./work"), ["./work"]);
  assert.deepEqual(variants("qwen3.8:27b"), ["qwen3.8:27b", "qwen3.8", "qwen"]);
});

test("scrub: case-insensitive, longest first, the earlier group wins a shared form", () => {
  const a: [string[], string] = [["ollama/gemma4:26b-mlx", "subjects/opencode"], "Program A"];
  const b: [string[], string] = [["ollama/qwen3.8:27b", "subjects/opencode"], "Program B"];
  assert.equal(
    scrub("OLLAMA/Gemma4:26B-mlx then gemma4 and Gemma, OpenCode vs qwen3.8:27b / QWEN", [a, b]),
    "Program A then Program A and Program A, Program A vs Program B / Program B",
  );
  assert.equal(scrub("opencode", [b, a]), "Program B");
  assert.equal(scrub("the work is done", [[["/x/y/work"], "T"]]), "the work is done");
  assert.equal(scrub("a+b (c)", [[["a+b (c)"], "T"]]), "T", "regex characters are literal");
  assert.equal(scrub("unchanged", []), "unchanged");
});

test("scrub: whole tokens only, so code and diffs around a hidden name stay intact", () => {
  const a: [string[], string] = [["ollama/gemma4:26b-mlx", "subjects/python3"], "Program A"];
  assert.equal(
    scrub("gemmatology uses gemma_utils; my_gemma4 vs gemma4.", [a]),
    "gemmatology uses gemma_utils; my_gemma4 vs Program A.",
  );
  assert.equal(
    scrub("-import pythonic\n+import python3x\nran python3 (gemma)", [a]),
    "-import pythonic\n+import python3x\nran Program A (Program A)",
  );
  assert.equal(scrub("cd /x/y/work/src && ls /x/y/workshop", [[["/x/y/work"], "T"]]), "cd T/src && ls /x/y/workshop");
});
