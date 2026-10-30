import { describe, expect, it } from "vitest";
import { z } from "zod";
import { back, defineFlow, forecast, nextSync, setInputs, start } from "../src/index.js";
import { onboarding } from "./onboarding.js";

describe("forecast", () => {
  it("follows unconditional transitions while nothing is answered", () => {
    expect(forecast(onboarding, start(onboarding))).toEqual(["company", "useCase", "invite", "done"]);
  });

  it("uses inputs on the current step as soon as they parse", () => {
    const state = setInputs(onboarding, start(onboarding), { name: "Acme", employees: "50" });

    expect(forecast(onboarding, state)).toEqual(["company", "sales", "done"]);
  });

  it("ignores inputs that don't parse yet", () => {
    const state = setInputs(onboarding, start(onboarding), { name: "Acme", employees: "fifty" });

    expect(forecast(onboarding, state)).toEqual(["company", "useCase", "invite", "done"]);
  });

  it("uses inputs kept on later steps after going back", () => {
    let state = nextSync(onboarding, setInputs(onboarding, start(onboarding), { name: "Acme", employees: 5 })).state;
    state = nextSync(onboarding, setInputs(onboarding, state, { useCase: "ecommerce" })).state;
    state = back(onboarding, back(onboarding, state));

    expect(forecast(onboarding, state)).toEqual(["company", "useCase", "shopify", "invite", "done"]);
  });

  it("skips hidden steps and evaluates their visibility against what is known", () => {
    const flow = defineFlow({
      start: "audience",
      steps: {
        audience: {
          fields: { kind: z.enum(["private", "business"]) },
          next: [{ to: "business", when: (v) => v.kind === "business" }, { to: "private" }],
        },
        private: { fields: { name: z.string() }, next: "company" },
        business: { fields: { cvr: z.string() }, next: "company" },
        company: { visibleWhen: (all) => all.business !== undefined, fields: { size: z.number() }, next: "done" },
        done: {},
      },
    });

    expect(forecast(flow, start(flow))).toEqual(["audience", "private", "done"]);

    const business = setInputs(flow, start(flow), { kind: "business" });
    expect(forecast(flow, business)).toEqual(["audience", "business", "done"]);

    const answered = setInputs(flow, nextSync(flow, business).state, { cvr: "12345678" });
    expect(forecast(flow, answered)).toEqual(["audience", "business", "company", "done"]);
  });

  it("stops where the route depends on an unanswered step", () => {
    const flow = defineFlow({
      start: "a",
      steps: {
        a: { fields: { n: z.number() }, next: [{ to: "b", when: (v) => v.n > 1 }] },
        b: {},
      },
    });

    expect(forecast(flow, start(flow))).toEqual(["a"]);
  });

  it("stops at a loop", () => {
    const flow = defineFlow({
      start: "a",
      steps: { a: { fields: { n: z.number() }, next: [{ to: "b", when: (v) => v.n > 1 }, { to: "a" }] }, b: {} },
    });

    expect(forecast(flow, start(flow))).toEqual(["a"]);
  });

  it("is the path once complete", () => {
    const state = nextSync(onboarding, setInputs(onboarding, start(onboarding), { name: "Acme", employees: 50 })).state;
    const done = nextSync(onboarding, setInputs(onboarding, state, { phone: "12345678" })).state;

    expect(forecast(onboarding, done)).toEqual(["company", "sales", "done"]);
  });
});
