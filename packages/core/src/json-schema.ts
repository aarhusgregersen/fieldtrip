import { operators } from "./definition.js";

export type JsonSchema = { readonly [keyword: string]: unknown };

// Field types are yours, so their schema is too; core only knows the flow around them.
export function definitionJsonSchema(field: JsonSchema): JsonSchema {
  const map = (value: JsonSchema, description: string) => ({ type: "object", description, additionalProperties: value });
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "FlowDefinition",
    description:
      "A multi-step flow. The user starts at `start`, fills in each step's fields, and moves on along the first transition whose conditions all hold. A step without `next` ends the flow.",
    type: "object",
    required: ["start", "steps"],
    additionalProperties: false,
    properties: {
      id: { type: "string" },
      start: { type: "string", description: "Name of the first step. Must be a key of `steps`." },
      steps: map({ $ref: "#/$defs/step" }, "Steps by name."),
    },
    $defs: {
      field,
      condition: {
        type: "object",
        description:
          "Compares an answer from a step against `value`. Only answers from steps already submitted on the user's path are known; anything else is undefined. Comparisons never coerce: 5 does not equal \"5\".",
        required: ["step", "field", "op"],
        additionalProperties: false,
        properties: {
          step: { type: "string", description: "Name of the step whose answer is compared." },
          field: { type: "string", description: "Name of a field on that step." },
          op: { enum: operators },
          value: {
            description:
              "Required for equals, notEquals, contains, greaterThan and lessThan; greaterThan and lessThan need a number. Ignored by the other operators.",
          },
        },
      },
      conditions: {
        type: "array",
        description: "All conditions must hold. Express OR as separate transitions.",
        items: { $ref: "#/$defs/condition" },
      },
      transition: {
        type: "object",
        required: ["to"],
        additionalProperties: false,
        properties: {
          to: { type: "string", description: "Name of the step to go to." },
          when: { $ref: "#/$defs/conditions" },
        },
      },
      step: {
        type: "object",
        additionalProperties: false,
        properties: {
          fields: map({ $ref: "#/$defs/field" }, "Fields by name."),
          visibleWhen: {
            $ref: "#/$defs/conditions",
            description: "When these don't hold, the step is skipped by following its transition without conditions.",
          },
          fieldsVisibleWhen: map(
            { $ref: "#/$defs/conditions" },
            "Conditions per field name. A hidden field isn't validated and isn't part of the result.",
          ),
          next: {
            description:
              "A step name, or transitions tried in order where the first match wins. End with a transition without `when`, or a user who matches none gets stuck.",
            anyOf: [{ type: "string" }, { type: "array", items: { $ref: "#/$defs/transition" } }],
          },
        },
      },
    },
  };
}
