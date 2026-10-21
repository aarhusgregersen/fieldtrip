import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  back,
  conditional,
  defineFlow,
  type FlowDefinition,
  fromDefinition,
  next,
  path,
  result,
  run,
  setInputs,
  start,
  visibleFields,
} from "../src/index.js";

const contact = defineFlow({
  start: "contact",
  steps: {
    contact: {
      fields: {
        method: z.enum(["email", "phone"]),
        phone: conditional(z.string().min(8)),
      },
      fieldsVisibleWhen: { phone: (v) => v.method === "phone" },
      next: "business",
    },
    business: { fields: { isCompany: z.boolean() }, next: "company" },
    company: {
      visibleWhen: (all) => all.business?.isCompany === true,
      fields: { cvr: z.string().length(8) },
      next: "done",
    },
    done: {},
  },
});

describe("field visibility", () => {
  it("shows a field once the field it depends on has a valid value", () => {
    const empty = start(contact);
    expect(visibleFields(contact, empty)).toEqual(["method"]);

    const phone = setInputs(contact, empty, { method: "phone" });
    expect(visibleFields(contact, phone)).toEqual(["method", "phone"]);
  });

  it("does not validate hidden fields, even when they hold invalid input", async () => {
    let state = setInputs(contact, start(contact), { method: "phone", phone: "12" });
    state = setInputs(contact, state, { method: "email" });

    const outcome = await next(contact, state);
    expect(outcome.ok).toBe(true);
    expect(outcome.state.values.contact).toEqual({ method: "email" });
  });

  it("requires a field while it is visible", async () => {
    const outcome = await next(contact, setInputs(contact, start(contact), { method: "phone" }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(Object.keys(outcome.issues)).toEqual(["phone"]);
  });
});

describe("step visibility", () => {
  it("skips a hidden step and leaves it out of history and result", async () => {
    const outcome = await run(contact, { contact: { method: "email" }, business: { isCompany: false } });

    expect(outcome.status).toBe("complete");
    expect(outcome.path).toEqual(["contact", "business", "done"]);
    expect(outcome.values).not.toHaveProperty("company");
  });

  it("shows the step when its condition holds", async () => {
    const outcome = await run(contact, { contact: { method: "email" }, business: { isCompany: true } });
    expect(outcome.state.current).toBe("company");
  });

  it("goes back past a step the user never saw", async () => {
    const outcome = await run(contact, { contact: { method: "email" }, business: { isCompany: false } });
    let state = back(contact, outcome.state);

    expect(state.current).toBe("done");
    state = back(contact, state);
    expect(state.current).toBe("business");
  });

  it("can skip the start step and end on a hidden terminal step", async () => {
    const flow = defineFlow({
      start: "intro",
      steps: {
        intro: { visibleWhen: () => false, next: "form" },
        form: { fields: { ok: z.boolean() }, next: [{ to: "thanks" }] },
        thanks: { visibleWhen: (all) => all.form?.ok === true },
      },
    });

    let state = start(flow);
    expect(state.current).toBe("form");

    const outcome = await next(flow, setInputs(flow, state, { ok: false }));
    state = outcome.state;
    expect(state.status).toBe("complete");
    expect(path(state)).toEqual(["form", "thanks"]);
    expect(result(flow, state)).toEqual({ form: { ok: false } });
    expect(back(flow, state).current).toBe("form");
  });
});

describe("visibility in definitions", () => {
  type FieldDef = { type: "text" | "choice" | "checkbox"; options?: string[] };
  const schema = (f: FieldDef) =>
    f.type === "checkbox" ? z.boolean() : f.type === "choice" ? z.enum(f.options as [string]) : z.string().min(1);

  const definition: FlowDefinition<FieldDef> = {
    start: "contact",
    steps: {
      contact: {
        fields: { method: { type: "choice", options: ["email", "phone"] }, phone: { type: "text" } },
        fieldsVisibleWhen: { phone: [{ step: "contact", field: "method", op: "equals", value: "phone" }] },
        next: "business",
      },
      business: { fields: { isCompany: { type: "checkbox" } }, next: "company" },
      company: {
        visibleWhen: [{ step: "business", field: "isCompany", op: "isChecked" }],
        fields: { cvr: { type: "text" } },
        next: "done",
      },
      done: {},
    },
  };
  const flow = fromDefinition(definition, { schema });

  it("hides fields and skips steps from data", async () => {
    expect(visibleFields(flow, setInputs(flow, start(flow), { method: "phone" }))).toEqual(["method", "phone"]);

    const outcome = await run(flow, { contact: { method: "email" }, business: { isCompany: false } });
    expect(outcome.path).toEqual(["contact", "business", "done"]);
  });
});
