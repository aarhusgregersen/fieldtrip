import { type AnyFlow, type FlowValues, type StepInputs, type StepName, stepOf } from "./define.js";
import type { StandardSchemaV1 } from "./standard-schema.js";

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

export function setInputs<FL extends AnyFlow>(_flow: FL, state: FlowState<FL>, inputs: AnyStepInputs<FL>): FlowState<FL>;
// Writing to another step only changes its inputs; its result changes once that step is submitted again.
export function setInputs<FL extends AnyFlow, K extends StepName<FL>>(
  _flow: FL,
  state: FlowState<FL>,
  inputs: NoInfer<Partial<StepInputs<FL, K>>>,
  step: K,
): FlowState<FL>;
export function setInputs<FL extends AnyFlow>(
  _flow: FL,
  state: FlowState<FL>,
  inputs: Record<string, unknown>,
  step: StepName<FL> = state.current,
): FlowState<FL> {
  return {
    ...state,
    status: step === state.current ? "active" : state.status,
    inputs: { ...state.inputs, [step]: { ...state.inputs[step], ...inputs } },
  };
}

// Best-effort parse of what the user has typed so far, for visibility conditions while they type.
// Async schemas can't be evaluated synchronously, so their fields count as unanswered here.
export function draftValues<FL extends AnyFlow>(flow: FL, state: FlowState<FL>): Record<string, unknown> {
  return draftAt(flow, state.current, state.inputs[state.current] ?? {});
}

function draftAt(flow: AnyFlow, name: string, inputs: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const draft: Record<string, unknown> = {};
  for (const [field, schema] of Object.entries(stepOf(flow, name).fields)) {
    const parsed = schema["~standard"].validate(inputs[field]);
    if (!(parsed instanceof Promise) && !parsed.issues) draft[field] = parsed.value;
  }
  return draft;
}

export function visibleFields<FL extends AnyFlow>(flow: FL, state: FlowState<FL>): string[] {
  return visibleAt(flow, state.current, state.inputs[state.current] ?? {}, pathValues(state));
}

function visibleAt(flow: AnyFlow, name: string, inputs: Readonly<Record<string, unknown>>, earlier: StepRecords): string[] {
  const step = stepOf(flow, name);
  const draft = draftAt(flow, name, inputs);
  const all = { ...earlier, [name]: draft };
  return Object.keys(step.fields).filter((field) => {
    const visible = step.fieldsVisibleWhen[field]?.(draft, all) ?? true;
    if (!visible) delete draft[field];
    return visible;
  });
}

type Validation = { ok: true; values: Record<string, unknown> } | { ok: false; issues: FieldIssues };
type Parsed = readonly (readonly [string, StandardSchemaV1.Result<unknown>])[];

export async function validateStep<FL extends AnyFlow>(flow: FL, state: FlowState<FL>): Promise<Validation> {
  const { step, inputs, visible, earlier } = validationInput(flow, state);
  const parsed = await Promise.all(
    visible.map(async (field) => [field, await step.fields[field]!["~standard"].validate(inputs[field])] as const),
  );
  return settle(flow, state.current, parsed, earlier);
}

// Same as validateStep, for flows whose schemas are all synchronous; throws FlowAsyncError otherwise.
export function validateStepSync<FL extends AnyFlow>(flow: FL, state: FlowState<FL>): Validation {
  const { step, inputs, visible, earlier } = validationInput(flow, state);
  const parsed = visible.map((field) => {
    const result = step.fields[field]!["~standard"].validate(inputs[field]);
    if (result instanceof Promise) {
      throw new FlowAsyncError(`Field "${state.current}.${field}" has an async schema; use the async API`);
    }
    return [field, result] as const;
  });
  return settle(flow, state.current, parsed, earlier);
}

function validationInput<FL extends AnyFlow>(flow: FL, state: FlowState<FL>) {
  const inputs = state.inputs[state.current] ?? {};
  const earlier = pathValues(state);
  return { step: stepOf(flow, state.current), inputs, earlier, visible: visibleAt(flow, state.current, inputs, earlier) };
}

function settle(flow: AnyFlow, name: string, parsed: Parsed, earlier: StepRecords): Validation {
  const values: Record<string, unknown> = {};
  const issues: Record<string, readonly string[]> = {};
  for (const [field, result] of parsed) {
    if (result.issues) issues[field] = result.issues.map((i) => i.message);
    else values[field] = result.value;
  }
  if (Object.keys(issues).length > 0) return { ok: false, issues };

  const custom: Readonly<Record<string, readonly string[] | undefined>> =
    stepOf(flow, name).validate?.(values, { ...earlier, [name]: values }) ?? {};
  const failed = Object.entries(custom).filter((entry): entry is [string, readonly string[]] => !!entry[1]?.length);
  return failed.length > 0 ? { ok: false, issues: Object.fromEntries(failed) } : { ok: true, values };
}

export async function next<FL extends AnyFlow>(flow: FL, state: FlowState<FL>): Promise<NextResult<FL>> {
  if (state.status === "complete") return { ok: true, state };
  return advance(flow, state, await validateStep(flow, state));
}

export function nextSync<FL extends AnyFlow>(flow: FL, state: FlowState<FL>): NextResult<FL> {
  if (state.status === "complete") return { ok: true, state };
  return advance(flow, state, validateStepSync(flow, state));
}

function advance<FL extends AnyFlow>(flow: FL, state: FlowState<FL>, validation: Validation): NextResult<FL> {
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

// The path the user is expected to take: history, then onward using whatever inputs already parse,
// falling back to the unconditional transition where a step isn't answered yet.
export function forecast<FL extends AnyFlow>(flow: FL, state: FlowState<FL>): StepName<FL>[] {
  const route: string[] = [...path(state)];
  if (state.status === "complete") return route;

  let values: StepRecords = pathValues(state);
  for (let name: string = state.current; ; ) {
    const step = stepOf(flow, name);
    const own = parseSync(flow, name, state.inputs[name] ?? {}, values);
    if (own) values = { ...values, [name]: own };

    const transition = own
      ? step.transitions.find((t) => t.when?.(own, values) ?? true)
      : step.transitions.find((t) => t.when === undefined);
    if (!transition) return route;

    let entered: ReturnType<typeof enter>;
    try {
      entered = enter(flow, transition.to, values);
    } catch (error) {
      if (error instanceof FlowStuckError) return route;
      throw error;
    }
    if (route.includes(entered.step)) return route;
    route.push(entered.step);
    if (entered.status === "complete") return route;
    name = entered.step;
  }
}

function parseSync(
  flow: AnyFlow,
  name: string,
  inputs: Readonly<Record<string, unknown>>,
  earlier: StepRecords,
): Record<string, unknown> | undefined {
  const step = stepOf(flow, name);
  const parsed: [string, StandardSchemaV1.Result<unknown>][] = [];
  for (const field of visibleAt(flow, name, inputs, earlier)) {
    const result = step.fields[field]!["~standard"].validate(inputs[field]);
    if (result instanceof Promise) return undefined;
    parsed.push([field, result]);
  }
  const validation = settle(flow, name, parsed, earlier);
  return validation.ok ? validation.values : undefined;
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

function pathValues<FL extends AnyFlow>(state: FlowState<FL>): StepRecords {
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

export class FlowAsyncError extends Error {
  override name = "FlowAsyncError";
}
