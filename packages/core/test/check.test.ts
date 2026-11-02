import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  checkDefinition,
  definitionJsonSchema,
  type FlowDefinition,
  FlowDefinitionError,
  fromDefinition,
} from "../src/index.js";

type FieldDef = { type: "text" | "number" | "choice"; options?: string[] };

const schema = (field: FieldDef) => {
  if (field.type === "choice" && !field.options?.length) throw new Error("a choice needs options");
  return { text: z.string(), number: z.coerce.number(), choice: z.enum((field.options ?? []) as [string]) }[field.type];
};

const fieldJsonSchema = {
  type: "object",
  required: ["type"],
  additionalProperties: false,
  properties: {
    type: { enum: ["text", "number", "choice"] },
    options: { type: "array", items: { type: "string" } },
  },
};

const valid: FlowDefinition<FieldDef> = {
  start: "customer",
  steps: {
    customer: {
      fields: { kind: { type: "choice", options: ["person", "company"] }, size: { type: "number" } },
      next: [
        { to: "vat", when: [{ step: "customer", field: "kind", op: "equals", value: "company" }] },
        { to: "done" },
      ],
    },
    vat: { fields: { cvr: { type: "text" } }, next: "done" },
    done: {},
  },
};

describe("checkDefinition", () => {
  it("finds nothing in a sound definition", () => {
    expect(checkDefinition(valid, { schema })).toEqual([]);
  });

  it("reports every broken reference at once, each with its location", () => {
    const broken: FlowDefinition<FieldDef> = {
      start: "begin",
      steps: {
        customer: {
          fields: { kind: { type: "text" } },
          fieldsVisibleWhen: { gone: [] },
          next: [
            { to: "vat", when: [{ step: "nowhere", field: "x", op: "isChecked" }] },
            { to: "done", when: [{ step: "customer", field: "typo", op: "isEmpty" }] },
            { to: "missing" },
          ],
        },
        done: {},
      },
    };

    expect(checkDefinition(broken).map(({ kind, path }) => ({ kind, path }))).toEqual([
      { kind: "unknown-start", path: ["start"] },
      { kind: "unknown-target", path: ["steps", "customer", "next", 0, "to"] },
      { kind: "unknown-step", path: ["steps", "customer", "next", 0, "when", 0, "step"] },
      { kind: "unknown-field", path: ["steps", "customer", "next", 1, "when", 0, "field"] },
      { kind: "unknown-target", path: ["steps", "customer", "next", 2, "to"] },
      { kind: "unknown-field", path: ["steps", "customer", "fieldsVisibleWhen", "gone"] },
    ]);
  });

  it("doesn't mistake inherited object keys for steps", () => {
    const issues = checkDefinition({ start: "toString", steps: { a: { next: "constructor" } } });
    expect(issues.map((i) => i.kind)).toEqual(["unknown-start", "unknown-target"]);
  });

  it("reports fields the schema mapper rejects", () => {
    const definition: FlowDefinition<FieldDef> = { start: "a", steps: { a: { fields: { pick: { type: "choice" } } } } };
    expect(checkDefinition(definition, { schema })).toEqual([
      {
        severity: "error",
        kind: "invalid-field",
        path: ["steps", "a", "fields", "pick"],
        message: 'Field "a.pick" is invalid: a choice needs options',
      },
    ]);
  });

  it("warns about conditions that can never match", () => {
    const at = (op: string, value?: unknown) => ({
      start: "a",
      steps: { a: { fields: { n: { type: "number" } }, next: [{ to: "b", when: [{ step: "a", field: "n", op, value }] }, { to: "b" }] }, b: {} },
    }) as FlowDefinition<FieldDef>;

    const warnings = (op: string, value?: unknown) =>
      checkDefinition(at(op, value)).map(({ severity, kind, path }) => ({ severity, kind, path: path.at(-1) }));

    expect(warnings("in", [1])).toEqual([{ severity: "warning", kind: "unknown-operator", path: "op" }]);
    expect(warnings("equals")).toEqual([{ severity: "warning", kind: "invalid-value", path: "value" }]);
    expect(warnings("greaterThan", "10")).toEqual([{ severity: "warning", kind: "invalid-value", path: "value" }]);
    expect(warnings("greaterThan", 10)).toEqual([]);
    expect(warnings("isEmpty")).toEqual([]);
  });

  it("includes the flow analysis, pointing at the offending transition", () => {
    const definition: FlowDefinition<FieldDef> = {
      start: "a",
      steps: {
        a: {
          fields: { x: { type: "text" } },
          next: [{ to: "b" }, { to: "c", when: [{ step: "a", field: "x", op: "isEmpty" }] }, { to: "d" }],
        },
        b: { fields: { y: { type: "text" } }, next: [{ to: "end", when: [{ step: "b", field: "y", op: "isEmpty" }] }] },
        c: { next: "c" },
        d: {},
        end: {},
        orphan: {},
      },
    };

    expect(checkDefinition(definition).map(({ kind, path }) => ({ kind, path }))).toEqual([
      { kind: "dead-transition", path: ["steps", "a", "next", 1] },
      { kind: "dead-transition", path: ["steps", "a", "next", 2] },
      { kind: "no-fallback", path: ["steps", "b", "next"] },
      { kind: "cannot-finish", path: ["steps", "c"] },
      { kind: "unreachable", path: ["steps", "orphan"] },
    ]);
  });

  it("skips the analysis when the graph itself is broken", () => {
    const issues = checkDefinition({ start: "a", steps: { a: { next: "nope" }, orphan: {} } });
    expect(issues.map((i) => i.kind)).toEqual(["unknown-target"]);
  });
});

describe("fromDefinition", () => {
  it("throws on errors but compiles despite warnings", () => {
    expect(() => fromDefinition({ ...valid, start: "nope" }, { schema })).toThrow(FlowDefinitionError);
    expect(() => fromDefinition({ start: "a", steps: { a: { next: "a" }, orphan: {} } }, { schema })).not.toThrow();
  });

  it("lets errors from the schema mapper through unchanged", () => {
    const definition: FlowDefinition<FieldDef> = { start: "a", steps: { a: { fields: { pick: { type: "choice" } } } } };
    expect(() => fromDefinition(definition, { schema })).toThrow("a choice needs options");
  });
});

describe("definitionJsonSchema", () => {
  const validate = new Ajv2020({ strict: false }).compile(definitionJsonSchema(fieldJsonSchema));

  it("accepts a sound definition", () => {
    expect(validate(valid)).toBe(true);
  });

  it("rejects malformed shapes", () => {
    expect(validate({ start: "a", steps: { a: { next: 42 } } })).toBe(false);
    expect(validate({ start: "a", steps: { a: { fields: { f: { type: "slider" } } } } })).toBe(false);
    expect(validate({ start: "a", steps: { a: { next: [{ to: "a", when: [{ step: "a", field: "f", op: "in" }] }] } } })).toBe(
      false,
    );
    expect(validate({ start: "a", steps: {}, extra: true })).toBe(false);
  });
});
