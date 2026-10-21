# fieldtrip

State machines for human input. Define multi-step flows — onboarding, applications, eligibility checks — as typed, testable, analyzable data instead of `if (step === ...)` scattered across components.

## The problem

Every multi-step wizard starts as a few `if` statements and ends as business logic tangled into UI, routing and state:

```tsx
if (state.companySize > 10 && state.country !== "US" && state.hasCRM && state.crm !== "salesforce") {
  return <IntegrationStep />;
}
```

Nobody can answer "which paths exist?", "can this step ever be reached?", or "why did this user end up here?" without reading every component.

## The idea

```ts
import { z } from "zod";
import { defineFlow } from "@fieldtrip/core";

const checkout = defineFlow({
  start: "country",
  steps: {
    country: { fields: { code: z.enum(["DK", "SE", "US"]) }, next: "customer" },
    customer: {
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
```

- **Typed end to end.** `v` is typed from the step's own fields, `all` from every step in the flow. `all.country?.code === "DKK"` and `to: "vatt"` are compile errors.
- **`all` is honest.** Every step in it is optional, because only steps on the path the user actually took have values.
- **Bring your own validator.** Fields are any [Standard Schema](https://standardschema.dev) (Zod, Valibot, ArkType…). Core has zero dependencies.
- **Targets are explicit.** Conditions are functions, but *where* they can lead is data — which is what makes the analysis below possible.

## Hidden fields and steps

```ts
contact: {
  fields: {
    method: z.enum(["email", "phone"]),
    phone: conditional(z.string().min(8)),
  },
  fieldsVisibleWhen: { phone: (v) => v.method === "phone" },
  next: "company",
},
company: {
  visibleWhen: (all) => all.business?.isCompany === true,
  fields: { cvr: z.string().length(8) },
  next: "done",
},
```

- A hidden field isn't validated and isn't part of the result, so "required" means "required *when visible*". Its input is kept, so showing it again restores what the user typed.
- `conditional()` marks a field that can be hidden, so its value is typed `string | undefined` everywhere. Visibility rules for unmarked fields are a type error.
- Field visibility reacts while the user types: it sees the step's values as far as they currently parse.
- A hidden step is skipped by following its unconditional transition. It never enters history, so `back()` skips it too.

## Running a flow

State is a plain JSON object. Every operation is `(flow, state) → state`, with no UI or framework assumptions.

```ts
import { start, setInputs, next, back, result } from "@fieldtrip/core";

let state = start(onboarding);
state = setInputs(onboarding, state, { name: "Acme", employees: "5" });

const outcome = await next(onboarding, state); // validates, then picks the first matching transition
if (!outcome.ok) outcome.issues; // { employees: ["..."] }
```

- `back()` follows the branch actually taken. Inputs are kept, so going back and forth never loses what the user typed.
- `result()` only contains values from steps on the current path — answers from an abandoned branch never leak into the submission.
- `JSON.stringify(state)` / `restore(flow, json)` to resume later.

## Testing without a browser

```ts
const outcome = await run(onboarding, {
  company: { name: "Acme", employees: 3 },
  useCase: { useCase: "ecommerce" },
  shopify: { storeUrl: "https://acme.shop" },
  invite: {},
});

expect(outcome.path).toEqual(["company", "useCase", "shopify", "invite", "done"]);
```

## Analysis

```ts
paths(onboarding);
// [["company", "sales", "done"],
//  ["company", "useCase", "shopify", "invite", "done"],
//  ["company", "useCase", "invite", "done"]]

analyze(flow);
// [{ kind: "unreachable", step: "orphan" },
//  { kind: "no-fallback", step: "a" },        // every transition is conditional — user can get stuck
//  { kind: "dead-transition", step: "b", ... } // listed after an unconditional one, never taken
//  { kind: "cannot-finish", step: "c" }]       // no route to a terminal step
```

Analysis is structural: conditions are opaque, so every conditional edge is assumed takeable.

## Flows defined at runtime

When end users build flows (a form builder, a CMS), the definition lives in a database and conditions must be data. `fromDefinition` compiles that into the same `Flow`, so everything above — sessions, `run`, analysis — works unchanged. You map your own field types to schemas; core never needs to know what a slider is.

```ts
const flow = fromDefinition(
  {
    start: "customer",
    steps: {
      customer: {
        fields: { kind: { type: "choice", options: ["person", "company"] } },
        next: [{ to: "vat", when: [{ step: "customer", field: "kind", op: "equals", value: "company" }] }, { to: "done" }],
      },
      vat: { fields: { cvr: { type: "text" } }, next: "done" },
      done: {},
    },
  },
  { schema: (field) => toZod(field) },
);
```

Definitions support the same visibility rules as data: `visibleWhen: [conditions]` on a step and `fieldsVisibleWhen: { field: [conditions] }`.

Operators: `equals`, `notEquals`, `contains`, `greaterThan`, `lessThan`, `isChecked`, `isNotChecked`, `isEmpty`, `isNotEmpty`. Conditions in one transition are ANDed; OR is separate transitions. Comparisons never coerce — that's the schema's job.

## React

`@fieldtrip/react` is headless: state and navigation, your components.

```tsx
const { FlowProvider, useFlowContext } = createFlowContext(checkout);

function CvrStep() {
  const { field } = useFlowContext();
  const cvr = field("cvr"); // { name, value, issues, onChange } — "cvrr" is a type error
  return <Input value={cvr.value} onChange={(e) => cvr.onChange(e.target.value)} error={cvr.issues[0]} />;
}
```

`useFlow(flow, { initialState, onChange })` is the same thing without context.

## Status

v0.1. Not yet: flow versioning/migration of in-flight state, live validation (`validateOn`), precise analysis of declarative conditions.
