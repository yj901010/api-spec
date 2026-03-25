export type AnalysisTarget = 'request' | 'response' | 'config';

export type IssueLevel = 'error' | 'warning' | 'info';

export type IssueCode =
  | 'UNEXPECTED_CHARACTER'
  | 'UNCLOSED_STRING'
  | 'UNCLOSED_BLOCK_COMMENT'
  | 'UNEXPECTED_TOKEN'
  | 'UNEXPECTED_EOF'
  | 'INVALID_NUMBER'
  | 'INVALID_COLON'
  | 'MISMATCH_BRACE'
  | 'MISMATCH_BRACKET'
  | 'TRAILING_COMMA'
  | 'ELLIPSIS'
  | 'OBJECT_ELLIPSIS'
  | 'COMMENT_FOUND'
  | 'EMPTY_ARRAY'
  | 'MIXED_ARRAY_TYPES'
  | 'ROOT_ARRAY_REQUEST'
  | 'GET_WITH_BODY'
  | 'PATH_PARAM_MISSING_IN_URL'
  | 'URL_PLACEHOLDER_WITHOUT_PARAM'
  | 'GENERATION_BLOCKED'
  | 'RECOVERY'
  | 'NULL_VALUE'
  | 'NAMING_STYLE'
  | 'JAVA_RESERVED_WORD'
  | 'SENSITIVE_DATA'
  | 'FORMAT_HINT'
  | 'DESCRIPTION_MISSING';

export interface SourcePosition {
  index: number;
  line: number;
  column: number;
}

export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

export interface ParseIssue {
  target: AnalysisTarget;
  level: IssueLevel;
  code: IssueCode;
  message: string;
  range: SourceRange;
  expected?: string;
  actual?: string;
  suggestion?: string;
  sourceLabel?: string;
  navigable?: boolean;
}

export type TokenKind =
  | 'lbrace'
  | 'rbrace'
  | 'lbracket'
  | 'rbracket'
  | 'colon'
  | 'comma'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'identifier'
  | 'ellipsis'
  | 'comment'
  | 'eof';

export interface Token {
  kind: TokenKind;
  value: string;
  range: SourceRange;
}

export interface BaseNode {
  type: AstNodeType;
  path: string;
  range: SourceRange;
  description?: string;
}

export type AstNodeType =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'identifier';

export interface ObjectEntry {
  key: string;
  keyRange: SourceRange;
  value: AstNode;
  description?: string;
}

export interface ObjectNode extends BaseNode {
  type: 'object';
  entries: ObjectEntry[];
  hasAdditionalFields: boolean;
}

export interface ArrayNode extends BaseNode {
  type: 'array';
  items: AstNode[];
  hasOmittedItems: boolean;
  itemDescription?: string;
}

export interface PrimitiveNode extends BaseNode {
  type: 'string' | 'number' | 'boolean' | 'null' | 'identifier';
  value: string | number | boolean | null;
}

export type AstNode = ObjectNode | ArrayNode | PrimitiveNode;

export interface FieldSchema {
  name: string;
  path: string;
  type: string;
  inferredType?: string;
  required: boolean;
  description?: string;
  example?: string;
  format?: string;
  enumValues?: string[];
  nullable?: boolean;
  children: FieldSchema[];
  hasOmittedItems?: boolean;
  hasAdditionalFields?: boolean;
  itemType?: string;
}

export interface SchemaRow {
  path: string;
  name: string;
  type: string;
  inferredType: string;
  required: boolean;
  description: string;
  example: string;
  notes: string[];
  format?: string;
  enumValues: string[];
  nullable: boolean;
  include: boolean;
}

export interface SchemaResult {
  root: FieldSchema | null;
  rows: SchemaRow[];
  issues: ParseIssue[];
  variantCount: number;
  variantNames: string[];
}

export interface ExampleVariant {
  id: string;
  name: string;
  raw: string;
  enabled: boolean;
}

export interface AnalysisResult {
  target: AnalysisTarget;
  raw: string;
  tokens: Token[];
  ast: AstNode | null;
  normalizedText: string;
  issues: ParseIssue[];
  schema: SchemaResult;
  variants?: ExampleVariant[];
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface EndpointParam {
  id: string;
  name: string;
  source: 'query' | 'path' | 'header';
  javaType: 'String' | 'int' | 'long' | 'double' | 'boolean' | 'Object';
  required: boolean;
  description?: string;
  sampleValue?: string;
}

export interface EndpointConfig {
  packageName: string;
  basePath: string;
  endpointPath: string;
  httpMethod: HttpMethod;
  controllerClassName: string;
  serviceClassName: string;
  methodName: string;
}

export type GeneratedTab =
  | 'request-spec'
  | 'response-spec'
  | 'payload'
  | 'controller'
  | 'service-interface'
  | 'service-impl'
  | 'dto'
  | 'openapi'
  | 'curl'
  | 'json-schema'
  | 'mock-request'
  | 'mock-response'
  | 'fetch'
  | 'axios'
  | 'markdown'
  | 'changes';

export type RequestMode = 'json' | 'form-urlencoded' | 'multipart/form-data' | 'none';

export interface SchemaOverride {
  path: string;
  include?: boolean;
  required?: boolean;
  type?: string;
  description?: string;
  example?: string;
  format?: string;
  enumValues?: string[];
  nullable?: boolean;
}

export interface SchemaOverrideSet {
  request: Record<string, SchemaOverride>;
  response: Record<string, SchemaOverride>;
}

export interface SnapshotDocumentState {
  name: string;
  requestRaw: string;
  responseRaw: string;
  requestVariants: ExampleVariant[];
  responseVariants: ExampleVariant[];
  endpoint: EndpointConfig;
  params: EndpointParam[];
  tags: string[];
  requestMode: RequestMode;
  schemaOverrides: SchemaOverrideSet;
}

export interface DocumentSnapshot {
  id: string;
  name: string;
  createdAt: string;
  state: SnapshotDocumentState;
}

export interface EndpointDocument {
  id: string;
  name: string;
  requestRaw: string;
  responseRaw: string;
  requestVariants: ExampleVariant[];
  responseVariants: ExampleVariant[];
  endpoint: EndpointConfig;
  params: EndpointParam[];
  tags: string[];
  requestMode: RequestMode;
  schemaOverrides: SchemaOverrideSet;
  snapshots: DocumentSnapshot[];
  compareSnapshotId?: string;
  activeResultTab: GeneratedTab;
  selectedIssue?: {
    target: Extract<AnalysisTarget, 'request' | 'response' | 'config'>;
    index: number;
  };
}

export type RootArrayRequestStrategy = 'block' | 'wrap';

export interface GenerationPreset {
  id: string;
  name: string;
  successResponseText: string;
  rootArrayRequestStrategy: RootArrayRequestStrategy;
  rootArrayWrapperField: string;
  requestBodyVariableName: string;
  dtoSuffix: string;
  includeLombok: boolean;
  addSwaggerAnnotations: boolean;
  openApiTitle: string;
  openApiVersion: string;
  serverUrl: string;
}

export interface LayoutState {
  columnSizes: [number, number, number];
  editorSplit: number;
  collapsedPanels: {
    left: boolean;
    center: boolean;
    right: boolean;
  };
  maximizedPanel: 'left' | 'center' | 'right' | null;
  showOnlyDiffChanges: boolean;
}

export interface WorkspaceState {
  documents: EndpointDocument[];
  activeDocumentId: string;
  presets: GenerationPreset[];
  activePresetId: string;
  layout: LayoutState;
  lastSavedAt?: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
  mimeType?: string;
}

export interface GenerationArtifacts {
  responseJavaType: 'Object' | 'List<Object>' | 'String';
  serviceJavaType: 'Object' | 'List<Object>' | 'void';
  requestHasBody: boolean;
  generationBlocked: boolean;
  rootArrayWrapped: boolean;
  payloadText: string;
  controllerCode: string;
  serviceInterfaceCode: string;
  serviceImplementationCode: string;
  dtoCode: string;
  requestDtoCode: string;
  responseDtoCode: string;
  openApiYaml: string;
  curlText: string;
  jsonSchemaText: string;
  mockRequestText: string;
  mockResponseText: string;
  fetchText: string;
  axiosText: string;
  markdownText: string;
  exportFiles: GeneratedFile[];
  issues: ParseIssue[];
}

export interface DiffLine {
  leftNumber: number | null;
  leftText: string;
  rightNumber: number | null;
  rightText: string;
  status: 'unchanged' | 'added' | 'removed' | 'changed';
}

export interface DiffResult {
  lines: DiffLine[];
  changeCount: number;
}

export interface ChangeItem {
  scope: 'request' | 'response';
  path: string;
  type: 'added' | 'removed' | 'type-changed' | 'required-changed' | 'nullable-changed' | 'format-changed';
  before?: string;
  after?: string;
  breaking: boolean;
}

export interface ChangeReport {
  snapshotName: string;
  createdAt: string;
  items: ChangeItem[];
  breakingCount: number;
}

export interface AppSnapshot {
  workspace: WorkspaceState;
  activeDocument: EndpointDocument;
  activePreset: GenerationPreset;
  requestAnalysis: AnalysisResult;
  responseAnalysis: AnalysisResult;
  generated: GenerationArtifacts;
  changeReport: ChangeReport | null;
}
