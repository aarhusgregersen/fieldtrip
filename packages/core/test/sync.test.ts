import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, FlowAsyncError, nextSync, runSync, setInputs, start, validateStepSync, visibleFields } from "../src/index.js";
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

  it("calls an async schema only once while drafting", () => {
    const validate = vi.fn(() => Promise.reject(new Error("network down")));
    const flow = defineFlow({
      start: "a",
      steps: { a: { fields: { email: { "~standard": { version: 1, vendor: "test", validate } } } } },
    });
    let state = start(flow);
    for (const email of ["a", "ab", "abc"]) {
      state = setInputs(flow, state, { email });
      expect(visibleFields(flow, state)).toEqual(["email"]);
    }

    expect(validate).toHaveBeenCalledTimes(1);
  });
});
