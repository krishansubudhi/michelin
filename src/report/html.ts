// HTML primitives shared by the report page (render.ts), its timeline (timeline.ts) and CUJ bodies (cuj.ts). Every function here is pure.
//
// Test: npm test (render.test.ts).

import type { Session } from "../llm/models.ts";
import type { Loose } from "./view.ts";

/**
 * Escape text for HTML. Pure.
 *
 * @param s Any value, e.g. "<b>&'\"".
 * @returns The escaped string, e.g. "&lt;b&gt;&amp;&#39;&quot;".
 */
export const esc = (s: unknown): string =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/**
 * Format milliseconds for people. Pure.
 *
 * @param ms Milliseconds, e.g. 1530.
 * @returns  e.g. "1.5 s", or "120 ms" under a second.
 */
export const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

/**
 * Format a cost in USD for people. Pure.
 *
 * @param usd Dollars, e.g. 0.0123; null or undefined when unknown.
 * @returns   e.g. "$0.0123", or "—" when unknown.
 */
export const fmtUsd = (usd: number | null | undefined) => (typeof usd === "number" ? `$${usd.toFixed(4)}` : "—");

/**
 * A coloured pill. Pure.
 *
 * @param text  Label, e.g. "passed 2/3".
 * @param color "ok" (green), "bad" (red), "na" (grey) or "run" (blue).
 * @returns     HTML.
 */
export const pill = (text: string, color: "ok" | "bad" | "na" | "run") =>
  `<span class="pill ${color}">${esc(text)}</span>`;

/**
 * Render a list of sessions as rows with the resume hint. Pure.
 *
 * @param rows [label, session] pairs, e.g. [["executor", {...}]].
 * @returns    HTML table, or "" if none.
 */
export function sessionsHtml(rows: [string, Session][]): string {
  if (!rows.length) return "";
  const resume = (s: Session) =>
    s.sessionId
      ? `<code class="copy" title="click to copy">${esc(`${s.cwd ? `cd ${s.cwd} && ` : ""}claude --resume ${s.sessionId}`)}</code>`
      : "—";
  const tr = rows.map(
    ([label, s]) =>
      `<tr><td>${esc(label)}</td><td>${esc(s?.model)} · ${esc(s?.effort)}</td>` +
      `<td>${esc(fmtMs(Number(s?.ms) || 0))}</td><td>${esc(fmtUsd(s?.costUsd))}</td><td>${s ? resume(s) : "—"}` +
      `${s?.error ? `<div class="err">${esc(s.error)}</div>` : ""}</td></tr>`,
  );
  const head = ["session", "model", "time", "cost", "id"].map((h) => `<th scope="col">${h}</th>`).join("");
  return `<div class="scroll"><table class="sessions"><thead><tr>${head}</tr></thead><tbody>${tr.join("")}</tbody></table></div>`;
}

/** A beat older than this means the runner is gone; it beats every 10s. */
export const STALE_MS = 30_000;

/** True if an unfinished run's heartbeat (or start) is fresh, i.e. the runner is still beating. Pure. */
export function alive(run: Loose, now: number): boolean {
  const beat = Date.parse(run.heartbeat ?? run.started ?? "");
  return Number.isFinite(beat) && now - beat < STALE_MS;
}
