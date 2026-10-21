import { type AnyFlow, type Step, type StepName, stepOf } from "./define.js";

export interface Edge<FL extends AnyFlow = AnyFlow> {
  readonly from: StepName<FL>;
  readonly to: StepName<FL>;
  readonly conditional: boolean;
}

export type Diagnostic<FL extends AnyFlow = AnyFlow> =
  | { readonly kind: "unreachable"; readonly step: StepName<FL> }
  | { readonly kind: "no-fallback"; readonly step: StepName<FL> }
  | { readonly kind: "dead-transition"; readonly step: StepName<FL>; readonly to: StepName<FL> }
  | { readonly kind: "cannot-finish"; readonly step: StepName<FL> };

export function edges<FL extends AnyFlow>(flow: FL): Edge<FL>[] {
  return Object.entries(flow.steps as Record<string, Step>).flatMap(([from, step]) =>
    step.transitions.map((t) => ({ from, to: t.to, conditional: t.when !== undefined })),
  );
}

export function terminals<FL extends AnyFlow>(flow: FL): StepName<FL>[] {
  return Object.keys(flow.steps).filter((name) => stepOf(flow, name).transitions.length === 0);
}

// Structural: conditions are opaque functions, so every conditional edge is assumed takeable.
export function paths<FL extends AnyFlow>(flow: FL, { limit = 1000 } = {}): StepName<FL>[][] {
  const found: StepName<FL>[][] = [];
  const walk = (current: StepName<FL>, trail: StepName<FL>[]) => {
    if (found.length >= limit) return;
    const route = [...trail, current];
    const step = stepOf(flow, current);
    if (step.transitions.length === 0) {
      found.push(route);
      return;
    }
    for (const to of step.targets) {
      if (!route.includes(to)) walk(to, route);
    }
  };
  walk(flow.start, []);
  return found;
}

export function analyze<FL extends AnyFlow>(flow: FL): Diagnostic<FL>[] {
  const names = Object.keys(flow.steps) as StepName<FL>[];
  const reachable = closure([flow.start], (s) => stepOf(flow, s).targets);
  const incoming = (s: string) => edges(flow).filter((e) => e.to === s).map((e) => e.from);
  const canFinish = closure(terminals(flow), incoming);
  const diagnostics: Diagnostic<FL>[] = [];

  for (const name of names) {
    const step = stepOf(flow, name);
    if (!reachable.has(name)) {
      diagnostics.push({ kind: "unreachable", step: name });
      continue;
    }
    if (!canFinish.has(name)) diagnostics.push({ kind: "cannot-finish", step: name });

    const fallback = step.transitions.findIndex((t) => t.when === undefined);
    if (step.transitions.length > 0 && fallback === -1) {
      diagnostics.push({ kind: "no-fallback", step: name });
    }
    if (fallback !== -1) {
      for (const t of step.transitions.slice(fallback + 1)) {
        diagnostics.push({ kind: "dead-transition", step: name, to: t.to });
      }
    }
  }
  return diagnostics;
}

function closure<T>(seed: readonly T[], neighbours: (node: T) => readonly T[]): Set<T> {
  const seen = new Set(seed);
  const queue = [...seed];
  for (let node = queue.shift(); node !== undefined; node = queue.shift()) {
    for (const n of neighbours(node)) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen;
}
