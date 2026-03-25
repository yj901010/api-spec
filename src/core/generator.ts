import type {
  AnalysisResult,
  EndpointDocument,
  GenerationArtifacts,
  GenerationPreset,
  ParseIssue,
} from '../types.js';
import { emptyRange } from '../utils/source.js';
import { indent, toCamelCase, toPascalCase } from '../utils/strings.js';
import { generateDtoArtifacts } from './dto.js';
import { buildOpenApiDocument, renderOpenApiYaml } from './openapi.js';
import { astToValue } from './pretty.js';
import { renderJsonSchema } from './json-schema.js';
import { renderMockJson } from './mock.js';
import { renderFetchSnippet, renderAxiosSnippet } from './http-client.js';
import { renderMarkdownDocument } from './markdown.js';

function javaMethodAnnotation(method: EndpointDocument['endpoint']['httpMethod']): string {
  switch (method) {
    case 'GET':
      return 'GetMapping';
    case 'POST':
      return 'PostMapping';
    case 'PUT':
      return 'PutMapping';
    case 'PATCH':
      return 'PatchMapping';
    case 'DELETE':
      return 'DeleteMapping';
    default:
      return 'PostMapping';
  }
}

function quoteJava(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function resolveResponseJavaType(response: AnalysisResult): 'Object' | 'List<Object>' | 'String' {
  const node = response.ast;
  if (!node) {
    return 'Object';
  }
  if (node.type === 'array') {
    return 'List<Object>';
  }
  if (node.type === 'string' || node.type === 'identifier') {
    return 'String';
  }
  return 'Object';
}

function resolveSuccessMessage(response: AnalysisResult, preset: GenerationPreset): string {
  const node = response.ast;
  if (node && (node.type === 'string' || node.type === 'identifier')) {
    return String(node.value);
  }
  return preset.successResponseText || 'SUCCESS';
}

function hasRequestBody(document: EndpointDocument, request: AnalysisResult): boolean {
  const requestMode = document.requestMode || 'json';
  if (requestMode === 'none') {
    return false;
  }
  if (!request.raw.trim()) {
    return false;
  }
  if (!request.ast) {
    return false;
  }
  return request.ast.type === 'object' || request.ast.type === 'array';
}

function isRootArrayRequest(document: EndpointDocument, request: AnalysisResult): boolean {
  return (document.requestMode || 'json') === 'json' && request.ast?.type === 'array';
}

function buildEffectivePayload(
  document: EndpointDocument,
  request: AnalysisResult,
  preset: GenerationPreset,
): { payloadText: string; rootArrayWrapped: boolean } {
  if ((document.requestMode || 'json') !== 'json') {
    return {
      payloadText: request.normalizedText || '{}',
      rootArrayWrapped: false,
    };
  }

  if (request.ast?.type === 'array' && preset.rootArrayRequestStrategy === 'wrap') {
    const wrapped = {
      [preset.rootArrayWrapperField || 'items']: astToValue(request.ast),
    };
    return {
      payloadText: JSON.stringify(wrapped, null, 2),
      rootArrayWrapped: true,
    };
  }

  return {
    payloadText: request.normalizedText || '{}',
    rootArrayWrapped: false,
  };
}

function validateConfiguration(
  document: EndpointDocument,
  preset: GenerationPreset,
  request: AnalysisResult,
): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const target = 'config' as const;
  const endpoint = document.endpoint;
  const params = document.params;

  const placeholders = Array.from(endpoint.endpointPath.matchAll(/\{([^}]+)\}/g))
    .map((match) => match[1]!)
    .filter(Boolean);
  const pathParamNames = params.filter((param) => param.source === 'path').map((param) => param.name);

  for (const param of params.filter((current) => current.source === 'path')) {
    if (!placeholders.includes(param.name)) {
      issues.push({
        target,
        level: 'warning',
        code: 'PATH_PARAM_MISSING_IN_URL',
        message: `path 파라미터 '${param.name}' 가 URL 경로에 없습니다.`,
        range: emptyRange(),
        suggestion: `${endpoint.endpointPath || '/path/{' + param.name + '}'} 형태로 맞춰주세요.`,
        navigable: false,
      });
    }
  }

  for (const placeholder of placeholders) {
    if (!pathParamNames.includes(placeholder)) {
      issues.push({
        target,
        level: 'warning',
        code: 'URL_PLACEHOLDER_WITHOUT_PARAM',
        message: `URL placeholder '{${placeholder}}' 에 해당하는 path 파라미터가 없습니다.`,
        range: emptyRange(),
        suggestion: `파라미터 목록에 ${placeholder} 를 추가하세요.`,
        navigable: false,
      });
    }
  }

  if (isRootArrayRequest(document, request)) {
    issues.push({
      target,
      level: preset.rootArrayRequestStrategy === 'wrap' ? 'info' : 'warning',
      code: 'ROOT_ARRAY_REQUEST',
      message:
        preset.rootArrayRequestStrategy === 'wrap'
          ? `request root 배열을 '${preset.rootArrayWrapperField}' 필드로 감싸서 생성합니다.`
          : 'request root 가 배열이라 Map<String, Object> @RequestBody 생성이 막혔습니다.',
      range: emptyRange(),
      suggestion:
        preset.rootArrayRequestStrategy === 'wrap'
          ? `{ "${preset.rootArrayWrapperField}": [...] } 형태 payload 를 함께 생성합니다.`
          : '{ "items": [...] } 형태로 감싸거나 preset 을 wrap 으로 바꾸세요.',
      navigable: false,
    });
  }

  if (endpoint.httpMethod === 'GET' && hasRequestBody(document, request)) {
    issues.push({
      target,
      level: 'warning',
      code: 'GET_WITH_BODY',
      message: 'GET 메서드에 request body 가 있습니다. 일부 클라이언트/프록시에서 지원이 불안정할 수 있습니다.',
      range: emptyRange(),
      navigable: false,
    });
  }

  return issues;
}

function buildAnnotationParams(annotationName: string, params: EndpointDocument['params']): string[] {
  return params.map((param) => {
    const requiredFragment = annotationName === 'PathVariable' ? '' : `, required = ${param.required ? 'true' : 'false'}`;
    return `@${annotationName}(value = "${param.name}"${requiredFragment}) ${param.javaType} ${param.name}`;
  });
}

function bodyParameterAnnotation(document: EndpointDocument, variableName: string): string | null {
  const requestMode = document.requestMode || 'json';
  if (requestMode === 'none') {
    return null;
  }
  if (requestMode === 'json') {
    return `@RequestBody Map<String, Object> ${variableName}`;
  }
  const annotation = requestMode === 'multipart/form-data' ? 'RequestPart' : 'RequestParam';
  return `@${annotation} Map<String, Object> ${variableName}`;
}

function generateMethodParameters(
  document: EndpointDocument,
  requestHasBody: boolean,
  requestBodyVariableName: string,
): { controllerParams: string[]; serviceParams: string[] } {
  const params = document.params;
  const pathParams = params.filter((param) => param.source === 'path');
  const queryParams = params.filter((param) => param.source === 'query');
  const headerParams = params.filter((param) => param.source === 'header');
  const bodyParam = requestHasBody ? bodyParameterAnnotation(document, requestBodyVariableName) : null;

  const controllerParams = [
    ...buildAnnotationParams('PathVariable', pathParams),
    ...buildAnnotationParams('RequestParam', queryParams),
    ...buildAnnotationParams('RequestHeader', headerParams),
    ...(bodyParam ? [bodyParam] : []),
  ];

  const serviceParams = [
    ...pathParams.map((param) => `${param.javaType} ${param.name}`),
    ...queryParams.map((param) => `${param.javaType} ${param.name}`),
    ...headerParams.map((param) => `${param.javaType} ${param.name}`),
    ...(bodyParam ? [`Map<String, Object> ${requestBodyVariableName}`] : []),
  ];

  return { controllerParams, serviceParams };
}

function requestConsumes(document: EndpointDocument): string | null {
  switch (document.requestMode || 'json') {
    case 'json':
      return 'MediaType.APPLICATION_JSON_VALUE';
    case 'form-urlencoded':
      return 'MediaType.APPLICATION_FORM_URLENCODED_VALUE';
    case 'multipart/form-data':
      return 'MediaType.MULTIPART_FORM_DATA_VALUE';
    default:
      return null;
  }
}

function generateControllerCode(
  document: EndpointDocument,
  preset: GenerationPreset,
  request: AnalysisResult,
  response: AnalysisResult,
  responseJavaType: GenerationArtifacts['responseJavaType'],
  requestHasBody: boolean,
  generationBlocked: boolean,
  rootArrayWrapped: boolean,
): string {
  const endpoint = document.endpoint;
  const className = toPascalCase(endpoint.controllerClassName) || 'GeneratedController';
  const serviceClassName = toPascalCase(endpoint.serviceClassName) || 'GeneratedService';
  const serviceFieldName = toCamelCase(serviceClassName) || 'generatedService';
  const annotation = javaMethodAnnotation(endpoint.httpMethod);
  const methodName = toCamelCase(endpoint.methodName) || 'handle';
  const requestBodyVariableName = toCamelCase(preset.requestBodyVariableName || 'map') || 'map';
  const produces = responseJavaType === 'String' ? 'MediaType.TEXT_PLAIN_VALUE' : 'MediaType.APPLICATION_JSON_VALUE';
  const mappingAttributes = [`value = "${endpoint.endpointPath || '/generated'}"`, `produces = ${produces}`];
  const consumes = requestConsumes(document);
  if (requestHasBody && consumes) {
    mappingAttributes.push(`consumes = ${consumes}`);
  }

  const imports = new Set<string>([
    'import org.springframework.http.MediaType;',
    'import org.springframework.web.bind.annotation.*;',
  ]);
  if (preset.includeLombok) {
    imports.add('import lombok.RequiredArgsConstructor;');
  }
  if (requestHasBody) {
    imports.add('import java.util.Map;');
  }
  if (responseJavaType === 'List<Object>') {
    imports.add('import java.util.List;');
  }
  if (preset.addSwaggerAnnotations) {
    imports.add('import io.swagger.v3.oas.annotations.Operation;');
    imports.add('import io.swagger.v3.oas.annotations.tags.Tag;');
  }

  const { controllerParams, serviceParams } = generateMethodParameters(document, requestHasBody, requestBodyVariableName);
  const parameterBlock = controllerParams.join(',\n        ');
  const serviceInvocation = `${serviceFieldName}.${methodName}(${serviceParams
    .map((param) => param.split(' ').pop() || '')
    .join(', ')})`;
  const methodBody = responseJavaType === 'String'
    ? `${serviceInvocation};\n        return "${quoteJava(resolveSuccessMessage(response, preset))}";`
    : `return ${serviceInvocation};`;

  const packageDeclaration = endpoint.packageName ? `package ${endpoint.packageName};\n\n` : '';
  const requestMapping = endpoint.basePath ? `@RequestMapping("${endpoint.basePath}")\n` : '';

  const commentLines: string[] = [];
  if (generationBlocked) {
    commentLines.push('// TODO: request root array 는 Map<String, Object>로 직접 받을 수 없습니다. preset 을 wrap 으로 바꾸거나 객체로 감싸서 다시 생성하세요.');
  }
  if (rootArrayWrapped) {
    commentLines.push(`// NOTE: request root array 는 '${preset.rootArrayWrapperField}' 필드로 감싸서 payload 를 생성합니다.`);
  }
  if ((document.requestMode || 'json') !== 'json' && requestHasBody) {
    commentLines.push(`// NOTE: ${document.requestMode} 모드로 생성된 API 입니다.`);
  }

  const classAnnotations = [
    '@RestController',
    ...(preset.addSwaggerAnnotations ? [`@Tag(name = "${className}")`] : []),
    requestMapping.trimEnd(),
    ...(preset.includeLombok ? ['@RequiredArgsConstructor'] : []),
  ].filter(Boolean).join('\n');

  const operationAnnotation = preset.addSwaggerAnnotations
    ? `    @Operation(summary = "${quoteJava(`${document.name} (${endpoint.httpMethod} ${endpoint.endpointPath || '/generated'})`)}")\n`
    : '';
  const constructorBlock = preset.includeLombok
    ? ''
    : `    public ${className}(${serviceClassName} ${serviceFieldName}) {\n        this.${serviceFieldName} = ${serviceFieldName};\n    }\n\n`;

  return `${packageDeclaration}${Array.from(imports).sort().join('\n')}

${classAnnotations}
public class ${className} {

    private final ${serviceClassName} ${serviceFieldName};

${constructorBlock}${commentLines.length > 0 ? indent(commentLines.join('\n'), 4) + '\n\n' : ''}${operationAnnotation}    @${annotation}(${mappingAttributes.join(', ')})
    public ${responseJavaType} ${methodName}(${parameterBlock || ''}) {
        ${methodBody}
    }
}
`;
}

function generateServiceInterfaceCode(
  document: EndpointDocument,
  preset: GenerationPreset,
  serviceJavaType: GenerationArtifacts['serviceJavaType'],
  requestHasBody: boolean,
): string {
  const endpoint = document.endpoint;
  const serviceClassName = toPascalCase(endpoint.serviceClassName) || 'GeneratedService';
  const methodName = toCamelCase(endpoint.methodName) || 'handle';
  const requestBodyVariableName = toCamelCase(preset.requestBodyVariableName || 'map') || 'map';
  const imports = new Set<string>();
  if (requestHasBody) {
    imports.add('import java.util.Map;');
  }
  if (serviceJavaType === 'List<Object>') {
    imports.add('import java.util.List;');
  }
  const { serviceParams } = generateMethodParameters(document, requestHasBody, requestBodyVariableName);
  return `${Array.from(imports).sort().join('\n')}${imports.size > 0 ? '\n\n' : ''}public interface ${serviceClassName} {

    ${serviceJavaType} ${methodName}(${serviceParams.join(', ')});
}
`;
}

function defaultReturnExpression(serviceJavaType: GenerationArtifacts['serviceJavaType']): string {
  if (serviceJavaType === 'void') {
    return '// write business logic';
  }
  if (serviceJavaType === 'List<Object>') {
    return 'return List.of();';
  }
  return 'return Map.of();';
}

function generateServiceImplementationCode(
  document: EndpointDocument,
  preset: GenerationPreset,
  serviceJavaType: GenerationArtifacts['serviceJavaType'],
  requestHasBody: boolean,
): string {
  const endpoint = document.endpoint;
  const serviceClassName = toPascalCase(endpoint.serviceClassName) || 'GeneratedService';
  const implementationName = `${serviceClassName}Impl`;
  const methodName = toCamelCase(endpoint.methodName) || 'handle';
  const requestBodyVariableName = toCamelCase(preset.requestBodyVariableName || 'map') || 'map';
  const imports = new Set<string>(['import org.springframework.stereotype.Service;']);
  if (requestHasBody || serviceJavaType === 'Object') {
    imports.add('import java.util.Map;');
  }
  if (serviceJavaType === 'List<Object>') {
    imports.add('import java.util.List;');
  }
  const { serviceParams } = generateMethodParameters(document, requestHasBody, requestBodyVariableName);
  const returnStatement = defaultReturnExpression(serviceJavaType);
  return `${Array.from(imports).sort().join('\n')}

@Service
public class ${implementationName} implements ${serviceClassName} {

    @Override
    public ${serviceJavaType} ${methodName}(${serviceParams.join(', ')}) {
        ${returnStatement}
    }
}
`;
}

function objectEntriesFromPayload(payloadText: string): Array<[string, unknown]> {
  try {
    const parsed = JSON.parse(payloadText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>);
    }
  } catch {
    // ignore
  }
  return [];
}

function generateCurl(
  document: EndpointDocument,
  requestHasBody: boolean,
  payloadText: string,
): string {
  const endpoint = document.endpoint;
  const params = document.params;
  const path = `${endpoint.basePath || ''}${endpoint.endpointPath || '/generated'}`;
  const queryParams = params.filter((param) => param.source === 'query');
  const headerParams = params.filter((param) => param.source === 'header');
  const pathParams = params.filter((param) => param.source === 'path');

  let resolvedPath = path;
  for (const param of pathParams) {
    const value = param.sampleValue || `{${param.name}}`;
    resolvedPath = resolvedPath.replace(`{${param.name}}`, value);
  }

  if (queryParams.length > 0) {
    const query = queryParams
      .map((param) => `${encodeURIComponent(param.name)}=${encodeURIComponent(param.sampleValue || `{${param.name}}`)}`)
      .join('&');
    resolvedPath = `${resolvedPath}?${query}`;
  }

  const lines = [`curl -X ${endpoint.httpMethod} '${(endpoint.basePath || '').startsWith('http') ? '' : 'http://localhost:8080'}${resolvedPath}'`];
  const requestMode = document.requestMode || 'json';
  if (requestHasBody && requestMode === 'json') {
    lines.push(`  -H 'Content-Type: application/json'`);
  }
  if (requestHasBody && requestMode === 'form-urlencoded') {
    lines.push(`  -H 'Content-Type: application/x-www-form-urlencoded'`);
  }
  for (const header of headerParams) {
    lines.push(`  -H '${header.name}: ${header.sampleValue || `{${header.name}}`}'`);
  }

  if (requestHasBody && payloadText.trim()) {
    if (requestMode === 'json') {
      const escaped = payloadText.replace(/'/g, `'\\''`);
      lines.push(`  -d '${escaped}'`);
    } else if (requestMode === 'form-urlencoded') {
      for (const [key, value] of objectEntriesFromPayload(payloadText)) {
        lines.push(`  --data-urlencode '${key}=${String(value)}'`);
      }
    } else if (requestMode === 'multipart/form-data') {
      for (const [key, value] of objectEntriesFromPayload(payloadText)) {
        lines.push(`  -F '${key}=${String(value)}'`);
      }
    }
  }
  return lines.join(' \\\n');
}

function buildExportFiles(
  document: EndpointDocument,
  artifacts: Omit<GenerationArtifacts, 'exportFiles'>,
  preset: GenerationPreset,
): GenerationArtifacts['exportFiles'] {
  const endpoint = document.endpoint;
  const packagePath = endpoint.packageName ? endpoint.packageName.replace(/\./g, '/') : 'generated';
  const controllerClassName = `${toPascalCase(endpoint.controllerClassName) || 'GeneratedController'}.java`;
  const serviceClassName = `${toPascalCase(endpoint.serviceClassName) || 'GeneratedService'}.java`;
  const implClassName = `${toPascalCase(endpoint.serviceClassName) || 'GeneratedService'}Impl.java`;
  const baseName = toPascalCase(endpoint.methodName || document.name || 'Generated');
  return [
    {
      path: `workspace.json`,
      content: JSON.stringify({ document, preset }, null, 2),
      mimeType: 'application/json',
    },
    {
      path: `src/main/java/${packagePath}/${controllerClassName}`,
      content: artifacts.controllerCode,
      mimeType: 'text/plain',
    },
    {
      path: `src/main/java/${packagePath}/${serviceClassName}`,
      content: artifacts.serviceInterfaceCode,
      mimeType: 'text/plain',
    },
    {
      path: `src/main/java/${packagePath}/${implClassName}`,
      content: artifacts.serviceImplementationCode,
      mimeType: 'text/plain',
    },
    {
      path: `src/main/java/${packagePath}/dto/${baseName}Request${toPascalCase(preset.dtoSuffix || 'Dto')}.java`,
      content: artifacts.requestDtoCode,
      mimeType: 'text/plain',
    },
    {
      path: `src/main/java/${packagePath}/dto/${baseName}Response${toPascalCase(preset.dtoSuffix || 'Dto')}.java`,
      content: artifacts.responseDtoCode,
      mimeType: 'text/plain',
    },
    {
      path: `openapi/${toCamelCase(baseName)}.yaml`,
      content: artifacts.openApiYaml,
      mimeType: 'text/yaml',
    },
    {
      path: `schema/${toCamelCase(baseName)}.schema.json`,
      content: artifacts.jsonSchemaText,
      mimeType: 'application/json',
    },
    {
      path: `examples/request.json`,
      content: artifacts.payloadText,
      mimeType: 'application/json',
    },
    {
      path: `examples/response.json`,
      content: responseExampleText(document, artifacts.responseJavaType),
      mimeType: 'application/json',
    },
    {
      path: `examples/mock-request.json`,
      content: artifacts.mockRequestText,
      mimeType: 'application/json',
    },
    {
      path: `examples/mock-response.json`,
      content: artifacts.mockResponseText,
      mimeType: 'application/json',
    },
    {
      path: `docs/${toCamelCase(baseName)}.md`,
      content: artifacts.markdownText,
      mimeType: 'text/markdown',
    },
    {
      path: `client/${toCamelCase(baseName)}.fetch.ts`,
      content: artifacts.fetchText,
      mimeType: 'text/plain',
    },
    {
      path: `client/${toCamelCase(baseName)}.axios.ts`,
      content: artifacts.axiosText,
      mimeType: 'text/plain',
    },
    {
      path: `http/${toCamelCase(baseName)}.sh`,
      content: artifacts.curlText,
      mimeType: 'text/plain',
    },
  ];
}

function responseExampleText(document: EndpointDocument, responseJavaType: GenerationArtifacts['responseJavaType']): string {
  if (responseJavaType === 'String') {
    return document.responseRaw.trim() || 'SUCCESS';
  }
  return document.responseRaw.trim() || '{}';
}

export function generateArtifacts(
  document: EndpointDocument,
  preset: GenerationPreset,
  request: AnalysisResult,
  response: AnalysisResult,
): GenerationArtifacts {
  const responseJavaType = resolveResponseJavaType(response);
  const serviceJavaType = responseJavaType === 'String' ? 'void' : responseJavaType;
  const effectivePayload = buildEffectivePayload(document, request, preset);
  const requestHasBody = hasRequestBody(document, request);
  const configIssues = validateConfiguration(document, preset, request);
  const generationBlocked = configIssues.some(
    (issue) => issue.code === 'ROOT_ARRAY_REQUEST' && preset.rootArrayRequestStrategy === 'block' && issue.level !== 'info',
  );

  const controllerCode = generateControllerCode(
    document,
    preset,
    request,
    response,
    responseJavaType,
    requestHasBody,
    generationBlocked,
    effectivePayload.rootArrayWrapped,
  );
  const serviceInterfaceCode = generateServiceInterfaceCode(document, preset, serviceJavaType, requestHasBody);
  const serviceImplementationCode = generateServiceImplementationCode(document, preset, serviceJavaType, requestHasBody);
  const curlText = generateCurl(document, requestHasBody, effectivePayload.payloadText);
  const dtoArtifacts = generateDtoArtifacts(document, preset, request, response);
  const openApiDocument = buildOpenApiDocument(document, preset, request, response);
  const openApiYaml = renderOpenApiYaml(openApiDocument);
  const jsonSchemaText = renderJsonSchema(request.schema.root, `${document.name} Request`);
  const mockRequestText = renderMockJson(request.schema.root);
  const mockResponseText = renderMockJson(response.schema.root);
  const fetchText = renderFetchSnippet(document, preset);
  const axiosText = renderAxiosSnippet(document, preset);
  const markdownText = renderMarkdownDocument(document, preset, request, response, effectivePayload.payloadText);

  const partialArtifacts = {
    responseJavaType,
    serviceJavaType,
    requestHasBody,
    generationBlocked,
    rootArrayWrapped: effectivePayload.rootArrayWrapped,
    controllerCode,
    serviceInterfaceCode,
    serviceImplementationCode,
    payloadText: effectivePayload.payloadText,
    curlText,
    dtoCode: dtoArtifacts.bundle,
    requestDtoCode: dtoArtifacts.requestDto.code,
    responseDtoCode: dtoArtifacts.responseDto.code,
    openApiYaml,
    jsonSchemaText,
    mockRequestText,
    mockResponseText,
    fetchText,
    axiosText,
    markdownText,
    issues: configIssues,
  } satisfies Omit<GenerationArtifacts, 'exportFiles'>;

  return {
    ...partialArtifacts,
    exportFiles: buildExportFiles(document, partialArtifacts, preset),
  };
}
