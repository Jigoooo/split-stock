import { z } from 'zod';

export function zodToJsonSchema<T>(schema: z.ZodType<T>): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export function buildOpenAiJsonSchema<T>(
  schema: z.ZodType<T>,
  name: string,
): {
  type: 'json_schema';
  json_schema: { name: string; schema: Record<string, unknown>; strict: boolean };
} {
  return {
    type: 'json_schema',
    json_schema: {
      name: sanitizeSchemaName(name),
      schema: zodToJsonSchema(schema),
      strict: false,
    },
  };
}

function sanitizeSchemaName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}
