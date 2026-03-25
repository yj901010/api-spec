import type { FieldSchema } from '../types.js';

function primitive(type: string): Record<string, unknown> {
  switch (type) {
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'null':
      return { type: 'null' };
    default:
      return {};
  }
}

function applyNullable(node: Record<string, unknown>, nullable?: boolean): Record<string, unknown> {
  if (!nullable) {
    return node;
  }

  const type = node.type;
  if (typeof type === 'string') {
    return {
      ...node,
      type: [type, 'null'],
    };
  }

  if (Array.isArray(type) && !type.includes('null')) {
    return {
      ...node,
      type: [...type, 'null'],
    };
  }

  return {
    anyOf: [node, { type: 'null' }],
  };
}

function buildNode(schema: FieldSchema | null): Record<string, unknown> {
  if (!schema) {
    return { type: 'object' };
  }

  const base: Record<string, unknown> = schema.description ? { description: schema.description } : {};
  if (schema.example) {
    try {
      base.examples = [JSON.parse(schema.example)];
    } catch {
      base.examples = [schema.example];
    }
  }
  if (schema.format) {
    base.format = schema.format;
  }
  if (schema.enumValues && schema.enumValues.length > 0) {
    base.enum = schema.enumValues;
  }

  if (schema.type === 'object') {
    return applyNullable({
      ...base,
      type: 'object',
      properties: Object.fromEntries(schema.children.map((child) => [child.name, buildNode(child)])),
      ...(schema.children.some((child) => child.required) ? { required: schema.children.filter((child) => child.required).map((child) => child.name) } : {}),
      ...(schema.hasAdditionalFields ? { additionalProperties: true } : { additionalProperties: false }),
    }, schema.nullable);
  }

  if (schema.type.startsWith('array<')) {
    const items = schema.children.length > 0
      ? {
          type: 'object',
          properties: Object.fromEntries(schema.children.map((child) => [child.name, buildNode(child)])),
          ...(schema.children.some((child) => child.required) ? { required: schema.children.filter((child) => child.required).map((child) => child.name) } : {}),
        }
      : primitive(schema.itemType || 'string');
    return applyNullable({
      ...base,
      type: 'array',
      items,
    }, schema.nullable);
  }

  return applyNullable({
    ...base,
    ...primitive(schema.type),
  }, schema.nullable);
}

export function buildJsonSchema(root: FieldSchema | null, title: string): Record<string, unknown> {
  const schema = buildNode(root);
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title,
    ...schema,
  };
}

export function renderJsonSchema(root: FieldSchema | null, title: string): string {
  return JSON.stringify(buildJsonSchema(root, title), null, 2);
}
