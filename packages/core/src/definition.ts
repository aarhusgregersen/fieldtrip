import { analyze, type Diagnostic } from "./analyze.js";
import { compileStep, type Fields, type Flow, FlowDefinitionError, type Transition, validateFlow } from "./define.js";
import type { StandardSchemaV1 } from "./standard-schema.js";

export const operators = [
  "equals",
  "notEquals",
  "contains",
  "greaterThan",
  "lessThan",
  "isChecked",
  "isNotChecked",
  "isEmpty",
  "isNotEmpty",
] as const;

export type Operator = (typeof operators)[number];

const comparing: ReadonlySet<string> = new Set<Operator>(["equals", "notEquals", "contains", "greaterThan", "lessThan"]);
const numeric: ReadonlySet<string> = new Set<Operator>(["greaterThan", "lessThan"]);

export interface ConditionDefinition {
  readonly step: string;
  readonly field: string;
  readonly op: Operator;
  readonly value?: unknown;
}

export interface TransitionDefinition {
  readonly to: string;
  // All conditions must hold; express OR as separate transitions.
  readonly when?: readonly ConditionDefinition[];
}

export interface StepDefinition<FD> {
  readonly fields?: Readonly<Record<string, FD>>;
  readonly visibleWhen?: readonly ConditionDefinition[];
  readonly fieldsVisibleWhen?: Readonly<Record<string, readonly ConditionDefinition[]>>;
  readonly next?: string | readonly TransitionDefinition[];
}

export interface FlowDefinition<FD> {
  readonly id?: string;
  readonly start: string;
  readonly steps: Readonly<Record<string, StepDefinition<FD>>>;
}

export interface FromDefinitionOptions<FD> {
  readonly schema: (field: FD, at: { readonly step: string; readonly field: string }) => StandardSchemaV1;
}

export type DefinitionIssueKind =
  | "unknown-start"
  | "unknown-target"
  | "unknown-step"
  | "unknown-field"
  | "invalid-field"
  | "unknown-operator"
  | "invalid-value"
  | Diagnostic["kind"];

// Errors stop `fromDefinition`; warnings compile but probably don't do what was meant.
export interface DefinitionIssue {
  readonly severity: "error" | "warning";
  readonly kind: DefinitionIssueKind;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export function fromDefinition<FD>(definition: FlowDefinition<FD>, options: FromDefinitionOptions<FD>): Flow {
  const error = structuralIssues(definition).find((issue) => issue.severity === "error");
  if (error) throw new FlowDefinitionError(error.message);
  return compile(definition, options.schema);
}

// Collects every problem instead of throwing on the first, so a form builder or an agent can fix them in one go.
export function checkDefinition<FD>(
  definition: FlowDefinition<FD>,
  options: Partial<FromDefinitionOptions<FD>> = {},
): DefinitionIssue[] {
  const issues = [...structuralIssues(definition), ...(options.schema ? fieldIssues(definition, options.schema) : [])];
  const compilable = !issues.some((i) => i.kind === "unknown-start" || i.kind === "unknown-target");
  return compilable ? [...issues, ...analysisIssues(definition, compile(definition, () => unvalidated))] : issues;
}

function compile<FD>(definition: FlowDefinition<FD>, schema: FromDefinitionOptions<FD>["schema"]): Flow {
  const steps = Object.fromEntries(
    Object.entries(definition.steps).map(([name, s]) => {
      const fields: Fields = Object.fromEntries(
        Object.entries(s.fields ?? {}).map(([field, fd]) => [field, schema(fd, { step: name, field })]),
      );
      const transitions: Transition[] = transitionsOf(s).map((t) =>
        t.when?.length ? { to: t.to, when: (_: unknown, all: AllValues) => matchesAll(t.when!, all) } : { to: t.to },
      );
      const visibleWhen = s.visibleWhen?.length ? (all: AllValues) => matchesAll(s.visibleWhen!, all) : undefined;
      const fieldsVisibleWhen = Object.fromEntries(
        Object.entries(s.fieldsVisibleWhen ?? {}).map(([field, conditions]) => [
          field,
          (_: unknown, all: AllValues) => matchesAll(conditions, all),
        ]),
      );
      return [name, compileStep({ fields, transitions, visibleWhen, fieldsVisibleWhen })];
    }),
  );
  return validateFlow({ id: definition.id, start: definition.start, steps });
}

function transitionsOf<FD>(step: StepDefinition<FD>): readonly TransitionDefinition[] {
  const next = step.next ?? [];
  return typeof next === "string" ? [{ to: next }] : next;
}

type AllValues = Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>;

export function matchesAll(conditions: readonly ConditionDefinition[], all: AllValues): boolean {
  return conditions.every((c) => matches(c, all[c.step]?.[c.field]));
}

export function matches(condition: ConditionDefinition, actual: unknown): boolean {
  const expected = condition.value;
  switch (condition.op) {
    case "equals":
      return isEqual(actual, expected);
    case "notEquals":
      return !isEqual(actual, expected);
    case "contains":
      if (Array.isArray(actual)) return actual.some((item) => isEqual(item, expected));
      return typeof actual === "string" && typeof expected === "string" && actual.includes(expected);
    case "greaterThan":
      return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "lessThan":
      return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "isChecked":
      return actual === true;
    case "isNotChecked":
      return actual !== true;
    case "isEmpty":
      return isEmpty(actual);
    case "isNotEmpty":
      return !isEmpty(actual);
  }
}

function isEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => isEqual(x, b[i]));
  return Object.is(a, b);
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

const unvalidated: StandardSchemaV1 = { "~standard": { version: 1, vendor: "fieldtrip", validate: (value) => ({ value }) } };

const has = (record: object | undefined, key: string) => record !== undefined && Object.hasOwn(record, key);

function issue(severity: DefinitionIssue["severity"]) {
  return (kind: DefinitionIssueKind, path: DefinitionIssue["path"], message: string): DefinitionIssue => ({
    severity,
    kind,
    path,
    message,
  });
}
const error = issue("error");
const warning = issue("warning");

// Definitions come from a database or an LLM, so the type system can't catch references to missing steps or fields.
function structuralIssues<FD>(definition: FlowDefinition<FD>): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];

  if (!has(definition.steps, definition.start)) {
    issues.push(error("unknown-start", ["start"], `Start step "${definition.start}" does not exist`));
  }

  for (const [name, step] of Object.entries(definition.steps)) {
    const at = ["steps", name];
    const conditions = (list: readonly ConditionDefinition[] | undefined, path: DefinitionIssue["path"]) =>
      list?.forEach((c, i) => issues.push(...conditionIssues(definition, name, c, [...path, i])));

    if (typeof step.next === "string") {
      if (!has(definition.steps, step.next)) {
        issues.push(error("unknown-target", [...at, "next"], `Step "${name}" transitions to unknown step "${step.next}"`));
      }
    } else {
      step.next?.forEach((t, i) => {
        if (!has(definition.steps, t.to)) {
          issues.push(
            error("unknown-target", [...at, "next", i, "to"], `Step "${name}" transitions to unknown step "${t.to}"`),
          );
        }
        conditions(t.when, [...at, "next", i, "when"]);
      });
    }

    conditions(step.visibleWhen, [...at, "visibleWhen"]);

    for (const [field, list] of Object.entries(step.fieldsVisibleWhen ?? {})) {
      if (!has(step.fields, field)) {
        issues.push(
          error(
            "unknown-field",
            [...at, "fieldsVisibleWhen", field],
            `Visibility rule on step "${name}" refers to unknown field "${field}"`,
          ),
        );
      }
      conditions(list, [...at, "fieldsVisibleWhen", field]);
    }
  }
  return issues;
}

function conditionIssues<FD>(
  definition: FlowDefinition<FD>,
  step: string,
  c: ConditionDefinition,
  path: DefinitionIssue["path"],
): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const target = definition.steps[c.step];
  if (!has(definition.steps, c.step)) {
    issues.push(error("unknown-step", [...path, "step"], `Condition on step "${step}" refers to unknown step "${c.step}"`));
  } else if (!has(target?.fields, c.field)) {
    issues.push(
      error("unknown-field", [...path, "field"], `Condition on step "${step}" refers to unknown field "${c.step}.${c.field}"`),
    );
  }

  if (!(operators as readonly string[]).includes(c.op)) {
    issues.push(
      warning("unknown-operator", [...path, "op"], `Unknown operator "${c.op}" never matches; use one of ${operators.join(", ")}`),
    );
  } else if (comparing.has(c.op) && c.value === undefined) {
    issues.push(warning("invalid-value", [...path, "value"], `Operator "${c.op}" needs a value to compare with`));
  } else if (numeric.has(c.op) && typeof c.value !== "number") {
    issues.push(
      warning("invalid-value", [...path, "value"], `Operator "${c.op}" never coerces, so a ${typeof c.value} value never matches`),
    );
  }
  return issues;
}

function fieldIssues<FD>(definition: FlowDefinition<FD>, schema: FromDefinitionOptions<FD>["schema"]): DefinitionIssue[] {
  return Object.entries(definition.steps).flatMap(([step, s]) =>
    Object.entries(s.fields ?? {}).flatMap(([field, fd]) => {
      try {
        schema(fd, { step, field });
        return [];
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        return [error("invalid-field", ["steps", step, "fields", field], `Field "${step}.${field}" is invalid: ${reason}`)];
      }
    }),
  );
}

function analysisIssues<FD>(definition: FlowDefinition<FD>, flow: Flow): DefinitionIssue[] {
  const deadSoFar = new Map<string, number>();
  return analyze(flow).map((d) => {
    const at = ["steps", d.step];
    switch (d.kind) {
      case "unreachable":
        return warning(d.kind, at, `Step "${d.step}" can't be reached from the start step "${definition.start}"`);
      case "cannot-finish":
        return warning(d.kind, at, `No route from step "${d.step}" reaches a step that ends the flow`);
      case "no-fallback":
        return warning(
          d.kind,
          [...at, "next"],
          `Every transition from step "${d.step}" has conditions, so a user who matches none gets stuck; add a last transition without "when"`,
        );
      case "dead-transition": {
        // `analyze` lists every transition after the first unconditional one, in order.
        const transitions = transitionsOf(definition.steps[d.step]!);
        const seen = deadSoFar.get(d.step) ?? 0;
        deadSoFar.set(d.step, seen + 1);
        const index = transitions.findIndex((t) => !t.when?.length) + 1 + seen;
        return warning(
          d.kind,
          [...at, "next", index],
          `Transition from step "${d.step}" to "${d.to}" comes after one without conditions, so it is never taken`,
        );
      }
    }
  });
}
