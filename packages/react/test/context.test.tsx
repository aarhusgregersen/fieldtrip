import { defineFlow } from "@fieldtrip/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFlowContext } from "../src/index.js";

const signup = defineFlow({
  start: "email",
  steps: {
    email: { fields: { email: z.email() }, next: "done" },
    done: {},
  },
});

const { FlowProvider, useFlowContext } = createFlowContext(signup);

function EmailStep() {
  const { field } = useFlowContext();
  const email = field("email");
  return (
    <label>
      Email
      <input value={String(email.value ?? "")} onChange={(e) => email.onChange(e.target.value)} />
      {email.issues.map((issue) => (
        <span key={issue}>{issue}</span>
      ))}
    </label>
  );
}

function Navigation() {
  const { next, step } = useFlowContext();
  return (
    <>
      <p>Step: {step}</p>
      <button onClick={next}>Next</button>
    </>
  );
}

describe("createFlowContext", () => {
  it("shares one flow between components anywhere in the tree", async () => {
    render(
      <FlowProvider>
        <EmailStep />
        <Navigation />
      </FlowProvider>,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "not-an-email" } });
    await act(async () => fireEvent.click(screen.getByText("Next")));
    expect(screen.getByText("Step: email")).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "a@b.dk" } });
    await act(async () => fireEvent.click(screen.getByText("Next")));
    expect(screen.getByText("Step: done")).toBeTruthy();
  });

  it("types field names from the flow", () => {
    function Typo() {
      const { field } = useFlowContext();
      // @ts-expect-error signup has no field "emial"
      field("emial");
      return null;
    }
    expect(Typo).toBeTypeOf("function");
  });
});
