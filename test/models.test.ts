// Tests for models.ts, no LLM: node --test test/models.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { command, llm, parseCliOutput, toSession } from "../src/llm/models.ts";
import { SETUP } from "../src/llm/schemas.ts";

const base = [
  "-p",
  "--model",
  "claude-opus-5-5",
  "--effort",
  "high",
  "--permission-mode",
  "bypassPermissions",
  "--setting-sources",
  "user",
  "--strict-mcp-config",
  "--output-format",
  "json",
];

test("claude models go through the CLI with --effort, no settings files, no MCP, and JSON output", () => {
  assert.deepEqual(command({ model: "claude-opus-5-5", effort: "high" }), ["claude", base]);
  assert.deepEqual(command({ model: "claude-fable-5-2", effort: "high" })[1].slice(1, 3), [
    "--model",
    "claude-fable-5-2",
  ]);
});

test("a role schema is passed as --json-schema", () => {
  const [, args] = command({ model: "claude-opus-5-5", effort: "high" }, { schema: SETUP });
  assert.deepEqual(args.slice(0, base.length), base);
  assert.equal(args[base.length], "--json-schema");
  assert.deepEqual(JSON.parse(args[base.length + 1]), SETUP);
});

test('tools: "" turns every tool off', () => {
  const [, args] = command({ model: "claude-opus-5-5", effort: "high" }, { tools: "" });
  assert.deepEqual(args.slice(base.length), ["--tools", ""]);
});

test("llm() sends the prompt over stdin, never in the spawned command line", async () => {
  // A fake claude on PATH records its argv and stdin, then prints a valid result.
  const dir = mkdtempSync(join(tmpdir(), "fake-claude-"));
  writeFileSync(
    join(dir, "claude"),
    `#!/bin/sh\nprintf '%s\\n' "$@" >"${dir}/argv"; cat >"${dir}/stdin"; echo '{"result":"ok","session_id":"s"}'\n`,
  );
  chmodSync(join(dir, "claude"), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${dir}:${path}`;
  try {
    const prompt = "secret prompt /tmp/michelin/runs/x";
    const r = await llm({ model: "claude-opus-5-5", effort: "high" }, prompt, { logPath: join(dir, "log") });
    assert.equal(r.error, null);
    assert.ok(!readFileSync(join(dir, "argv"), "utf8").includes("secret prompt"));
    assert.equal(readFileSync(join(dir, "stdin"), "utf8"), prompt);
  } finally {
    process.env.PATH = path;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("llm() timeout kills the CLI's whole process tree, grandchildren included", async () => {
  // A fake claude that starts a grandchild `sleep 300`, records its pid, then hangs.
  const dir = mkdtempSync(join(tmpdir(), "fake-claude-"));
  writeFileSync(join(dir, "claude"), `#!/bin/sh\nsleep 300 &\necho $! >"${dir}/pid"\nwait\n`);
  chmodSync(join(dir, "claude"), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${dir}:${path}`;
  try {
    const r = await llm({ model: "claude-opus-5-5", effort: "high" }, "p", { timeoutS: 1, logPath: join(dir, "log") });
    assert.match(r.error ?? "", /timeout after 1s/);
    const pid = Number(readFileSync(join(dir, "pid"), "utf8"));
    assert.ok(pid > 0);
    await new Promise((ok) => setTimeout(ok, 200));
    assert.throws(() => process.kill(pid, 0), /ESRCH/, "grandchild sleep should be dead");
  } finally {
    process.env.PATH = path;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a wrong model id fails at its call with an error naming the id", async () => {
  // A fake claude answering the way the real one does for an unknown model: exit 1, is_error, subtype "success".
  const dir = mkdtempSync(join(tmpdir(), "fake-claude-"));
  const reply =
    '{"is_error":true,"subtype":"success","api_error_status":404,"result":"There is an issue with the selected model."}';
  writeFileSync(join(dir, "claude"), `#!/bin/sh\ncat >/dev/null; echo '${reply}'; exit 1\n`);
  chmodSync(join(dir, "claude"), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${dir}:${path}`;
  try {
    const r = await llm({ model: "claude-nope-9", effort: "high" }, "p", { logPath: join(dir, "log") });
    assert.match(r.error ?? "", /^exit 1, claude-nope-9: claude error: There is an issue with the selected model/);
    assert.match(readFileSync(join(dir, "log"), "utf8"), /claude-nope-9/);
  } finally {
    process.env.PATH = path;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseCliOutput reads result, structured_output and session_id", () => {
  const out = JSON.stringify({
    result: " hi \n",
    session_id: "abc-123",
    total_cost_usd: 0.25,
    structured_output: { ok: true },
    is_error: false,
  });
  assert.deepEqual(parseCliOutput(out), {
    text: "hi",
    data: { ok: true },
    sessionId: "abc-123",
    costUsd: 0.25,
    error: null,
  });
});

test("parseCliOutput: missing fields are null, a CLI error is an error, non-JSON is an error", () => {
  assert.deepEqual(parseCliOutput('{"result":"x"}'), {
    text: "x",
    data: null,
    sessionId: null,
    costUsd: null,
    error: null,
  });
  assert.match(
    parseCliOutput('{"is_error":true,"subtype":"error_max_turns","session_id":"s"}').error ?? "",
    /error_max_turns/,
  );
  assert.deepEqual(parseCliOutput("API Error: 400"), {
    text: "API Error: 400",
    data: null,
    sessionId: null,
    costUsd: null,
    error: "stdout is not JSON",
  });
});

test("toSession records cost, and the folder only for scratch calls", () => {
  const pick = { model: "claude-opus-5-5", effort: "high" } as const;
  const r = { text: "", data: null, sessionId: "s", ms: 9, costUsd: 0.5, error: null };
  assert.deepEqual(toSession(pick, r, null), { ...pick, sessionId: "s", ms: 9, costUsd: 0.5, error: null });
  assert.equal(toSession(pick, { ...r, cwd: "/tmp/x" }, "bad").cwd, "/tmp/x");
});
