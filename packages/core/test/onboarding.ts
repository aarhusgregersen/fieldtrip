import { z } from "zod";
import { defineFlow } from "../src/index.js";

export const onboarding = defineFlow({
  id: "onboarding",
  start: "company",
  steps: {
    company: {
      fields: { name: z.string().min(1), employees: z.coerce.number().int().positive() },
      next: [{ to: "sales", when: (v) => v.employees > 20 }, { to: "useCase" }],
    },
    useCase: {
      fields: { useCase: z.enum(["ecommerce", "agency", "saas"]) },
      next: [{ to: "shopify", when: (v) => v.useCase === "ecommerce" }, { to: "invite" }],
    },
    shopify: {
      fields: { storeUrl: z.url() },
      next: "invite",
    },
    sales: {
      fields: { phone: z.string().min(8) },
      next: "done",
    },
    invite: {
      fields: { emails: z.array(z.email()).default([]) },
      next: "done",
    },
    done: {},
  },
});
