// Tests for compare-html.ts: the compare page shows the table, the cost and every judge's reasons, escaped.
// Run: npm test (no LLM).

import { test } from "node:test";
import assert from "node:assert/strict";
import { compareHtml } from "../src/report/compare-html.ts";

test("compareHtml: header bar, Head-to-head table, cost, and each game's verdicts with names restored", () => {
  const rows = [
    { name: "g<1>", wins: 1, losses: 0, ties: 0, games: 1, winRate: 1, elo: 1016 },
    { name: "q", wins: 0, losses: 1, ties: 0, games: 1, winRate: 0, elo: 984 },
  ];
  const v = { ab: "A", ba: "B", result: "first" as const, whyAB: "A said 13", whyBA: "B said 13" };
  const html = compareHtml(rows, [{ cuj: "math-add", a: "g<1>", b: "q", winner: "a", judges: { "J-high": v } }], 0.02);
  assert.match(html, /<header class="bar">[\s\S]*g&lt;1&gt; vs q[\s\S]*total judge cost \$0\.0200/);
  assert.match(
    html,
    /<h2>Head-to-head<\/h2>[\s\S]*<th scope="row">g&lt;1&gt;<\/th><td>1-0-0<\/td><td>100%<\/td><td>1016/,
  );
  assert.match(html, /math-add: g&lt;1&gt; vs q · winner g&lt;1&gt;/);
  assert.match(html, /g&lt;1&gt; shown as A: g&lt;1&gt;\. A said 13[\s\S]*shown as B: g&lt;1&gt;\. B said 13/);
  assert.doesNotMatch(html, /<1>/);
});
