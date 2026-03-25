import type {
  AppSnapshot,
  EndpointDocument,
  EndpointParam,
  GeneratedFile,
  GeneratedTab,
  LayoutState,
  ParseIssue,
  WorkspaceState,
} from '../types.js';
import {
  createEmptyDocumentTemplate,
  createEmptyParam,
  createEmptyVariant,
  createPresetFromCurrent,
  createSnapshot,
  duplicateDocumentTemplate,
  exportWorkspace,
  Store,
} from '../state/store.js';
import { escapeHtml } from '../utils/strings.js';
import {
  describePanelState,
  describeSplitterState,
  computeIssueSelection,
  computeWorkspaceColumns,
  nudgeLayoutWithKeyboard,
  renderGutterHtml,
} from './helpers.js';
import {
  renderChangeReport,
  renderDiffCard,
  renderDocumentList,
  renderGeneratedContent,
  renderIssueGroups,
  renderPresetList,
  renderPreview,
  renderSnapshotList,
  renderSummary,
  renderTabs,
  renderVariantSection,
} from './renderers.js';
import { buildDiff } from '../core/diff.js';
import { createZipBlob } from '../utils/zip.js';
import { analyzeVariantSet } from '../core/analysis-set.js';
import { generateArtifacts } from '../core/generator.js';
import { buildOpenApiDocument, mergeOpenApiDocuments, renderOpenApiYaml } from '../core/openapi.js';
import { applyCurlImport } from '../core/curl.js';
import { applyRawHttpImport } from '../core/http-import.js';
import { applyPostmanCollectionImport } from '../core/postman-import.js';
import { applyOpenApiImport } from '../core/openapi-import.js';
import { maskSensitiveText, maskVariants } from '../core/mask.js';

const DEFAULT_LAYOUT: LayoutState = {
  columnSizes: [35, 31, 34],
  editorSplit: 52,
  collapsedPanels: { left: false, center: false, right: false },
  maximizedPanel: null,
  showOnlyDiffChanges: false,
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'endpoint';
}


function downloadFile(filename: string, content: string, mimeType = 'application/json'): void {
  downloadBlob(filename, new Blob([content], { type: mimeType }));
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('파일 읽기 실패'));
    reader.readAsText(file);
  });
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

export class App {
  private snapshot!: AppSnapshot;
  private documentFilter = '';
  private unsubscribeStore?: () => void;
  private eventController?: AbortController;

  private requestInput!: HTMLTextAreaElement;
  private responseInput!: HTMLTextAreaElement;
  private requestGutter!: HTMLElement;
  private responseGutter!: HTMLElement;
  private importInput!: HTMLInputElement;
  private paramsBody!: HTMLElement;
  private summarySection!: HTMLElement;
  private issuesSection!: HTMLElement;
  private previewsSection!: HTMLElement;
  private diffSection!: HTMLElement;
  private resultContent!: HTMLElement;
  private tabsContainer!: HTMLElement;
  private lastSavedLabel!: HTMLElement;
  private documentListSection!: HTMLElement;
  private presetListSection!: HTMLElement;
  private workspaceLayout!: HTMLElement;
  private editorSplitLayout!: HTMLElement;
  private requestVariantsSection!: HTMLElement;
  private responseVariantsSection!: HTMLElement;
  private snapshotListSection!: HTMLElement;
  private quickImportInput!: HTMLTextAreaElement;
  private quickImportFormat!: HTMLSelectElement;
  private documentSearchInput!: HTMLInputElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly store: Store,
  ) {}

  mount(): void {
    this.destroy();
    this.root.innerHTML = this.template();
    this.captureElements();
    this.applyStaticLabels();
    this.eventController = new AbortController();
    this.bindEvents();
    this.unsubscribeStore = this.store.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.syncFormValues();
      this.renderDynamic();
      this.applyLayout();
      this.renderEditorGutters();
    });
  }

  destroy(): void {
    this.eventController?.abort();
    this.eventController = undefined;
    this.unsubscribeStore?.();
    this.unsubscribeStore = undefined;
    this.root.innerHTML = '';
  }

  private template(): string {
    return `
      <div class="app-shell">
        <header class="topbar">
          <div>
            <div class="eyebrow">API Spec Studio</div>
            <h1>API Workbench</h1>
            <p class="subtitle">멀티 예시 병합, 스키마 수정, 스냅샷 비교, cURL/HTTP/Postman/OpenAPI import, Mock/JSON Schema/Client code 생성까지 포함한 확장 버전</p>
          </div>
          <div class="topbar-actions">
            <button class="ghost-button" data-action="reset">샘플로 초기화</button>
            <button class="ghost-button" data-action="restore-layout">레이아웃 초기화</button>
            <button class="ghost-button" data-action="save-snapshot">스냅샷 저장</button>
            <button class="ghost-button" data-action="mask-sensitive">민감값 마스킹</button>
            <button class="ghost-button" data-action="export">워크스페이스 JSON</button>
            <button class="ghost-button" data-action="export-current-zip">현재 엔드포인트 ZIP</button>
            <button class="ghost-button" data-action="export-workspace-zip">워크스페이스 ZIP</button>
            <button class="ghost-button" data-action="import">가져오기</button>
            <button class="primary-button" data-action="copy-active-result">현재 탭 복사</button>
            <input id="importWorkspaceInput" type="file" accept="application/json" hidden />
          </div>
        </header>

        <main id="workspaceLayout" class="workspace-layout">
          <section id="leftPanel" class="shell-panel panel-left" data-panel="left">
            <div class="shell-panel-header">
              <div>
                <div class="eyebrow eyebrow-inline">Workspace</div>
                <h2>Input & Config</h2>
              </div>
              <div class="panel-actions">
                <button class="icon-button small-button" data-action="maximize-panel" data-panel="left">최대화</button>
              </div>
            </div>
            <div class="shell-panel-scroll">
              <section class="panel-section">
                <div class="panel-title-row">
                  <h3>Endpoints</h3>
                  <div class="row-actions">
                    <button class="ghost-button small-button" data-action="add-document">추가</button>
                  </div>
                </div>
                <input id="documentSearchInput" type="text" placeholder="엔드포인트 검색 (이름 / 경로 / 태그)" />
                <div id="documentListSection"></div>
              </section>

              <section class="panel-section">
                <div class="panel-title-row">
                  <h3>Editors</h3>
                  <span id="lastSavedLabel" class="muted"></span>
                </div>
                <div id="editorSplitLayout" class="editor-split-layout">
                  <section class="editor-card">
                    <div class="panel-title-row">
                      <h4>Request Example</h4>
                      <span class="mini-pill">Primary</span>
                    </div>
                    <div class="editor-shell">
                      <div id="requestGutter" class="editor-gutter"></div>
                      <textarea id="requestInput" class="code-textarea" spellcheck="false"></textarea>
                    </div>
                  </section>
                  <div class="splitter splitter-horizontal" data-splitter="request-response"></div>
                  <section class="editor-card">
                    <div class="panel-title-row">
                      <h4>Response Example</h4>
                      <span class="mini-pill">Primary</span>
                    </div>
                    <div class="editor-shell">
                      <div id="responseGutter" class="editor-gutter"></div>
                      <textarea id="responseInput" class="code-textarea" spellcheck="false"></textarea>
                    </div>
                  </section>
                </div>
              </section>

              <section class="panel-section">
                <div class="panel-title-row">
                  <h3>Request Variants</h3>
                  <button class="ghost-button small-button" data-action="add-variant" data-scope="request">추가</button>
                </div>
                <div id="requestVariantsSection"></div>
              </section>

              <section class="panel-section">
                <div class="panel-title-row">
                  <h3>Response Variants</h3>
                  <button class="ghost-button small-button" data-action="add-variant" data-scope="response">추가</button>
                </div>
                <div id="responseVariantsSection"></div>
              </section>

              <section class="panel-section">
                <div class="panel-title-row"><h3>Endpoint</h3></div>
                <div class="form-grid">
                  <label>
                    <span>Document Name</span>
                    <input id="documentNameInput" type="text" />
                  </label>
                  <label>
                    <span>Package</span>
                    <input id="packageNameInput" type="text" />
                  </label>
                  <label>
                    <span>Base Path</span>
                    <input id="basePathInput" type="text" />
                  </label>
                  <label>
                    <span>Endpoint Path</span>
                    <input id="endpointPathInput" type="text" />
                  </label>
                  <label>
                    <span>HTTP Method</span>
                    <select id="httpMethodInput">
                      <option>GET</option>
                      <option>POST</option>
                      <option>PUT</option>
                      <option>PATCH</option>
                      <option>DELETE</option>
                    </select>
                  </label>
                  <label>
                    <span>Request Mode</span>
                    <select id="requestModeInput">
                      <option value="json">json</option>
                      <option value="form-urlencoded">form-urlencoded</option>
                      <option value="multipart/form-data">multipart/form-data</option>
                      <option value="none">none</option>
                    </select>
                  </label>
                  <label>
                    <span>Controller Class</span>
                    <input id="controllerClassInput" type="text" />
                  </label>
                  <label>
                    <span>Service Class</span>
                    <input id="serviceClassInput" type="text" />
                  </label>
                  <label>
                    <span>Method Name</span>
                    <input id="methodNameInput" type="text" />
                  </label>
                  <label class="label-span-2">
                    <span>Tags (comma separated)</span>
                    <input id="tagsInput" type="text" />
                  </label>
                </div>
              </section>

              <section class="panel-section">
                <div class="panel-title-row"><h3>Quick Import</h3></div>
                <div class="form-grid compact-form-grid">
                  <label>
                    <span>Format</span>
                    <select id="quickImportFormat">
                      <option value="curl">cURL</option>
                      <option value="http">Raw HTTP</option>
                      <option value="postman">Postman Collection JSON</option>
                      <option value="openapi">OpenAPI JSON</option>
                    </select>
                  </label>
                  <label class="label-span-2">
                    <span>Pasted Content</span>
                    <textarea id="quickImportInput" class="variant-textarea import-textarea" spellcheck="false"></textarea>
                  </label>
                </div>
                <div class="row-actions">
                  <button class="ghost-button small-button" data-action="apply-import-current">현재 문서에 적용</button>
                  <button class="ghost-button small-button" data-action="apply-import-add">새 문서로 추가</button>
                </div>
              </section>

              <section class="panel-section">
                <div class="panel-title-row">
                  <h3>Generation Presets</h3>
                  <div class="row-actions">
                    <button class="ghost-button small-button" data-action="duplicate-preset">복제</button>
                    <button class="ghost-button small-button" data-action="remove-preset">삭제</button>
                  </div>
                </div>
                <div id="presetListSection"></div>
                <div class="form-grid compact-form-grid">
                  <label>
                    <span>Preset Name</span>
                    <input id="presetNameInput" type="text" />
                  </label>
                  <label>
                    <span>Success String</span>
                    <input id="successResponseTextInput" type="text" />
                  </label>
                  <label>
                    <span>Root Array Strategy</span>
                    <select id="rootArrayStrategyInput">
                      <option value="block">block</option>
                      <option value="wrap">wrap</option>
                    </select>
                  </label>
                  <label>
                    <span>Root Array Wrapper Field</span>
                    <input id="rootArrayWrapperFieldInput" type="text" />
                  </label>
                  <label>
                    <span>RequestBody Variable</span>
                    <input id="requestBodyVariableNameInput" type="text" />
                  </label>
                  <label>
                    <span>DTO Suffix</span>
                    <input id="dtoSuffixInput" type="text" />
                  </label>
                  <label>
                    <span>OpenAPI Title</span>
                    <input id="openApiTitleInput" type="text" />
                  </label>
                  <label>
                    <span>OpenAPI Version</span>
                    <input id="openApiVersionInput" type="text" />
                  </label>
                  <label>
                    <span>Server URL</span>
                    <input id="serverUrlInput" type="text" />
                  </label>
                  <label class="checkbox-row">
                    <span>Use Lombok</span>
                    <input id="includeLombokInput" type="checkbox" />
                  </label>
                  <label class="checkbox-row">
                    <span>Swagger Annotation</span>
                    <input id="addSwaggerAnnotationsInput" type="checkbox" />
                  </label>
                </div>
              </section>

              <section class="panel-section">
                <div class="panel-title-row">
                  <h3>Params</h3>
                  <button class="ghost-button small-button" data-action="add-param">파라미터 추가</button>
                </div>
                <div class="table-wrap">
                  <table class="param-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Source</th>
                        <th>Java Type</th>
                        <th>Required</th>
                        <th>Sample</th>
                        <th>Description</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody id="paramsBody"></tbody>
                  </table>
                </div>
              </section>

              <section class="panel-section">
                <div class="panel-title-row">
                  <h3>Snapshots</h3>
                  <button class="ghost-button small-button" data-action="save-snapshot">저장</button>
                </div>
                <div id="snapshotListSection"></div>
              </section>
            </div>
          </section>

          <div class="splitter splitter-vertical" data-splitter="left-center"></div>

          <section id="centerPanel" class="shell-panel panel-center" data-panel="center">
            <div class="shell-panel-header">
              <div>
                <div class="eyebrow eyebrow-inline">Analysis</div>
                <h2>Issues / Preview / Diff</h2>
              </div>
              <div class="panel-actions">
                <button class="icon-button small-button" data-action="toggle-diff-mode">Diff 토글</button>
                <button class="icon-button small-button" data-action="maximize-panel" data-panel="center">최대화</button>
              </div>
            </div>
            <div class="shell-panel-scroll">
              <section id="summarySection" class="panel-section"></section>
              <section id="issuesSection" class="panel-section"></section>
              <section id="previewsSection" class="panel-section"></section>
              <section id="diffSection" class="panel-section"></section>
            </div>
          </section>

          <div class="splitter splitter-vertical" data-splitter="center-right"></div>

          <section id="rightPanel" class="shell-panel panel-right" data-panel="right">
            <div class="shell-panel-header">
              <div>
                <div class="eyebrow eyebrow-inline">Generated</div>
                <h2>Code / Spec / Export</h2>
              </div>
              <div class="panel-actions">
                <button class="icon-button small-button" data-action="maximize-panel" data-panel="right">최대화</button>
              </div>
            </div>
            <div class="shell-panel-scroll">
              <section class="panel-section">
                <div id="tabsContainer"></div>
                <div id="resultContent" class="result-content"></div>
              </section>
            </div>
          </section>
        </main>
      </div>
    `;
  }

  private captureElements(): void {
    this.workspaceLayout = this.root.querySelector('#workspaceLayout') as HTMLElement;
    this.editorSplitLayout = this.root.querySelector('#editorSplitLayout') as HTMLElement;
    this.requestInput = this.root.querySelector('#requestInput') as HTMLTextAreaElement;
    this.responseInput = this.root.querySelector('#responseInput') as HTMLTextAreaElement;
    this.requestGutter = this.root.querySelector('#requestGutter') as HTMLElement;
    this.responseGutter = this.root.querySelector('#responseGutter') as HTMLElement;
    this.importInput = this.root.querySelector('#importWorkspaceInput') as HTMLInputElement;
    this.paramsBody = this.root.querySelector('#paramsBody') as HTMLElement;
    this.summarySection = this.root.querySelector('#summarySection') as HTMLElement;
    this.issuesSection = this.root.querySelector('#issuesSection') as HTMLElement;
    this.previewsSection = this.root.querySelector('#previewsSection') as HTMLElement;
    this.diffSection = this.root.querySelector('#diffSection') as HTMLElement;
    this.resultContent = this.root.querySelector('#resultContent') as HTMLElement;
    this.tabsContainer = this.root.querySelector('#tabsContainer') as HTMLElement;
    this.lastSavedLabel = this.root.querySelector('#lastSavedLabel') as HTMLElement;
    this.documentListSection = this.root.querySelector('#documentListSection') as HTMLElement;
    this.presetListSection = this.root.querySelector('#presetListSection') as HTMLElement;
    this.requestVariantsSection = this.root.querySelector('#requestVariantsSection') as HTMLElement;
    this.responseVariantsSection = this.root.querySelector('#responseVariantsSection') as HTMLElement;
    this.snapshotListSection = this.root.querySelector('#snapshotListSection') as HTMLElement;
    this.quickImportInput = this.root.querySelector('#quickImportInput') as HTMLTextAreaElement;
    this.quickImportFormat = this.root.querySelector('#quickImportFormat') as HTMLSelectElement;
    this.documentSearchInput = this.root.querySelector('#documentSearchInput') as HTMLInputElement;
  }

  private applyStaticLabels(): void {
    const setText = (selector: string, value: string): void => {
      const element = this.root.querySelector(selector);
      if (element) {
        element.textContent = value;
      }
    };

    const setButton = (selector: string, value: string, ariaLabel?: string): void => {
      const element = this.root.querySelector(selector) as HTMLButtonElement | null;
      if (!element) return;
      element.type = 'button';
      element.textContent = value;
      if (ariaLabel) {
        element.setAttribute('aria-label', ariaLabel);
      }
    };

    setText('.subtitle', '여러 예시를 병합해 스펙, 코드, 문서, 목 데이터를 한 자리에서 검토하는 프런트엔드 전용 API 워크벤치');
    setButton('[data-action="reset"]', '샘플로 초기화');
    setButton('[data-action="restore-layout"]', '레이아웃 초기화');
    setButton('[data-action="save-snapshot"]', '스냅샷 저장');
    setButton('[data-action="mask-sensitive"]', '민감정보 마스킹');
    setButton('[data-action="export"]', '워크스페이스 JSON');
    setButton('[data-action="export-current-zip"]', '현재 엔드포인트 ZIP');
    setButton('[data-action="export-workspace-zip"]', '워크스페이스 ZIP');
    setButton('[data-action="import"]', '가져오기');
    setButton('[data-action="copy-active-result"]', '현재 탭 복사');
    setButton('[data-action="toggle-diff-mode"]', 'Diff 변경만', 'Diff 변경만 보기 토글');
    setButton('[data-action="maximize-panel"][data-panel="left"]', '최대화', '왼쪽 패널 최대화 또는 복원');
    setButton('[data-action="maximize-panel"][data-panel="center"]', '최대화', '가운데 패널 최대화 또는 복원');
    setButton('[data-action="maximize-panel"][data-panel="right"]', '최대화', '오른쪽 패널 최대화 또는 복원');

    const splitters = [
      { selector: '[data-splitter="request-response"]', orientation: 'horizontal', label: '요청과 응답 편집기 크기 조절' },
      { selector: '[data-splitter="left-center"]', orientation: 'vertical', label: '왼쪽과 가운데 패널 크기 조절' },
      { selector: '[data-splitter="center-right"]', orientation: 'vertical', label: '가운데와 오른쪽 패널 크기 조절' },
    ] as const;
    for (const splitter of splitters) {
      const element = this.root.querySelector(splitter.selector) as HTMLElement | null;
      if (!element) continue;
      element.tabIndex = 0;
      element.setAttribute('role', 'separator');
      element.setAttribute('aria-orientation', splitter.orientation);
      element.setAttribute('aria-label', splitter.label);
    }

    if (this.documentSearchInput) {
      this.documentSearchInput.placeholder = '엔드포인트 검색 (이름 / 경로 / 태그)';
      this.documentSearchInput.setAttribute('aria-label', '엔드포인트 검색');
    }
  }

  private bindEvents(): void {
    this.requestInput.addEventListener('input', () => {
      this.store.update((draft) => {
        const document = this.getActiveDocumentDraft(draft);
        if (document) {
          document.requestRaw = this.requestInput.value;
        }
      });
    });

    this.responseInput.addEventListener('input', () => {
      this.store.update((draft) => {
        const document = this.getActiveDocumentDraft(draft);
        if (document) {
          document.responseRaw = this.responseInput.value;
        }
      });
    });

    this.requestInput.addEventListener('scroll', () => {
      this.requestGutter.scrollTop = this.requestInput.scrollTop;
    });
    this.responseInput.addEventListener('scroll', () => {
      this.responseGutter.scrollTop = this.responseInput.scrollTop;
    });

    this.documentSearchInput.addEventListener('input', () => {
      this.documentFilter = this.documentSearchInput.value;
      this.documentListSection.innerHTML = renderDocumentList(this.snapshot, this.documentFilter);
    });

    const bindDocumentInput = (selector: string, updater: (document: EndpointDocument, value: string) => void): void => {
      const input = this.root.querySelector(selector) as HTMLInputElement | HTMLSelectElement;
      const handler = (): void => {
        this.store.update((draft) => {
          const document = this.getActiveDocumentDraft(draft);
          if (document) {
            updater(document, input.value);
          }
        });
      };
      input.addEventListener('input', handler);
      input.addEventListener('change', handler);
    };

    bindDocumentInput('#documentNameInput', (document, value) => { document.name = value; });
    bindDocumentInput('#packageNameInput', (document, value) => { document.endpoint.packageName = value; });
    bindDocumentInput('#basePathInput', (document, value) => { document.endpoint.basePath = value; });
    bindDocumentInput('#endpointPathInput', (document, value) => { document.endpoint.endpointPath = value; });
    bindDocumentInput('#httpMethodInput', (document, value) => { document.endpoint.httpMethod = value as EndpointDocument['endpoint']['httpMethod']; });
    bindDocumentInput('#requestModeInput', (document, value) => { document.requestMode = value as EndpointDocument['requestMode']; });
    bindDocumentInput('#controllerClassInput', (document, value) => { document.endpoint.controllerClassName = value; });
    bindDocumentInput('#serviceClassInput', (document, value) => { document.endpoint.serviceClassName = value; });
    bindDocumentInput('#methodNameInput', (document, value) => { document.endpoint.methodName = value; });
    bindDocumentInput('#tagsInput', (document, value) => {
      document.tags = value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
    });

    const bindPresetInput = (selector: string, updater: (workspace: WorkspaceState, value: string | boolean) => void): void => {
      const input = this.root.querySelector(selector) as HTMLInputElement | HTMLSelectElement;
      const handler = (): void => {
        this.store.update((draft) => updater(draft, input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : input.value));
      };
      input.addEventListener('input', handler);
      input.addEventListener('change', handler);
    };

    bindPresetInput('#presetNameInput', (draft, value) => {
      const preset = this.getActivePresetDraft(draft);
      if (preset) preset.name = String(value);
    });
    bindPresetInput('#successResponseTextInput', (draft, value) => {
      const preset = this.getActivePresetDraft(draft);
      if (preset) preset.successResponseText = String(value);
    });
    bindPresetInput('#rootArrayStrategyInput', (draft, value) => {
      const preset = this.getActivePresetDraft(draft);
      if (preset) preset.rootArrayRequestStrategy = value === 'wrap' ? 'wrap' : 'block';
    });
    bindPresetInput('#rootArrayWrapperFieldInput', (draft, value) => {
      const preset = this.getActivePresetDraft(draft);
      if (preset) preset.rootArrayWrapperField = String(value);
    });
    bindPresetInput('#requestBodyVariableNameInput', (draft, value) => {
      const preset = this.getActivePresetDraft(draft);
      if (preset) preset.requestBodyVariableName = String(value);
    });
    bindPresetInput('#dtoSuffixInput', (draft, value) => {
      const preset = this.getActivePresetDraft(draft);
      if (preset) preset.dtoSuffix = String(value);
    });
    bindPresetInput('#openApiTitleInput', (draft, value) => {
      const preset = this.getActivePresetDraft(draft);
      if (preset) preset.openApiTitle = String(value);
    });
    bindPresetInput('#openApiVersionInput', (draft, value) => {
      const preset = this.getActivePresetDraft(draft);
      if (preset) preset.openApiVersion = String(value);
    });
    bindPresetInput('#serverUrlInput', (draft, value) => {
      const preset = this.getActivePresetDraft(draft);
      if (preset) preset.serverUrl = String(value);
    });
    bindPresetInput('#includeLombokInput', (draft, value) => {
      const preset = this.getActivePresetDraft(draft);
      if (preset) preset.includeLombok = Boolean(value);
    });
    bindPresetInput('#addSwaggerAnnotationsInput', (draft, value) => {
      const preset = this.getActivePresetDraft(draft);
      if (preset) preset.addSwaggerAnnotations = Boolean(value);
    });

    this.paramsBody.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement;
      const row = target.closest<HTMLTableRowElement>('tr[data-param-id]');
      if (!row) return;
      const paramId = row.dataset.paramId!;
      const field = target.dataset.field as keyof EndpointParam;
      this.store.update((draft) => {
        const document = this.getActiveDocumentDraft(draft);
        const param = document?.params.find((candidate) => candidate.id === paramId);
        if (!param || !field) return;
        if (field === 'required') {
          param.required = (target as HTMLInputElement).checked;
          return;
        }
        (param[field] as string) = target.value;
      });
    });

    this.root.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (!target?.dataset?.action) return;
      const action = target.dataset.action;
      if (action === 'variant-edit') {
        this.updateVariantField(target.dataset.scope as 'request' | 'response', target.dataset.variantId || '', target.dataset.field || '', target.value);
      }
      if (action === 'schema-edit') {
        this.updateSchemaField(
          target.dataset.scope as 'request' | 'response',
          target.dataset.path || '',
          target.dataset.field || '',
          target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : target.value,
        );
      }
    });

    this.root.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement;
      if (!target?.dataset?.action) return;
      const action = target.dataset.action;
      if (action === 'variant-toggle') {
        this.updateVariantField(
          target.dataset.scope as 'request' | 'response',
          target.dataset.variantId || '',
          'enabled',
          target instanceof HTMLInputElement ? target.checked : false,
        );
      }
      if (action === 'schema-edit') {
        this.updateSchemaField(
          target.dataset.scope as 'request' | 'response',
          target.dataset.path || '',
          target.dataset.field || '',
          target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : target.value,
        );
      }
      if (action === 'select-snapshot') {
        this.store.update((draft) => {
          const document = this.getActiveDocumentDraft(draft);
          if (document) {
            document.compareSnapshotId = target.dataset.snapshotId;
            document.activeResultTab = 'changes';
          }
        });
      }
    });

    this.root.addEventListener('click', async (event) => {
      const target = event.target as HTMLElement;
      const actionElement = target.closest<HTMLElement>('[data-action]');
      if (!actionElement) return;

      const action = actionElement.dataset.action;
      switch (action) {
        case 'add-document':
          this.store.update((draft) => {
            const document = createEmptyDocumentTemplate();
            draft.documents.push(document);
            draft.activeDocumentId = document.id;
          });
          break;
        case 'select-document':
          this.store.update((draft) => {
            if (typeof actionElement.dataset.documentId === 'string') {
              draft.activeDocumentId = actionElement.dataset.documentId;
            }
          });
          break;
        case 'duplicate-document':
          this.store.update((draft) => {
            const source = draft.documents.find((document) => document.id === actionElement.dataset.documentId);
            if (!source) return;
            const copy = duplicateDocumentTemplate(source);
            draft.documents.push(copy);
            draft.activeDocumentId = copy.id;
          });
          break;
        case 'remove-document':
          this.store.update((draft) => {
            if (draft.documents.length <= 1) return;
            draft.documents = draft.documents.filter((document) => document.id !== actionElement.dataset.documentId);
            if (!draft.documents.some((document) => document.id === draft.activeDocumentId)) {
              draft.activeDocumentId = draft.documents[0]!.id;
            }
          });
          break;
        case 'add-param':
          this.store.update((draft) => {
            const document = this.getActiveDocumentDraft(draft);
            if (document) document.params.push(createEmptyParam());
          });
          break;
        case 'remove-param':
          this.store.update((draft) => {
            const document = this.getActiveDocumentDraft(draft);
            if (document) document.params = document.params.filter((param) => param.id !== actionElement.dataset.paramId);
          });
          break;
        case 'add-variant':
          this.store.update((draft) => {
            const document = this.getActiveDocumentDraft(draft);
            if (!document) return;
            const scope = actionElement.dataset.scope as 'request' | 'response';
            if (scope === 'request') document.requestVariants.push(createEmptyVariant('Request Variant'));
            if (scope === 'response') document.responseVariants.push(createEmptyVariant('Response Variant'));
          });
          break;
        case 'remove-variant':
          this.store.update((draft) => {
            const document = this.getActiveDocumentDraft(draft);
            if (!document) return;
            const scope = actionElement.dataset.scope as 'request' | 'response';
            const variantId = actionElement.dataset.variantId;
            if (scope === 'request') document.requestVariants = document.requestVariants.filter((variant) => variant.id !== variantId);
            if (scope === 'response') document.responseVariants = document.responseVariants.filter((variant) => variant.id !== variantId);
          });
          break;
        case 'change-tab':
          this.store.update((draft) => {
            const document = this.getActiveDocumentDraft(draft);
            if (document) document.activeResultTab = actionElement.dataset.tab as GeneratedTab;
          });
          break;
        case 'export':
          downloadFile('api-spec-workspace.json', exportWorkspace(this.snapshot.workspace));
          break;
        case 'import':
          this.importInput.click();
          break;
        case 'reset':
          this.store.reset();
          break;
        case 'restore-layout':
          this.store.update((draft) => {
            draft.layout = structuredClone(DEFAULT_LAYOUT);
            draft.layout.collapsedPanels = { left: false, center: false, right: false };
          });
          break;
        case 'copy-active-result':
          await navigator.clipboard.writeText(this.getActiveResultText());
          break;
        case 'jump-issue':
          if (!actionElement.classList.contains('issue-card-static')) {
            this.jumpToIssue(actionElement.dataset.target as ParseIssue['target'], Number(actionElement.dataset.issueIndex));
          }
          break;
        case 'maximize-panel':
          this.maximizePanel(actionElement.dataset.panel as 'left' | 'center' | 'right');
          break;
        case 'toggle-diff-mode':
          this.store.update((draft) => {
            draft.layout.showOnlyDiffChanges = !draft.layout.showOnlyDiffChanges;
          });
          break;
        case 'select-preset':
          this.store.update((draft) => {
            if (typeof actionElement.dataset.presetId === 'string') {
              draft.activePresetId = actionElement.dataset.presetId;
            }
          });
          break;
        case 'duplicate-preset':
          this.store.update((draft) => {
            const preset = this.getActivePresetDraft(draft);
            if (!preset) return;
            const copy = createPresetFromCurrent(preset);
            draft.presets.push(copy);
            draft.activePresetId = copy.id;
          });
          break;
        case 'remove-preset':
          this.store.update((draft) => {
            if (draft.presets.length <= 1) return;
            draft.presets = draft.presets.filter((preset) => preset.id !== draft.activePresetId);
            draft.activePresetId = draft.presets[0]!.id;
          });
          break;
        case 'export-current-zip':
          this.exportCurrentEndpointZip();
          break;
        case 'export-workspace-zip':
          this.exportWorkspaceZip();
          break;
        case 'apply-import-current':
          this.applyQuickImport(false);
          break;
        case 'apply-import-add':
          this.applyQuickImport(true);
          break;
        case 'save-snapshot':
          this.store.update((draft) => {
            const document = this.getActiveDocumentDraft(draft);
            if (!document) return;
            const snapshot = createSnapshot(document);
            document.snapshots.unshift(snapshot);
            document.compareSnapshotId = snapshot.id;
            document.activeResultTab = 'changes';
          });
          break;
        case 'restore-snapshot':
          this.restoreSnapshot(actionElement.dataset.snapshotId || '');
          break;
        case 'delete-snapshot':
          this.store.update((draft) => {
            const document = this.getActiveDocumentDraft(draft);
            if (!document) return;
            document.snapshots = document.snapshots.filter((snapshot) => snapshot.id !== actionElement.dataset.snapshotId);
            if (document.compareSnapshotId === actionElement.dataset.snapshotId) {
              document.compareSnapshotId = undefined;
            }
          });
          break;
        case 'mask-sensitive':
          this.store.update((draft) => {
            const document = this.getActiveDocumentDraft(draft);
            if (!document) return;
            document.requestRaw = maskSensitiveText(document.requestRaw);
            document.responseRaw = maskSensitiveText(document.responseRaw);
            document.requestVariants = maskVariants(document.requestVariants);
            document.responseVariants = maskVariants(document.responseVariants);
          });
          break;
        default:
          break;
      }
    });

    this.root.addEventListener('pointerdown', (event) => {
      const target = event.target as HTMLElement;
      const splitter = target.closest<HTMLElement>('[data-splitter]');
      if (!splitter) return;
      this.startDrag(splitter.dataset.splitter as 'left-center' | 'center-right' | 'request-response', event);
    });

    this.root.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement | null;
      const splitter = target?.closest<HTMLElement>('[data-splitter]');
      if (!splitter) return;
      const nextLayout = nudgeLayoutWithKeyboard(
        this.snapshot.workspace.layout,
        splitter.dataset.splitter as 'left-center' | 'center-right' | 'request-response',
        event.key,
        event.shiftKey,
      );
      if (!nextLayout) return;
      event.preventDefault();
      this.store.update((draft) => {
        draft.layout = nextLayout;
      });
    });

    this.importInput.addEventListener('change', async () => {
      const file = this.importInput.files?.[0];
      if (!file) return;
      try {
        const raw = await readFileAsText(file);
        this.store.replace(JSON.parse(raw) as WorkspaceState);
      } catch (error) {
        alert(`가져오기에 실패했습니다. ${errorMessage(error, '파일 형식과 내용을 확인해 주세요.')}`);
      } finally {
        this.importInput.value = '';
      }
    });

    window.addEventListener('keydown', async (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        downloadFile('api-spec-workspace.json', exportWorkspace(this.snapshot.workspace));
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c' && event.altKey) {
        event.preventDefault();
        await navigator.clipboard.writeText(this.getActiveResultText());
      }
    });
  }

  private getActiveDocumentDraft(draft: WorkspaceState): EndpointDocument | undefined {
    return draft.documents.find((document) => document.id === draft.activeDocumentId);
  }

  private getActivePresetDraft(draft: WorkspaceState) {
    return draft.presets.find((preset) => preset.id === draft.activePresetId);
  }

  private updateVariantField(scope: 'request' | 'response', variantId: string, field: string, value: string | boolean): void {
    this.store.update((draft) => {
      const document = this.getActiveDocumentDraft(draft);
      if (!document) return;
      const variants = scope === 'request' ? document.requestVariants : document.responseVariants;
      const variant = variants.find((candidate) => candidate.id === variantId);
      if (!variant) return;
      if (field === 'enabled') {
        variant.enabled = Boolean(value);
      } else if (field === 'name' || field === 'raw') {
        (variant[field] as string) = String(value);
      }
    });
  }

  private updateSchemaField(scope: 'request' | 'response', path: string, field: string, value: string | boolean): void {
    if (!path) return;
    this.store.update((draft) => {
      const document = this.getActiveDocumentDraft(draft);
      if (!document) return;
      const bucket = document.schemaOverrides[scope];
      const current = bucket[path] ?? { path };
      switch (field) {
        case 'type':
          current.type = String(value);
          break;
        case 'required':
          current.required = Boolean(value);
          break;
        case 'nullable':
          current.nullable = Boolean(value);
          break;
        case 'description':
          current.description = String(value);
          break;
        case 'format':
          current.format = String(value).trim() || undefined;
          break;
        case 'enumValues':
          current.enumValues = String(value)
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
          break;
        case 'example':
          current.example = String(value);
          break;
        default:
          break;
      }
      bucket[path] = current;
    });
  }

  private restoreSnapshot(snapshotId: string): void {
    this.store.update((draft) => {
      const document = this.getActiveDocumentDraft(draft);
      if (!document) return;
      const snapshot = document.snapshots.find((candidate) => candidate.id === snapshotId);
      if (!snapshot) return;
      const state = snapshot.state;
      document.name = state.name;
      document.requestRaw = state.requestRaw;
      document.responseRaw = state.responseRaw;
      document.requestVariants = structuredClone(state.requestVariants);
      document.responseVariants = structuredClone(state.responseVariants);
      document.endpoint = structuredClone(state.endpoint);
      document.params = structuredClone(state.params);
      document.tags = structuredClone(state.tags);
      document.requestMode = state.requestMode;
      document.schemaOverrides = structuredClone(state.schemaOverrides);
      document.compareSnapshotId = snapshot.id;
      document.activeResultTab = 'changes';
    });
  }

  private applyQuickImport(asNewDocuments: boolean): void {
    const raw = this.quickImportInput.value.trim();
    if (!raw) {
      alert('가져올 내용을 붙여 넣어주세요.');
      return;
    }
    const format = this.quickImportFormat.value;

    this.store.update((draft) => {
      const current = this.getActiveDocumentDraft(draft);
      if (!current) return;
      const template = createEmptyDocumentTemplate();
      const appendDocuments = (documents: EndpointDocument[]): void => {
        for (const document of documents) {
          draft.documents.push(document);
        }
        if (documents.length > 0) {
          draft.activeDocumentId = documents[documents.length - 1]!.id;
        }
      };

      if (format === 'curl') {
        const imported = applyCurlImport(raw, current);
        if (!imported) return;
        if (asNewDocuments) {
          const created = duplicateDocumentTemplate({ ...current, ...imported, id: current.id, snapshots: [], compareSnapshotId: undefined });
          draft.documents.push(created);
          draft.activeDocumentId = created.id;
        } else {
          Object.assign(current, imported);
        }
        return;
      }

      if (format === 'http') {
        const imported = applyRawHttpImport(raw, current);
        if (!imported) return;
        if (asNewDocuments) {
          const created = duplicateDocumentTemplate({ ...current, ...imported, id: current.id, snapshots: [], compareSnapshotId: undefined });
          draft.documents.push(created);
          draft.activeDocumentId = created.id;
        } else {
          Object.assign(current, imported);
        }
        return;
      }

      if (format === 'postman') {
        const importedDocs = applyPostmanCollectionImport(raw, template);
        if (!importedDocs || importedDocs.length === 0) return;
        if (asNewDocuments) {
          appendDocuments(importedDocs);
        } else {
          const first = importedDocs[0]!;
          Object.assign(current, { ...first, id: current.id, snapshots: current.snapshots, compareSnapshotId: current.compareSnapshotId });
        }
        return;
      }

      if (format === 'openapi') {
        const importedDocs = applyOpenApiImport(raw, template);
        if (!importedDocs || importedDocs.length === 0) return;
        if (asNewDocuments) {
          appendDocuments(importedDocs);
        } else {
          const first = importedDocs[0]!;
          Object.assign(current, { ...first, id: current.id, snapshots: current.snapshots, compareSnapshotId: current.compareSnapshotId });
        }
      }
    });
  }

  private syncFormValues(): void {
    if (document.activeElement !== this.requestInput && this.requestInput.value !== this.snapshot.activeDocument.requestRaw) {
      this.requestInput.value = this.snapshot.activeDocument.requestRaw;
    }
    if (document.activeElement !== this.responseInput && this.responseInput.value !== this.snapshot.activeDocument.responseRaw) {
      this.responseInput.value = this.snapshot.activeDocument.responseRaw;
    }

    this.syncInputValue('#documentNameInput', this.snapshot.activeDocument.name);
    this.syncInputValue('#packageNameInput', this.snapshot.activeDocument.endpoint.packageName);
    this.syncInputValue('#basePathInput', this.snapshot.activeDocument.endpoint.basePath);
    this.syncInputValue('#endpointPathInput', this.snapshot.activeDocument.endpoint.endpointPath);
    this.syncInputValue('#httpMethodInput', this.snapshot.activeDocument.endpoint.httpMethod);
    this.syncInputValue('#requestModeInput', this.snapshot.activeDocument.requestMode);
    this.syncInputValue('#controllerClassInput', this.snapshot.activeDocument.endpoint.controllerClassName);
    this.syncInputValue('#serviceClassInput', this.snapshot.activeDocument.endpoint.serviceClassName);
    this.syncInputValue('#methodNameInput', this.snapshot.activeDocument.endpoint.methodName);
    this.syncInputValue('#tagsInput', this.snapshot.activeDocument.tags.join(', '));

    this.syncInputValue('#presetNameInput', this.snapshot.activePreset.name);
    this.syncInputValue('#successResponseTextInput', this.snapshot.activePreset.successResponseText);
    this.syncInputValue('#rootArrayStrategyInput', this.snapshot.activePreset.rootArrayRequestStrategy);
    this.syncInputValue('#rootArrayWrapperFieldInput', this.snapshot.activePreset.rootArrayWrapperField);
    this.syncInputValue('#requestBodyVariableNameInput', this.snapshot.activePreset.requestBodyVariableName);
    this.syncInputValue('#dtoSuffixInput', this.snapshot.activePreset.dtoSuffix);
    this.syncInputValue('#openApiTitleInput', this.snapshot.activePreset.openApiTitle);
    this.syncInputValue('#openApiVersionInput', this.snapshot.activePreset.openApiVersion);
    this.syncInputValue('#serverUrlInput', this.snapshot.activePreset.serverUrl);
    this.syncCheckbox('#includeLombokInput', this.snapshot.activePreset.includeLombok);
    this.syncCheckbox('#addSwaggerAnnotationsInput', this.snapshot.activePreset.addSwaggerAnnotations);

    this.paramsBody.innerHTML = this.snapshot.activeDocument.params
      .map(
        (param) => `
          <tr data-param-id="${escapeHtml(param.id)}">
            <td><input data-field="name" type="text" value="${escapeHtml(param.name)}" /></td>
            <td>
              <select data-field="source">
                <option value="query" ${param.source === 'query' ? 'selected' : ''}>query</option>
                <option value="path" ${param.source === 'path' ? 'selected' : ''}>path</option>
                <option value="header" ${param.source === 'header' ? 'selected' : ''}>header</option>
              </select>
            </td>
            <td>
              <select data-field="javaType">
                ${['String', 'int', 'long', 'double', 'boolean', 'Object']
                  .map((type) => `<option value="${type}" ${param.javaType === type ? 'selected' : ''}>${type}</option>`)
                  .join('')}
              </select>
            </td>
            <td class="checkbox-cell"><input data-field="required" type="checkbox" ${param.required ? 'checked' : ''} /></td>
            <td><input data-field="sampleValue" type="text" value="${escapeHtml(param.sampleValue || '')}" /></td>
            <td><input data-field="description" type="text" value="${escapeHtml(param.description || '')}" /></td>
            <td><button class="icon-button small-button" data-action="remove-param" data-param-id="${escapeHtml(param.id)}">삭제</button></td>
          </tr>
        `,
      )
      .join('');

    this.lastSavedLabel.textContent = `자동 저장: ${this.snapshot.workspace.lastSavedAt ?? '-'}`;
  }

  private syncInputValue(selector: string, value: string): void {
    const element = this.root.querySelector(selector) as HTMLInputElement | HTMLSelectElement;
    if (element && document.activeElement !== element && element.value !== value) {
      element.value = value;
    }
  }

  private syncCheckbox(selector: string, value: boolean): void {
    const element = this.root.querySelector(selector) as HTMLInputElement;
    if (element && document.activeElement !== element && element.checked !== value) {
      element.checked = value;
    }
  }

  private renderDynamic(): void {
    const requestFlags = [
      ...(this.snapshot.requestAnalysis.ast?.type === 'array' && this.snapshot.requestAnalysis.ast.hasOmittedItems ? ['생략 요소 있음'] : []),
      ...(this.snapshot.requestAnalysis.ast?.type === 'object' && this.snapshot.requestAnalysis.ast.hasAdditionalFields ? ['추가 필드 가능'] : []),
      ...(this.snapshot.generated.rootArrayWrapped ? [`payload 는 '${this.snapshot.activePreset.rootArrayWrapperField}' 로 래핑`] : []),
      ...(this.snapshot.requestAnalysis.schema.variantCount > 0 ? [`variant ${this.snapshot.requestAnalysis.schema.variantCount}개 병합`] : []),
    ];

    const responseFlags = [
      ...(this.snapshot.responseAnalysis.ast?.type === 'array' && this.snapshot.responseAnalysis.ast.hasOmittedItems ? ['생략 요소 있음'] : []),
      ...(this.snapshot.responseAnalysis.ast?.type === 'object' && this.snapshot.responseAnalysis.ast.hasAdditionalFields ? ['추가 필드 가능'] : []),
      ...(this.snapshot.generated.responseJavaType === 'String' ? ['plain text response'] : []),
      ...(this.snapshot.responseAnalysis.schema.variantCount > 0 ? [`variant ${this.snapshot.responseAnalysis.schema.variantCount}개 병합`] : []),
    ];

    const requestDiff = buildDiff(this.snapshot.activeDocument.requestRaw, this.snapshot.generated.payloadText);
    const responseDiff = buildDiff(this.snapshot.activeDocument.responseRaw, this.snapshot.responseAnalysis.normalizedText);

    this.documentListSection.innerHTML = renderDocumentList(this.snapshot, this.documentFilter);
    this.presetListSection.innerHTML = renderPresetList(this.snapshot);
    this.requestVariantsSection.innerHTML = renderVariantSection('request', this.snapshot.activeDocument.requestVariants);
    this.responseVariantsSection.innerHTML = renderVariantSection('response', this.snapshot.activeDocument.responseVariants);
    this.snapshotListSection.innerHTML = renderSnapshotList(this.snapshot);
    this.summarySection.innerHTML = renderSummary(this.snapshot);
    this.issuesSection.innerHTML = renderIssueGroups(this.snapshot);
    this.previewsSection.innerHTML = [
      renderPreview('Request Normalized', this.snapshot.generated.payloadText, requestFlags),
      renderPreview('Response Normalized', this.snapshot.responseAnalysis.normalizedText, responseFlags),
      this.snapshot.changeReport ? renderChangeReport(this.snapshot.changeReport) : '',
    ].join('');
    this.diffSection.innerHTML = [
      renderDiffCard('Request Diff', requestDiff, this.snapshot.workspace.layout.showOnlyDiffChanges),
      renderDiffCard('Response Diff', responseDiff, this.snapshot.workspace.layout.showOnlyDiffChanges),
    ].join('');
    this.tabsContainer.innerHTML = renderTabs(this.snapshot.activeDocument.activeResultTab);
    this.resultContent.innerHTML = renderGeneratedContent(this.snapshot);
  }

  private renderEditorGutters(): void {
    const selected = this.snapshot.activeDocument.selectedIssue;
    this.requestGutter.innerHTML = renderGutterHtml(
      this.snapshot.activeDocument.requestRaw,
      this.snapshot.requestAnalysis.issues.filter((issue) => issue.navigable !== false),
      selected?.target === 'request' ? this.snapshot.requestAnalysis.issues[selected.index] : undefined,
    );
    this.responseGutter.innerHTML = renderGutterHtml(
      this.snapshot.activeDocument.responseRaw,
      this.snapshot.responseAnalysis.issues.filter((issue) => issue.navigable !== false),
      selected?.target === 'response' ? this.snapshot.responseAnalysis.issues[selected.index] : undefined,
    );
    this.requestGutter.scrollTop = this.requestInput.scrollTop;
    this.responseGutter.scrollTop = this.responseInput.scrollTop;
  }

  private getActiveResultText(): string {
    switch (this.snapshot.activeDocument.activeResultTab) {
      case 'request-spec':
        return JSON.stringify(this.snapshot.requestAnalysis.schema.rows, null, 2);
      case 'response-spec':
        return JSON.stringify(this.snapshot.responseAnalysis.schema.rows, null, 2);
      case 'payload':
        return this.snapshot.generated.payloadText;
      case 'controller':
        return this.snapshot.generated.controllerCode;
      case 'service-interface':
        return this.snapshot.generated.serviceInterfaceCode;
      case 'service-impl':
        return this.snapshot.generated.serviceImplementationCode;
      case 'dto':
        return this.snapshot.generated.dtoCode;
      case 'openapi':
        return this.snapshot.generated.openApiYaml;
      case 'curl':
        return this.snapshot.generated.curlText;
      case 'json-schema':
        return this.snapshot.generated.jsonSchemaText;
      case 'mock-request':
        return this.snapshot.generated.mockRequestText;
      case 'mock-response':
        return this.snapshot.generated.mockResponseText;
      case 'fetch':
        return this.snapshot.generated.fetchText;
      case 'axios':
        return this.snapshot.generated.axiosText;
      case 'markdown':
        return this.snapshot.generated.markdownText;
      case 'changes':
        return JSON.stringify(this.snapshot.changeReport, null, 2);
      default:
        return '';
    }
  }

  private jumpToIssue(target: ParseIssue['target'], index: number): void {
    this.store.update((draft) => {
      const document = this.getActiveDocumentDraft(draft);
      if (document && (target === 'request' || target === 'response' || target === 'config')) {
        document.selectedIssue = { target, index };
      }
    });

    if (target === 'request') {
      this.selectIssueInTextarea(this.requestInput, this.snapshot.requestAnalysis.issues[index]);
      return;
    }
    if (target === 'response') {
      this.selectIssueInTextarea(this.responseInput, this.snapshot.responseAnalysis.issues[index]);
    }
  }

  private selectIssueInTextarea(textarea: HTMLTextAreaElement, issue: ParseIssue | undefined): void {
    const selection = computeIssueSelection(issue, getComputedStyle(textarea).lineHeight || '20');
    if (!selection) return;
    textarea.focus();
    textarea.setSelectionRange(selection.selectionStart, selection.selectionEnd);
    textarea.scrollTop = selection.scrollTop;
  }

  private maximizePanel(panel: 'left' | 'center' | 'right'): void {
    this.store.update((draft) => {
      draft.layout.maximizedPanel = draft.layout.maximizedPanel === panel ? null : panel;
    });
  }

  private applyLayout(): void {
    const layout = this.snapshot.workspace.layout;
    const displayLayout = {
      ...layout,
      collapsedPanels: { left: false, center: false, right: false },
    };
    const workspaceColumns = computeWorkspaceColumns(displayLayout);
    const maximized = layout.maximizedPanel;
    const appliedWorkspaceColumns = maximized ? '1fr 0px 0px 0px 0px' : workspaceColumns;
    this.workspaceLayout.style.gridTemplateColumns = appliedWorkspaceColumns;
    this.workspaceLayout.style.setProperty('--legacy-grid-columns', appliedWorkspaceColumns);
    this.editorSplitLayout.style.gridTemplateRows = `${layout.editorSplit}fr 12px ${100 - layout.editorSplit}fr`;

    (['left', 'center', 'right'] as const).forEach((panel) => {
      const element = this.root.querySelector(`[data-panel="${panel}"]`) as HTMLElement;
      const panelState = describePanelState(displayLayout, panel);
      const hidden = Boolean(maximized && maximized !== panel);
      element.classList.toggle('panel-hidden', hidden);
      element.classList.toggle('panel-collapsed', false);
      element.classList.toggle('panel-maximized', panelState.maximized);
      element.hidden = hidden;
      element.style.display = hidden ? 'none' : '';
      element.style.gridColumn = maximized && maximized === panel ? '1 / -1' : '';
    });

    (['left-center', 'center-right', 'request-response'] as const).forEach((splitterName) => {
      const splitter = this.root.querySelector(`[data-splitter="${splitterName}"]`) as HTMLElement | null;
      if (!splitter) return;
      if (splitterName !== 'request-response' && maximized) {
        splitter.style.display = 'none';
        splitter.tabIndex = -1;
        splitter.setAttribute('aria-hidden', 'true');
        return;
      }
      const splitterState = describeSplitterState(displayLayout, splitterName);
      splitter.style.display = splitterState.hidden ? 'none' : '';
      splitter.tabIndex = splitterState.hidden ? -1 : 0;
      splitter.setAttribute('aria-hidden', splitterState.hidden ? 'true' : 'false');
      splitter.setAttribute('aria-valuemin', String(splitterState.valueMin));
      splitter.setAttribute('aria-valuemax', String(splitterState.valueMax));
      splitter.setAttribute('aria-valuenow', String(Math.round(splitterState.valueNow)));
      splitter.setAttribute('aria-valuetext', splitterState.valueText);
    });

    (['left', 'center', 'right'] as const).forEach((panel) => {
      const maximizeButton = this.root.querySelector(`[data-action="maximize-panel"][data-panel="${panel}"]`) as HTMLButtonElement | null;
      const panelState = describePanelState(displayLayout, panel);
      if (maximizeButton) {
        maximizeButton.textContent = panelState.maximizeLabel;
        maximizeButton.setAttribute('aria-pressed', panelState.maximized ? 'true' : 'false');
      }
    });

    const diffToggle = this.root.querySelector('[data-action="toggle-diff-mode"]') as HTMLButtonElement | null;
    if (diffToggle) {
      diffToggle.setAttribute('aria-pressed', layout.showOnlyDiffChanges ? 'true' : 'false');
      diffToggle.textContent = layout.showOnlyDiffChanges ? 'Diff 전체 보기' : 'Diff 변경만';
    }
  }

  private startDrag(splitter: 'left-center' | 'center-right' | 'request-response', event: PointerEvent): void {
    if (splitter === 'request-response') {
      const containerRect = this.editorSplitLayout.getBoundingClientRect();
      const total = containerRect.height - 12;
      if (total <= 0) return;
      const startSplit = this.snapshot.workspace.layout.editorSplit;
      const startY = event.clientY;
      const onMove = (moveEvent: PointerEvent): void => {
        const delta = moveEvent.clientY - startY;
        const nextSplit = (((startSplit / 100) * total + delta) / total) * 100;
        this.store.update((draft) => {
          draft.layout.editorSplit = Math.min(80, Math.max(20, nextSplit));
        });
      };
      this.bindDrag(onMove, 'row-resize');
      return;
    }

    if (this.snapshot.workspace.layout.maximizedPanel) return;

    const leftPanel = this.root.querySelector('#leftPanel') as HTMLElement;
    const centerPanel = this.root.querySelector('#centerPanel') as HTMLElement;
    const rightPanel = this.root.querySelector('#rightPanel') as HTMLElement;

    const pair = splitter === 'left-center'
      ? { first: leftPanel, second: centerPanel, firstIndex: 0, secondIndex: 1 }
      : { first: centerPanel, second: rightPanel, firstIndex: 1, secondIndex: 2 };

    if (!pair.first || !pair.second) return;
    if (pair.first.classList.contains('panel-collapsed') || pair.second.classList.contains('panel-collapsed')) return;

    const firstWidth = pair.first.getBoundingClientRect().width;
    const secondWidth = pair.second.getBoundingClientRect().width;
    const total = firstWidth + secondWidth;
    if (total <= 0) return;
    const startX = event.clientX;
    const startSizes = [...this.snapshot.workspace.layout.columnSizes] as [number, number, number];
    const pairWeight = startSizes[pair.firstIndex]! + startSizes[pair.secondIndex]!;

    const onMove = (moveEvent: PointerEvent): void => {
      const delta = moveEvent.clientX - startX;
      const minWidth = 220;
      const nextFirst = Math.min(total - minWidth, Math.max(minWidth, firstWidth + delta));
      const nextSecond = total - nextFirst;
      this.store.update((draft) => {
        const ratio = nextFirst / (nextFirst + nextSecond);
        draft.layout.columnSizes[pair.firstIndex] = pairWeight * ratio;
        draft.layout.columnSizes[pair.secondIndex] = pairWeight * (1 - ratio);
      });
    };

    this.bindDrag(onMove, 'col-resize');
  }

  private bindDrag(onMove: (event: PointerEvent) => void, cursor: string): void {
    const handleMove = (moveEvent: PointerEvent): void => {
      moveEvent.preventDefault();
      onMove(moveEvent);
    };
    const handleUp = (): void => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      document.body.classList.remove('is-dragging');
      document.body.style.cursor = '';
    };
    document.body.classList.add('is-dragging');
    document.body.style.cursor = cursor;
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp, { once: true });
  }

  private exportCurrentEndpointZip(): void {
    const documentSlug = slugify(this.snapshot.activeDocument.name);
    const blob = createZipBlob(this.snapshot.generated.exportFiles);
    downloadBlob(`${documentSlug}.zip`, blob);
  }

  private exportWorkspaceZip(): void {
    const files: GeneratedFile[] = [
      {
        path: 'workspace.json',
        content: exportWorkspace(this.snapshot.workspace),
        mimeType: 'application/json',
      },
    ];

    const openApiDocuments = this.snapshot.workspace.documents.map((document) => {
      const requestAnalysis = analyzeVariantSet(document.requestRaw, document.requestVariants, 'request', document.schemaOverrides.request);
      const responseAnalysis = analyzeVariantSet(document.responseRaw, document.responseVariants, 'response', document.schemaOverrides.response);
      const generated = generateArtifacts(document, this.snapshot.activePreset, requestAnalysis, responseAnalysis);
      const prefix = `endpoints/${slugify(document.name)}`;
      files.push(...generated.exportFiles.map((file) => ({ ...file, path: `${prefix}/${file.path}` })));
      return buildOpenApiDocument(document, this.snapshot.activePreset, requestAnalysis, responseAnalysis);
    });

    const merged = mergeOpenApiDocuments(
      openApiDocuments,
      this.snapshot.activePreset.openApiTitle,
      this.snapshot.activePreset.openApiVersion,
      this.snapshot.activePreset.serverUrl,
    );
    files.push({
      path: 'openapi/workspace.yaml',
      content: renderOpenApiYaml(merged),
      mimeType: 'text/yaml',
    });

    downloadBlob('api-spec-workspace.zip', createZipBlob(files));
  }
}
