// run.json's type: the single typed index of one run, written by runner.ts and read back by report.ts.
// Types only; runner.test.ts checks what a run writes.
import type { Settings } from "./settings.ts";
import type { Session } from "../llm/models.ts";
import type { Agent } from "./agent.ts";

/** run.json: the single typed index of one run. */
export type Run = {
  /** Subject folder, e.g. "subjects/toy". */
  subject: string;
  /** Models per role. */
  settings: Settings;
  /** `claude --version` of the CLI that ran every call, e.g. "2.1.318 (Claude Code)"; null if unknown. */
  claudeVersion: string | null;
  /** The agent and model under test, from AGENT, AGENT_MODEL and AGENT_EFFORT, e.g. {AGENT: "agy", AGENT_MODEL: "gemini-4-neon-medium"}; null if none. */
  agent: Agent | null;
  /** ISO start time. */
  started: string;
  /** ISO end time; null while running. */
  finished: string | null;
  heartbeat?: string; // ISO time of the runner's last sign of life, every 10s; stale means it died
  /** "ok", "failed", or "" before the constructor returns. */
  setup: "" | "ok" | "failed";
  /** Why setup failed (the call's error or the constructor's notes); null if it worked. */
  setupError: string | null;
  /** Per-CUJ definition: its file and instruction, e.g. {"toy-country": {path: "subjects/toy/cujs/toy/country.yaml", ...}}. */
  defs: Record<string, { path: string; instruction: string; timeout_s: number }>;
  /** Per-CUJ run status: "done", "error: ...", or "skipped (setup failed)". */
  cujs: Record<string, string>;
  /** Per-CUJ "passed k/n" or "unjudged". */
  scores: Record<string, string>;
  /** Every LLM call: "constructor", "destructor", "<cuj>/executor", "<cuj>/judge-<model>-<effort>". */
  sessions: Record<string, Session>;
  /** Each role's output file, relative to the run folder, keyed like sessions. */
  outputs: Record<string, string>;
};
