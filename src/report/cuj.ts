// A CUJ's report body (definition, verdicts per expectation, steps, reply) and its pills and judge labels.
// Every function here is pure.
//
// Test: npm test (render.test.ts).

import type { Outcome } from "../llm/judge.ts";
import type { Step, Vote } from "../llm/schemas.ts";
import type { CujView } from "./view.ts";
import { esc, fmtMs, pill, sessionsHtml } from "./html.ts";

/**
 * A CUJ's status pill: skipped, k/n passed, or its score. Pure.
 *
 * @param c      The CUJ view.
 * @param prefix Text before "k/n", e.g. "passed " or "".
 * @returns      HTML pill.
 */
export function cujPill(c: CujView, prefix: string): string {
  const n = c.outcomes.length,
    passed = c.outcomes.filter((o) => o.pass === true).length;
  if (c.status.startsWith("skipped")) return pill(c.status, "na");
  return n ? pill(`${prefix}${passed}/${n}`, passed === n ? "ok" : "bad") : pill(c.score || "unjudged", "na");
}

/**
 * A vote or majority as a pill with the word, so pass/fail is never colour or glyph alone. Pure.
 *
 * @param pass true, false, or null when there is no usable vote.
 * @returns    HTML pill: "pass" (green), "fail" (red) or "none" (grey).
 */
const verdictPill = (pass: boolean | null): string =>
  pass === null ? pill("none", "na") : pass ? pill("pass", "ok") : pill("fail", "bad");

/**
 * A judge's short label, e.g. "claude-opus-5-5-high" → "opus·high", so judge names fit a phone. Pure.
 *
 * @param name Judge name, model then effort, e.g. "claude-sonnet-5-5-medium".
 * @returns    The short label, or the name itself if it has no known model family.
 */
export function shortJudge(name: string): string {
  const fam = name.match(/(opus|sonnet|haiku|fable)/i)?.[1]?.toLowerCase();
  const eff = name.match(/-(low|medium|high|xhigh|max)$/i)?.[1]?.toLowerCase();
  return fam ? (eff ? `${fam}·${eff === "medium" ? "med" : eff}` : fam) : name;
}

/** A judge's short label with its full name on hover and for assistive tech. Pure. */
const judgeLabel = (name: string) => `<abbr class="jn" title="${esc(name)}">${esc(shortJudge(name))}</abbr>`;

/** A step's measured time in ms, 0 if missing. Pure. */
const stepMs = (s: Step) => Number(s.ms) || 0;

/**
 * The executor's steps as a list with latency bars. Pure.
 *
 * @param steps The executor's steps.
 * @returns     HTML list, or "" if none.
 */
function stepsHtml(steps: Step[]): string {
  if (!steps.length) return "";
  const max = Math.max(1, ...steps.map(stepMs));
  const li = steps.map(
    (s) =>
      `<li><b>${esc(s.action)}</b> <span class="in">${esc(s.input)}</span><div class="got">${esc(s.got)}</div>` +
      `<div class="lat"><i style="width:${Math.round((stepMs(s) / max) * 100)}%"></i><span>${esc(fmtMs(stepMs(s)))}</span></div></li>`,
  );
  return `<ol class="steps">${li.join("")}</ol>`;
}

/**
 * The executor's final reply, or why it failed. Pure.
 *
 * @param ex The executor's checked result, or null.
 * @returns  HTML, or "" if there is no result.
 */
function replyHtml(ex: CujView["executor"]): string {
  if (!ex) return "";
  return ex.ok
    ? `<h3>Final reply</h3><p class="reply">${esc(ex.data.reply)}</p>`
    : `<p class="err">executor failed: ${esc(ex.error)}</p>`;
}

/**
 * One judge's verdict on one expectation: its label, pass/fail, and reason. Pure.
 *
 * @param judge Judge name, e.g. "claude-opus-5-5-high".
 * @param v     Its vote, or null if it gave no usable result.
 * @returns     HTML list item.
 */
function voteHtml(judge: string, v: Vote | null): string {
  const why = v?.why ? ` <span class="why">${esc(v.why)}</span>` : "";
  return `<li><span class="jv">${judgeLabel(judge)} ${verdictPill(v ? v.pass : null)}</span>${why}</li>`;
}

/**
 * One expectation, numbered as in the CUJ: its text and majority pass/fail, then every judge's verdict under it. Pure.
 *
 * @param o      The expectation's outcome, e.g. {expectation: "Says USA.", votes: {...}, pass: true}.
 * @param n      Its 1-based number in the CUJ, e.g. 2.
 * @param judges Judge names, in column order; a judge with no entry for this expectation is left out.
 * @returns      HTML list item.
 */
function outcomeHtml(o: Outcome, n: number, judges: string[]): string {
  const pass = o.pass ?? null;
  const votes = judges.filter((j) => o.votes && j in o.votes).map((j) => voteHtml(j, o.votes[j] ?? null));
  return (
    `<li class="${pass === null ? "na" : pass ? "ok" : "bad"}">` +
    `<div class="exp"><span class="n">${n}.</span> <span class="et">${esc(o.expectation)}</span> ${verdictPill(pass)}</div>` +
    (votes.length ? `<ul class="votes">${votes.join("")}</ul>` : "") +
    `</li>`
  );
}

/**
 * The verdicts: one numbered block per expectation, in CUJ order, each judge's pass/fail and reason right under it. Pure.
 *
 * @param c      The CUJ view.
 * @param judges Judge names, e.g. ["claude-opus-5-5-high"].
 * @returns      HTML, or "" if nothing was judged.
 */
function verdictsHtml(c: CujView, judges: string[]): string {
  if (!c.outcomes.length) return "";
  const li = c.outcomes.map((o, i) => outcomeHtml(o, i + 1, judges));
  return `<h3>Verdicts</h3><ol class="verdicts">${li.join("")}</ol>`;
}

/**
 * A CUJ's file, timeout and instruction, and an unusual status. Pure.
 *
 * @param c The CUJ view.
 * @returns HTML, or "" if there is neither.
 */
function defHtml(c: CujView): string {
  const d = c.def,
    odd = c.status && c.status !== "done" && !c.status.startsWith("skipped");
  return (
    (d
      ? `<p class="muted">${esc(d.path)} · timeout ${esc(d.timeout_s)} s</p><blockquote>${esc(d.instruction)}</blockquote>`
      : "") + (odd ? `<p class="err">${esc(c.status)}</p>` : "")
  );
}

/**
 * Whether a CUJ failed: an expectation failed, the executor failed, or its status is an error. Pure.
 *
 * @param c The CUJ view.
 * @returns true if it failed.
 */
const failed = (c: CujView): boolean =>
  c.outcomes.some((o) => o.pass === false) || c.executor?.ok === false || c.status.startsWith("error");

/**
 * A count with its noun, singular for 1. Pure.
 *
 * @param n    The count, e.g. 4.
 * @param noun The singular noun, e.g. "executor step".
 * @returns    e.g. "4 executor steps" or "1 executor step".
 */
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * How many distinct files some patches change: their "diff --git a/<path> " lines, else their "+++ b/<path>" lines
 * (so "+++ /dev/null" never counts). Pure.
 *
 * @param patches Patch texts, e.g. ["diff --git a/x b/x\n..."].
 * @returns       The number of distinct paths; 0 for empty patches.
 */
function filesChanged(patches: string[]): number {
  const paths = (re: RegExp) => new Set(patches.flatMap((p) => [...p.matchAll(re)].map((m) => m[1])));
  const git = paths(/^diff --git a\/(\S+) /gm);
  if (git.size) return git.size;
  return paths(/^\+\+\+ b\/(\S+)/gm).size;
}

/**
 * A reply as one line, whitespace collapsed; if longer than 200 characters, its first 200 then "…". Pure.
 *
 * @param reply The executor's reply.
 * @returns     The short reply.
 */
function shortReply(reply: string): string {
  const s = reply.replace(/\s+/g, " ").trim();
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

/** The executor's step count, e.g. "4 executor steps", or "" if it saved no steps. Pure. */
function stepsFact(c: CujView): string {
  const steps = c.executor?.ok ? c.executor.data?.steps : null;
  return Array.isArray(steps) ? count(steps.length, "executor step") : "";
}

/** The executor session's time, e.g. "took 280.3 s", or "" if unknown. Pure. */
function tookFact(c: CujView): string {
  const ms = c.sessions.find(([k]) => k === "executor")?.[1]?.ms;
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? `took ${fmtMs(ms)}` : "";
}

/** The files the saved patches change, e.g. "2 files changed", or "" if no patch was saved. Pure. */
const filesFact = (c: CujView) => (c.patches?.length ? `${count(filesChanged(c.patches), "file")} changed` : "");

/** The executor's reply, short, e.g. "executor's summary: “Done.”", or "" if it saved none. Pure. */
function replyFact(c: CujView): string {
  const reply = c.executor?.ok ? c.executor.data?.reply : null;
  const s = typeof reply === "string" ? shortReply(reply) : "";
  return s ? `executor's summary: “${s}”` : "";
}

/**
 * A CUJ's run facts as plain text, each left out when the saved data lacks it. Pure.
 *
 * @param c The CUJ view.
 * @returns e.g. ["4 executor steps", "took 280.3 s", "0 files changed", "executor's summary: “…”"].
 */
const facts = (c: CujView): string[] => [stepsFact(c), tookFact(c), filesFact(c), replyFact(c)].filter(Boolean);

/**
 * A failed CUJ's "Run facts" block: steps, time, files changed, executor's summary, whichever were saved. Pure.
 *
 * @param c The CUJ view.
 * @returns HTML, or "" if the CUJ did not fail or no fact is known.
 */
export function factsHtml(c: CujView): string {
  const f = failed(c) ? facts(c) : [];
  if (!f.length) return "";
  return `<h3>Run facts</h3><ul class="facts">${f.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
}

/**
 * A CUJ node's body: run facts if it failed, definition, verdicts and judge errors, steps, reply, sessions. Pure.
 *
 * @param c The CUJ view.
 * @returns HTML.
 */
export function cujBody(c: CujView): string {
  const steps = c.executor?.ok ? (c.executor.data.steps ?? []) : [];
  const judges = [...new Set(c.outcomes.flatMap((o) => Object.keys(o.votes ?? {})))];
  const jerr = Object.entries(c.judges)
    .flatMap(([k, j]) => (j.ok ? [] : [`<p class="err">${esc(k)}: ${esc(j.error)}</p>`]))
    .join("");
  return (
    factsHtml(c) +
    defHtml(c) +
    verdictsHtml(c, judges) +
    jerr +
    (steps.length ? `<h3>Steps (${steps.length})</h3>${stepsHtml(steps)}` : "") +
    replyHtml(c.executor) +
    (c.sessions.length ? `<h3>Sessions</h3>${sessionsHtml(c.sessions)}` : "")
  );
}
