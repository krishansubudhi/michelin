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
  assert.match(html, /<b>math-add<\/b> <span class="pill ok">g&lt;1&gt; wins<\/span>/);
  assert.match(html, /<span class="pill ok">g&lt;1&gt; wins<\/span> <span class="muted">Judge 1 \(/);
  assert.match(html, /g&lt;1&gt; shown as A: g&lt;1&gt;\. A said 13[\s\S]*shown as B: g&lt;1&gt;\. B said 13/);
  assert.doesNotMatch(html, /<1>/);
});

test("compareHtml: measures add a Times and metrics table with a column per metric; none leaves it out", () => {
  const rows = [{ name: "g", wins: 0, losses: 0, ties: 0, games: 0, winRate: 0, elo: 1000 }];
  const m = { cuj: "c", run: "g", ms: 1500, wall: 9000, metrics: { "<tok>": "1<2" } };
  const html = compareHtml(rows, [], 0, [m]);
  assert.match(
    html,
    /<h2>Times and metrics<\/h2>[\s\S]*<th scope="col">wall time<\/th><th scope="col">&lt;tok&gt;<\/th>/,
  );
  assert.match(html, /<th scope="row">c<\/th><td>g<\/td><td>1\.5 s<\/td><td>9\.0 s<\/td><td>1&lt;2<\/td>/);
  assert.doesNotMatch(compareHtml(rows, [], 0), /Times and metrics/);
});

test("compareHtml: a slim credit line above the title and the 'Made with Michelin' footer, both linking the repo", () => {
  const html = compareHtml([], [], 0);
  assert.match(
    html,
    /<body><p class="made-top">Made with Michelin · npm i -g michelin-eval · <a href="https:\/\/github\.com\/krishansubudhi\/michelin">GitHub<\/a><\/p><header class="bar">/,
  );
  assert.match(
    html,
    /<\/main><footer class="made">Made with Michelin · <a href="https:\/\/github\.com\/krishansubudhi\/michelin">github\.com\/krishansubudhi\/michelin<\/a><\/footer><\/body>/,
  );
});
