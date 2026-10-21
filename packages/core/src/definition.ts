import { compileStep, type Fields, type Flow, FlowDefinitionError, type Transition, validateFlow } from "./define.js";
import type { StandardSchemaV1 } from "./standard-schema.js";

export type Operator =
  | "equals"
  | "notEquals"
  | "contains"
  | "greaterThan"
  | "lessThan"
  | "isChecked"
  | "isNotChecked"
  | "isEmpty"
  | "isNotEmpty";

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

export function fromDefinition<FD>(definition: FlowDefinition<FD>, options: FromDefinitionOptions<FD>): Flow {
  const steps = Object.fromEntries(
    Object.entries(definition.steps).map(([name, s]) => {
      const fields: Fields = Object.fromEntries(
        Object.entries(s.fields ?? {}).map(([field, fd]) => [field, options.schema(fd, { step: name, field })]),
      );
      const check = (conditions: readonly ConditionDefinition[] | undefined) =>
        conditions?.forEach((c) => assertCondition(definition, name, c));

      const next = s.next ?? [];
      const transitions: Transition[] = (typeof next === "string" ? [{ to: next }] : next).map((t) => {
        check(t.when);
        return t.when?.length ? { to: t.to, when: (_: unknown, all: AllValues) => matchesAll(t.when!, all) } : { to: t.to };
      });

      check(s.visibleWhen);
      const visibleWhen = s.visibleWhen?.length ? (all: AllValues) => matchesAll(s.visibleWhen!, all) : undefined;

      const fieldsVisibleWhen = Object.fromEntries(
        Object.entries(s.fieldsVisibleWhen ?? {}).map(([field, conditions]) => {
          if (!(field in fields)) {
            throw new FlowDefinitionError(`Visibility rule on step "${name}" refers to unknown field "${field}"`);
          }
          check(conditions);
          return [field, (_: unknown, all: AllValues) => matchesAll(conditions, all)];
        }),
      );

      return [name, compileStep({ fields, transitions, visibleWhen, fieldsVisibleWhen })];
    }),
  );
  return validateFlow({ id: definition.id, start: definition.start, steps });
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

// Definitions come from a database, so the type system can't catch references to deleted steps or fields.
function assertCondition<FD>(definition: FlowDefinition<FD>, step: string, c: ConditionDefinition) {
  const target = definition.steps[c.step];
  if (!target) {
    throw new FlowDefinitionError(`Condition on step "${step}" refers to unknown step "${c.step}"`);
  }
  if (!target.fields || !(c.field in target.fields)) {
    throw new FlowDefinitionError(`Condition on step "${step}" refers to unknown field "${c.step}.${c.field}"`);
  }
}
