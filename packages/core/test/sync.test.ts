import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, FlowAsyncError, nextSync, runSync, setInputs, start, validateStepSync } from "../src/index.js";
import { onboarding } from "./onboarding.js";

describe("sync API", () => {
  it("plays a flow without promises", () => {
    const outcome = runSync(onboarding, {
      company: { name: "Acme", employees: 3 },
      useCase: { useCase: "agency" },
      invite: {},
    });

    expect(outcome.status).toBe("complete");
    expect(outcome.path).toEqual(["company", "useCase", "invite", "done"]);
  });

  it("validates and advances like the async API", () => {
    const invalid = nextSync(onboarding, setInputs(onboarding, start(onboarding), { name: "" }));
    expect(invalid.ok).toBe(false);

    const valid = nextSync(onboarding, setInputs(onboarding, start(onboarding), { name: "Acme", employees: "50" }));
    expect(valid.state.current).toBe("sales");
  });

  it("refuses async schemas", () => {
    const flow = defineFlow({
      start: "a",
      steps: { a: { fields: { name: z.string().refine(async () => true) } } },
    });
    const state = setInputs(flow, start(flow), { name: "x" });

    expect(() => validateStepSync(flow, state)).toThrow(FlowAsyncError);
    expect(() => runSync(flow, { a: { name: "x" } })).toThrow(/"a.name" has an async schema/);
  });
});
