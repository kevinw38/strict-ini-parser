/**
 * Everything parse() gives you is a string, because INI has no type syntax.
 * Callers end up hand-rolling `Number(cfg.port)` and `cfg.debug === 'true'`
 * checks all over the place, and those checks rarely agree on what counts
 * as a valid number or a missing key. This module describes the shape you
 * expect once, in one place, and turns strings into the right type or
 * collects every problem at once instead of failing on the first one.
 */

import type { IniDocument } from './parser.js';

export type FieldType = 'string' | 'number' | 'boolean';

export interface FieldSchema {
  type: FieldType;
  required?: boolean;
  default?: string | number | boolean;
}

export type SectionSchema = Record<string, FieldSchema>;

export interface DocumentSchema {
  global?: SectionSchema;
  sections?: Record<string, SectionSchema>;
}

type FieldValue<T extends FieldType> = T extends 'number'
  ? number
  : T extends 'boolean'
    ? boolean
    : string;

type FieldOptional<F extends FieldSchema> = F['required'] extends true
  ? false
  : F['default'] extends string | number | boolean
    ? false
    : true;

type FieldResult<F extends FieldSchema> = FieldOptional<F> extends true
  ? FieldValue<F['type']> | undefined
  : FieldValue<F['type']>;

export type InferSection<S extends SectionSchema> = { [K in keyof S]: FieldResult<S[K]> };

export type InferDocument<Schema extends DocumentSchema> = {
  global: Schema['global'] extends SectionSchema ? InferSection<Schema['global']> : Record<string, never>;
  sections: Schema['sections'] extends Record<string, SectionSchema>
    ? { [K in keyof Schema['sections']]: InferSection<Schema['sections'][K]> }
    : Record<string, never>;
};

export class SchemaValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join('; '));
    this.name = 'SchemaValidationError';
    this.errors = errors;
  }
}

export function validate<Schema extends DocumentSchema>(
  doc: IniDocument,
  schema: Schema,
): InferDocument<Schema> {
  const errors: string[] = [];

  const global = schema.global
    ? validateSection(doc.global, schema.global, 'top level', errors)
    : {};

  const sections: Record<string, unknown> = {};
  if (schema.sections) {
    for (const name of Object.keys(schema.sections)) {
      sections[name] = validateSection(doc.sections[name], schema.sections[name], `section "${name}"`, errors);
    }
  }

  if (errors.length > 0) {
    throw new SchemaValidationError(errors);
  }

  return { global, sections } as InferDocument<Schema>;
}

function validateSection<S extends SectionSchema>(
  values: Record<string, string> | undefined,
  schema: S,
  where: string,
  errors: string[],
): InferSection<S> {
  const source = values ?? {};
  const result: Record<string, string | number | boolean> = {};

  for (const key of Object.keys(schema)) {
    const field = schema[key];
    const raw = source[key];

    if (raw === undefined) {
      if (field.default !== undefined) {
        result[key] = field.default;
      } else if (field.required) {
        errors.push(`${where}: missing required key "${key}"`);
      }
      continue;
    }

    const converted = convert(raw, field.type);
    if (converted === undefined) {
      errors.push(`${where}: key "${key}" is not a valid ${field.type} ("${raw}")`);
      continue;
    }
    result[key] = converted;
  }

  return result as InferSection<S>;
}

function convert(raw: string, type: FieldType): string | number | boolean | undefined {
  switch (type) {
    case 'string':
      return raw;
    case 'number': {
      // Number('') is 0 and Number('  ') is also 0, neither of which came
      // from a digit the user actually wrote, so reject them explicitly
      // rather than silently defaulting to zero.
      if (raw.trim() === '') {
        return undefined;
      }
      const n = Number(raw);
      return Number.isNaN(n) ? undefined : n;
    }
    case 'boolean':
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      return undefined;
  }
}
