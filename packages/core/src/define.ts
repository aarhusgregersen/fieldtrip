import type { StandardSchemaV1 } from "./standard-schema.js";

export type Fields = Record<string, StandardSchemaV1>;

// Loose on purpose: a step without `fields` infers as `unknown`, and a stricter
// constraint would make TS discard inference for the whole flow.
export type FlowShape = Record<string, unknown>;

type FieldsOf<F> = F extends Fields ? (string extends keyof F ? {} : F) : {};

type In<X> = X extends StandardSchemaV1 ? StandardSchemaV1.InferInput<X> : never;
type Out<X> = X extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<X> : never;
type Simplify<T> = { [K in keyof T]: T[K] } & {};

export interface Conditional {
  readonly "~conditional": true;
}

// Marks a field that can be hidden, so its value is typed as possibly missing.
// Needed because TS can't infer which keys a map of callbacks covers.
export function conditional<S extends StandardSchemaV1>(schema: S): S & Conditional {
  return { "~standard": schema["~standard"], "~conditional": true } as S & Conditional;
}

export function isConditional(schema: StandardSchemaV1): boolean {
  return "~conditional" in schema;
}

type ConditionalKeys<F> = { [K in keyof FieldsOf<F>]: FieldsOf<F>[K] extends Conditional ? K : never }[keyof FieldsOf<F>];
type AlwaysKeys<F> = Exclude<keyof FieldsOf<F>, ConditionalKeys<F>>;

export type FieldInputs<F> = { -readonly [K in keyof FieldsOf<F>]: In<FieldsOf<F>[K]> };
export type FieldValues<F> = Simplify<
  { -readonly [K in AlwaysKeys<F>]: Out<FieldsOf<F>[K]> } & {
    -readonly [K in ConditionalKeys<F>]?: Out<FieldsOf<F>[K]>;
  }
>;

// Every step is optional: only steps on the path the user actually took have values.
export type ValuesOf<S extends FlowShape> = { readonly [P in keyof S]?: FieldValues<S[P]> };

export interface Transition<V = any, A = any, T extends string = string> {
  readonly to: T;
  readonly when?: (values: V, all: A) => boolean;
}

export type FieldVisibility<V = any, A = any> = (values: Partial<V>, all: A) => boolean;

export type StepIssues<F = any> = { readonly [K in keyof FieldsOf<F>]?: readonly string[] };

// Runs after every visible field parsed, so checks can span fields and depend on earlier steps.
export type StepValidator<V = any, A = any, F = any> = (values: V, all: A) => StepIssues<F> | undefined;

export interface StepConfig<F, S extends FlowShape> {
  readonly fields?: F & Fields;
  // A hidden step is skipped, following its unconditional transition.
  readonly visibleWhen?: (all: NoInfer<ValuesOf<S>>) => boolean;
  // `{}` would skip excess-property checks, so steps without conditional fields get a map nothing fits.
  readonly fieldsVisibleWhen?: [ConditionalKeys<F>] extends [never]
    ? Readonly<Record<string, never>>
    : { readonly [K in ConditionalKeys<F>]: FieldVisibility<NoInfer<FieldValues<F>>, NoInfer<ValuesOf<S>>> };
  readonly validate?: StepValidator<NoInfer<FieldValues<F>>, NoInfer<ValuesOf<S>>, NoInfer<F>>;
  readonly next?:
    | NoInfer<keyof S & string>
    | readonly Transition<NoInfer<FieldValues<F>>, NoInfer<ValuesOf<S>>, NoInfer<keyof S & string>>[];
}

// NoInfer keeps S inferred from `fields` alone, so conditions can be typed against the whole flow.
export interface FlowConfig<S extends FlowShape> {
  readonly id?: string;
  readonly start: NoInfer<keyof S & string>;
  readonly steps: { readonly [P in keyof S]: StepConfig<S[P], S> };
}

export interface Step {
  readonly fields: Fields;
  readonly transitions: readonly Transition[];
  readonly targets: readonly string[];
  readonly visibleWhen?: ((all: any) => boolean) | undefined;
  readonly fieldsVisibleWhen: Readonly<Record<string, FieldVisibility>>;
  readonly validate?: StepValidator | undefined;
}

export interface StepParts {
  readonly fields?: Fields | undefined;
  readonly transitions?: readonly Transition[] | undefined;
  readonly visibleWhen?: ((all: any) => boolean) | undefined;
  readonly fieldsVisibleWhen?: Readonly<Record<string, FieldVisibility>> | undefined;
  readonly validate?: StepValidator | undefined;
}

export interface Flow<S extends FlowShape = FlowShape> {
  readonly id: string | undefined;
  readonly start: keyof S & string;
  readonly steps: { readonly [P in keyof S]: Step };
  readonly "~shape"?: S;
}

export type AnyFlow = Flow<any>;

export function defineFlow<const S extends FlowShape>(config: FlowConfig<S>): Flow<S> {
  const steps = Object.fromEntries(
    Object.entries(config.steps as Record<string, StepConfig<Fields, FlowShape>>).map(([name, s]) => {
      const transitions: readonly Transition[] =
        s.next === undefined ? [] : typeof s.next === "string" ? [{ to: s.next }] : s.next;
      return [
        name,
        compileStep({
          fields: s.fields,
          transitions,
          visibleWhen: s.visibleWhen,
          fieldsVisibleWhen: s.fieldsVisibleWhen as Record<string, FieldVisibility> | undefined,
          validate: s.validate,
        }),
      ];
    }),
  ) as Flow<S>["steps"];
  return validateFlow({ id: config.id, start: config.start, steps });
}

export function compileStep(parts: StepParts): Step {
  const transitions = parts.transitions ?? [];
  return {
    fields: parts.fields ?? {},
    transitions,
    targets: [...new Set(transitions.map((t) => t.to))],
    visibleWhen: parts.visibleWhen,
    fieldsVisibleWhen: parts.fieldsVisibleWhen ?? {},
    validate: parts.validate,
  };
}

export function validateFlow<FL extends AnyFlow>(flow: FL): FL {
  const names = Object.keys(flow.steps);
  if (!names.includes(flow.start)) {
    throw new FlowDefinitionError(`Start step "${flow.start}" does not exist`);
  }
  for (const [name, s] of Object.entries(flow.steps as Record<string, Step>)) {
    for (const target of s.targets) {
      if (!names.includes(target)) {
        throw new FlowDefinitionError(`Step "${name}" transitions to unknown step "${target}"`);
      }
    }
  }
  return flow;
}

export function stepOf(flow: AnyFlow, name: string): Step {
  return (flow.steps as Record<string, Step>)[name]!;
}

export class FlowDefinitionError extends Error {
  override name = "FlowDefinitionError";
}

export type ShapeOf<FL extends AnyFlow> = NonNullable<FL["~shape"]>;
export type StepName<FL extends AnyFlow> = keyof ShapeOf<FL> & string;

// Flows built from a runtime definition have no static shape; fall back to plain records.
type IsDynamic<FL extends AnyFlow> = string extends StepName<FL> ? true : false;
type Loose = Record<string, unknown>;

export type StepValues<FL extends AnyFlow, K extends StepName<FL>> =
  IsDynamic<FL> extends true ? Loose : FieldValues<ShapeOf<FL>[K]>;
export type StepInputs<FL extends AnyFlow, K extends StepName<FL>> =
  IsDynamic<FL> extends true ? Loose : FieldInputs<ShapeOf<FL>[K]>;
export type FlowValues<FL extends AnyFlow> =
  IsDynamic<FL> extends true ? Readonly<Record<string, Loose | undefined>> : ValuesOf<ShapeOf<FL>>;
export type FieldName<FL extends AnyFlow> =
  IsDynamic<FL> extends true
    ? string
    : { [K in StepName<FL>]: keyof FieldsOf<ShapeOf<FL>[K]> & string }[StepName<FL>];
