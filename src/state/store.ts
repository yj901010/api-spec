import type {
  AppSnapshot,
  DocumentSnapshot,
  EndpointConfig,
  EndpointDocument,
  EndpointParam,
  ExampleVariant,
  GenerationPreset,
  LayoutState,
  SchemaOverrideSet,
  WorkspaceState,
} from '../types.js';
import { analyzeVariantSet } from '../core/analysis-set.js';
import { generateArtifacts } from '../core/generator.js';
import { formatDateTime } from '../utils/strings.js';
import { buildChangeReport } from '../core/changes.js';

const STORAGE_KEY = 'api-spec-studio.workspace.v3';

const defaultEndpoint: EndpointConfig = {
  packageName: 'com.example.api',
  basePath: '/api',
  endpointPath: '/orders/{orderId}',
  httpMethod: 'POST',
  controllerClassName: 'OrderController',
  serviceClassName: 'OrderService',
  methodName: 'saveOrder',
};

const sampleRequest = `{
  // 요청자 ID
  "userId": 10,
  "orderDate": "2026-03-25",
  "items": [
    {
      "itemId": 1001,
      "qty": 2,
      "memo": "gift"
    },
    ...
  ],
  "delivery": {
    "address": "Seoul",
    "zipCode": "04524"
  },
}`;

const sampleRequestVariant = `{
  "userId": 10,
  "orderDate": "2026-03-25",
  "items": [
    {
      "itemId": 1002,
      "qty": 1
    }
  ],
  "delivery": {
    "address": "Seoul"
  }
}`;

const sampleResponse = `{
  "success": true,
  "message": "OK",
  "result": {
    "orderId": 98123,
    "status": "CREATED"
  }
}`;

const sampleResponseVariant = `{
  "success": true,
  "message": "OK",
  "result": {
    "orderId": 98124
  }
}`;

const sampleSearchRequest = `{
  // 검색어
  "keyword": "keyboard",
  "page": 1,
  "size": 20,
  "sort": [
    "POPULAR",
    ...
  ]
}`;

const sampleSearchResponse = `[
  {
    "productId": 101,
    "name": "Wireless Keyboard",
    "price": 49000
  },
  ...
]`;

const defaultParams: EndpointParam[] = [
  {
    id: crypto.randomUUID(),
    name: 'orderId',
    source: 'path',
    javaType: 'long',
    required: true,
    description: '주문 번호',
    sampleValue: '98123',
  },
  {
    id: crypto.randomUUID(),
    name: 'traceId',
    source: 'header',
    javaType: 'String',
    required: false,
    description: '추적용 헤더',
    sampleValue: 'TRACE-001',
  },
];

const defaultLayout: LayoutState = {
  columnSizes: [35, 31, 34],
  editorSplit: 52,
  collapsedPanels: {
    left: false,
    center: false,
    right: false,
  },
  maximizedPanel: null,
  showOnlyDiffChanges: false,
};

function createDefaultPresets(): GenerationPreset[] {
  return [
    {
      id: crypto.randomUUID(),
      name: 'Standard Internal',
      successResponseText: 'SUCCESS',
      rootArrayRequestStrategy: 'block',
      rootArrayWrapperField: 'items',
      requestBodyVariableName: 'map',
      dtoSuffix: 'Dto',
      includeLombok: true,
      addSwaggerAnnotations: false,
      openApiTitle: 'API Spec Studio Workspace',
      openApiVersion: '1.0.0',
      serverUrl: 'http://localhost:8080',
    },
    {
      id: crypto.randomUUID(),
      name: 'Root Array Wrapper',
      successResponseText: 'SUCCESS',
      rootArrayRequestStrategy: 'wrap',
      rootArrayWrapperField: 'items',
      requestBodyVariableName: 'map',
      dtoSuffix: 'Dto',
      includeLombok: true,
      addSwaggerAnnotations: false,
      openApiTitle: 'Wrapped Array API',
      openApiVersion: '1.0.0',
      serverUrl: 'http://localhost:8080',
    },
    {
      id: crypto.randomUUID(),
      name: 'Swagger Friendly',
      successResponseText: 'OK',
      rootArrayRequestStrategy: 'block',
      rootArrayWrapperField: 'items',
      requestBodyVariableName: 'requestMap',
      dtoSuffix: 'Dto',
      includeLombok: true,
      addSwaggerAnnotations: true,
      openApiTitle: 'Swagger Friendly API',
      openApiVersion: '1.0.0',
      serverUrl: 'http://localhost:8080',
    },
  ];
}

type DocumentDraft = Partial<Omit<EndpointDocument, 'endpoint' | 'params' | 'requestVariants' | 'responseVariants' | 'schemaOverrides' | 'snapshots'>> & {
  endpoint?: Partial<EndpointConfig>;
  params?: Partial<EndpointParam>[];
  requestVariants?: Partial<ExampleVariant>[];
  responseVariants?: Partial<ExampleVariant>[];
  schemaOverrides?: Partial<SchemaOverrideSet>;
  snapshots?: Partial<DocumentSnapshot>[];
};

function createVariant(name: string, raw: string, enabled = true): ExampleVariant {
  return {
    id: crypto.randomUUID(),
    name,
    raw,
    enabled,
  };
}

function ensureVariant(variant: Partial<ExampleVariant>, fallbackName = 'Variant'): ExampleVariant {
  return {
    id: typeof variant.id === 'string' ? variant.id : crypto.randomUUID(),
    name: typeof variant.name === 'string' ? variant.name : fallbackName,
    raw: typeof variant.raw === 'string' ? variant.raw : '{\n  \n}',
    enabled: variant.enabled !== false,
  };
}

function ensureSchemaOverrides(overrides: Partial<SchemaOverrideSet> | undefined): SchemaOverrideSet {
  return {
    request: typeof overrides?.request === 'object' && overrides.request ? structuredClone(overrides.request) : {},
    response: typeof overrides?.response === 'object' && overrides.response ? structuredClone(overrides.response) : {},
  };
}

function ensureParam(param: Partial<EndpointParam>): EndpointParam {
  return {
    id: typeof param.id === 'string' ? param.id : crypto.randomUUID(),
    name: typeof param.name === 'string' ? param.name : 'param',
    source: param.source === 'path' || param.source === 'query' || param.source === 'header' ? param.source : 'query',
    javaType:
      param.javaType === 'String' ||
      param.javaType === 'int' ||
      param.javaType === 'long' ||
      param.javaType === 'double' ||
      param.javaType === 'boolean' ||
      param.javaType === 'Object'
        ? param.javaType
        : 'String',
    required: Boolean(param.required),
    description: typeof param.description === 'string' ? param.description : '',
    sampleValue: typeof param.sampleValue === 'string' ? param.sampleValue : '',
  };
}

function createSnapshotState(document: EndpointDocument) {
  return {
    name: document.name,
    requestRaw: document.requestRaw,
    responseRaw: document.responseRaw,
    requestVariants: structuredClone(document.requestVariants),
    responseVariants: structuredClone(document.responseVariants),
    endpoint: structuredClone(document.endpoint),
    params: structuredClone(document.params),
    tags: structuredClone(document.tags),
    requestMode: document.requestMode,
    schemaOverrides: structuredClone(document.schemaOverrides),
  };
}

function ensureSnapshot(snapshot: Partial<DocumentSnapshot>): DocumentSnapshot {
  const empty = createEmptyDocumentTemplate();
  const state = snapshot.state ?? createSnapshotState(empty);
  return {
    id: typeof snapshot.id === 'string' ? snapshot.id : crypto.randomUUID(),
    name: typeof snapshot.name === 'string' ? snapshot.name : 'Snapshot',
    createdAt: typeof snapshot.createdAt === 'string' ? snapshot.createdAt : formatDateTime(),
    state: {
      name: typeof state.name === 'string' ? state.name : empty.name,
      requestRaw: typeof state.requestRaw === 'string' ? state.requestRaw : empty.requestRaw,
      responseRaw: typeof state.responseRaw === 'string' ? state.responseRaw : empty.responseRaw,
      requestVariants: Array.isArray(state.requestVariants) ? state.requestVariants.map((variant) => ensureVariant(variant, 'Request Variant')) : [],
      responseVariants: Array.isArray(state.responseVariants) ? state.responseVariants.map((variant) => ensureVariant(variant, 'Response Variant')) : [],
      endpoint: { ...defaultEndpoint, ...(state.endpoint ?? {}) },
      params: Array.isArray(state.params) ? state.params.map((param) => ensureParam(param)) : [],
      tags: Array.isArray(state.tags) ? state.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      requestMode:
        state.requestMode === 'form-urlencoded' || state.requestMode === 'multipart/form-data' || state.requestMode === 'none'
          ? state.requestMode
          : 'json',
      schemaOverrides: ensureSchemaOverrides(state.schemaOverrides),
    },
  };
}

function ensurePreset(preset: Partial<GenerationPreset>): GenerationPreset {
  return {
    id: typeof preset.id === 'string' ? preset.id : crypto.randomUUID(),
    name: typeof preset.name === 'string' ? preset.name : 'Preset',
    successResponseText: typeof preset.successResponseText === 'string' ? preset.successResponseText : 'SUCCESS',
    rootArrayRequestStrategy: preset.rootArrayRequestStrategy === 'wrap' ? 'wrap' : 'block',
    rootArrayWrapperField: typeof preset.rootArrayWrapperField === 'string' ? preset.rootArrayWrapperField : 'items',
    requestBodyVariableName: typeof preset.requestBodyVariableName === 'string' ? preset.requestBodyVariableName : 'map',
    dtoSuffix: typeof preset.dtoSuffix === 'string' ? preset.dtoSuffix : 'Dto',
    includeLombok: preset.includeLombok !== false,
    addSwaggerAnnotations: Boolean(preset.addSwaggerAnnotations),
    openApiTitle: typeof preset.openApiTitle === 'string' ? preset.openApiTitle : 'API Spec Studio Workspace',
    openApiVersion: typeof preset.openApiVersion === 'string' ? preset.openApiVersion : '1.0.0',
    serverUrl: typeof preset.serverUrl === 'string' ? preset.serverUrl : 'http://localhost:8080',
  };
}

function createDocument(partial?: DocumentDraft): EndpointDocument {
  return {
    id: partial?.id && typeof partial.id === 'string' ? partial.id : crypto.randomUUID(),
    name: partial?.name && typeof partial.name === 'string' ? partial.name : 'Save Order',
    requestRaw: typeof partial?.requestRaw === 'string' ? partial.requestRaw : sampleRequest,
    responseRaw: typeof partial?.responseRaw === 'string' ? partial.responseRaw : sampleResponse,
    requestVariants: Array.isArray(partial?.requestVariants)
      ? partial.requestVariants.map((variant, index) => ensureVariant(variant, `Request Variant ${index + 1}`))
      : [createVariant('Missing memo', sampleRequestVariant)],
    responseVariants: Array.isArray(partial?.responseVariants)
      ? partial.responseVariants.map((variant, index) => ensureVariant(variant, `Response Variant ${index + 1}`))
      : [createVariant('Result without status', sampleResponseVariant)],
    endpoint: {
      ...defaultEndpoint,
      ...(partial?.endpoint ?? {}),
    },
    params: Array.isArray(partial?.params)
      ? partial.params.map((param) => ensureParam(param))
      : structuredClone(defaultParams),
    tags: Array.isArray(partial?.tags) ? partial.tags.filter((tag): tag is string => typeof tag === 'string') : ['core'],
    requestMode:
      partial?.requestMode === 'form-urlencoded' || partial?.requestMode === 'multipart/form-data' || partial?.requestMode === 'none'
        ? partial.requestMode
        : 'json',
    schemaOverrides: ensureSchemaOverrides(partial?.schemaOverrides),
    snapshots: Array.isArray(partial?.snapshots) ? partial.snapshots.map((snapshot) => ensureSnapshot(snapshot)) : [],
    compareSnapshotId: typeof partial?.compareSnapshotId === 'string' ? partial.compareSnapshotId : undefined,
    activeResultTab:
      partial?.activeResultTab === 'request-spec' ||
      partial?.activeResultTab === 'response-spec' ||
      partial?.activeResultTab === 'payload' ||
      partial?.activeResultTab === 'controller' ||
      partial?.activeResultTab === 'service-interface' ||
      partial?.activeResultTab === 'service-impl' ||
      partial?.activeResultTab === 'dto' ||
      partial?.activeResultTab === 'openapi' ||
      partial?.activeResultTab === 'curl' ||
      partial?.activeResultTab === 'json-schema' ||
      partial?.activeResultTab === 'mock-request' ||
      partial?.activeResultTab === 'mock-response' ||
      partial?.activeResultTab === 'fetch' ||
      partial?.activeResultTab === 'axios' ||
      partial?.activeResultTab === 'markdown' ||
      partial?.activeResultTab === 'changes'
        ? partial.activeResultTab
        : 'controller',
    selectedIssue:
      partial?.selectedIssue &&
      (partial.selectedIssue.target === 'request' || partial.selectedIssue.target === 'response' || partial.selectedIssue.target === 'config')
        ? {
            target: partial.selectedIssue.target,
            index: Number(partial.selectedIssue.index) || 0,
          }
        : undefined,
  };
}

function createSecondaryDocument(): EndpointDocument {
  return createDocument({
    name: 'Search Products',
    requestRaw: sampleSearchRequest,
    responseRaw: sampleSearchResponse,
    requestVariants: [
      createVariant(
        'Second page',
        `{
  "keyword": "keyboard",
  "page": 2,
  "size": 20
}`,
      ),
    ],
    responseVariants: [
      createVariant(
        'Variant item',
        `[
  {
    "productId": 102,
    "name": "Compact Keyboard",
    "price": 39000,
    "badge": "HOT"
  }
]`,
      ),
    ],
    endpoint: {
      ...defaultEndpoint,
      endpointPath: '/products/search',
      httpMethod: 'POST',
      controllerClassName: 'ProductController',
      serviceClassName: 'ProductService',
      methodName: 'searchProducts',
    },
    params: [],
    tags: ['catalog', 'search'],
    activeResultTab: 'openapi',
  });
}

function createDefaultWorkspace(): WorkspaceState {
  const presets = createDefaultPresets();
  const primary = createDocument();
  const secondary = createSecondaryDocument();
  return {
    documents: [primary, secondary],
    activeDocumentId: primary.id,
    presets,
    activePresetId: presets[0]!.id,
    layout: structuredClone(defaultLayout),
    lastSavedAt: formatDateTime(),
  };
}

function ensureLayout(layout: Partial<LayoutState> | undefined): LayoutState {
  const normalizeColumnSize = (value: unknown, fallback: number): number => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
  };

  return {
    columnSizes:
      Array.isArray(layout?.columnSizes) && layout.columnSizes.length === 3
        ? [
            normalizeColumnSize(layout.columnSizes[0], defaultLayout.columnSizes[0]),
            normalizeColumnSize(layout.columnSizes[1], defaultLayout.columnSizes[1]),
            normalizeColumnSize(layout.columnSizes[2], defaultLayout.columnSizes[2]),
          ]
        : structuredClone(defaultLayout.columnSizes),
    editorSplit: typeof layout?.editorSplit === 'number' ? Math.min(80, Math.max(20, layout.editorSplit)) : defaultLayout.editorSplit,
    collapsedPanels: {
      left: Boolean(layout?.collapsedPanels?.left),
      center: Boolean(layout?.collapsedPanels?.center),
      right: Boolean(layout?.collapsedPanels?.right),
    },
    maximizedPanel:
      layout?.maximizedPanel === 'left' || layout?.maximizedPanel === 'center' || layout?.maximizedPanel === 'right'
        ? layout.maximizedPanel
        : null,
    showOnlyDiffChanges: Boolean(layout?.showOnlyDiffChanges),
  };
}

function fromLegacyWorkspace(candidate: Record<string, unknown>): WorkspaceState {
  const document = createDocument({
    requestRaw: typeof candidate.requestRaw === 'string' ? candidate.requestRaw : sampleRequest,
    responseRaw: typeof candidate.responseRaw === 'string' ? candidate.responseRaw : sampleResponse,
    endpoint: typeof candidate.endpoint === 'object' && candidate.endpoint ? (candidate.endpoint as Partial<EndpointConfig>) : undefined,
    params: Array.isArray(candidate.params) ? (candidate.params as Partial<EndpointParam>[]) : undefined,
    activeResultTab: candidate.activeResultTab as EndpointDocument['activeResultTab'],
  });
  const presets = createDefaultPresets();
  return {
    documents: [document],
    activeDocumentId: document.id,
    presets,
    activePresetId: presets[0]!.id,
    layout: structuredClone(defaultLayout),
    lastSavedAt: typeof candidate.lastSavedAt === 'string' ? candidate.lastSavedAt : formatDateTime(),
  };
}

function ensureWorkspace(value: unknown): WorkspaceState {
  if (!value || typeof value !== 'object') {
    return createDefaultWorkspace();
  }

  const candidate = value as Record<string, unknown>;

  if (!Array.isArray(candidate.documents) && ('requestRaw' in candidate || 'responseRaw' in candidate)) {
    return fromLegacyWorkspace(candidate);
  }

  const presets = Array.isArray(candidate.presets) && candidate.presets.length > 0
    ? candidate.presets.map((preset) => ensurePreset(preset as Partial<GenerationPreset>))
    : createDefaultPresets();

  const documents = Array.isArray(candidate.documents) && candidate.documents.length > 0
    ? candidate.documents.map((document) => createDocument(document as Partial<EndpointDocument>))
    : [createDocument()];

  const activeDocumentId =
    typeof candidate.activeDocumentId === 'string' && documents.some((document) => document.id === candidate.activeDocumentId)
      ? candidate.activeDocumentId
      : documents[0]!.id;

  const activePresetId =
    typeof candidate.activePresetId === 'string' && presets.some((preset) => preset.id === candidate.activePresetId)
      ? candidate.activePresetId
      : presets[0]!.id;

  return {
    documents,
    activeDocumentId,
    presets,
    activePresetId,
    layout: ensureLayout(candidate.layout as Partial<LayoutState> | undefined),
    lastSavedAt: typeof candidate.lastSavedAt === 'string' ? candidate.lastSavedAt : formatDateTime(),
  };
}

function loadWorkspace(): WorkspaceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? ensureWorkspace(JSON.parse(raw)) : createDefaultWorkspace();
  } catch {
    return createDefaultWorkspace();
  }
}

function persist(workspace: WorkspaceState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  } catch {
    // Ignore persistence failures so the in-memory workspace remains usable.
  }
}

export class Store {
  private workspace = loadWorkspace();
  private listeners = new Set<(snapshot: AppSnapshot) => void>();
  private cachedSnapshot?: AppSnapshot;

  subscribe(listener: (snapshot: AppSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): AppSnapshot {
    if (this.cachedSnapshot) {
      return this.cachedSnapshot;
    }

    const activeDocument =
      this.workspace.documents.find((document) => document.id === this.workspace.activeDocumentId) ?? this.workspace.documents[0] ?? createDocument();
    const activePreset =
      this.workspace.presets.find((preset) => preset.id === this.workspace.activePresetId) ?? this.workspace.presets[0] ?? createDefaultPresets()[0]!;

    const requestAnalysis = analyzeVariantSet(
      activeDocument.requestRaw,
      activeDocument.requestVariants,
      'request',
      activeDocument.schemaOverrides.request,
    );
    const responseAnalysis = analyzeVariantSet(
      activeDocument.responseRaw,
      activeDocument.responseVariants,
      'response',
      activeDocument.schemaOverrides.response,
    );
    const generated = generateArtifacts(activeDocument, activePreset, requestAnalysis, responseAnalysis);

    const compareSnapshot = activeDocument.compareSnapshotId
      ? activeDocument.snapshots.find((snapshot) => snapshot.id === activeDocument.compareSnapshotId)
      : undefined;

    const changeReport = compareSnapshot
      ? (() => {
          const beforeRequest = analyzeVariantSet(
            compareSnapshot.state.requestRaw,
            compareSnapshot.state.requestVariants,
            'request',
            compareSnapshot.state.schemaOverrides.request,
          );
          const beforeResponse = analyzeVariantSet(
            compareSnapshot.state.responseRaw,
            compareSnapshot.state.responseVariants,
            'response',
            compareSnapshot.state.schemaOverrides.response,
          );
          return buildChangeReport(
            compareSnapshot.name,
            compareSnapshot.createdAt,
            beforeRequest.schema.rows,
            beforeResponse.schema.rows,
            requestAnalysis.schema.rows,
            responseAnalysis.schema.rows,
          );
        })()
      : null;

    this.cachedSnapshot = {
      workspace: structuredClone(this.workspace),
      activeDocument: structuredClone(activeDocument),
      activePreset: structuredClone(activePreset),
      requestAnalysis,
      responseAnalysis,
      generated,
      changeReport,
    };

    return this.cachedSnapshot;
  }

  update(mutator: (draft: WorkspaceState) => void): void {
    const next = structuredClone(this.workspace);
    mutator(next);
    if (next.documents.length === 0) {
      next.documents.push(createDocument());
      next.activeDocumentId = next.documents[0]!.id;
    }
    if (!next.documents.some((document) => document.id === next.activeDocumentId)) {
      next.activeDocumentId = next.documents[0]!.id;
    }
    if (next.presets.length === 0) {
      const presets = createDefaultPresets();
      next.presets = presets;
      next.activePresetId = presets[0]!.id;
    }
    if (!next.presets.some((preset) => preset.id === next.activePresetId)) {
      next.activePresetId = next.presets[0]!.id;
    }
    next.lastSavedAt = formatDateTime();
    this.workspace = ensureWorkspace(next);
    this.cachedSnapshot = undefined;
    persist(this.workspace);
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  replace(workspace: WorkspaceState): void {
    this.workspace = ensureWorkspace(workspace);
    this.cachedSnapshot = undefined;
    persist(this.workspace);
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  reset(): void {
    this.workspace = createDefaultWorkspace();
    this.cachedSnapshot = undefined;
    persist(this.workspace);
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export function createEmptyParam(): EndpointParam {
  return {
    id: crypto.randomUUID(),
    name: 'newParam',
    source: 'query',
    javaType: 'String',
    required: false,
    description: '',
    sampleValue: '',
  };
}

export function createEmptyVariant(name = 'Variant'): ExampleVariant {
  return createVariant(name, '{\n  \n}');
}

export function createSnapshot(document: EndpointDocument, name?: string): DocumentSnapshot {
  return {
    id: crypto.randomUUID(),
    name: name || `Snapshot ${document.snapshots.length + 1}`,
    createdAt: formatDateTime(),
    state: createSnapshotState(document),
  };
}

export function createEmptyDocumentTemplate(): EndpointDocument {
  return createDocument({
    name: 'New Endpoint',
    requestRaw: '{\n  \n}',
    responseRaw: '{\n  \n}',
    requestVariants: [],
    responseVariants: [],
    endpoint: {
      ...defaultEndpoint,
      endpointPath: '/new-endpoint',
      controllerClassName: 'NewEndpointController',
      serviceClassName: 'NewEndpointService',
      methodName: 'newEndpoint',
    },
    params: [],
    tags: [],
    activeResultTab: 'controller',
  });
}

export function duplicateDocumentTemplate(document: EndpointDocument): EndpointDocument {
  return createDocument({
    ...structuredClone(document),
    id: crypto.randomUUID(),
    name: `${document.name} Copy`,
    snapshots: [],
    compareSnapshotId: undefined,
  });
}

export function createPresetFromCurrent(preset: GenerationPreset): GenerationPreset {
  return ensurePreset({
    ...structuredClone(preset),
    id: crypto.randomUUID(),
    name: `${preset.name} Copy`,
  });
}

export function exportWorkspace(state: WorkspaceState): string {
  return JSON.stringify(state, null, 2);
}
