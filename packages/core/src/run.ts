import { type AnyFlow, type FlowValues, type StepInputs, type StepName, stepOf } from "./define.js";
import {
  type AnyStepInputs,
  type FieldIssues,
  type FlowState,
  FlowStateError,
  type NextResult,
  next,
  nextSync,
  path,
  result,
  setInputs,
  start,
} from "./session.js";

export type Answers<FL extends AnyFlow> = { [K in StepName<FL>]?: Partial<StepInputs<FL, K>> };

export type RunResult<FL extends AnyFlow> = {
  readonly state: FlowState<FL>;
  readonly path: readonly StepName<FL>[];
  readonly values: FlowValues<FL>;
} & (
  | { readonly status: "complete" | "unanswered" }
  | { readonly status: "invalid"; readonly issues: FieldIssues }
);

// Plays a flow headlessly with a fixed set of answers until it completes or needs input it wasn't given.
export async function run<FL extends AnyFlow>(flow: FL, answers: Answers<FL>): Promise<RunResult<FL>> {
  const player = play(flow, answers);
  for (let step = player.next(); ; ) {
    if (step.done) return step.value;
    step = player.next(await next(flow, step.value));
  }
}

// Same as run, for flows whose schemas are all synchronous; throws FlowAsyncError otherwise.
export function runSync<FL extends AnyFlow>(flow: FL, answers: Answers<FL>): RunResult<FL> {
  const player = play(flow, answers);
  for (let step = player.next(); ; ) {
    if (step.done) return step.value;
    step = player.next(nextSync(flow, step.value));
  }
}

function* play<FL extends AnyFlow>(
  flow: FL,
  answers: Answers<FL>,
): Generator<FlowState<FL>, RunResult<FL>, NextResult<FL>> {
  checkAnswers(flow, answers);
  let state = start(flow);
  const done = (extra: { status: "complete" | "unanswered" } | { status: "invalid"; issues: FieldIssues }) =>
    ({ state, path: path(state), values: result(flow, state), ...extra }) as RunResult<FL>;

  while (state.status === "active") {
    const step = state.current;
    const stepAnswers = answers[step] as Record<string, unknown> | undefined;
    const needsInput = Object.keys(stepOf(flow, step).fields).length > 0;
    if (needsInput && stepAnswers === undefined) return done({ status: "unanswered" });

    const outcome = yield setInputs(flow, state, (stepAnswers ?? {}) as AnyStepInputs<FL>);
    state = outcome.state;
    if (!outcome.ok) return done({ status: "invalid", issues: outcome.issues });
  }
  return done({ status: "complete" });
}

// Answers are often built with dynamic keys the type system can't check, and a typo would silently be ignored.
function checkAnswers(flow: AnyFlow, answers: Readonly<Record<string, unknown>>) {
  for (const [step, inputs] of Object.entries(answers)) {
    if (!(step in flow.steps)) throw new FlowStateError(`Answers refer to unknown step "${step}"`);
    for (const field of Object.keys(inputs ?? {})) {
      if (!(field in stepOf(flow, step).fields)) {
        throw new FlowStateError(`Answers refer to unknown field "${step}.${field}"`);
      }
    }
  }
}
