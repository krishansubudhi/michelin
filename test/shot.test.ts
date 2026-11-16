// Tests for scripts/shot.ts, no browser: node --test test/shot.test.ts  (or npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, outName, parse, redact } from "../scripts/shot.ts";

test("one url, no flags: one phone light shot at the out path as given", () => {
  const p = parse(["http://x", "/r/a.png"]);
  assert.deepEqual(p.shots, [{ url: "http://x", png: "/r/a.png", preset: "phone", theme: "light" }]);
  assert.equal(p.timings, false);
  assert.equal(p.help, false);
});

test("phone+wide in light+dark is one call: four shots, names suffixed", () => {
  const p = parse(["http://x", "/r/a.png", "--phone", "--wide", "--light", "--dark", "--timings"]);
  assert.deepEqual(
    p.shots.map((s) => s.png),
    ["/r/a-phone-light.png", "/r/a-phone-dark.png", "/r/a-wide-light.png", "/r/a-wide-dark.png"],
  );
  assert.equal(p.timings, true);
});

test("several url/out pairs; a lone url, a bad --wait or an unknown flag is refused", () => {
  assert.equal(parse(["u1", "a.png", "u2", "b.png", "--dark"]).shots.length, 2);
  assert.throws(() => parse(["u1"]), /pairs/);
  assert.throws(() => parse(["u1", "a.png", "--wait=-3"]), /--wait/);
  assert.throws(() => parse(["u1", "a.png", "--tablet"]));
  assert.equal(parse(["--help"]).help, true);
});

test("presets: phone is a 390x844 scale-3 touch iPhone, wide is 1280x800", () => {
  assert.deepEqual(PRESETS.phone.viewport, { width: 390, height: 844 });
  assert.equal(PRESETS.phone.deviceScaleFactor, 3);
  assert.ok(PRESETS.phone.isMobile && PRESETS.phone.hasTouch && /iPhone/.test(PRESETS.phone.userAgent ?? ""));
  assert.deepEqual(PRESETS.wide.viewport, { width: 1280, height: 800 });
});

test("outName adds .png when missing; redact hides a token", () => {
  assert.equal(outName("/r/a", "wide", "dark", true), "/r/a-wide-dark.png");
  assert.equal(redact("http://h:1/?a=1&token=s3cret#x"), "http://h:1/?a=1&token=…#x");
});
