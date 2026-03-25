import type { EndpointDocument, EndpointParam, HttpMethod } from '../types.js';
import { toPascalCase } from '../utils/strings.js';
import { decodePathname } from './import-utils.js';

interface OpenApiLike {
  paths?: Record<string, Record<string, any>>;
}

interface MediaContentSelection {
  mediaType: string | null;
  raw: string;
  requestMode: EndpointDocument['requestMode'];
}

function inferMethod(method: string): HttpMethod | null {
  const upper = method.toUpperCase();
  if (upper === 'GET' || upper === 'POST' || upper === 'PUT' || upper === 'PATCH' || upper === 'DELETE') {
    return upper;
  }
  return null;
}

function schemaExample(schema: any): unknown {
  if (!schema || typeof schema !== 'object') {
    return {};
  }
  if (schema.example !== undefined) {
    return schema.example;
  }
  if (schema.type === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema.properties || {})) {
      output[key] = schemaExample(value);
    }
    return output;
  }
  if (schema.type === 'array') {
    return [schemaExample(schema.items || {})];
  }
  if (schema.enum && Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }
  switch (schema.type) {
    case 'string':
      return schema.format === 'date' ? '2026-03-25' : schema.format === 'date-time' ? '2026-03-25T09:00:00Z' : 'sample';
    case 'number':
    case 'integer':
      return 1;
    case 'boolean':
      return true;
    default:
      return {};
  }
}

function contentExample(media: any): unknown {
  if (media?.example !== undefined) {
    return media.example;
  }
  return schemaExample(media?.schema || {});
}

function requestModeFromMediaType(mediaType: string | null, hasBody: boolean): EndpointDocument['requestMode'] {
  if (!hasBody) {
    return 'none';
  }
  if (!mediaType) {
    return 'json';
  }
  const normalized = mediaType.toLowerCase();
  if (normalized.includes('application/x-www-form-urlencoded')) {
    return 'form-urlencoded';
  }
  if (normalized.includes('multipart/form-data')) {
    return 'multipart/form-data';
  }
  return 'json';
}

function stringifyExample(example: unknown): string {
  if (example === undefined || example === null) {
    return '';
  }
  return typeof example === 'string' ? example : JSON.stringify(example, null, 2);
}

function selectRequestBody(requestBody: any): MediaContentSelection {
  const content = requestBody?.content;
  if (!content || typeof content !== 'object') {
    return { mediaType: null, raw: '', requestMode: 'none' };
  }

  const entries = Object.entries(content);
  const preferred = ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data'];
  const selected =
    preferred
      .map((mediaType) => [mediaType, content[mediaType]] as const)
      .find(([, media]) => Boolean(media))
    ?? entries[0]
    ?? null;

  if (!selected) {
    return { mediaType: null, raw: '', requestMode: 'none' };
  }

  const [mediaType, media] = selected;
  const raw = stringifyExample(contentExample(media));
  return {
    mediaType,
    raw,
    requestMode: requestModeFromMediaType(mediaType, raw.trim().length > 0),
  };
}

function selectResponseExample(operation: any): unknown {
  const response = operation.responses?.['200'] ?? operation.responses?.default;
  const content = response?.content;
  if (!content || typeof content !== 'object') {
    return {};
  }

  if (content['application/json']) {
    return contentExample(content['application/json']);
  }
  const firstMedia = Object.values(content)[0];
  return contentExample(firstMedia);
}

export function applyOpenApiImport(raw: string, template: EndpointDocument): EndpointDocument[] | null {
  let parsed: OpenApiLike;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed.paths || typeof parsed.paths !== 'object') {
    return null;
  }

  const documents: EndpointDocument[] = [];
  for (const [path, operations] of Object.entries(parsed.paths)) {
    for (const [methodKey, operation] of Object.entries(operations || {})) {
      const method = inferMethod(methodKey);
      if (!method) {
        continue;
      }
      const parameters: EndpointParam[] = (operation.parameters || []).map((parameter: any) => ({
        id: crypto.randomUUID(),
        name: parameter.name || 'param',
        source: parameter.in === 'path' ? 'path' : parameter.in === 'header' ? 'header' : 'query',
        javaType:
          parameter.schema?.type === 'integer' || parameter.schema?.type === 'number'
            ? 'long'
            : parameter.schema?.type === 'boolean'
              ? 'boolean'
              : 'String',
        required: Boolean(parameter.required || parameter.in === 'path'),
        description: parameter.description || '',
        sampleValue: parameter.example ? String(parameter.example) : '',
      }));
      const requestBody = selectRequestBody(operation.requestBody);
      const responseSchema = selectResponseExample(operation);

      const baseName = operation.operationId || operation.summary || `${methodKey} ${path}`;
      documents.push({
        ...structuredClone(template),
        id: crypto.randomUUID(),
        name: operation.summary || baseName,
        requestRaw: requestBody.raw,
        responseRaw:
          typeof responseSchema === 'string'
            ? responseSchema
            : JSON.stringify(responseSchema, null, 2),
        requestVariants: [],
        responseVariants: [],
        tags: ['openapi-import'],
        requestMode: requestBody.requestMode,
        endpoint: {
          ...template.endpoint,
          basePath: '',
          httpMethod: method,
          endpointPath: decodePathname(path),
          controllerClassName: `${toPascalCase(baseName)}Controller`,
          serviceClassName: `${toPascalCase(baseName)}Service`,
          methodName: `${toPascalCase(baseName).charAt(0).toLowerCase()}${toPascalCase(baseName).slice(1)}` || 'generated',
        },
        params: parameters,
        schemaOverrides: { request: {}, response: {} },
        snapshots: [],
        compareSnapshotId: undefined,
        activeResultTab: 'openapi',
      });
    }
  }

  return documents.length > 0 ? documents : null;
}
