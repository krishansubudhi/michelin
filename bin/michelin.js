#!/usr/bin/env node
// The `michelin` command as npm installs it (npm install -g github:krishansubudhi/michelin). Node refuses to strip TypeScript types for
// files under node_modules (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so this plain-JS entry registers a load hook
// that strips this package's src/*.ts itself (module.stripTypeScriptTypes, its ExperimentalWarning muted), then runs
// the runner's cli().
//
// Test: node bin/michelin.js --help; across the edge: npm pack, npm install the tarball, node_modules/.bin/michelin --help.

import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

/** URL prefix of this package's TypeScript sources, e.g. "file:///x/node_modules/michelin-eval/src/". */
const SRC = new URL("../src/", import.meta.url).href;

const emitWarning = process.emitWarning.bind(process);
/**
 * Drop the one ExperimentalWarning stripTypeScriptTypes raises on each use; pass every other warning on.
 *
 * @param {string | Error} warning The warning, e.g. "stripTypeScriptTypes is an experimental feature ...".
 * @param {...unknown} rest        Its type, code and other arguments, e.g. "ExperimentalWarning".
 */
process.emitWarning = (warning, ...rest) => {
  if (!String(warning).includes("stripTypeScriptTypes")) emitWarning(warning, ...rest);
};

/**
 * Load hook: this package's src/*.ts files load as ES modules with their types stripped; anything else loads as usual.
 *
 * @param {string} url       The module's URL, e.g. "file:///x/node_modules/michelin-eval/src/run/runner.ts".
 * @param {object} context   Node's load context, passed on unchanged.
 * @param {Function} nextLoad The next loader in the chain.
 * @returns {object}         {format: "module", source, shortCircuit: true} for our .ts, else nextLoad's result.
 */
function load(url, context, nextLoad) {
  if (!url.startsWith(SRC) || !url.endsWith(".ts")) return nextLoad(url, context);
  const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"));
  return { format: "module", source, shortCircuit: true };
}

registerHooks({ load });
const { cli } = await import("../src/run/runner.ts");
cli();
