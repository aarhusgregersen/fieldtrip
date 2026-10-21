import { describe, expect, it } from "vitest";
import { z } from "zod";
import { analyze, defineFlow, FlowDefinitionError, paths } from "../src/index.js";
import { onboarding } from "./onboarding.js";

describe("analyze", () => {
  it("enumerates every path through the flow", () => {
    expect(paths(onboarding)).toEqual([
      ["company", "sales", "done"],
      ["company", "useCase", "shopify", "invite", "done"],
      ["company", "useCase", "invite", "done"],
    ]);
  });

  it("finds nothing wrong with a well-formed flow", () => {
    expect(analyze(onboarding)).toEqual([]);
  });

  it("flags definition smells", () => {
    const flow = defineFlow({
      start: "a",
      steps: {
        a: {
          fields: { n: z.number() },
          next: [{ to: "b", when: (v) => v.n > 1 }],
        },
        b: { next: [{ to: "c" }, { to: "end" }] },
        c: { next: "c" },
        end: {},
        orphan: { next: "end" },
      },
    });

    expect(analyze(flow)).toEqual([
      { kind: "no-fallback", step: "a" },
      { kind: "dead-transition", step: "b", to: "end" },
      { kind: "cannot-finish", step: "c" },
      { kind: "unreachable", step: "orphan" },
    ]);
  });

  it("rejects transitions to unknown steps at runtime too", () => {
    const untyped = { start: "a", steps: { a: { next: "ghost" } } } as never;
    expect(() => defineFlow(untyped)).toThrow(FlowDefinitionError);
  });
});
