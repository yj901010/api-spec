import type { EndpointDocument, EndpointParam, HttpMethod } from '../types.js';
import { findContentType, inferPathTemplate, inferRequestMode, normalizeImportedBody } from './import-utils.js';

export interface ParsedHttpRequest {
  method: HttpMethod;
  path: string;
  headers: Array<{ name: string; value: string }>;
  body: string;
}

function inferMethod(value: string): HttpMethod {
  const upper = value.toUpperCase();
  if (upper === 'GET' || upper === 'POST' || upper === 'PUT' || upper === 'PATCH' || upper === 'DELETE') {
    return upper;
  }
  return 'GET';
}

export function parseRawHttpRequest(raw: string): ParsedHttpRequest | null {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return null;
  }
  const parts = normalized.split('\n\n');
  const head = parts.shift() || '';
  const bodyParts = parts;
  const lines = head.split('\n');
  const requestLine = lines.shift();
  if (!requestLine) {
    return null;
  }
  const [method, path] = requestLine.split(/\s+/);
  if (!method || !path) {
    return null;
  }
  const headers = lines
    .map((line) => {
      const idx = line.indexOf(':');
      if (idx < 0) return null;
      return { name: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
    })
    .filter((value): value is { name: string; value: string } => Boolean(value));

  let body = bodyParts.join('\n\n').trim();
  if (body) {
    try {
      body = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      // keep raw
    }
  }

  return {
    method: inferMethod(method),
    path,
    headers,
    body,
  };
}

export function applyRawHttpImport(raw: string, endpoint: EndpointDocument): EndpointDocument | null {
  const parsed = parseRawHttpRequest(raw);
  if (!parsed) {
    return null;
  }
  const url = new URL(parsed.path, 'http://localhost');
  const pathInfo = inferPathTemplate(url.pathname || endpoint.endpoint.endpointPath);
  const queryParams: EndpointParam[] = [];
  url.searchParams.forEach((value, key) => {
    queryParams.push({
      id: crypto.randomUUID(),
      name: key,
      source: 'query',
      javaType: 'String',
      required: false,
      sampleValue: value,
      description: '',
    });
  });
  const headerParams: EndpointParam[] = parsed.headers
    .filter((header) => header.name.toLowerCase() !== 'content-type')
    .map((header) => ({
      id: crypto.randomUUID(),
      name: header.name,
      source: 'header',
      javaType: 'String',
      required: false,
      sampleValue: header.value,
      description: '',
    }));

  const requestMode = inferRequestMode(findContentType(parsed.headers), parsed.body);
  const requestRaw = normalizeImportedBody(parsed.body, requestMode);

  return {
    ...endpoint,
    requestRaw,
    requestMode,
    endpoint: {
      ...endpoint.endpoint,
      basePath: '',
      httpMethod: parsed.method,
      endpointPath: pathInfo.endpointPath,
    },
    params: [...pathInfo.pathParams, ...queryParams, ...headerParams],
  };
}
