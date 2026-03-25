import type { EndpointDocument, EndpointParam } from '../types.js';

interface HeaderLike {
  name: string;
  value: string;
}

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_ID_SEGMENT = /^[0-9a-f]{24}$/i;
const LONG_HEX_SEGMENT = /^[0-9a-f]{16,}$/i;
const VERSION_SEGMENT = /^v\d+$/i;

export function decodePathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

function toWords(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function toCamelCase(value: string): string {
  const words = toWords(value.toLowerCase());
  if (words.length === 0) {
    return '';
  }
  return words[0]! + words.slice(1).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
}

function singularize(value: string): string {
  const lower = value.toLowerCase();
  if (lower.endsWith('ies') && lower.length > 3) {
    return `${lower.slice(0, -3)}y`;
  }
  if (lower.endsWith('ses') && lower.length > 3) {
    return lower.slice(0, -2);
  }
  if (lower.endsWith('s') && lower.length > 1) {
    return lower.slice(0, -1);
  }
  return lower;
}

function looksDynamicSegment(segment: string): boolean {
  if (!segment || VERSION_SEGMENT.test(segment)) {
    return false;
  }
  return /^\d+$/.test(segment) || UUID_SEGMENT.test(segment) || OBJECT_ID_SEGMENT.test(segment) || LONG_HEX_SEGMENT.test(segment);
}

function inferParamName(previousLiteral: string | undefined, existingNames: Set<string>, segment: string): string {
  const baseName = previousLiteral ? `${toCamelCase(singularize(previousLiteral)) || 'item'}Id` : /^\d+$/.test(segment) ? 'id' : 'resourceId';
  if (!existingNames.has(baseName)) {
    existingNames.add(baseName);
    return baseName;
  }

  let index = 2;
  let candidate = `${baseName}${index}`;
  while (existingNames.has(candidate)) {
    index += 1;
    candidate = `${baseName}${index}`;
  }
  existingNames.add(candidate);
  return candidate;
}

export function buildPathParams(pathname: string): EndpointParam[] {
  return Array.from(decodePathname(pathname).matchAll(/\{([^}]+)\}/g), (match) => {
    const name = match[1] || 'pathParam';
    return {
      id: crypto.randomUUID(),
      name,
      source: 'path' as const,
      javaType: 'String' as const,
      required: true,
      sampleValue: `{${name}}`,
      description: '',
    };
  });
}

export function inferPathTemplate(pathname: string): { endpointPath: string; pathParams: EndpointParam[] } {
  const decodedPath = decodePathname(pathname);
  const segments = decodedPath.split('/');
  const pathParams: EndpointParam[] = [];
  const existingNames = new Set(
    Array.from(decodedPath.matchAll(/\{([^}]+)\}/g), (match) => match[1] || 'pathParam').filter(Boolean),
  );

  const transformedSegments = segments.map((segment, index) => {
    if (!segment || /^\{[^}]+\}$/.test(segment)) {
      return segment;
    }

    if (!looksDynamicSegment(segment)) {
      return segment;
    }

    const previousLiteral = [...segments.slice(0, index)].reverse().find((candidate) => candidate && !looksDynamicSegment(candidate) && !/^\{[^}]+\}$/.test(candidate));
    const name = inferParamName(previousLiteral, existingNames, segment);
    pathParams.push({
      id: crypto.randomUUID(),
      name,
      source: 'path',
      javaType: /^\d+$/.test(segment) ? 'long' : 'String',
      required: true,
      sampleValue: segment,
      description: '',
    });
    return `{${name}}`;
  });

  return {
    endpointPath: transformedSegments.join('/') || '/',
    pathParams: pathParams.length > 0 ? pathParams : buildPathParams(decodedPath),
  };
}

export function findContentType(headers: HeaderLike[]): string | undefined {
  return headers.find((header) => header.name.toLowerCase() === 'content-type')?.value;
}

export function inferRequestMode(contentType: string | undefined, body: string): EndpointDocument['requestMode'] {
  if (!body.trim()) {
    return 'none';
  }

  const normalized = (contentType || '').toLowerCase();
  if (normalized.includes('application/x-www-form-urlencoded')) {
    return 'form-urlencoded';
  }
  if (normalized.includes('multipart/form-data')) {
    return 'multipart/form-data';
  }
  return 'json';
}

export function normalizeImportedBody(rawBody: string, requestMode: EndpointDocument['requestMode']): string {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return '';
  }

  if (requestMode === 'form-urlencoded') {
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        // fall back to query-string parsing
      }
    }
    const searchParams = new URLSearchParams(trimmed);
    const entries = Array.from(searchParams.entries());
    if (entries.length > 0) {
      return JSON.stringify(Object.fromEntries(entries), null, 2);
    }
  }

  if (requestMode === 'json') {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}
