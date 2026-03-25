import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeVariantSet } from '../build/core/analysis-set.js';
import { generateArtifacts } from '../build/core/generator.js';
import { applyCurlImport } from '../build/core/curl.js';
import { applyRawHttpImport } from '../build/core/http-import.js';
import { buildChangeReport } from '../build/core/changes.js';
import { applyPostmanCollectionImport } from '../build/core/postman-import.js';
import { applyOpenApiImport } from '../build/core/openapi-import.js';
import { buildOpenApiDocument, mergeOpenApiDocuments } from '../build/core/openapi.js';

const endpoint = {
  packageName: 'com.example.api',
  basePath: '/api',
  endpointPath: '/orders/{orderId}',
  httpMethod: 'POST',
  controllerClassName: 'OrderController',
  serviceClassName: 'OrderService',
  methodName: 'saveOrder',
};

const baseDocument = {
  id: 'doc-x',
  name: 'Save Order',
  requestRaw: '{"userId":10}',
  responseRaw: '{"success":true}',
  requestVariants: [],
  responseVariants: [],
  endpoint,
  params: [],
  tags: [],
  requestMode: 'json',
  schemaOverrides: { request: {}, response: {} },
  snapshots: [],
  activeResultTab: 'controller',
};

const preset = {
  id: 'preset-1',
  name: 'Standard Internal',
  successResponseText: 'SUCCESS',
  rootArrayRequestStrategy: 'block',
  rootArrayWrapperField: 'items',
  requestBodyVariableName: 'map',
  dtoSuffix: 'Dto',
  includeLombok: true,
  addSwaggerAnnotations: false,
  openApiTitle: 'Workspace',
  openApiVersion: '1.0.0',
  serverUrl: 'http://localhost:8080',
};

test('analyzeVariantSet merges variants and marks missing fields optional', () => {
  const analysis = analyzeVariantSet(
    '{"userId":10,"memo":"gift"}',
    [{ id: 'v1', name: 'without memo', enabled: true, raw: '{"userId":10}' }],
    'request',
    {},
  );

  const memo = analysis.schema.rows.find((row) => row.path === 'memo');
  assert.equal(memo?.required, false);
  assert.equal(analysis.schema.variantCount, 1);
});

test('generateArtifacts emits json schema, mocks, and client snippets', () => {
  const request = analyzeVariantSet('{"userId":10}', [], 'request', {});
  const response = analyzeVariantSet('{"success":true}', [], 'response', {});
  const artifacts = generateArtifacts(baseDocument, preset, request, response);

  assert.match(artifacts.jsonSchemaText, /"\$schema"/);
  assert.match(artifacts.mockRequestText, /userId/);
  assert.match(artifacts.fetchText, /fetch\(/);
  assert.match(artifacts.axiosText, /axios/);
  assert.match(artifacts.markdownText, /# Save Order/);
});

test('curl and raw http imports populate endpoint information', () => {
  const curlDoc = applyCurlImport(
    "curl -X POST 'http://localhost:8080/api/orders/1?traceId=T1' -H 'X-Token: abc' -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode 'status=READY'",
    { ...baseDocument, requestRaw: '{"stale":true}', params: [{ id: 'p1', name: 'orderId', source: 'path', javaType: 'long', required: true, sampleValue: '1', description: '' }] },
  );
  assert.equal(curlDoc?.endpoint.httpMethod, 'POST');
  assert.equal(curlDoc?.endpoint.endpointPath, '/api/orders/{orderId}');
  assert.equal(curlDoc?.endpoint.basePath, '');
  assert.equal(curlDoc?.requestMode, 'form-urlencoded');
  assert.equal(curlDoc?.requestRaw, '{\n  "status": "READY"\n}');
  assert.ok(curlDoc?.params.some((param) => param.source === 'header'));
  assert.equal(curlDoc?.params.find((param) => param.source === 'path')?.sampleValue, '1');

  const httpDoc = applyRawHttpImport('GET /api/orders/2?debug=true HTTP/1.1\nX-Trace: 1', { ...baseDocument, requestRaw: '{"stale":true}' });
  assert.equal(httpDoc?.endpoint.httpMethod, 'GET');
  assert.equal(httpDoc?.endpoint.endpointPath, '/api/orders/{orderId}');
  assert.equal(httpDoc?.endpoint.basePath, '');
  assert.equal(httpDoc?.requestMode, 'none');
  assert.equal(httpDoc?.requestRaw, '');
  assert.ok(httpDoc?.params.some((param) => param.name === 'debug'));
  assert.equal(httpDoc?.params.find((param) => param.source === 'path')?.sampleValue, '2');
});

test('postman import can create multiple endpoint documents', () => {
  const collection = JSON.stringify({
    item: [
      { name: 'Save Order', request: { method: 'POST', url: { raw: 'http://localhost:8080/api/orders/42' }, body: { mode: 'raw', raw: '{"userId":10}' } } },
      { name: 'Search Order', request: { method: 'GET', url: { raw: 'http://localhost:8080/api/orders?status=READY' } } },
    ],
  });

  const documents = applyPostmanCollectionImport(collection, baseDocument);
  assert.equal(documents?.length, 2);
  assert.equal(documents?.[0].requestMode, 'json');
  assert.equal(documents?.[1].requestMode, 'none');
  assert.equal(documents?.[0].endpoint.basePath, '');
  assert.equal(documents?.[0].endpoint.endpointPath, '/api/orders/{orderId}');
  assert.equal(documents?.[0].params.find((param) => param.source === 'path')?.sampleValue, '42');
});

test('openapi import preserves supported request body modes', () => {
  const spec = JSON.stringify({
    paths: {
      '/upload': {
        post: {
          operationId: 'uploadFile',
          requestBody: {
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    file: { type: 'string' },
                    note: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ok: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const documents = applyOpenApiImport(spec, baseDocument);
  assert.equal(documents?.[0].requestMode, 'multipart/form-data');
  assert.match(documents?.[0].requestRaw || '', /"file"/);
  assert.equal(documents?.[0].endpoint.basePath, '');
});

test('mergeOpenApiDocuments keeps path methods and resolves schema name collisions', () => {
  const requestA = analyzeVariantSet('{"userId":10}', [], 'request', {});
  const responseA = analyzeVariantSet('{"success":true}', [], 'response', {});
  const requestB = analyzeVariantSet('{"status":"READY"}', [], 'request', {});
  const responseB = analyzeVariantSet('{"items":[]}', [], 'response', {});

  const postDoc = buildOpenApiDocument(
    { ...baseDocument, endpoint: { ...endpoint, basePath: '', endpointPath: '/orders', httpMethod: 'POST', methodName: 'saveOrder' } },
    preset,
    requestA,
    responseA,
  );
  const getDoc = buildOpenApiDocument(
    { ...baseDocument, endpoint: { ...endpoint, basePath: '', endpointPath: '/orders', httpMethod: 'GET', methodName: 'saveOrder' } },
    preset,
    requestB,
    responseB,
  );

  const merged = mergeOpenApiDocuments([postDoc, getDoc], preset.openApiTitle, preset.openApiVersion, preset.serverUrl);
  assert.ok(merged.paths['/orders'].post);
  assert.ok(merged.paths['/orders'].get);
  assert.equal(Object.keys(merged.components.schemas).length, 4);
});

test('change report flags request type changes as breaking', () => {
  const report = buildChangeReport(
    'Snapshot A',
    '2026-03-25',
    [{ path: 'userId', name: 'userId', type: 'number', inferredType: 'number', required: true, description: '', example: '1', notes: [], enumValues: [], nullable: false, include: true }],
    [],
    [{ path: 'userId', name: 'userId', type: 'string', inferredType: 'number', required: true, description: '', example: '"1"', notes: [], enumValues: [], nullable: false, include: true }],
    [],
  );

  assert.ok(report.items.some((item) => item.type === 'type-changed' && item.breaking));
});
