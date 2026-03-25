import type { AppSnapshot } from '../types.js';

export function getActiveResultText(snapshot: AppSnapshot): string {
  switch (snapshot.activeDocument.activeResultTab) {
    case 'request-spec':
      return JSON.stringify(snapshot.requestAnalysis.schema.rows, null, 2);
    case 'response-spec':
      return JSON.stringify(snapshot.responseAnalysis.schema.rows, null, 2);
    case 'payload':
      return snapshot.generated.payloadText;
    case 'controller':
      return snapshot.generated.controllerCode;
    case 'service-interface':
      return snapshot.generated.serviceInterfaceCode;
    case 'service-impl':
      return snapshot.generated.serviceImplementationCode;
    case 'dto':
      return snapshot.generated.dtoCode;
    case 'openapi':
      return snapshot.generated.openApiYaml;
    case 'curl':
      return snapshot.generated.curlText;
    case 'json-schema':
      return snapshot.generated.jsonSchemaText;
    case 'mock-request':
      return snapshot.generated.mockRequestText;
    case 'mock-response':
      return snapshot.generated.mockResponseText;
    case 'fetch':
      return snapshot.generated.fetchText;
    case 'axios':
      return snapshot.generated.axiosText;
    case 'markdown':
      return snapshot.generated.markdownText;
    case 'changes':
      return JSON.stringify(snapshot.changeReport, null, 2);
    default:
      return '';
  }
}
