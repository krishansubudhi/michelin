// Tests for cujs.ts, no LLM: node --test test/cujs.test.ts  (or npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SUBJECT_DIRS,
  checkUniqueIds,
  cujId,
  expandCujs,
  externalSubjectDirs,
  loadCuj,
  resolveArg,
  runGroups,
} from "../src/run/cujs.ts";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
/** Every .yaml under a folder, at any depth, sorted. */
const allCujs = (dir: string) =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => join(dir, f))
    .sort();

test("every subject's and shared CUJs load with the right field types", () => {
  const cujs = SUBJECT_DIRS.flatMap(allCujs);
  assert.ok(cujs.length > 0);
  for (const p of cujs) loadCuj(p); // throws on a bad CUJ
});

test("loadCuj refuses an unknown field, e.g. a typo, and names it", () => {
  const p = join(tmp("cuj-"), "typo.yaml");
  writeFileSync(p, "instruction: hi\ntimeout_s: 5\nexpectations: [a]\nexpectaions: [b]\n");
  assert.throws(() => loadCuj(p), /typo\.yaml: unknown field: expectaions/);
  writeFileSync(
    p,
    "instruction: hi\ntimeout_s: 5\nexpectations: [a]\nstory: s\ngiven: {memory: [m], clock: '07:10'}\n",
  );
  assert.deepEqual(loadCuj(p).given, { memory: ["m"], clock: "07:10" });
  writeFileSync(p, "instruction: hi\ntimeout_s: 5\nexpectations: [a]\ncontext: c\n");
  assert.throws(() => loadCuj(p), /unknown field: context/);
});

test("loadCuj refuses a given that is not a map", () => {
  const p = join(tmp("cuj-"), "given.yaml");
  for (const g of ["[a, b]", "x", "", "5"]) {
    writeFileSync(p, `instruction: hi\ntimeout_s: 5\nexpectations: [a]\ngiven: ${g}\n`);
    assert.throws(() => loadCuj(p), /given\.yaml: given must be a map/);
  }
});

test("a CUJ path becomes its id: the path under cujs/", () => {
  assert.equal(cujId("test/fixtures/subjects/toy-v1/cujs/chat/name.yaml"), "chat-name");
  assert.equal(cujId("subjects/toy/cujs/toy/country.yaml"), "toy-country");
});

test("loadCuj refuses a bad CUJ and names the file", () => {
  const d = tmp("cuj-");
  const bad = {
    "no-timeout.yaml": "instruction: hi\nexpectations: [a]\n",
    "timeout-string.yaml": "instruction: hi\ntimeout_s: '5'\nexpectations: [a]\n",
    "expect-number.yaml": "instruction: hi\ntimeout_s: 5\nexpectations: [1]\n",
    "empty.yaml": "",
  };
  for (const [name, body] of Object.entries(bad)) {
    writeFileSync(join(d, name), body);
    assert.throws(() => loadCuj(join(d, name)), new RegExp(`${name}: needs instruction`));
  }
  const worse = {
    "zero-timeout.yaml": ["timeout_s: 0\nexpectations: [a]", /timeout_s must be a positive number/],
    "no-expectations.yaml": ["timeout_s: 5\nexpectations: []", /expectations must be a non-empty list/],
    "blank-expectation.yaml": ["timeout_s: 5\nexpectations: ['  ']", /expectations must be a non-empty list/],
  } as const;
  for (const [name, [body, msg]] of Object.entries(worse)) {
    writeFileSync(join(d, name), `instruction: hi\n${body}\n`);
    assert.throws(() => loadCuj(join(d, name)), msg);
  }
});

test("two CUJ files with the same id fail early, naming both", () => {
  checkUniqueIds([
    "test/fixtures/subjects/toy-v1/cujs/chat/name.yaml",
    "test/fixtures/subjects/toy-v1/cujs/chat/country.yaml",
  ]);
  assert.throws(
    () =>
      checkUniqueIds([
        "test/fixtures/subjects/toy-v1/cujs/chat/name.yaml",
        "test/fixtures/subjects/toy-v1/cujs/chat/name.yaml",
      ]),
    /duplicate CUJ id chat-name: test\/fixtures\/subjects\/toy-v1\/cujs\/chat\/name\.yaml, test\/fixtures/,
  );
  assert.throws(() => checkUniqueIds(["s/cujs/a/b.yaml", "s/cujs/a-b.yaml"]), /duplicate CUJ id a-b/);
});

test("a nested CUJ path becomes a dashed id, from the last cujs/ folder", () => {
  assert.equal(cujId("s/cujs/a/b/c.yaml"), "a-b-c");
  assert.equal(cujId("cujs/x/cujs/y.yaml"), "y");
  assert.equal(cujId("../other/cujs/hi.yaml"), "hi");
});

test("a CUJ outside any cujs/ folder is named by its path from the current folder", () => {
  assert.equal(cujId("suite/fast_hello.yaml"), "suite-fast_hello");
  assert.equal(cujId("../other/hi.yaml"), "other-hi");
});

test("a CUJ folder expands to every .yaml directly in it, sorted; files stay as given", () => {
  const d = tmp("cujdir-");
  for (const f of ["b.yaml", "a.yaml", "notes.md"]) writeFileSync(join(d, f), "");
  mkdirSync(join(d, "sub"));
  writeFileSync(join(d, "sub", "c.yaml"), "");
  assert.deepEqual(expandCujs([d, "x/one.yaml"]), [join(d, "a.yaml"), join(d, "b.yaml"), "x/one.yaml"]);
  assert.deepEqual(expandCujs(["subjects/toy/cujs/toy"]), [
    "subjects/toy/cujs/toy/country.yaml",
    "subjects/toy/cujs/toy/name.yaml",
  ]);
  const empty = tmp("cujempty-");
  assert.throws(() => expandCujs([empty]), new RegExp(`${empty}: no .yaml CUJ files`));
});

test("CUJs listed one by one share a run; a folder gives each CUJ a fresh run of its own", () => {
  assert.deepEqual(runGroups(["x/a.yaml", "x/b.yaml"], ["x/a.yaml", "x/b.yaml"]), [["x/a.yaml", "x/b.yaml"]]);
  const files = expandCujs(["subjects/toy/cujs/toy"]);
  assert.deepEqual(
    runGroups(["subjects/toy/cujs/toy"], files),
    files.map((f) => [f]),
  );
});

test("MICHELIN_SUBJECTS lists external subject folders, colon-separated like PATH", () => {
  assert.deepEqual(externalSubjectDirs({ MICHELIN_SUBJECTS: "/a:/b::" }), ["/a", "/b"]);
  assert.deepEqual(externalSubjectDirs({}), []);
});

test("resolveArg keeps a path that exists, else finds it under the first external folder that has it", () => {
  const [a, b] = [tmp("ext-a-"), tmp("ext-b-")];
  mkdirSync(join(b, "app", "cujs"), { recursive: true });
  assert.equal(resolveArg("subjects/toy", [b]), "subjects/toy");
  assert.equal(resolveArg("app/cujs", [a, b]), join(b, "app", "cujs"));
  assert.equal(resolveArg("nowhere/x.yaml", [a, b]), "nowhere/x.yaml");
});
