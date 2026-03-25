import type { EndpointDocument, EndpointParam, HttpMethod } from '../types.js';
import { findContentType, inferPathTemplate, inferRequestMode, normalizeImportedBody } from './import-utils.js';

export interface ParsedCurl {
  method: HttpMethod;
  url: string;
  headers: Array<{ name: string; value: string }>;
  body: string;
  requestModeHint?: EndpointDocument['requestMode'];
}

function shellSplit(input: string): string[] {
  const result: string[] = [];
  let current = '';
  let quote: 'single' | 'double' | null = null;
  let escaping = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;

    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (quote === 'single') {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (quote === 'double') {
      if (char === '"') {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'") {
      quote = 'single';
      continue;
    }
    if (char === '"') {
      quote = 'double';
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        result.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    result.push(current);
  }

  return result;
}

function tryJsonBeautify(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return '';
  }
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return input.trim();
  }
}

function objectBodyFromEntries(entries: string[]): string {
  const output: Record<string, string> = {};

  for (const entry of entries) {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }
    output[key] = value;
  }

  return Object.keys(output).length > 0 ? JSON.stringify(output, null, 2) : '';
}

export function parseCurl(raw: string): ParsedCurl | null {
  const tokens = shellSplit(raw.replace(/\\\n/g, ' '));
  if (tokens.length === 0 || tokens[0] !== 'curl') {
    return null;
  }

  let method: HttpMethod = 'GET';
  let url = '';
  const headers: Array<{ name: string; value: string }> = [];
  let body = '';
  const urlEncodedEntries: string[] = [];
  const multipartEntries: string[] = [];

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const next = tokens[index + 1];

    if ((token === '-X' || token === '--request') && next) {
      const upper = next.toUpperCase();
      if (upper === 'GET' || upper === 'POST' || upper === 'PUT' || upper === 'PATCH' || upper === 'DELETE') {
        method = upper;
      }
      index += 1;
      continue;
    }

    if ((token === '-H' || token === '--header') && next) {
      const [name = '', ...valueParts] = next.split(':');
      headers.push({ name: name.trim(), value: valueParts.join(':').trim() });
      index += 1;
      continue;
    }

    if ((token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary') && next) {
      body = next;
      if (method === 'GET') {
        method = 'POST';
      }
      index += 1;
      continue;
    }

    if (token === '--data-urlencode' && next) {
      urlEncodedEntries.push(next);
      if (method === 'GET') {
        method = 'POST';
      }
      index += 1;
      continue;
    }

    if ((token === '-F' || token === '--form') && next) {
      multipartEntries.push(next);
      if (method === 'GET') {
        method = 'POST';
      }
      index += 1;
      continue;
    }

    if (!token.startsWith('-') && !url && /^(https?:\/\/|\/)/.test(token)) {
      url = token;
    }
  }

  if (!url) {
    const fallback = tokens.find((token) => /^(https?:\/\/|\/)/.test(token));
    url = fallback ?? '';
  }

  if (!url) {
    return null;
  }

  let requestModeHint: EndpointDocument['requestMode'] | undefined;
  if (multipartEntries.length > 0) {
    body = objectBodyFromEntries(multipartEntries);
    requestModeHint = 'multipart/form-data';
  } else if (urlEncodedEntries.length > 0) {
    body = objectBodyFromEntries(urlEncodedEntries);
    requestModeHint = 'form-urlencoded';
  } else {
    body = tryJsonBeautify(body);
  }

  return {
    method,
    url,
    headers,
    body,
    requestModeHint,
  };
}

export function applyCurlImport(raw: string, endpoint: EndpointDocument): EndpointDocument | null {
  const parsed = parseCurl(raw);
  if (!parsed) {
    return null;
  }

  const url = parsed.url.startsWith('http') ? new URL(parsed.url) : new URL(parsed.url, 'http://localhost');
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

  const requestMode = parsed.requestModeHint ?? inferRequestMode(findContentType(parsed.headers), parsed.body);
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
