import type { EndpointDocument, GenerationPreset } from '../types.js';

function basePath(document: EndpointDocument): string {
  return `${document.endpoint.basePath || ''}${document.endpoint.endpointPath || ''}` || '/generated';
}

function queryParams(document: EndpointDocument): string[] {
  return document.params.filter((param) => param.source === 'query').map((param) => param.name);
}

function headerParams(document: EndpointDocument): string[] {
  return document.params.filter((param) => param.source === 'header').map((param) => param.name);
}

function pathParams(document: EndpointDocument): string[] {
  return document.params.filter((param) => param.source === 'path').map((param) => param.name);
}

function toJsStringLiteral(value: string): string {
  return JSON.stringify(value);
}

function renderPathBuilder(document: EndpointDocument): string {
  const path = basePath(document);
  const parts = path.split(/(\{[^}]+\})/g).filter(Boolean);
  const expression = parts
    .map((part) => {
      const match = part.match(/^\{([^}]+)\}$/);
      if (match) {
        const name = match[1]!;
        return `encodeURIComponent(String(params.${name} ?? ''))`;
      }
      return toJsStringLiteral(part);
    })
    .join(' + ');
  return `const urlPath = ${expression || toJsStringLiteral('/')};`;
}

function renderUrlExpression(document: EndpointDocument, includeQuery = true): string {
  const queries = queryParams(document);
  if (!includeQuery || queries.length === 0) {
    return `${renderPathBuilder(document)}\nconst url = urlPath;`;
  }
  return [
    renderPathBuilder(document),
    'const query = new URLSearchParams();',
    ...queries.map((name) => `if (params.${name} !== undefined && params.${name} !== null) query.append('${name}', String(params.${name}));`),
    "const url = query.toString() ? `${urlPath}?${query.toString()}` : urlPath;",
  ].join('\n');
}

function renderHeaders(document: EndpointDocument): string {
  const requestMode = document.requestMode || 'json';
  const headerNames = headerParams(document);
  const lines = ['const headers: Record<string, string> = {'];
  if (requestMode === 'json') {
    lines.push(`  'Content-Type': 'application/json',`);
  }
  if (requestMode === 'form-urlencoded') {
    lines.push(`  'Content-Type': 'application/x-www-form-urlencoded',`);
  }
  for (const name of headerNames) {
    lines.push(`  '${name}': String(params.${name} ?? ''),`);
  }
  lines.push('};');
  return lines.join('\n');
}

function bodyExpression(document: EndpointDocument, _preset: GenerationPreset): string {
  const requestMode = document.requestMode || 'json';
  if (requestMode === 'none') {
    return '';
  }
  if (requestMode === 'form-urlencoded') {
    return `const body = new URLSearchParams(Object.entries(payload ?? {}).reduce((acc, [key, value]) => ({ ...acc, [key]: String(value ?? '') }), {} as Record<string, string>));`;
  }
  if (requestMode === 'multipart/form-data') {
    return `const body = new FormData();\nObject.entries(payload ?? {}).forEach(([key, value]) => {\n  if (Array.isArray(value)) {\n    value.forEach((entry) => body.append(key, entry as Blob | string));\n    return;\n  }\n  if (value !== undefined && value !== null) body.append(key, value as Blob | string);\n});`;
  }
  return `const body = JSON.stringify(payload ?? {});`;
}

export function renderFetchSnippet(document: EndpointDocument, preset: GenerationPreset): string {
  const requestMode = document.requestMode || 'json';
  const paramsSignature = [...pathParams(document), ...queryParams(document), ...headerParams(document)]
    .map((name) => `${name}?: string | number | boolean`)
    .join('; ');
  const payloadArg = requestMode === 'none' ? '' : `, payload?: Record<string, unknown>`;
  const body = bodyExpression(document, preset);
  const hasBody = requestMode !== 'none';
  return `export async function ${document.endpoint.methodName || 'callApi'}(params: { ${paramsSignature} } = {}${payloadArg}) {\n  ${renderUrlExpression(document)}\n  ${renderHeaders(document)}\n  ${body ? `${body}\n  ` : ''}const response = await fetch(url, {\n    method: '${document.endpoint.httpMethod}',\n    headers${hasBody ? ',\n    body,' : ''}\n  });\n\n  if (!response.ok) {\n    throw new Error(\`Request failed: \${response.status}\`);\n  }\n\n  const contentType = response.headers.get('content-type') || '';\n  return contentType.includes('application/json') ? response.json() : response.text();\n}\n`;
}

export function renderAxiosSnippet(document: EndpointDocument, preset: GenerationPreset): string {
  const requestMode = document.requestMode || 'json';
  const payloadArg = requestMode === 'none' ? '' : `, payload?: Record<string, unknown>`;
  const paramsSignature = [...pathParams(document), ...queryParams(document), ...headerParams(document)]
    .map((name) => `${name}?: string | number | boolean`)
    .join('; ');
  const queryObject = queryParams(document).map((name) => `${name}: params.${name}`).join(', ');
  const body = bodyExpression(document, preset);
  const paramsLine = queryObject ? `    params: { ${queryObject} },\n` : '';
  return `import axios from 'axios';\n\nexport async function ${document.endpoint.methodName || 'callApi'}(params: { ${paramsSignature} } = {}${payloadArg}) {\n  ${renderUrlExpression(document, false)}\n  ${renderHeaders(document)}\n  ${body ? `${body}\n  ` : ''}const response = await axios.request({\n    url,\n    method: '${document.endpoint.httpMethod.toLowerCase()}',\n    headers,\n${requestMode !== 'none' ? '    data: body,\n' : ''}${paramsLine}  });\n  return response.data;\n}\n`;
}
