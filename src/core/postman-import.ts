import type { EndpointDocument, EndpointParam, HttpMethod } from '../types.js';
import { inferPathTemplate } from './import-utils.js';
import { toPascalCase } from '../utils/strings.js';

interface PostmanRequestUrl {
  raw?: string;
  path?: string[];
  query?: Array<{ key?: string; value?: string }>;
}

interface PostmanRequestLike {
  name?: string;
  request?: {
    method?: string;
    url?: string | PostmanRequestUrl;
    header?: Array<{ key?: string; value?: string }>;
    body?: {
      mode?: string;
      raw?: string;
      formdata?: Array<{ key?: string; value?: string }>;
      urlencoded?: Array<{ key?: string; value?: string }>;
    };
  };
  item?: PostmanRequestLike[];
}

function inferMethod(value?: string): HttpMethod {
  const upper = String(value || 'GET').toUpperCase();
  if (upper === 'GET' || upper === 'POST' || upper === 'PUT' || upper === 'PATCH' || upper === 'DELETE') {
    return upper;
  }
  return 'GET';
}

function flattenItems(items: PostmanRequestLike[], collector: PostmanRequestLike[] = []): PostmanRequestLike[] {
  for (const item of items) {
    if (Array.isArray(item.item)) {
      flattenItems(item.item, collector);
    } else if (item.request) {
      collector.push(item);
    }
  }
  return collector;
}

function normalizeBody(request: PostmanRequestLike['request']): { raw: string; requestMode: EndpointDocument['requestMode'] } {
  if (!request?.body) {
    return { raw: '', requestMode: 'none' };
  }
  const body = request.body;
  if (body.mode === 'raw') {
    const raw = body.raw?.trim() || '{\n  \n}';
    try {
      return { raw: JSON.stringify(JSON.parse(raw), null, 2), requestMode: 'json' };
    } catch {
      return { raw, requestMode: 'json' };
    }
  }
  if (body.mode === 'urlencoded') {
    const map = Object.fromEntries((body.urlencoded ?? []).map((entry) => [entry.key || 'field', entry.value || '']));
    return { raw: JSON.stringify(map, null, 2), requestMode: 'form-urlencoded' };
  }
  if (body.mode === 'formdata') {
    const map = Object.fromEntries((body.formdata ?? []).map((entry) => [entry.key || 'field', entry.value || '']));
    return { raw: JSON.stringify(map, null, 2), requestMode: 'multipart/form-data' };
  }
  return { raw: '', requestMode: 'none' };
}

function normalizeUrl(value: string | PostmanRequestUrl | undefined): URL {
  if (typeof value === 'string') {
    return new URL(value, 'http://localhost');
  }
  const raw = value?.raw || `/${(value?.path || []).join('/')}`;
  return new URL(raw, 'http://localhost');
}

export function applyPostmanCollectionImport(raw: string, template: EndpointDocument): EndpointDocument[] | null {
  let parsed: { item?: PostmanRequestLike[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.item)) {
    return null;
  }

  const requests = flattenItems(parsed.item);
  if (requests.length === 0) {
    return null;
  }

  return requests.map((item, index) => {
    const request = item.request!;
    const url = normalizeUrl(request.url);
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
    const headerParams: EndpointParam[] = (request.header ?? [])
      .filter((header) => header.key && header.key.toLowerCase() !== 'content-type')
      .map((header) => ({
        id: crypto.randomUUID(),
        name: header.key || 'Header',
        source: 'header',
        javaType: 'String',
        required: false,
        sampleValue: header.value || '',
        description: '',
      }));

    const normalizedBody = normalizeBody(request);
    const pathInfo = inferPathTemplate(url.pathname);
    const safeName = item.name || `Imported ${index + 1}`;
    const methodName = safeName.replace(/[^A-Za-z0-9]+/g, ' ');
    return {
      ...structuredClone(template),
      id: crypto.randomUUID(),
      name: safeName,
      requestRaw: normalizedBody.raw,
      responseRaw: '{\n  \n}',
      requestVariants: [],
      responseVariants: [],
      tags: ['postman-import'],
      requestMode: normalizedBody.requestMode,
      endpoint: {
        ...template.endpoint,
        basePath: '',
        httpMethod: inferMethod(request.method),
        endpointPath: pathInfo.endpointPath,
        controllerClassName: `${toPascalCase(safeName)}Controller`,
        serviceClassName: `${toPascalCase(safeName)}Service`,
        methodName: methodName ? methodName.charAt(0).toLowerCase() + toPascalCase(methodName).slice(1) : `imported${index + 1}`,
      },
      params: [...pathInfo.pathParams, ...queryParams, ...headerParams],
      schemaOverrides: { request: {}, response: {} },
      snapshots: [],
      compareSnapshotId: undefined,
      activeResultTab: 'controller',
    };
  });
}
