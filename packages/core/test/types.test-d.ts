import { describe, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { conditional, defineFlow, type FieldName, type FlowValues, fromDefinition, setInputs, start, type StepName } from "../src/index.js";
import { onboarding } from "./onboarding.js";

describe("types", () => {
  it("infers step names and values", () => {
    expectTypeOf<StepName<typeof onboarding>>().toEqualTypeOf<
      "company" | "useCase" | "shopify" | "sales" | "invite" | "done"
    >();
    expectTypeOf<NonNullable<FlowValues<typeof onboarding>["company"]>>().toEqualTypeOf<{
      name: string;
      employees: number;
    }>();
    expectTypeOf<NonNullable<FlowValues<typeof onboarding>["done"]>>().toEqualTypeOf<{}>();
    expectTypeOf<FieldName<typeof onboarding>>().toEqualTypeOf<
      "name" | "employees" | "useCase" | "storeUrl" | "phone" | "emails"
    >();
  });

  it("types conditions against the step's own fields and every other step", () => {
    defineFlow({
      start: "country",
      steps: {
        country: { fields: { code: z.enum(["DK", "SE"]) }, next: "type" },
        type: {
          fields: { kind: z.enum(["person", "company"]) },
          next: [
            {
              to: "done",
              when: (v, all) => {
                expectTypeOf(v).toEqualTypeOf<{ kind: "person" | "company" }>();
                expectTypeOf(all.country).toEqualTypeOf<{ code: "DK" | "SE" } | undefined>();
                // @ts-expect-error "DKK" is not a country code
                return all.country?.code === "DKK";
              },
            },
          ],
        },
        done: {},
      },
    });
  });

  it("rejects unknown fields on other steps", () => {
    defineFlow({
      start: "a",
      steps: {
        // @ts-expect-error b has no field "typo"
        a: { fields: { n: z.number() }, next: [{ to: "b", when: (_, all) => all.b?.typo === 1 }] },
        b: { fields: { m: z.string() } },
      },
    });
  });

  it("rejects unknown transition targets and start steps", () => {
    defineFlow({
      start: "a",
      steps: {
        // @ts-expect-error "nope" is not a step
        a: { next: "nope" },
        b: {},
      },
    });

    defineFlow({
      // @ts-expect-error "zzz" is not a step
      start: "zzz",
      steps: { a: {} },
    });
  });

  it("types inputs against the flow's fields", () => {
    setInputs(onboarding, start(onboarding), { employees: "5" });
    // @ts-expect-error no step has a field "employes"
    setInputs(onboarding, start(onboarding), { employes: "5" });
  });
});

describe("types of definition-built flows", () => {
  it("fall back to plain records", () => {
    const flow = fromDefinition({ start: "a", steps: { a: {} } }, { schema: () => z.string() });

    expectTypeOf<StepName<typeof flow>>().toEqualTypeOf<string>();
    expectTypeOf<FieldName<typeof flow>>().toEqualTypeOf<string>();
    setInputs(flow, start(flow), { anything: 1 });
  });
});

describe("types of conditional fields", () => {
  it("types hidden-able fields as optional everywhere", () => {
    const flow = defineFlow({
      start: "a",
      steps: {
        a: {
          fields: { method: z.enum(["email", "phone"]), phone: conditional(z.string()) },
          fieldsVisibleWhen: { phone: (v) => v.method === "phone" },
          next: [{ to: "b", when: (v) => expectTypeOf(v.phone).toEqualTypeOf<string | undefined>() === undefined }],
        },
        b: {},
      },
    });
    expectTypeOf<NonNullable<FlowValues<typeof flow>["a"]>>().toEqualTypeOf<{
      method: "email" | "phone";
      phone?: string;
    }>();
  });

  it("only allows visibility rules for fields marked conditional", () => {
    defineFlow({
      start: "a",
      steps: {
        a: {
          fields: { method: z.string(), phone: z.string() },
          // @ts-expect-error phone is not wrapped in conditional()
          fieldsVisibleWhen: { phone: () => true },
        },
      },
    });
  });
});

describe("mixed conditional and plain fields", () => {
  it("rejects a visibility rule for a plain field next to a conditional one", () => {
    defineFlow({
      start: "a",
      steps: {
        a: {
          fields: { method: z.string(), phone: conditional(z.string()) },
          // @ts-expect-error method is not wrapped in conditional()
          fieldsVisibleWhen: { phone: () => true, method: () => true },
        },
      },
    });
  });
});
