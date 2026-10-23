import { conditional, defineFlow, restore } from "@fieldtripjs/core";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
