// Which agent and model a subject drove this run, read from the environment the run was started in, for run.json.
// A subject that drives another agent (e.g. subjects/coding-agents) reads AGENT and AGENT_MODEL itself; the runner only
// records them, so a results row can be recounted from run.json files instead of from labels written by hand.
// Tests: test/agent.test.ts

/** The agent under test as run.json records it, e.g. {AGENT: "claude", AGENT_MODEL: "claude-opus-5-5"}. */
export type Agent = { AGENT: string; AGENT_MODEL: string; AGENT_EFFORT?: string };

/**
 * The agent and model named by the environment. Pure.
 *
 * @param env Environment variables, e.g. process.env; reads AGENT, AGENT_MODEL and AGENT_EFFORT.
 * @returns   {AGENT, AGENT_MODEL} plus AGENT_EFFORT when set, e.g. {AGENT: "agy", AGENT_MODEL: "gemini-4-neon-medium"};
 *            null if AGENT is unset or empty (a subject that drives no other agent). AGENT_MODEL is "" if unset.
 */
export function agentFromEnv(env: Record<string, string | undefined>): Agent | null {
  if (!env.AGENT) return null;
  const agent: Agent = { AGENT: env.AGENT, AGENT_MODEL: env.AGENT_MODEL ?? "" };
  if (env.AGENT_EFFORT) agent.AGENT_EFFORT = env.AGENT_EFFORT;
  return agent;
}
