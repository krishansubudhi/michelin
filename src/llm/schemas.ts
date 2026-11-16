// Schemas: the typed JSON every LLM role must return, in one place.
//
// Each role has a JSON Schema (passed to `claude --json-schema`) and a TS type next to it.
// validate() checks a parsed value against the same schema at runtime, so a malformed reply
// becomes a recorded error, never a quiet pass.
//
// Test: npm test (schemas.test.ts, no LLM).

/** The JSON Schema subset these schemas use: objects, arrays, strings, numbers, booleans. */
export type Schema =
  | { type: "string" }
  | { type: "number" }
  | { type: "boolean" }
  | { type: "array"; items: Schema }
  | { type: "object"; properties: Record<string, Schema>; required: string[]; additionalProperties: false };

const str = { type: "string" } as const;
const num = { type: "number" } as const;
const bool = { type: "boolean" } as const;
const list = (items: Schema): Schema => ({ type: "array", items });
const obj = (properties: Record<string, Schema>): Schema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

/** The constructor's result: did setup work, which steps ran, anything worth knowing. */
export type Setup = { ok: boolean; steps: string[]; notes: string };
export const SETUP: Schema = obj({ ok: bool, steps: list(str), notes: str });

/** One call the executor made to the subject. */
export type Step = { action: string; input: string; got: string; ms: number };
/** The executor's result: every call it made, then a short account. */
export type ExecutorResult = { steps: Step[]; reply: string };
export const EXECUTOR: Schema = obj({ steps: list(obj({ action: str, input: str, got: str, ms: num })), reply: str });

/** The destructor's result: did teardown work, what it cleaned, anything worth knowing. */
export type Teardown = { ok: boolean; cleaned: string[]; notes: string };
export const TEARDOWN: Schema = obj({ ok: bool, cleaned: list(str), notes: str });

/** One judge's call on one expectation. */
export type Vote = { pass: boolean; why: string };
/** One judge's result: one vote per expectation, in order. */
export type JudgeResult = { verdicts: Vote[] };
export const JUDGE: Schema = obj({ verdicts: list(obj({ pass: bool, why: str })) });

/** The array and object members of Schema. */
type ArraySchema = Extract<Schema, { type: "array" }>;
type ObjectSchema = Extract<Schema, { type: "object" }>;

/**
 * Check a value against an array schema: an array whose every item matches. Pure.
 *
 * @param schema The array schema.
 * @param value  The value to check.
 * @param path   Where we are, e.g. "$.steps".
 * @returns      null if it matches, else the first mismatch.
 */
function validateArray(schema: ArraySchema, value: unknown, path: string): string | null {
  if (!Array.isArray(value)) return `${path}: expected array`;
  for (const [i, v] of value.entries()) {
    const e = validate(schema.items, v, `${path}[${i}]`);
    if (e) return e;
  }
  return null;
}

/**
 * Check a value against an object schema: every required key, no others, each matching. Pure.
 *
 * @param schema The object schema.
 * @param value  The value to check.
 * @param path   Where we are, e.g. "$".
 * @returns      null if it matches, else the first mismatch.
 */
function validateObject(schema: ObjectSchema, value: unknown, path: string): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return `${path}: expected object`;
  for (const k of schema.required) if (!(k in value)) return `${path}.${k}: missing`;
  for (const [k, v] of Object.entries(value)) {
    const s = schema.properties[k];
    if (!s) return `${path}.${k}: unexpected field`;
    const e = validate(s, v, `${path}.${k}`);
    if (e) return e;
  }
  return null;
}

/**
 * Check a value against a schema. Pure.
 *
 * @param schema The schema, e.g. SETUP.
 * @param value  The parsed JSON, e.g. {ok: true, steps: [], notes: ""}.
 * @param path   Where we are, for the message; default "$", e.g. "$.steps[0]".
 * @returns      null if it matches, else the first mismatch, e.g. "$.ok: expected boolean".
 */
export function validate(schema: Schema, value: unknown, path = "$"): string | null {
  if (schema.type === "array") return validateArray(schema, value, path);
  if (schema.type === "object") return validateObject(schema, value, path);
  return typeof value === schema.type && !(schema.type === "number" && !Number.isFinite(value))
    ? null
    : `${path}: expected ${schema.type}`;
}

/** A role's output after validation: the typed data, or why it was refused. */
export type Checked<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Validate one LLM result against its role's schema. Pure.
 *
 * @param schema The role's schema, e.g. EXECUTOR.
 * @param data   The structured output, or null if the call returned none.
 * @param error  The call's own error, e.g. "exit 1" or "timeout"; null if it ran fine.
 * @returns      {ok: true, data} if valid; otherwise {ok: false, error} naming what went wrong.
 */
export function check<T>(schema: Schema, data: unknown, error: string | null): Checked<T> {
  if (error) return { ok: false, error };
  if (data === null || data === undefined) return { ok: false, error: "no structured output" };
  const e = validate(schema, data);
  return e ? { ok: false, error: `invalid output: ${e}` } : { ok: true, data: data as T };
}
