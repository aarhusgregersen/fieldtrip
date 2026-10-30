import { describe, expect, it } from "vitest";
import { back, FlowStateError, next, path, restore, result, setInputs, start } from "../src/index.js";
import { onboarding } from "./onboarding.js";

async function advance(state: ReturnType<typeof start<typeof onboarding>>, inputs: Record<string, unknown>) {
  const outcome = await next(onboarding, setInputs(onboarding, state, inputs));
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.issues));
  return outcome.state;
}

describe("session", () => {
  it("branches on the submitted values", async () => {
    const small = await advance(start(onboarding), { name: "Acme", employees: "5" });
    expect(small.current).toBe("useCase");

    const big = await advance(start(onboarding), { name: "Acme", employees: "50" });
    expect(big.current).toBe("sales");
  });

  it("refuses to advance with invalid input and reports issues per field", async () => {
    const state = setInputs(onboarding, start(onboarding), { name: "" });
    const outcome = await next(onboarding, state);

    expect(outcome.ok).toBe(false);
    expect(outcome.state.current).toBe("company");
    if (!outcome.ok) expect(Object.keys(outcome.issues).sort()).toEqual(["employees", "name"]);
  });

  it("goes back along the branch actually taken", async () => {
    let state = await advance(start(onboarding), { name: "Acme", employees: 5 });
    state = await advance(state, { useCase: "ecommerce" });
    expect(path(state)).toEqual(["company", "useCase", "shopify"]);

    state = back(onboarding, state);
    expect(state.current).toBe("useCase");
    expect(state.inputs.useCase).toEqual({ useCase: "ecommerce" });
  });

  it("drops values from abandoned branches from the result", async () => {
    let state = await advance(start(onboarding), { name: "Acme", employees: 5 });
    state = await advance(state, { useCase: "ecommerce" });
    state = await advance(state, { storeUrl: "https://acme.shop" });
    expect(state.current).toBe("invite");

    state = back(onboarding, back(onboarding, state));
    state = await advance(state, { useCase: "agency" });
    state = await advance(state, { emails: [] });
    state = await advance(state, {});

    expect(state.status).toBe("complete");
    expect(path(state)).toEqual(["company", "useCase", "invite", "done"]);
    expect(result(onboarding, state)).toEqual({
      company: { name: "Acme", employees: 5 },
      useCase: { useCase: "agency" },
      invite: { emails: [] },
      done: {},
    });
    expect(state.inputs.shopify).toEqual({ storeUrl: "https://acme.shop" });
  });

  it("survives a JSON round trip mid-flow", async () => {
    const state = await advance(start(onboarding), { name: "Acme", employees: 5 });
    const resumed = restore(onboarding, JSON.stringify(state));

    expect(resumed).toEqual(state);
    expect((await advance(resumed, { useCase: "saas" })).current).toBe("invite");
  });

  it("rejects state that does not belong to the flow", () => {
    expect(() => restore(onboarding, { status: "active", current: "nope", history: [] })).toThrow(FlowStateError);
  });
});

describe("inputs for other steps", () => {
  it("prefills a later step without touching the current one", async () => {
    let state = setInputs(onboarding, start(onboarding), { storeUrl: "https://acme.shop" }, "shopify");
    expect(state.current).toBe("company");

    state = await advance(state, { name: "Acme", employees: 5 });
    state = await advance(state, { useCase: "ecommerce" });
    const outcome = await next(onboarding, state);

    expect(outcome.ok && result(onboarding, outcome.state).shopify).toEqual({ storeUrl: "https://acme.shop" });
  });

  it("leaves an earlier step's result alone until it is submitted again", async () => {
    let state = await advance(start(onboarding), { name: "Acme", employees: 5 });
    state = setInputs(onboarding, state, { name: "Other" }, "company");

    expect(state.inputs.company).toEqual({ name: "Other", employees: 5 });
    expect(state.values.company).toEqual({ name: "Acme", employees: 5 });
  });
});
