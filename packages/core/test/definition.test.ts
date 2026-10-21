import { describe, expect, it } from "vitest";
import { z } from "zod";
import { analyze, type FlowDefinition, FlowDefinitionError, fromDefinition, matches, paths, run } from "../src/index.js";

type FieldDef = { type: "text" | "number" | "checkbox" | "choice"; required?: boolean; options?: string[] };

const schema = (field: FieldDef) => {
  const base = {
    text: z.string(),
    number: z.coerce.number(),
    checkbox: z.boolean(),
    choice: z.enum((field.options ?? []) as [string, ...string[]]),
  }[field.type];
  return field.required ? base : base.optional();
};

const definition: FlowDefinition<FieldDef> = {
  start: "country",
  steps: {
    country: { fields: { code: { type: "choice", options: ["DK", "SE"], required: true } }, next: "customer" },
    customer: {
      fields: { kind: { type: "choice", options: ["person", "company"], required: true } },
      next: [
        {
          to: "vat",
          when: [
            { step: "customer", field: "kind", op: "equals", value: "company" },
            { step: "country", field: "code", op: "equals", value: "DK" },
          ],
        },
        { to: "done" },
      ],
    },
    vat: { fields: { cvr: { type: "text", required: true } }, next: "done" },
    done: {},
  },
};

describe("fromDefinition", () => {
  const flow = fromDefinition(definition, { schema });

  it("runs like a code-defined flow, including conditions on earlier steps", async () => {
    const dk = await run(flow, { country: { code: "DK" }, customer: { kind: "company" }, vat: { cvr: "12345678" } });
    const se = await run(flow, { country: { code: "SE" }, customer: { kind: "company" } });

    expect(dk.path).toEqual(["country", "customer", "vat", "done"]);
    expect(se.path).toEqual(["country", "customer", "done"]);
  });

  it("enforces required fields through the supplied schemas", async () => {
    const outcome = await run(flow, { country: {} });
    expect(outcome.status).toBe("invalid");
  });

  it("is analyzable", () => {
    expect(paths(flow)).toHaveLength(2);
    expect(analyze(flow)).toEqual([]);
  });

  it("rejects conditions that point at fields that no longer exist", () => {
    const broken: FlowDefinition<FieldDef> = {
      start: "a",
      steps: {
        a: { next: [{ to: "b", when: [{ step: "a", field: "deleted", op: "isChecked" }] }, { to: "b" }] },
        b: {},
      },
    };
    expect(() => fromDefinition(broken, { schema })).toThrow(FlowDefinitionError);
  });
});

describe("matches", () => {
  const is = (op: Parameters<typeof matches>[0]["op"], actual: unknown, value?: unknown) =>
    matches({ step: "s", field: "f", op, value }, actual);

  it("compares without coercion", () => {
    expect(is("equals", "DK", "DK")).toBe(true);
    expect(is("equals", 5, "5")).toBe(false);
    expect(is("greaterThan", 21, 20)).toBe(true);
    expect(is("greaterThan", "21", 20)).toBe(false);
    expect(is("lessThan", 3, 10)).toBe(true);
  });

  it("handles strings, lists and emptiness", () => {
    expect(is("contains", "hello world", "world")).toBe(true);
    expect(is("contains", ["a", "b"], "b")).toBe(true);
    expect(is("isEmpty", "")).toBe(true);
    expect(is("isEmpty", [])).toBe(true);
    expect(is("isNotEmpty", 0)).toBe(true);
    expect(is("isChecked", true)).toBe(true);
    expect(is("isNotChecked", undefined)).toBe(true);
  });
});
