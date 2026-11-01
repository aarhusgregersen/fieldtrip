import { conditional, defineFlow, restore, start } from "@fieldtripjs/core";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { useFlow } from "../src/index.js";

const flow = defineFlow({
  start: "company",
  steps: {
    company: {
      fields: { employees: z.coerce.number().int().positive() },
      next: [{ to: "sales", when: (v) => v.employees > 20 }, { to: "done" }],
    },
    sales: { fields: { phone: z.string().min(8) }, next: "done" },
    done: {},
  },
});

describe("useFlow", () => {
  it("collects input, validates and branches", async () => {
    const { result } = renderHook(() => useFlow(flow));

    act(() => result.current.field("employees").onChange("50"));
    await act(() => result.current.next());

    expect(result.current.step).toBe("sales");
    expect(result.current.values.company).toEqual({ employees: 50 });
  });

  it("exposes issues per field and clears them on edit", async () => {
    const { result } = renderHook(() => useFlow(flow));

    await act(async () => expect(await result.current.next()).toBe(false));
    expect(result.current.field("employees").issues).toHaveLength(1);

    act(() => result.current.setInput("employees", "3"));
    expect(result.current.field("employees").issues).toEqual([]);
  });

  it("goes back and restores what the user typed", async () => {
    const { result } = renderHook(() => useFlow(flow));

    act(() => result.current.setInput("employees", "50"));
    await act(() => result.current.next());
    act(() => result.current.back());

    expect(result.current.step).toBe("company");
    expect(result.current.field("employees").value).toBe("50");
    expect(result.current.canGoBack).toBe(false);
  });

  it("reports every state change and can resume from it", async () => {
    const onChange = vi.fn();
    const first = renderHook(() => useFlow(flow, { onChange }));

    act(() => first.result.current.setInput("employees", "50"));
    await act(() => first.result.current.next());
    const saved = JSON.stringify(onChange.mock.lastCall?.[0]);

    const resumed = renderHook(() => useFlow(flow, { initialState: restore(flow, saved) }));
    expect(resumed.result.current.step).toBe("sales");
    expect(resumed.result.current.path).toEqual(["company", "sales"]);
  });

  it("forecasts the expected route while the user types", () => {
    const { result } = renderHook(() => useFlow(flow));
    expect(result.current.forecast).toEqual(["company", "done"]);

    act(() => result.current.setInput("employees", "50"));
    expect(result.current.forecast).toEqual(["company", "sales", "done"]);
  });

  it("completes on a terminal step", async () => {
    const { result } = renderHook(() => useFlow(flow));

    act(() => result.current.setInput("employees", "3"));
    await act(() => result.current.next());
    await act(() => result.current.next());

    expect(result.current.isComplete).toBe(true);
    expect(result.current.path).toEqual(["company", "done"]);
  });
});

describe("useFlow visibility", () => {
  const contact = defineFlow({
    start: "contact",
    steps: {
      contact: {
        fields: { method: z.enum(["email", "phone"]), phone: conditional(z.string().min(8)) },
        fieldsVisibleWhen: { phone: (v) => v.method === "phone" },
      },
    },
  });

  it("reveals fields as the user answers", () => {
    const { result } = renderHook(() => useFlow(contact));
    expect(result.current.visibleFields).toEqual(["method"]);
    expect(result.current.field("phone").visible).toBe(false);

    act(() => result.current.setInput("method", "phone"));
    expect(result.current.visibleFields).toEqual(["method", "phone"]);
    expect(result.current.field("phone").visible).toBe(true);
  });
});

describe("useFlow setInputs", () => {
  const quote = defineFlow({
    start: "address",
    steps: {
      address: { fields: { street: z.string().min(1) }, next: "postal" },
      postal: { fields: { postalCode: z.string().length(4) }, next: "sqm" },
      sqm: { fields: { squareMeters: z.coerce.number().positive(), rooms: z.coerce.number().int() }, next: "done" },
      done: {},
    },
  });

  it("prefills a later step without moving or completing the flow", async () => {
    const { result } = renderHook(() => useFlow(quote));
    await act(async () => expect(await result.current.next()).toBe(false));
    const issues = result.current.issues;

    act(() => result.current.setInputs({ squareMeters: "120" }, "sqm"));
    expect(result.current.state.inputs.sqm).toEqual({ squareMeters: "120" });
    expect(result.current.step).toBe("address");
    expect(result.current.state.status).toBe("active");
    expect(result.current.issues).toBe(issues);

    act(() => result.current.setInput("street", "Vestergade 1"));
    await act(() => result.current.next());
    act(() => result.current.setInput("postalCode", "8000"));
    await act(() => result.current.next());
    expect(result.current.step).toBe("sqm");
    expect(result.current.field("squareMeters").value).toBe("120");
  });

  it("writes several fields to the current step and clears only their issues", async () => {
    const { result } = renderHook(() => useFlow(quote, { initialState: { ...start(quote), current: "sqm" } }));
    await act(() => result.current.next());
    expect(Object.keys(result.current.issues)).toEqual(["squareMeters", "rooms"]);

    act(() => result.current.setInputs({ squareMeters: "120" }));
    expect(result.current.inputs).toEqual({ squareMeters: "120" });
    expect(Object.keys(result.current.issues)).toEqual(["rooms"]);
  });

  it("changes a passed step's inputs, but not its values until it is submitted again", async () => {
    const { result } = renderHook(() => useFlow(quote));
    act(() => result.current.setInput("street", "Vestergade 1"));
    await act(() => result.current.next());

    act(() => result.current.setInputs({ street: "Østergade 2" }, "address"));
    expect(result.current.state.inputs.address).toEqual({ street: "Østergade 2" });
    expect(result.current.values.address).toEqual({ street: "Vestergade 1" });

    act(() => result.current.back());
    await act(() => result.current.next());
    expect(result.current.values.address).toEqual({ street: "Østergade 2" });
  });

  it("keeps input that arrives while next() validates", async () => {
    let release!: (ok: boolean) => void;
    const checked = new Promise<boolean>((resolve) => (release = resolve));
    const slow = defineFlow({
      start: "a",
      steps: {
        a: { fields: { code: z.string().refine(() => checked) }, next: "b" },
        b: { fields: { note: z.string() } },
      },
    });
    const { result } = renderHook(() => useFlow(slow));
    act(() => result.current.setInput("code", "x"));

    const advanced = result.current.next();
    act(() => result.current.setInputs({ note: "late" }, "b"));
    release(true);
    await act(async () => expect(await advanced).toBe(false));

    expect(result.current.step).toBe("a");
    expect(result.current.state.inputs.b).toEqual({ note: "late" });
  });

  it("only accepts the target step's fields", () => {
    const { result } = renderHook(() => useFlow(quote));
    const { setInputs } = result.current;
    expectTypeOf(setInputs).toBeCallableWith({ squareMeters: "120" }, "sqm");
    // @ts-expect-error postalCode belongs to the postal step
    act(() => setInputs({ postalCode: "8000" }, "sqm"));
  });
});

describe("useFlow canAdvance", () => {
  it("is false until the step is valid", () => {
    const { result } = renderHook(() => useFlow(flow));
    expect(result.current.canAdvance).toBe(false);

    act(() => result.current.setInput("employees", "50"));
    expect(result.current.canAdvance).toBe(true);
    expect(result.current.issues).toEqual({});
  });

  it("leaves async steps to next()", () => {
    const lookup = defineFlow({
      start: "a",
      steps: { a: { fields: { cvr: z.string().refine(async (v) => v.length === 8) } } },
    });
    const { result } = renderHook(() => useFlow(lookup));
    act(() => result.current.setInput("cvr", "123"));
    expect(result.current.canAdvance).toBe(true);
  });
});
