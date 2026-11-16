// A CUJ's report body (definition, judge grid, steps, reply, judge reasons) and its pills and judge labels.
// Every function here is pure.
//
// Test: npm test (render.test.ts).

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

/** A vote or majority as a mark: ✓, ✗, or — when there is none. Pure. */
const mark = (pass: boolean | null) => (pass === null ? "—" : pass ? "✓" : "✗");

/** A mark for people and screen readers alike: the glyph, plus "pass"/"fail"/"none" as hidden text. Pure. */
const markHtml = (pass: boolean | null) =>
  `<span aria-hidden="true">${mark(pass)}</span><span class="sr-only">${pass === null ? "none" : pass ? "pass" : "fail"}</span>`;

/**
 * A judge's short label, e.g. "claude-opus-5-5-high" → "opus·high", so the judge grid fits a phone. Pure.
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

/** Sort key so failures come first: false 0, null 1, true 2. Pure. */
const rank = (pass: boolean | null | undefined) => (pass === false ? 0 : pass === true ? 2 : 1);

/** A CUJ's outcomes with failures first. Pure. */
const failedFirst = (c: CujView) => [...c.outcomes].sort((a, b) => rank(a.pass) - rank(b.pass));

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
 * The judge grid: one row per expectation (failed first), one column per judge, then the majority. Pure.
 *
 * @param c      The CUJ view.
 * @param judges Judge names, e.g. ["claude-opus-5-5-high"].
 * @returns      HTML, or "" if nothing was judged.
 */
function gridHtml(c: CujView, judges: string[]): string {
  if (!c.outcomes.length) return "";
  const cell = (v: Vote | null | undefined) =>
    v
      ? `<td class="${v.pass ? "ok" : "bad"}" title="${esc(v.why)}">${markHtml(v.pass)}</td>`
      : `<td>${markHtml(null)}</td>`;
  const maj = (p: boolean | null) => `<td class="maj${p === null ? "" : p ? " ok" : " bad"}">${markHtml(p)}</td>`;
  const rows = failedFirst(c).map(
    (o) =>
      `<tr><th scope="row">${esc(o.expectation)}</th>${judges.map((j) => cell(o.votes?.[j])).join("")}${maj(o.pass)}</tr>`,
  );
  const th = (h: string) => `<th scope="col">${h}</th>`;
  const head = `<tr>${th("expectation")}${judges.map((j) => th(judgeLabel(j))).join("")}${th("majority")}</tr>`;
  return `<h3>Judges</h3><div class="scroll"><table class="votes"><thead>${head}</thead><tbody>${rows.join("")}</tbody></table></div>`;
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
 * Judge reasons grouped under each numbered expectation, so every reason shows what it judged. Pure.
 *
 * @param c      The CUJ view.
 * @param judges Judge names.
 * @returns      HTML, or "" if no vote has a reason.
 */
function whyHtml(c: CujView, judges: string[]): string {
  const groups = c.outcomes.flatMap((o, i) => {
    const li = judges.flatMap((j) => {
      const v = o.votes?.[j];
      return v?.why ? [`<li><b>${judgeLabel(j)}</b> ${markHtml(v.pass)} ${esc(v.why)}</li>`] : [];
    });
    return li.length ? [`<li><b>${i + 1}. ${esc(o.expectation)}</b><ul>${li.join("")}</ul></li>`] : [];
  });
  return groups.length ? `<h3>Judge reasons</h3><ol class="why">${groups.join("")}</ol>` : "";
}

/**
 * A CUJ node's body: definition, judge grid and errors, steps, reply, judge reasons, sessions. Pure.
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
    defHtml(c) +
    gridHtml(c, judges) +
    jerr +
    (steps.length ? `<h3>Steps (${steps.length})</h3>${stepsHtml(steps)}` : "") +
    replyHtml(c.executor) +
    whyHtml(c, judges) +
    (c.sessions.length ? `<h3>Sessions</h3>${sessionsHtml(c.sessions)}` : "")
  );
}
