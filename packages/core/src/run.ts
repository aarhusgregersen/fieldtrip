import { type AnyFlow, type FlowValues, type StepInputs, type StepName, stepOf } from "./define.js";
import { type AnyStepInputs, type FieldIssues, type FlowState, next, path, result, setInputs, start } from "./session.js";

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
  let state = start(flow);
  const done = (extra: { status: "complete" | "unanswered" } | { status: "invalid"; issues: FieldIssues }) =>
    ({ state, path: path(state), values: result(flow, state), ...extra }) as RunResult<FL>;

  while (state.status === "active") {
    const step = state.current;
    const stepAnswers = answers[step] as Record<string, unknown> | undefined;
    const needsInput = Object.keys(stepOf(flow, step).fields).length > 0;
    if (needsInput && stepAnswers === undefined) return done({ status: "unanswered" });

    const outcome = await next(flow, setInputs(flow, state, (stepAnswers ?? {}) as AnyStepInputs<FL>));
    state = outcome.state;
    if (!outcome.ok) return done({ status: "invalid", issues: outcome.issues });
  }
  return done({ status: "complete" });
}
