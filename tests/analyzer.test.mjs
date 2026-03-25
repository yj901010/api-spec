import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeInput } from '../build/core/analyzer.js';
import { generateArtifacts } from '../build/core/generator.js';

const endpoint = {
  packageName: 'com.example.api',
  basePath: '/api',
  endpointPath: '/orders/{orderId}',
  httpMethod: 'POST',
  controllerClassName: 'OrderController',
  serviceClassName: 'OrderService',
  methodName: 'saveOrder',
};

const document = {
  id: 'doc-1',
  name: 'Save Order',
  requestRaw: '',
  responseRaw: '',
  endpoint,
  params: [{ id: 'p1', name: 'orderId', source: 'path', javaType: 'long', required: true, sampleValue: '1', description: '' }],
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

test('analyzeInput parses comments, trailing commas, and ellipsis', () => {
  const result = analyzeInput(
    `{
      // 회원 ID
      "userId": 10,
      "items": [
        { "itemId": 1 },
        ...
      ],
    }`,
    'request',
  );

  assert.ok(result.ast);
  assert.equal(result.ast.type, 'object');
  assert.ok(result.normalizedText.includes('"userId": 10'));
  assert.ok(result.issues.some((issue) => issue.code === 'ELLIPSIS'));
  assert.ok(result.issues.some((issue) => issue.code === 'TRAILING_COMMA'));
  const userIdRow = result.schema.rows.find((row) => row.path === 'userId');
  assert.equal(userIdRow?.description, '회원 ID');
});

test('analyzeInput reports bracket mismatch', () => {
  const result = analyzeInput(
    `{
      "items": [1, 2, 3}
    }`,
    'request',
  );

  assert.ok(result.issues.some((issue) => issue.code === 'MISMATCH_BRACE'));
});

test('generateArtifacts produces String controller and void service for success responses', () => {
  const request = analyzeInput('{"userId": 10}', 'request');
  const response = analyzeInput('SUCCESS', 'response');
  const artifacts = generateArtifacts(
    { ...document, requestRaw: '{"userId": 10}', responseRaw: 'SUCCESS' },
    preset,
    request,
    response,
  );

  assert.equal(artifacts.responseJavaType, 'String');
  assert.equal(artifacts.serviceJavaType, 'void');
  assert.match(artifacts.controllerCode, /return "SUCCESS";/);
  assert.match(artifacts.dtoCode, /Response DTO/);
});

test('generateArtifacts blocks root array requests in block mode', () => {
  const request = analyzeInput('[{"itemId": 1}]', 'request');
  const response = analyzeInput('{"success": true}', 'response');
  const artifacts = generateArtifacts(
    { ...document, requestRaw: '[{"itemId":1}]', responseRaw: '{"success":true}' },
    preset,
    request,
    response,
  );

  assert.ok(artifacts.generationBlocked);
  assert.ok(artifacts.issues.some((issue) => issue.code === 'ROOT_ARRAY_REQUEST'));
});

test('generateArtifacts wraps root array requests when preset says wrap', () => {
  const request = analyzeInput('[{"itemId": 1}]', 'request');
  const response = analyzeInput('{"success": true}', 'response');
  const wrapPreset = { ...preset, rootArrayRequestStrategy: 'wrap', rootArrayWrapperField: 'items' };
  const artifacts = generateArtifacts(
    { ...document, requestRaw: '[{"itemId":1}]', responseRaw: '{"success":true}' },
    wrapPreset,
    request,
    response,
  );

  assert.equal(artifacts.generationBlocked, false);
  assert.equal(artifacts.rootArrayWrapped, true);
  assert.match(artifacts.payloadText, /"items"/);
  assert.match(artifacts.openApiYaml, /items:/);
});

test('generateArtifacts emits explicit constructor when Lombok is disabled', () => {
  const request = analyzeInput('{"userId": 10}', 'request');
  const response = analyzeInput('{"success": true}', 'response');
  const artifacts = generateArtifacts(
    { ...document, requestRaw: '{"userId":10}', responseRaw: '{"success":true}' },
    { ...preset, includeLombok: false },
    request,
    response,
  );

  assert.doesNotMatch(artifacts.controllerCode, /RequiredArgsConstructor/);
  assert.match(artifacts.controllerCode, /public OrderController\(OrderService orderService\)/);
});
