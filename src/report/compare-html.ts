// Compare page: `michelin compare`'s report.html, the win-rate table, every game's reasons and the times-and-metrics
// table as one page. Pure.
// Styled like the run report (render.ts): the same precompiled Tailwind and header bar.
//
// Test: npm test (compare-html.test.ts, no LLM).

import type { Game, Row } from "../run/compare.ts";
import { metricNames, secs, type Measure } from "../run/measures.ts";
import { esc, FOOTER_HTML, fmtUsd, TOPLINE_HTML } from "./html.ts";
import { TAILWIND_CSS } from "./tailwind.gen.ts";

/**
 * Who a judge's letter names: A or B mapped back to a run name. Pure.
 *
 * @param g      The game, e.g. {a: "gemma", b: "qwen", ...}.
 * @param letter The judge's winner, e.g. "A"; "tie" or null pass through.
 * @param aIs    The letter run a was shown as in that order, e.g. "A".
 * @returns      e.g. "gemma", "tie" or "no valid verdict".
 */
function named(g: Game, letter: string | null, aIs: "A" | "B"): string {
  return letter === null ? "no valid verdict" : letter === "tie" ? "tie" : letter === aIs ? g.a : g.b;
}

/**
 * One game as a folded card: the winner, then each judge's two verdicts and why. Pure.
 *
 * @param g The game.
 * @returns HTML.
 */
function gameHtml(g: Game): string {
  const won = g.winner === null ? "no valid verdict" : g.winner === "tie" ? "tie" : g.winner === "a" ? g.a : g.b;
  const judges = Object.entries(g.judges).map(
    ([m, v]) =>
      `<li><b>${esc(m)}</b>: ${esc(v.result ?? "no result")}<ul>` +
      `<li>${esc(g.a)} shown as A: ${esc(named(g, v.ab, "A"))}. ${esc(v.whyAB)}</li>` +
      `<li>${esc(g.a)} shown as B: ${esc(named(g, v.ba, "B"))}. ${esc(v.whyBA)}</li></ul></li>`,
  );
  return (
    `<details open><summary>${esc(g.cuj)}: ${esc(g.a)} vs ${esc(g.b)} · winner ${esc(won)}` +
    `${g.bySpeed ? " (judges tied; faster run)" : ""} · ${esc(g.a)} ${secs(g.ms?.a)}, ${esc(g.b)} ${secs(g.ms?.b)}</summary>` +
    `<ul>${judges.join("")}</ul></details>`
  );
}

/**
 * The times-and-metrics section: one row per run per CUJ, program time, wall time, then one column per metric. Pure.
 *
 * @param ms The measures, e.g. [{cuj: "toy-country", run: "gemma", ms: 4000, wall: 9000, metrics: {tokens: "123"}}].
 * @returns  HTML, "" when ms is empty; a missing metric shows "?".
 */
export function measuresHtml(ms: Measure[]): string {
  if (!ms.length) return "";
  const names = metricNames(ms);
  const head = ["CUJ", "run", "program time", "wall time", ...names].map((h) => `<th scope="col">${esc(h)}</th>`);
  const tr = ms.map(
    (m) =>
      `<tr><th scope="row">${esc(m.cuj)}</th><td>${esc(m.run)}</td><td>${secs(m.ms)}</td><td>${secs(m.wall)}</td>` +
      names.map((n) => `<td>${esc(m.metrics[n] ?? "?")}</td>`).join("") +
      `</tr>`,
  );
  return (
    `<section class="card"><h2>Times and metrics</h2>` +
    `<div class="scroll"><table><thead><tr>${head.join("")}</tr></thead><tbody>${tr.join("")}</tbody></table></div>` +
    `</section>`
  );
}

/**
 * The whole compare page. Pure.
 *
 * @param rows    The standings, best first, e.g. [{name: "gemma", wins: 1, losses: 0, ties: 0, games: 1, winRate: 1, elo: 1016}].
 * @param games   Every game, e.g. [{cuj: "toy-country", a: "gemma", b: "qwen", winner: "a", judges: {...}}].
 * @param costUsd Total judge cost in USD, e.g. 0.42.
 * @param measures Every run's times and metrics per CUJ, e.g. [{cuj: "toy-country", run: "gemma", ms: 4000,
 *                 metrics: {tokens: "123"}}]; [] (the default) leaves the "Times and metrics" section out.
 * @returns       The full HTML document.
 */
export function compareHtml(rows: Row[], games: Game[], costUsd: number, measures: Measure[] = []): string {
  const head = ["run", "W-L-T", "win rate", "Elo"].map((h) => `<th scope="col">${h}</th>`).join("");
  const tr = rows.map(
    (r) =>
      `<tr><th scope="row">${esc(r.name)}</th><td>${r.wins}-${r.losses}-${r.ties}</td>` +
      `<td>${Math.round(r.winRate * 100)}%</td><td>${Math.round(r.elo)}</td></tr>`,
  );
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>compare report</title><style>${TAILWIND_CSS}</style></head><body>${TOPLINE_HTML}` +
    `<header class="bar"><div class="bar-in"><h1>${esc(rows.map((r) => r.name).join(" vs "))}</h1>` +
    `<p class="muted">${games.length} game(s) · total judge cost ${esc(fmtUsd(costUsd))}</p></div></header>` +
    `<main class="page"><section class="card"><h2>Head-to-head</h2>` +
    `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${tr.join("")}</tbody></table></div>` +
    `${games.map(gameHtml).join("")}</section>${measuresHtml(measures)}</main>${FOOTER_HTML}</body></html>`
  );
}
