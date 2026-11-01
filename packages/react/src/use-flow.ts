import {
  type AnyFlow,
  back as backState,
  type AnyStepInputs,
  type FieldIssues,
  type FieldName,
  type FlowState,
  FlowAsyncError,
  type FlowValues,
  forecast as forecastOf,
  next as nextState,
  path as pathOf,
  result,
  setInputs,
  start,
  type StepInputs,
  type StepName,
  validateStepSync,
  visibleFields as visibleFieldsOf,
} from "@fieldtripjs/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface UseFlowOptions<FL extends AnyFlow> {
  readonly initialState?: FlowState<FL>;
  readonly onChange?: (state: FlowState<FL>) => void;
}

export interface FieldProps<N extends string = string> {
  readonly name: N;
  readonly value: unknown;
  readonly issues: readonly string[];
  readonly visible: boolean;
  readonly onChange: (value: unknown) => void;
}

export interface SetFlowInputs<FL extends AnyFlow> {
  (inputs: AnyStepInputs<FL>): void;
  <K extends StepName<FL>>(inputs: NoInfer<Partial<StepInputs<FL, K>>>, step: K): void;
}

export interface FlowController<FL extends AnyFlow> {
  readonly state: FlowState<FL>;
  readonly step: StepName<FL>;
  readonly path: readonly StepName<FL>[];
  readonly forecast: readonly StepName<FL>[];
  readonly values: FlowValues<FL>;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly issues: FieldIssues;
  readonly visibleFields: readonly FieldName<FL>[];
  readonly isComplete: boolean;
  readonly isPending: boolean;
  readonly canGoBack: boolean;
  readonly canAdvance: boolean;
  readonly setInput: (name: FieldName<FL>, value: unknown) => void;
  readonly setInputs: SetFlowInputs<FL>;
  readonly field: <N extends FieldName<FL>>(name: N) => FieldProps<N>;
  readonly next: () => Promise<boolean>;
  readonly back: () => void;
  readonly reset: () => void;
}

export function useFlow<FL extends AnyFlow>(flow: FL, options: UseFlowOptions<FL> = {}): FlowController<FL> {
  const [state, setState] = useState(() => options.initialState ?? start(flow));
  const [issues, setIssues] = useState<FieldIssues>({});
  const [isPending, setPending] = useState(false);
  const latest = useRef(state);
  const onChange = useRef(options.onChange);

  useEffect(() => {
    onChange.current = options.onChange;
  });

  const commit = useCallback((next: FlowState<FL>) => {
    latest.current = next;
    setState(next);
    onChange.current?.(next);
  }, []);

  const setStepInputs = useCallback(
    (inputs: Record<string, unknown>, step: StepName<FL> = latest.current.current) => {
      const current = latest.current;
      commit(setInputs(flow, current, inputs as Partial<StepInputs<FL, typeof step>>, step));
      if (step !== current.current) return;
      setIssues((issues) => Object.fromEntries(Object.entries(issues).filter(([name]) => !(name in inputs))));
    },
    [flow, commit],
  ) as SetFlowInputs<FL>;

  const setInput = useCallback(
    (name: FieldName<FL>, value: unknown) => setStepInputs({ [name]: value } as AnyStepInputs<FL>),
    [setStepInputs],
  );

  const next = useCallback(async () => {
    const submitted = latest.current;
    setPending(true);
    try {
      const outcome = await nextState(flow, submitted);
      // Input that arrived while validating would be silently overwritten by the stale result.
      if (latest.current !== submitted) return false;
      if (!outcome.ok) {
        setIssues(outcome.issues);
        return false;
      }
      setIssues({});
      commit(outcome.state);
      return true;
    } finally {
      setPending(false);
    }
  }, [flow, commit]);

  const back = useCallback(() => {
    setIssues({});
    commit(backState(flow, latest.current));
  }, [flow, commit]);

  const reset = useCallback(() => {
    setIssues({});
    commit(start(flow));
  }, [flow, commit]);

  const inputs = state.inputs[state.current] ?? {};
  const visibleFields = useMemo(() => visibleFieldsOf(flow, state) as FieldName<FL>[], [flow, state]);
  const forecast = useMemo(() => forecastOf(flow, state), [flow, state]);
  const canAdvance = useMemo(() => {
    try {
      return validateStepSync(flow, state).ok;
    } catch (error) {
      // An async schema can't be checked during render; next() decides.
      if (error instanceof FlowAsyncError) return true;
      throw error;
    }
  }, [flow, state]);

  const field = useCallback(
    <N extends FieldName<FL>>(name: N): FieldProps<N> => ({
      name,
      value: inputs[name],
      issues: issues[name] ?? [],
      visible: visibleFields.includes(name),
      onChange: (value) => setInput(name, value),
    }),
    [inputs, issues, visibleFields, setInput],
  );

  return useMemo(
    () => ({
      state,
      step: state.current,
      path: pathOf(state),
      forecast,
      values: result(flow, state),
      inputs,
      issues,
      visibleFields,
      isComplete: state.status === "complete",
      isPending,
      canGoBack: state.history.length > 0 || state.status === "complete",
      canAdvance,
      setInput,
      setInputs: setStepInputs,
      field,
      next,
      back,
      reset,
    }),
    [
      flow,
      state,
      forecast,
      inputs,
      issues,
      visibleFields,
      isPending,
      canAdvance,
      setInput,
      setStepInputs,
      field,
      next,
      back,
      reset,
    ],
  );
}
