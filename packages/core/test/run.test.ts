import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, run } from "../src/index.js";
import { onboarding } from "./onboarding.js";

describe("run", () => {
  it("plays a whole flow from answers", async () => {
    const outcome = await run(onboarding, {
      company: { name: "Acme", employees: 3 },
      useCase: { useCase: "ecommerce" },
      shopify: { storeUrl: "https://acme.shop" },
      invite: {},
    });

    expect(outcome.status).toBe("complete");
    expect(outcome.path).toEqual(["company", "useCase", "shopify", "invite", "done"]);
    expect(outcome.values.invite?.emails).toEqual([]);
  });

  it("stops at the first step it has no answers for", async () => {
    const outcome = await run(onboarding, { company: { name: "Acme", employees: 300 } });

    expect(outcome.status).toBe("unanswered");
    expect(outcome.state.current).toBe("sales");
  });

  it("reports invalid answers", async () => {
    const outcome = await run(onboarding, { company: { name: "Acme", employees: -1 } });

    expect(outcome.status).toBe("invalid");
    if (outcome.status === "invalid") expect(outcome.issues.employees).toHaveLength(1);
  });
});

describe("conditions on earlier steps", () => {
  it("receives values collected along the path", async () => {
    const flow = defineFlow({
      start: "country",
      steps: {
        country: { fields: { code: z.string() }, next: "type" },
        type: {
          fields: { kind: z.enum(["person", "company"]) },
          next: [
            { to: "vat", when: (v, all) => v.kind === "company" && all.country?.code === "DK" },
            { to: "done" },
          ],
        },
        vat: { fields: { cvr: z.string().length(8) }, next: "done" },
        done: {},
      },
    });

    const dk = await run(flow, { country: { code: "DK" }, type: { kind: "company" } });
    const se = await run(flow, { country: { code: "SE" }, type: { kind: "company" } });

    expect(dk.state.current).toBe("vat");
    expect(se.path).toEqual(["country", "type", "done"]);
  });
});

describe("answers that don't match the flow", () => {
  it("rejects unknown steps", async () => {
    const answers: Record<string, Record<string, unknown>> = { compnay: { name: "Acme" } };

    await expect(run(onboarding, answers)).rejects.toThrow('unknown step "compnay"');
  });

  it("rejects unknown fields", async () => {
    await expect(run(onboarding, { company: { nmae: "Acme" } as never })).rejects.toThrow(
      'unknown field "company.nmae"',
    );
  });
});
