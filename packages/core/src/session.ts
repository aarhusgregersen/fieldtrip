import { type AnyFlow, type FlowValues, type StepInputs, type StepName, stepOf } from "./define.js";

type StepRecords = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export interface FlowState<FL extends AnyFlow = AnyFlow> {
  readonly status: "active" | "complete";
  readonly current: StepName<FL>;
  readonly history: readonly StepName<FL>[];
  readonly inputs: StepRecords;
  readonly values: StepRecords;
}

export type FieldIssues = Readonly<Record<string, readonly string[]>>;

export type NextResult<FL extends AnyFlow> =
  | { readonly ok: true; readonly state: FlowState<FL> }
  | { readonly ok: false; readonly state: FlowState<FL>; readonly issues: FieldIssues };

export function start<FL extends AnyFlow>(flow: FL): FlowState<FL> {
  const entered = enter(flow, flow.start, {});
  return { status: entered.status, current: entered.step, history: [], inputs: {}, values: {} };
}

// Field-less steps are left out: `{}` in the union would switch off excess-property checks.
export type AnyStepInputs<FL extends AnyFlow> = {
  [K in StepName<FL>]: keyof StepInputs<FL, K> extends never ? never : Partial<StepInputs<FL, K>>;
}[StepName<FL>];

export function setInputs<FL extends AnyFlow>(
  _flow: FL,
  state: FlowState<FL>,
  inputs: AnyStepInputs<FL>,
): FlowState<FL> {
  const step = state.current;
  return {
    ...state,
    status: "active",
    inputs: { ...state.inputs, [step]: { ...state.inputs[step], ...inputs } },
  };
}

// Best-effort parse of what the user has typed so far, for visibility conditions while they type.
// Async schemas can't be evaluated synchronously, so their fields count as unanswered here.
export function draftValues<FL extends AnyFlow>(flow: FL, state: FlowState<FL>): Record<string, unknown> {
  const inputs = state.inputs[state.current] ?? {};
  const draft: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(stepOf(flow, state.current).fields)) {
    const parsed = schema["~standard"].validate(inputs[name]);
    if (!(parsed instanceof Promise) && !parsed.issues) draft[name] = parsed.value;
  }
  return draft;
}

export function visibleFields<FL extends AnyFlow>(flow: FL, state: FlowState<FL>): string[] {
  const step = stepOf(flow, state.current);
  const draft = draftValues(flow, state);
  const all = { ...pathValues(state), [state.current]: draft };
  return Object.keys(step.fields).filter((name) => {
    const visible = step.fieldsVisibleWhen[name]?.(draft, all) ?? true;
    if (!visible) delete draft[name];
    return visible;
  });
}

export async function validateStep<FL extends AnyFlow>(
  flow: FL,
  state: FlowState<FL>,
): Promise<{ ok: true; values: Record<string, unknown> } | { ok: false; issues: FieldIssues }> {
  const step = stepOf(flow, state.current);
  const inputs = state.inputs[state.current] ?? {};
  const values: Record<string, unknown> = {};
  const issues: Record<string, string[]> = {};

  await Promise.all(
    visibleFields(flow, state).map(async (name) => {
      const schema = step.fields[name]!;
      const result = await schema["~standard"].validate(inputs[name]);
      if (result.issues) issues[name] = result.issues.map((i) => i.message);
      else values[name] = result.value;
    }),
  );

  return Object.keys(issues).length > 0 ? { ok: false, issues } : { ok: true, values };
}

export async function next<FL extends AnyFlow>(flow: FL, state: FlowState<FL>): Promise<NextResult<FL>> {
  if (state.status === "complete") return { ok: true, state };

  const validation = await validateStep(flow, state);
  if (!validation.ok) return { ok: false, state, issues: validation.issues };

  const step = stepOf(flow, state.current);
  const values = { ...pathValues(state), [state.current]: validation.values };

  if (step.transitions.length === 0) {
    return { ok: true, state: { ...state, status: "complete", values } };
  }

  const transition = step.transitions.find((t) => t.when?.(validation.values, values) ?? true);
  if (!transition) {
    throw new FlowStuckError(`No transition from "${state.current}" matched the submitted values`);
  }

  const entered = enter(flow, transition.to, values);
  return {
    ok: true,
    state: {
      ...state,
      status: entered.status,
      current: entered.step,
      history: [...state.history, state.current],
      values,
    },
  };
}

function enter(
  flow: AnyFlow,
  target: string,
  values: Readonly<Record<string, unknown>>,
): { step: string; status: FlowState["status"] } {
  const skipped = new Set<string>();
  for (let name = target; ; ) {
    const step = stepOf(flow, name);
    if (step.visibleWhen?.(values) ?? true) return { step: name, status: "active" };
    if (step.transitions.length === 0) return { step: name, status: "complete" };
    if (skipped.has(name)) throw new FlowStuckError(`Hidden steps form a loop at "${name}"`);
    skipped.add(name);

    const fallback = step.transitions.find((t) => t.when === undefined);
    if (!fallback) {
      throw new FlowStuckError(`Step "${name}" is hidden and has no unconditional transition to skip to`);
    }
    name = fallback.to;
  }
}

export function back<FL extends AnyFlow>(_flow: FL, state: FlowState<FL>): FlowState<FL> {
  // A flow can end on a hidden terminal step the user never saw; going back skips past it.
  const endedOnHiddenStep = state.values[state.current] === undefined;
  if (state.status === "complete" && !endedOnHiddenStep) return { ...state, status: "active" };
  const previous = state.history.at(-1);
  if (previous === undefined) return state;
  return { ...state, status: "active", current: previous, history: state.history.slice(0, -1) };
}

export function path<FL extends AnyFlow>(state: FlowState<FL>): readonly StepName<FL>[] {
  return [...state.history, state.current];
}

// Values from abandoned branches stay in `inputs` (so going back restores them),
// but never leak into the result.
export function result<FL extends AnyFlow>(_flow: FL, state: FlowState<FL>): FlowValues<FL> {
  return pathValues(state) as FlowValues<FL>;
}

function pathValues<FL extends AnyFlow>(state: FlowState<FL>): Record<string, Readonly<Record<string, unknown>>> {
  const steps = state.status === "complete" ? path(state) : state.history;
  return Object.fromEntries(
    steps.flatMap((s) => (state.values[s] ? [[s, state.values[s]] as const] : [])),
  );
}

export function restore<FL extends AnyFlow>(flow: FL, json: unknown): FlowState<FL> {
  const state = (typeof json === "string" ? JSON.parse(json) : json) as FlowState<FL>;
  const known = (s: unknown) => typeof s === "string" && s in flow.steps;
  if (
    typeof state !== "object" ||
    state === null ||
    (state.status !== "active" && state.status !== "complete") ||
    !known(state.current) ||
    !Array.isArray(state.history) ||
    !state.history.every(known)
  ) {
    throw new FlowStateError("Serialized state does not match this flow");
  }
  return state;
}

export class FlowStuckError extends Error {
  override name = "FlowStuckError";
}

export class FlowStateError extends Error {
  override name = "FlowStateError";
}
