// Tests for src/run/agent.ts: run.json's record of the agent and model under test.
// Run: node --test test/agent.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentFromEnv } from "../src/run/agent.ts";

test("AGENT and AGENT_MODEL are recorded as given, with AGENT_EFFORT only when set", () => {
  assert.deepEqual(agentFromEnv({ AGENT: "agy", AGENT_MODEL: "gemini-4-neon-medium", HOME: "/x" }), {
    AGENT: "agy",
    AGENT_MODEL: "gemini-4-neon-medium",
  });
  assert.deepEqual(agentFromEnv({ AGENT: "claude", AGENT_MODEL: "claude-opus-5-5", AGENT_EFFORT: "medium" }), {
    AGENT: "claude",
    AGENT_MODEL: "claude-opus-5-5",
    AGENT_EFFORT: "medium",
  });
});

test("no AGENT means no agent under test: null, even with a model set", () => {
  assert.equal(agentFromEnv({}), null);
  assert.equal(agentFromEnv({ AGENT: "", AGENT_MODEL: "m" }), null);
});

test("an AGENT without a model records an empty model, never a guessed one", () => {
  assert.deepEqual(agentFromEnv({ AGENT: "opencode" }), { AGENT: "opencode", AGENT_MODEL: "" });
});
