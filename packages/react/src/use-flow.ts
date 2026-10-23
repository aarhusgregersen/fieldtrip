import {
  type AnyFlow,
  back as backState,
  type AnyStepInputs,
  type FieldIssues,
  type FieldName,
  type FlowState,
  type FlowValues,
  next as nextState,
  path as pathOf,
  result,
  setInputs,
  start,
  type StepName,
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

export interface FlowController<FL extends AnyFlow> {
  readonly state: FlowState<FL>;
  readonly step: StepName<FL>;
  readonly path: readonly StepName<FL>[];
  readonly values: FlowValues<FL>;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly issues: FieldIssues;
  readonly visibleFields: readonly FieldName<FL>[];
  readonly isComplete: boolean;
  readonly isPending: boolean;
  readonly canGoBack: boolean;
  readonly setInput: (name: FieldName<FL>, value: unknown) => void;
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

  const setInput = useCallback(
    (name: FieldName<FL>, value: unknown) => {
      commit(setInputs(flow, latest.current, { [name]: value } as AnyStepInputs<FL>));
      setIssues(({ [name]: _cleared, ...rest }) => rest);
    },
    [flow, commit],
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
      values: result(flow, state),
      inputs,
      issues,
      visibleFields,
      isComplete: state.status === "complete",
      isPending,
      canGoBack: state.history.length > 0 || state.status === "complete",
      setInput,
      field,
      next,
      back,
      reset,
    }),
    [flow, state, inputs, issues, visibleFields, isPending, setInput, field, next, back, reset],
  );
}
