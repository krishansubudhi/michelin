// Pair: a blind head-to-head judge. Given one task and two programs' evidence, which did it better?
//
// Each judge sees the pair twice, once in each order (A/B, then B/A), so a judge that just prefers a position
// gives a tie, never a win. Every identifier of either run is scrubbed (scrub.ts) into "Program A" / "Program B",
// and in the task text into "the program", so a judge can't tell which subject or model it is reading.
//
// judgePair writes into its out folder:
//   prompt-AB.txt, prompt-BA.txt                the two prompts exactly as the judges saw them
//   pair-<model>-<effort>-AB.json / -BA.json    each judge's checked result, session, time, cost and raw reply
//
// Test: npm test (pair.test.ts, no LLM).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Llm, Pick } from "./models.ts";
import { PAIR, check, type Checked, type Pair } from "./schemas.ts";
import { scrub } from "./scrub.ts";

/** One program's evidence on one task: the journey (steps as JSON lines) and the executor's reply. */
export type Evidence = { journey: string; reply: string };

/** What the programs were asked: the CUJ's instruction and its expectations (the rubric). */
export type Task = { instruction: string; expectations: string[] };

/** Which run did better: the one called first, the second, or neither. */
export type Side3 = "first" | "second" | "tie";

/** One run's evidence and every identifier that could name it (scrub.ts identifiers). */
export type Blind = { evidence: Evidence; ids: string[] };

/** One judge's two verdicts: winner when first was A (ab) and when first was B (ba), combined, and each why. */
export type PairVerdict = { ab: string | null; ba: string | null; result: Side3 | null; whyAB: string; whyBA: string };

/** The panel's result on one pair: the majority winner, each judge's verdicts by "<model>-<effort>", total cost. */
export type PairOutcome = { winner: Side3 | null; judges: Record<string, PairVerdict>; costUsd: number };

/**
 * Build the prompt a pairwise judge sees. Pure.
 *
 * @param task The task, e.g. {instruction: "Ask it the capital of France.", expectations: ["The reply says Paris."]}.
 * @param a    Program A's evidence, e.g. {journey: '{"input":"q"}', reply: "It said Paris."}.
 * @param b    Program B's evidence.
 * @returns    The full prompt, asking for {"winner": "A"|"B"|"tie", "why": "..."}.
 */
export function pairPrompt(task: Task, a: Evidence, b: Evidence): string {
  const rubric = task.expectations.map((e, i) => `${i + 1}. ${e.trim()}`).join("\n") || "(none given)";
  const side = (name: string, e: Evidence) => `${name}'s journey (one JSON line per call made to it):
${e.journey.trim() || "(empty: nothing was logged)"}

${name}'s final reply:
${e.reply.trim() || "(empty)"}`;
  return `You are a strict judge comparing two programs that were given the same task.
Decide, from the evidence below only, which program did the task better. Do not run tools or look anything up.
If the evidence doesn't show something, it didn't happen.

Task:
${task.instruction.trim() || "(none given)"}

Rubric (what a good result shows):
${rubric}

${side("Program A", a)}

${side("Program B", b)}

Return {"winner": "A", "B" or "tie", "why": "one or two sentences citing both journeys"}.`;
}

/**
 * Check one pairwise judge's result: a valid Pair whose winner is "A", "B" or "tie". Pure.
 *
 * @param data  The judge's structured output, e.g. {winner: "A", why: "A asked twice"}.
 * @param error The call's own error, e.g. "timeout after 300s"; null if it ran fine.
 * @returns     {ok: true, data} or {ok: false, error}, e.g. 'winner must be "A", "B" or "tie", got "C"'.
 */
export function checkPair(data: unknown, error: string | null): Checked<Pair> {
  const c = check<Pair>(PAIR, data, error);
  if (c.ok && !["A", "B", "tie"].includes(c.data.winner))
    return { ok: false, error: `winner must be "A", "B" or "tie", got ${JSON.stringify(c.data.winner)}` };
  return c;
}

/**
 * Combine one judge's two verdicts on the same pair shown in both orders. Pure.
 *
 * @param ab The winner when first was shown as A, e.g. "A"; null if no valid result.
 * @param ba The winner when first was shown as B, e.g. "B"; null if no valid result.
 * @returns  "first" iff ab = A and ba = B; "second" iff ab = B and ba = A; null if either is null; else "tie".
 */
export function combine(ab: string | null, ba: string | null): Side3 | null {
  if (ab === null || ba === null) return null;
  if (ab === "A" && ba === "B") return "first";
  if (ab === "B" && ba === "A") return "second";
  return "tie";
}

/**
 * The majority of the judges' combined results. Pure.
 *
 * @param results Each judge's combine() result, e.g. ["first", "tie", null].
 * @returns       "first" if more firsts than seconds, "second" if more seconds, "tie" if equal, null if all null.
 */
export function panel(results: (Side3 | null)[]): Side3 | null {
  const usable = results.filter((r) => r !== null);
  if (!usable.length) return null;
  const firsts = usable.filter((r) => r === "first").length;
  const seconds = usable.filter((r) => r === "second").length;
  return firsts > seconds ? "first" : seconds > firsts ? "second" : "tie";
}

/**
 * The two blind prompts for one pair: each run's evidence scrubbed to its tag, the task to "the program". Pure.
 *
 * @param task   The task; identifiers of either run in it become "the program".
 * @param first  The first run, e.g. {evidence: {journey, reply}, ids: ["ollama/gemma4:26b-mlx", ...]}.
 * @param second The second run.
 * @returns      ab: first shown as Program A, second as B; ba: the same pair swapped.
 */
export function blindPrompts(task: Task, first: Blind, second: Blind): { ab: string; ba: string } {
  const both: [string[], string][] = [[[...first.ids, ...second.ids], "the program"]];
  const t = { instruction: scrub(task.instruction, both), expectations: task.expectations.map((e) => scrub(e, both)) };
  const hide = (own: Blind, other: Blind, tag: string, otherTag: string): Evidence => {
    const groups: [string[], string][] = [
      [own.ids, tag],
      [other.ids, otherTag],
    ];
    return { journey: scrub(own.evidence.journey, groups), reply: scrub(own.evidence.reply, groups) };
  };
  return {
    ab: pairPrompt(t, hide(first, second, "Program A", "Program B"), hide(second, first, "Program B", "Program A")),
    ba: pairPrompt(t, hide(second, first, "Program A", "Program B"), hide(first, second, "Program B", "Program A")),
  };
}

/**
 * Judge one pair blind: every judge sees it in both orders, all calls in parallel, then the panel's majority.
 *
 * @param llm    How to call an LLM (the real llm() or a test fake).
 * @param judges The judges, e.g. [{model: "claude-opus-5-5", effort: "high"}].
 * @param out    Folder to write into (created if missing), e.g. ".runs/compare-<ISO>/chat-country/a-vs-b".
 * @param pair   task: what the two runs did, e.g. {instruction: "Ask it 6+7.", expectations: ["It says 13."]};
 *               first, second: each run's evidence and identifiers, e.g. {evidence: {journey, reply}, ids: [...]}.
 * @returns      winner (panel of every judge's combine), each judge's verdicts, and the total judge cost in USD.
 *               Writes prompt-AB.txt, prompt-BA.txt and pair-<model>-<effort>-AB.json / -BA.json.
 */
export async function judgePair(
  llm: Llm,
  judges: Pick[],
  out: string,
  { task, first, second }: { task: Task; first: Blind; second: Blind },
): Promise<PairOutcome> {
  const prompts = blindPrompts(task, first, second);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "prompt-AB.txt"), prompts.ab);
  writeFileSync(join(out, "prompt-BA.txt"), prompts.ba);
  const opts = { timeoutS: 300, schema: PAIR, tools: "", scratch: true };
  const calls = await Promise.all(judges.map((j) => Promise.all([llm(j, prompts.ab, opts), llm(j, prompts.ba, opts)])));
  const outcome: PairOutcome = { winner: null, judges: {}, costUsd: 0 };
  judges.forEach((j, i) => {
    const m = `${j.model}-${j.effort}`;
    const [ab, ba] = calls[i].map((r, k) => {
      const c = checkPair(r.data, r.error);
      const file = join(out, `pair-${m}-${k ? "BA" : "AB"}.json`);
      writeFileSync(
        file,
        JSON.stringify({ ...c, sessionId: r.sessionId, ms: r.ms, costUsd: r.costUsd, raw: r.text }, null, 2),
      );
      outcome.costUsd += r.costUsd ?? 0;
      return c.ok ? { winner: c.data.winner, why: c.data.why } : { winner: null, why: `(no valid result: ${c.error})` };
    });
    const result = combine(ab.winner, ba.winner);
    outcome.judges[m] = { ab: ab.winner, ba: ba.winner, result, whyAB: ab.why, whyBA: ba.why };
  });
  outcome.winner = panel(Object.values(outcome.judges).map((v) => v.result));
  return outcome;
}
