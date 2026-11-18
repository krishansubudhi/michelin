// The report's typed view of one run folder: what loadRun (report.ts) builds and renderReport (render.ts) draws.
// Types only, so every report module can import them without an import cycle.

import type { Session } from "../llm/models.ts";
import type { Outcome } from "../llm/judge.ts";
import type { Checked, Setup, Teardown, ExecutorResult, JudgeResult } from "../llm/schemas.ts";

/**
 * A file kept as plain text, e.g. {path: "llm.log", text: "..."}. A binary file has no text: kind "image" (shown as
 * an <img> linking the file beside report.html) or "binary" (named with its size, never dumped).
 */
export type FileText = { path: string; text: string; kind?: "image" | "binary"; bytes?: number };

// Parsed JSON of unknown shape: every field is probed defensively, so a precise type would be a lie.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loose = any;

/** Everything known about one CUJ in a run. */
export type CujView = {
  /** CUJ id, e.g. "chat-name". */
  id: string;
  /** The CUJ's file and instruction from run.json defs, or null for older runs. */
  def: { path: string; instruction: string; timeout_s: number } | null;
  /** Run status from run.json, e.g. "done"; "" if unknown. */
  status: string;
  /** Score from run.json, e.g. "passed 1/2"; "" if unknown. */
  score: string;
  /** The executor's checked result, or null if absent. */
  executor: Checked<ExecutorResult> | null;
  /** verdict.json: one outcome per expectation. */
  outcomes: Outcome[];
  /** Each judge's checked result, keyed "judge-<model>-<effort>". */
  judges: Record<string, Checked<JudgeResult>>;
  /** This CUJ's sessions as [label, session], label without the CUJ prefix, e.g. "executor". */
  sessions: [string, Session][];
};

/** Typed view of one run folder; what renderReport draws. */
export type RunView = {
  /** Run folder path, e.g. ".runs/2026-11-06T03-04-45-304Z". */
  dir: string;
  /** run.json contents, whatever fields were present. */
  run: Record<string, Loose>;
  /** constructor.json, or null. */
  constructor: Checked<Setup> | null;
  /** destructor.json, or null. */
  destructor: Checked<Teardown> | null;
  /** Sessions of the constructor and destructor, keyed by label. */
  sessions: Record<string, Session>;
  /** One view per CUJ, sorted by id. */
  cujs: CujView[];
  /** Debug-only text: raw replies, *.txt, llm.log. */
  raw: FileText[];
  /** Files not recognised. */
  unknown: FileText[];
};
