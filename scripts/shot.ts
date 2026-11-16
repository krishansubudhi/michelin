#!/usr/bin/env node
// shot: quick headless screenshots of a web page, for Michelin's executor (its own headless Chrome; never a personal browser profile).
// One call launches one headless system Chrome (playwright, channel "chrome"), shoots every url x preset x theme in
// parallel, then prints one JSON line per PNG saying what it shows (judges read text only, never the PNG).
//
// Usage: node scripts/shot.ts <url> <out.png> [<url> <out.png> ...] [--phone] [--wide] [--light] [--dark] [--timings]
//   --phone       iPhone emulation: 390x844, scale 3, mobile UA, touch (the default preset)
//   --wide        desktop 1280x800
//   --light/--dark  prefers-color-scheme (light is the default); give both for both
//   --timings     add DOMContentLoaded ms to each line
//   --full-page   the whole page, not just the first screen
//   --wait=<ms>   extra settle time after load (default 0)
// Two presets or two themes make a matrix: out.png becomes out-phone-light.png, out-wide-dark.png, ...
// Test: node --test test/shot.test.ts (the pure parts; no browser)

import { parseArgs } from "node:util";
import { statSync } from "node:fs";
import { chromium, devices, type BrowserContextOptions, type Page } from "playwright";

const iphone = devices["iPhone 13"];

/** A viewport preset: the playwright context options it sets. */
export const PRESETS: Record<string, BrowserContextOptions> = {
  phone: {
    userAgent: iphone.userAgent,
    screen: { width: 390, height: 844 },
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  wide: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};

/** One PNG to make: which page, where to save it, at which preset and theme. */
export type Shot = { url: string; png: string; preset: string; theme: "light" | "dark" };

/** What a whole call asks for. */
export type Plan = { shots: Shot[]; timings: boolean; fullPage: boolean; waitMs: number; help: boolean };

export const USAGE =
  "usage: shot <url> <out.png> [<url> <out.png> ...] [--phone] [--wide] [--light] [--dark] [--timings] [--full-page] [--wait=ms]";

/**
 * The file name for one cell of the matrix. Pure.
 *
 * @param out    The out path given, e.g. "/r/chat.png".
 * @param preset The preset, e.g. "phone".
 * @param theme  The theme, e.g. "dark".
 * @param matrix Whether several presets or themes were asked for; false keeps `out` as given.
 * @returns      e.g. "/r/chat-phone-dark.png", or "/r/chat.png" when matrix is false.
 */
export const outName = (out: string, preset: string, theme: string, matrix: boolean) =>
  matrix ? out.replace(/(\.png)?$/i, `-${preset}-${theme}.png`) : out;

/**
 * The flags of one group that were given, or the group's first (its default) if none was. Pure.
 *
 * @param v     Parsed flags, e.g. {wide: true, dark: true}.
 * @param names The group, default first, e.g. ["phone", "wide"].
 * @returns     e.g. ["wide"]; ["phone"] when neither was given.
 */
function chosen<T extends string>(v: Record<string, unknown>, names: readonly T[]): T[] {
  const on = names.filter((n) => v[n]);
  return on.length ? on : [names[0]];
}

/**
 * Read --wait. Pure.
 *
 * @param s The flag's text, e.g. "500"; undefined when not given.
 * @returns The ms, e.g. 500; 0 when not given.
 * @throws  Error with the usage line unless it is a number >= 0.
 */
function ms(s: string | undefined): number {
  const n = Number(s ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--wait must be ms >= 0, got ${s}\n${USAGE}`);
  return n;
}

/**
 * Parse the command line into a plan. Pure.
 *
 * @param argv The arguments after the script, e.g. ["http://x", "/r/a.png", "--wide", "--dark"].
 * @returns    The plan: one Shot per url x preset x theme; help: true (and no shots) for --help.
 * @throws     Error with the usage line if urls and outs don't pair up or an option is unknown.
 */
export function parse(argv: string[]): Plan {
  const { values: v, positionals: pos } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      phone: { type: "boolean" },
      wide: { type: "boolean" },
      light: { type: "boolean" },
      dark: { type: "boolean" },
      timings: { type: "boolean" },
      "full-page": { type: "boolean" },
      wait: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (v.help) return { shots: [], timings: false, fullPage: false, waitMs: 0, help: true };
  if (!pos.length || pos.length % 2) throw new Error(`give <url> <out.png> pairs\n${USAGE}`);
  const waitMs = ms(v.wait);
  const presets = chosen(v, ["phone", "wide"]);
  const themes = chosen(v, ["light", "dark"] as const);
  const matrix = presets.length > 1 || themes.length > 1;
  const shots: Shot[] = [];
  for (let i = 0; i < pos.length; i += 2)
    for (const preset of presets)
      for (const theme of themes)
        shots.push({ url: pos[i], png: outName(pos[i + 1], preset, theme, matrix), preset, theme });
  return { shots, timings: !!v.timings, fullPage: !!v["full-page"], waitMs, help: false };
}

/**
 * Hide a url's token so a printed line can't leak it. Pure.
 *
 * @param url e.g. "http://localhost:8792/?token=abc123".
 * @returns   e.g. "http://localhost:8792/?token=…".
 */
export const redact = (url: string) => url.replace(/([?&]token=)[^&#]+/g, "$1…");

/**
 * The text a viewer would read in the picture: visible text nodes inside the shot area, in page order. Runs in the page.
 *
 * @param fullPage true = the whole page; false = the first screen only.
 * @returns        The text, whitespace collapsed, cut at 600 characters.
 */
function visibleText(fullPage: boolean): string {
  const h = fullPage ? Infinity : innerHeight;
  /** Whether a text node is drawn inside the shot area. Defined in here: the page gets this one function. */
  const shown = (n: Node) => {
    const el = n.parentElement;
    if (!n.textContent?.trim() || !el || el.closest("script,style,noscript,template")) return false;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.opacity === "0") return false;
    const r = document.createRange();
    r.selectNodeContents(n);
    return inside(r.getBoundingClientRect());
  };
  /** Whether a box has size and overlaps the shot area. */
  const inside = (b: DOMRect) =>
    b.width * b.height > 0 && b.bottom > 0 && b.top < h && b.right > 0 && b.left < innerWidth;
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (shown(n)) parts.push(n.textContent ?? "");
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 600);
}

/**
 * Load one page and save its PNG.
 *
 * @param page The page, already in its preset's context.
 * @param shot What to shoot.
 * @param plan The call's options.
 * @returns    The line to print: png, preset, theme, viewport, bytes, title, overflowX, text (and dcl_ms with --timings).
 */
async function take(page: Page, shot: Shot, plan: Plan): Promise<object> {
  await page.goto(shot.url, { waitUntil: "load", timeout: 15000 });
  await page.waitForLoadState("networkidle", { timeout: 1000 }).catch(() => {});
  if (plan.waitMs) await page.waitForTimeout(plan.waitMs);
  await page.screenshot({ path: shot.png, fullPage: plan.fullPage });
  const text = await page.evaluate(visibleText, plan.fullPage);
  const facts = await page.evaluate(() => ({
    title: document.title,
    dcl:
      (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)
        ?.domContentLoadedEventEnd ?? -1,
    overflowX: document.documentElement.scrollWidth > innerWidth,
  }));
  const vp = page.viewportSize();
  const scale = PRESETS[shot.preset].deviceScaleFactor ?? 1;
  return {
    png: shot.png,
    url: redact(shot.url),
    preset: shot.preset,
    theme: shot.theme,
    viewport: `${vp?.width}x${vp?.height}@${scale}`,
    bytes: statSync(shot.png).size,
    title: facts.title,
    overflowX: facts.overflowX,
    ...(plan.timings ? { dcl_ms: Math.round(facts.dcl) } : {}),
    text,
  };
}

/**
 * Run a plan: one browser, one context per shot, all in parallel; print a JSON line per shot.
 *
 * @param plan What to shoot.
 * @returns    How many shots failed (each failure prints {png, error}).
 */
async function run(plan: Plan): Promise<number> {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const lines = await Promise.all(
      plan.shots.map(async (s) => {
        const ctx = await browser.newContext({ ...PRESETS[s.preset], colorScheme: s.theme });
        try {
          return await take(await ctx.newPage(), s, plan);
        } catch (e) {
          return { png: s.png, url: redact(s.url), error: (e as Error).message.split("\n")[0] };
        } finally {
          await ctx.close();
        }
      }),
    );
    for (const l of lines) console.log(JSON.stringify(l));
    return lines.filter((l) => "error" in l).length;
  } finally {
    await browser.close();
  }
}

if (import.meta.main) {
  let plan: Plan;
  try {
    plan = parse(process.argv.slice(2));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
  if (plan.help) console.log(USAGE);
  else process.exitCode = (await run(plan)) ? 1 : 0;
}
