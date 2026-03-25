import type { AnalysisResult, EndpointDocument, FieldSchema, GenerationPreset } from '../types.js';
import { astToValue } from './pretty.js';
import { toPascalCase } from '../utils/strings.js';

export interface OpenApiDocument {
  openapi: string;
  info: {
    title: string;
    version: string;
  };
  servers: Array<{ url: string }>;
  paths: Record<string, unknown>;
  components: {
    schemas: Record<string, unknown>;
  };
}

function primitiveSchema(type: string): Record<string, unknown> {
  switch (type) {
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'null':
      return { nullable: true };
    case 'mixed':
      return {};
    default:
      return {};
  }
}

function parseExample(example?: string): unknown {
  if (!example) {
    return undefined;
  }
  try {
    return JSON.parse(example);
  } catch {
    return example;
  }
}

function schemaToOpenApiSchema(schema: FieldSchema | null): Record<string, unknown> {
  if (!schema) {
    return { type: 'object' };
  }

  const meta: Record<string, unknown> = {
    ...(schema.description ? { description: schema.description } : {}),
    ...(schema.format ? { format: schema.format } : {}),
    ...(schema.enumValues && schema.enumValues.length > 0 ? { enum: schema.enumValues } : {}),
    ...(schema.nullable ? { nullable: true } : {}),
  };
  const example = parseExample(schema.example);
  if (example !== undefined) {
    meta.example = example;
  }

  if (schema.type === 'object') {
    const properties: Record<string, unknown> = {};
    const required = schema.children.filter((child) => child.required).map((child) => child.name);
    for (const child of schema.children) {
      const childSchema = schemaToOpenApiSchema(child);
      if (child.description) {
        childSchema.description = child.description;
      }
      if (child.hasAdditionalFields) {
        childSchema.additionalProperties = true;
      }
      properties[child.name] = childSchema;
    }
    return {
      type: 'object',
      ...meta,
      properties,
      ...(required.length > 0 ? { required } : {}),
      ...(schema.hasAdditionalFields ? { additionalProperties: true } : {}),
    };
  }

  if (schema.type.startsWith('array<')) {
    const itemShape = schema.children.length > 0
      ? {
          type: 'object',
          properties: Object.fromEntries(
            schema.children.map((child) => [
              child.name,
              {
                ...schemaToOpenApiSchema(child),
                ...(child.description ? { description: child.description } : {}),
              },
            ]),
          ),
          required: schema.children.filter((child) => child.required).map((child) => child.name),
          ...(schema.hasAdditionalFields ? { additionalProperties: true } : {}),
        }
      : primitiveSchema(schema.itemType ?? 'mixed');

    return {
      type: 'array',
      ...meta,
      items: itemShape,
    };
  }

  return {
    ...primitiveSchema(schema.type),
    ...meta,
  };
}

function schemaRootForRequest(schema: FieldSchema | null, preset: GenerationPreset): Record<string, unknown> {
  if (!schema) {
    return { type: 'object' };
  }

  if (schema.type.startsWith('array<') && preset.rootArrayRequestStrategy === 'wrap') {
    return {
      type: 'object',
      properties: {
        [preset.rootArrayWrapperField]: schemaToOpenApiSchema(schema),
      },
      required: [preset.rootArrayWrapperField],
    };
  }

  return schemaToOpenApiSchema(schema);
}

function requestExample(request: AnalysisResult, preset: GenerationPreset): unknown {
  if (!request.ast) {
    return {};
  }
  const value = astToValue(request.ast);
  if (request.ast.type === 'array' && preset.rootArrayRequestStrategy === 'wrap') {
    return {
      [preset.rootArrayWrapperField]: value,
    };
  }
  return value;
}

function responseExample(response: AnalysisResult): unknown {
  return response.ast ? astToValue(response.ast) : {};
}

function yamlScalar(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null) {
    return 'null';
  }
  return JSON.stringify(value);
}

function yamlKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : JSON.stringify(key);
}

function toYaml(value: unknown, depth = 0): string {
  const indentation = '  '.repeat(depth);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    return value
      .map((item) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const rendered = toYaml(item, depth + 1);
          const [firstLine, ...rest] = rendered.split('\n');
          return `${indentation}- ${firstLine}${rest.length > 0 ? `\n${rest.join('\n')}` : ''}`;
        }
        return `${indentation}- ${toYaml(item, depth + 1).trimStart()}`;
      })
      .join('\n');
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return '{}';
    }
    return entries
      .map(([key, current]) => {
        if (current && typeof current === 'object') {
          const rendered = toYaml(current, depth + 1);
          if (rendered.includes('\n')) {
            return `${indentation}${yamlKey(key)}:\n${rendered}`;
          }
          return `${indentation}${yamlKey(key)}: ${rendered.trimStart()}`;
        }
        return `${indentation}${yamlKey(key)}: ${yamlScalar(current)}`;
      })
      .join('\n');
  }

  return `${indentation}${yamlScalar(value)}`;
}

function requestContentType(document: EndpointDocument): string {
  switch (document.requestMode || 'json') {
    case 'form-urlencoded':
      return 'application/x-www-form-urlencoded';
    case 'multipart/form-data':
      return 'multipart/form-data';
    case 'none':
      return '';
    default:
      return 'application/json';
  }
}

export function buildOpenApiDocument(
  document: EndpointDocument,
  preset: GenerationPreset,
  request: AnalysisResult,
  response: AnalysisResult,
): OpenApiDocument {
  const baseName = toPascalCase(document.endpoint.methodName || document.name || 'Generated');
  const requestSchemaName = `${baseName}Request${toPascalCase(preset.dtoSuffix || 'Dto')}`;
  const responseSchemaName = `${baseName}Response${toPascalCase(preset.dtoSuffix || 'Dto')}`;
  const requestSchema = schemaRootForRequest(request.schema.root, preset);
  const responseSchema = schemaToOpenApiSchema(response.schema.root);

  const parameters = document.params.map((param) => ({
    name: param.name,
    in: param.source === 'path' ? 'path' : param.source === 'header' ? 'header' : 'query',
    required: param.source === 'path' ? true : param.required,
    description: param.description || undefined,
    schema: {
      type:
        param.javaType === 'int' || param.javaType === 'long' || param.javaType === 'double'
          ? 'number'
          : param.javaType === 'boolean'
            ? 'boolean'
            : 'string',
    },
    example: param.sampleValue || undefined,
  }));

  const responseContent =
    response.ast && (response.ast.type === 'string' || response.ast.type === 'identifier')
      ? {
          'text/plain': {
            schema: { type: 'string' },
            example: typeof responseExample(response) === 'string' ? responseExample(response) : preset.successResponseText,
          },
        }
      : {
          'application/json': {
            schema: { $ref: `#/components/schemas/${responseSchemaName}` },
            example: responseExample(response),
          },
        };

  const operation: Record<string, unknown> = {
    operationId: document.endpoint.methodName || 'generatedOperation',
    summary: document.name,
    parameters,
    responses: {
      '200': {
        description: 'Success response',
        content: responseContent,
      },
    },
  };

  const contentType = requestContentType(document);
  if ((document.requestMode || 'json') !== 'none' && request.ast && (request.ast.type === 'object' || request.ast.type === 'array')) {
    operation.requestBody = {
      required: true,
      content: {
        [contentType]: {
          schema: { $ref: `#/components/schemas/${requestSchemaName}` },
          example: requestExample(request, preset),
        },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: preset.openApiTitle || `${document.name} API`,
      version: preset.openApiVersion || '1.0.0',
    },
    servers: [{ url: preset.serverUrl || 'http://localhost:8080' }],
    paths: {
      [`${document.endpoint.basePath || ''}${document.endpoint.endpointPath || '/generated'}`]: {
        [document.endpoint.httpMethod.toLowerCase()]: operation,
      },
    },
    components: {
      schemas: {
        [requestSchemaName]: requestSchema,
        [responseSchemaName]: responseSchema,
      },
    },
  };
}

export function renderOpenApiYaml(document: OpenApiDocument): string {
  return toYaml(document);
}

function uniqueSchemaName(name: string, usedNames: Set<string>): string {
  if (!usedNames.has(name)) {
    return name;
  }

  let index = 2;
  let candidate = `${name}${index}`;
  while (usedNames.has(candidate)) {
    index += 1;
    candidate = `${name}${index}`;
  }
  return candidate;
}

function replaceSchemaRefs(value: unknown, renamedSchemas: Map<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => replaceSchemaRefs(item, renamedSchemas));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;
  const replaced: Record<string, unknown> = {};
  for (const [key, current] of Object.entries(record)) {
    if (key === '$ref' && typeof current === 'string' && current.startsWith('#/components/schemas/')) {
      const originalName = current.slice('#/components/schemas/'.length);
      replaced[key] = renamedSchemas.has(originalName)
        ? `#/components/schemas/${renamedSchemas.get(originalName)}`
        : current;
      continue;
    }
    replaced[key] = replaceSchemaRefs(current, renamedSchemas);
  }
  return replaced;
}

export function mergeOpenApiDocuments(documents: OpenApiDocument[], title: string, version: string, serverUrl: string): OpenApiDocument {
  const merged: OpenApiDocument = {
    openapi: '3.1.0',
    info: {
      title,
      version,
    },
    servers: serverUrl ? [{ url: serverUrl }] : [],
    paths: {},
    components: {
      schemas: {},
    },
  };
  const usedSchemaNames = new Set<string>();

  for (const document of documents) {
    const cloned = structuredClone(document);
    const renamedSchemas = new Map<string, string>();
    const nextSchemas: Record<string, unknown> = {};

    for (const [name, schema] of Object.entries(cloned.components.schemas)) {
      const uniqueName = uniqueSchemaName(name, usedSchemaNames);
      usedSchemaNames.add(uniqueName);
      renamedSchemas.set(name, uniqueName);
      nextSchemas[uniqueName] = schema;
    }

    const nextPaths = replaceSchemaRefs(cloned.paths, renamedSchemas) as Record<string, unknown>;
    const normalizedSchemas = replaceSchemaRefs(nextSchemas, renamedSchemas) as Record<string, unknown>;

    for (const [path, pathItem] of Object.entries(nextPaths)) {
      const existing = merged.paths[path];
      if (existing && typeof existing === 'object' && pathItem && typeof pathItem === 'object') {
        merged.paths[path] = {
          ...(existing as Record<string, unknown>),
          ...(pathItem as Record<string, unknown>),
        };
      } else {
        merged.paths[path] = pathItem;
      }
    }

    Object.assign(merged.components.schemas, normalizedSchemas);
  }

  return merged;
}
