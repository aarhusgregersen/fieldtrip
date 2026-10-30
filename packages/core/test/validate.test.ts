import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, runSync } from "../src/index.js";

const flow = defineFlow({
  start: "audience",
  steps: {
    audience: { fields: { kind: z.enum(["private", "business"]) }, next: "frequency" },
    frequency: {
      fields: { every: z.enum(["week", "month", "daily"]) },
      validate: (v, all) =>
        v.every === "daily" && all.audience?.kind !== "business" ? { every: ["Only for businesses"] } : undefined,
      next: "done",
    },
    done: {},
  },
});

describe("step validation", () => {
  it("rejects values based on earlier steps", () => {
    const outcome = runSync(flow, { audience: { kind: "private" }, frequency: { every: "daily" } });

    expect(outcome.status).toBe("invalid");
    if (outcome.status === "invalid") expect(outcome.issues).toEqual({ every: ["Only for businesses"] });
  });

  it("accepts what the earlier steps allow", () => {
    expect(runSync(flow, { audience: { kind: "business" }, frequency: { every: "daily" } }).status).toBe("complete");
  });

  it("ignores empty issue lists", () => {
    const lenient = defineFlow({
      start: "a",
      steps: { a: { fields: { n: z.number() }, validate: () => ({ n: [] }) } },
    });

    expect(runSync(lenient, { a: { n: 1 } }).status).toBe("complete");
  });

  it("only runs once every field parses", () => {
    let calls = 0;
    const counted = defineFlow({
      start: "a",
      steps: {
        a: {
          fields: { n: z.number() },
          validate: () => {
            calls++;
            return undefined;
          },
        },
      },
    });

    runSync(counted, { a: { n: "x" as never } });
    expect(calls).toBe(0);
  });
});
