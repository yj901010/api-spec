import { createContext, Suspense, lazy, useContext, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { DockviewReact, type DockviewApi, type DockviewIDisposable } from 'dockview';
import type { EndpointDocument, GeneratedTab } from '../types.js';
import { Store, createEmptyDocumentTemplate, createSnapshot, exportWorkspace } from '../state/store.js';
import { maskSensitiveText, maskVariants } from '../core/mask.js';
import { useStoreSnapshot } from './use-store-snapshot.js';
import { getActiveResultText } from './result-text.js';
import { deriveCodeMirrorSelection, listWorkbenchIssues, restoreDocumentFromSnapshot } from './workbench-helpers.js';
import { ChangeReportView } from './change-report-view.js';
import { clearDockviewLayout, loadDockviewLayout, saveDockviewLayout } from './dockview-layout.js';
import {
  addDocumentParam,
  applyQuickImportToWorkspace,
  updateDocumentSchemaOverride,
  type QuickImportFormat,
  type QuickImportResult,
} from './workbench-actions.js';

const LazyCodeMirrorEditor = lazy(async () => {
  const module = await import('./codemirror-editor.js');
  return { default: module.CodeMirrorEditor };
});

const RESULT_TABS: Array<{ id: GeneratedTab; label: string }> = [
  { id: 'request-spec', label: 'Request Spec' },
  { id: 'response-spec', label: 'Response Spec' },
  { id: 'controller', label: 'Controller' },
  { id: 'dto', label: 'DTO' },
  { id: 'openapi', label: 'OpenAPI' },
  { id: 'json-schema', label: 'JSON Schema' },
  { id: 'changes', label: 'Changes' },
];

const TYPE_OPTIONS = ['string', 'number', 'boolean', 'object', 'array<string>', 'array<number>', 'array<boolean>', 'array<object>', 'mixed', 'null'];
const WorkbenchStoreContext = createContext<Store | null>(null);

function preloadCodeMirrorEditor(): void {
  void import('./codemirror-editor.js');
}

function useWorkbenchStore(): Store {
  const store = useContext(WorkbenchStoreContext);
  if (!store) {
    throw new Error('Workbench store context is missing.');
  }
  return store;
}

function EditorSkeleton() {
  return (
    <div className="alpha-editor-skeleton" aria-hidden="true">
      <div className="alpha-editor-skeleton-bar" />
      <div className="alpha-editor-skeleton-lines">
        {Array.from({ length: 10 }, (_, index) => (
          <div key={index} className="alpha-editor-skeleton-line" />
        ))}
      </div>
    </div>
  );
}

function downloadText(filename: string, content: string, mimeType = 'application/json'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function updateActiveDocument(store: Store, updater: (document: EndpointDocument) => void): void {
  store.update((draft) => {
    const document = draft.documents.find((candidate) => candidate.id === draft.activeDocumentId);
    if (document) {
      updater(document);
    }
  });
}

function ExplorerPanel() {
  const store = useWorkbenchStore();
  const snapshot = useStoreSnapshot(store);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const filtered = snapshot.workspace.documents.filter((document) => {
    const needle = deferredQuery.trim().toLowerCase();
    if (!needle) return true;
    return [
      document.name,
      `${document.endpoint.basePath}${document.endpoint.endpointPath}`,
      document.tags.join(' '),
    ].join(' ').toLowerCase().includes(needle);
  });

  return (
    <div className="alpha-panel alpha-panel-fill">
      <div className="alpha-panel-header">
        <div>
          <div className="alpha-eyebrow">Workspace</div>
          <h3>Endpoints</h3>
        </div>
        <button
          type="button"
          className="ghost-button small-button"
          onClick={() => {
            store.update((draft) => {
              const document = createEmptyDocumentTemplate();
              draft.documents.push(document);
              draft.activeDocumentId = document.id;
            });
          }}
        >
          New
        </button>
      </div>
      <div className="alpha-panel-body">
        <input
          type="text"
          className="alpha-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search endpoints"
          aria-label="Search endpoints"
        />

        <div className="alpha-endpoint-list">
          {filtered.map((document) => {
            const active = document.id === snapshot.workspace.activeDocumentId;
            return (
              <button
                key={document.id}
                type="button"
                className={active ? 'alpha-endpoint-card alpha-endpoint-card-active' : 'alpha-endpoint-card'}
                onClick={() => {
                  store.update((draft) => {
                    draft.activeDocumentId = document.id;
                  });
                }}
              >
                <span className="alpha-endpoint-method">{document.endpoint.httpMethod}</span>
                <span className="alpha-endpoint-name">{document.name}</span>
                <span className="alpha-endpoint-path">{document.endpoint.basePath}{document.endpoint.endpointPath}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EditorsPanel() {
  const store = useWorkbenchStore();
  const snapshot = useStoreSnapshot(store);
  const selectedIssue = snapshot.activeDocument.selectedIssue;
  const requestIssue = selectedIssue?.target === 'request' ? snapshot.requestAnalysis.issues[selectedIssue.index] : undefined;
  const responseIssue = selectedIssue?.target === 'response' ? snapshot.responseAnalysis.issues[selectedIssue.index] : undefined;
  const requestSelection = deriveCodeMirrorSelection(requestIssue, selectedIssue ? `request-${selectedIssue.index}` : undefined);
  const responseSelection = deriveCodeMirrorSelection(responseIssue, selectedIssue ? `response-${selectedIssue.index}` : undefined);

  useEffect(() => {
    preloadCodeMirrorEditor();
  }, []);

  return (
    <div className="alpha-panel alpha-panel-fill">
      <div className="alpha-panel-header">
        <div>
          <div className="alpha-eyebrow">Editor</div>
          <h3>{snapshot.activeDocument.name}</h3>
        </div>
        <div className="alpha-meta">{snapshot.requestAnalysis.issues.length + snapshot.responseAnalysis.issues.length} issues</div>
      </div>
      <div className="alpha-panel-body">
        <div className="alpha-editors">
          <section className="alpha-editor-card">
            <header className="alpha-editor-title">Request Example</header>
            <Suspense fallback={<EditorSkeleton />}>
              <LazyCodeMirrorEditor
                ariaLabel="Request example editor"
                value={snapshot.activeDocument.requestRaw}
                selection={requestSelection}
                onChange={(value) => {
                  updateActiveDocument(store, (document) => {
                    document.requestRaw = value;
                    document.selectedIssue = undefined;
                  });
                }}
              />
            </Suspense>
          </section>

          <section className="alpha-editor-card">
            <header className="alpha-editor-title">Response Example</header>
            <Suspense fallback={<EditorSkeleton />}>
              <LazyCodeMirrorEditor
                ariaLabel="Response example editor"
                value={snapshot.activeDocument.responseRaw}
                selection={responseSelection}
                onChange={(value) => {
                  updateActiveDocument(store, (document) => {
                    document.responseRaw = value;
                    document.selectedIssue = undefined;
                  });
                }}
              />
            </Suspense>
          </section>
        </div>
      </div>
    </div>
  );
}

function OutputPanel() {
  const store = useWorkbenchStore();
  const snapshot = useStoreSnapshot(store);

  return (
    <div className="alpha-panel alpha-panel-fill">
      <div className="alpha-panel-header">
        <div>
          <div className="alpha-eyebrow">Generated</div>
          <h3>Artifacts</h3>
        </div>
        <button
          type="button"
          className="ghost-button small-button"
          onClick={async () => {
            await navigator.clipboard.writeText(getActiveResultText(snapshot));
          }}
        >
          Copy
        </button>
      </div>
      <div className="alpha-panel-body">
        <div className="alpha-tab-row" role="tablist" aria-label="Generated outputs">
          {RESULT_TABS.map((tab) => {
            const active = snapshot.activeDocument.activeResultTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={active ? 'alpha-tab alpha-tab-active' : 'alpha-tab'}
                role="tab"
                aria-selected={active}
                onClick={() => {
                  updateActiveDocument(store, (document) => {
                    document.activeResultTab = tab.id;
                  });
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        {snapshot.activeDocument.activeResultTab === 'changes'
          ? <ChangeReportView report={snapshot.changeReport} />
          : <pre className="alpha-output">{getActiveResultText(snapshot)}</pre>}
      </div>
    </div>
  );
}

function IssuesPanel() {
  const store = useWorkbenchStore();
  const snapshot = useStoreSnapshot(store);
  const issues = useMemo(() => listWorkbenchIssues(snapshot).slice(0, 20), [snapshot]);

  return (
    <div className="alpha-panel alpha-panel-fill">
      <div className="alpha-panel-header">
        <div>
          <div className="alpha-eyebrow">Diagnostics</div>
          <h3>Issues</h3>
        </div>
        <div className="alpha-meta">{issues.length} shown</div>
      </div>
      <div className="alpha-panel-body">
        <div className="alpha-issue-list">
          {issues.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`alpha-issue alpha-issue-${item.issue.level}`}
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                updateActiveDocument(store, (document) => {
                  document.selectedIssue = { target: item.target, index: item.index };
                });
              }}
            >
              <div className="alpha-issue-code">{item.issue.code}</div>
              <div className="alpha-issue-message">{item.issue.message}</div>
              <div className="alpha-issue-meta">
                {item.target} @ {item.issue.range.start.line}:{item.issue.range.start.column}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function InspectorPanel() {
  const store = useWorkbenchStore();
  const snapshot = useStoreSnapshot(store);
  const activeDocument = snapshot.activeDocument;
  const activePreset = snapshot.activePreset;
  const [importFormat, setImportFormat] = useState<QuickImportFormat>('curl');
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState<string>('');

  return (
    <div className="alpha-panel alpha-panel-fill">
      <div className="alpha-panel-header alpha-panel-header-sticky">
        <div>
          <div className="alpha-eyebrow">Inspector</div>
          <h3>Config and Snapshots</h3>
        </div>
      </div>
      <div className="alpha-panel-body">
      <section className="alpha-section">
        <div className="alpha-section-title">Endpoint</div>
        <div className="alpha-form-grid">
          <label className="alpha-field">
            <span>Name</span>
            <input
              value={activeDocument.name}
              onChange={(event) => updateActiveDocument(store, (document) => {
                document.name = event.target.value;
              })}
            />
          </label>
          <label className="alpha-field">
            <span>Method</span>
            <select
              value={activeDocument.endpoint.httpMethod}
              onChange={(event) => updateActiveDocument(store, (document) => {
                document.endpoint.httpMethod = event.target.value as typeof document.endpoint.httpMethod;
              })}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
          </label>
          <label className="alpha-field alpha-field-span-2">
            <span>Base Path</span>
            <input
              value={activeDocument.endpoint.basePath}
              onChange={(event) => updateActiveDocument(store, (document) => {
                document.endpoint.basePath = event.target.value;
              })}
            />
          </label>
          <label className="alpha-field alpha-field-span-2">
            <span>Endpoint Path</span>
            <input
              value={activeDocument.endpoint.endpointPath}
              onChange={(event) => updateActiveDocument(store, (document) => {
                document.endpoint.endpointPath = event.target.value;
              })}
            />
          </label>
          <label className="alpha-field">
            <span>Request Mode</span>
            <select
              value={activeDocument.requestMode}
              onChange={(event) => updateActiveDocument(store, (document) => {
                document.requestMode = event.target.value as typeof document.requestMode;
              })}
            >
              <option value="json">json</option>
              <option value="form-urlencoded">form-urlencoded</option>
              <option value="multipart/form-data">multipart/form-data</option>
              <option value="none">none</option>
            </select>
          </label>
          <label className="alpha-field">
            <span>Preset</span>
            <select
              value={snapshot.workspace.activePresetId}
              onChange={(event) => {
                store.update((draft) => {
                  draft.activePresetId = event.target.value;
                });
              }}
            >
              {snapshot.workspace.presets.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.name}</option>
              ))}
            </select>
          </label>
          <label className="alpha-field alpha-field-span-2">
            <span>Tags</span>
            <input
              value={activeDocument.tags.join(', ')}
              onChange={(event) => updateActiveDocument(store, (document) => {
                document.tags = event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean);
              })}
            />
          </label>
        </div>
      </section>

      <section className="alpha-section">
        <div className="alpha-section-title">Preset</div>
        <div className="alpha-form-grid">
          <label className="alpha-field">
            <span>Preset Name</span>
            <input
              value={activePreset.name}
              onChange={(event) => {
                store.update((draft) => {
                  const preset = draft.presets.find((candidate) => candidate.id === draft.activePresetId);
                  if (preset) preset.name = event.target.value;
                });
              }}
            />
          </label>
          <label className="alpha-field">
            <span>Success Text</span>
            <input
              value={activePreset.successResponseText}
              onChange={(event) => {
                store.update((draft) => {
                  const preset = draft.presets.find((candidate) => candidate.id === draft.activePresetId);
                  if (preset) preset.successResponseText = event.target.value;
                });
              }}
            />
          </label>
          <label className="alpha-field">
            <span>Root Array</span>
            <select
              value={activePreset.rootArrayRequestStrategy}
              onChange={(event) => {
                store.update((draft) => {
                  const preset = draft.presets.find((candidate) => candidate.id === draft.activePresetId);
                  if (preset) preset.rootArrayRequestStrategy = event.target.value === 'wrap' ? 'wrap' : 'block';
                });
              }}
            >
              <option value="block">block</option>
              <option value="wrap">wrap</option>
            </select>
          </label>
          <label className="alpha-field">
            <span>Wrapper Field</span>
            <input
              value={activePreset.rootArrayWrapperField}
              onChange={(event) => {
                store.update((draft) => {
                  const preset = draft.presets.find((candidate) => candidate.id === draft.activePresetId);
                  if (preset) preset.rootArrayWrapperField = event.target.value;
                });
              }}
            />
          </label>
          <label className="alpha-field">
            <span>DTO Suffix</span>
            <input
              value={activePreset.dtoSuffix}
              onChange={(event) => {
                store.update((draft) => {
                  const preset = draft.presets.find((candidate) => candidate.id === draft.activePresetId);
                  if (preset) preset.dtoSuffix = event.target.value;
                });
              }}
            />
          </label>
          <label className="alpha-field">
            <span>Body Variable</span>
            <input
              value={activePreset.requestBodyVariableName}
              onChange={(event) => {
                store.update((draft) => {
                  const preset = draft.presets.find((candidate) => candidate.id === draft.activePresetId);
                  if (preset) preset.requestBodyVariableName = event.target.value;
                });
              }}
            />
          </label>
          <label className="alpha-field alpha-field-span-2">
            <span>OpenAPI Title</span>
            <input
              value={activePreset.openApiTitle}
              onChange={(event) => {
                store.update((draft) => {
                  const preset = draft.presets.find((candidate) => candidate.id === draft.activePresetId);
                  if (preset) preset.openApiTitle = event.target.value;
                });
              }}
            />
          </label>
          <label className="alpha-field">
            <span>OpenAPI Version</span>
            <input
              value={activePreset.openApiVersion}
              onChange={(event) => {
                store.update((draft) => {
                  const preset = draft.presets.find((candidate) => candidate.id === draft.activePresetId);
                  if (preset) preset.openApiVersion = event.target.value;
                });
              }}
            />
          </label>
          <label className="alpha-field">
            <span>Server URL</span>
            <input
              value={activePreset.serverUrl}
              onChange={(event) => {
                store.update((draft) => {
                  const preset = draft.presets.find((candidate) => candidate.id === draft.activePresetId);
                  if (preset) preset.serverUrl = event.target.value;
                });
              }}
            />
          </label>
        </div>
        <div className="alpha-inline-actions">
          <label className="alpha-checkbox">
            <input
              type="checkbox"
              checked={activePreset.includeLombok}
              onChange={(event) => {
                store.update((draft) => {
                  const preset = draft.presets.find((candidate) => candidate.id === draft.activePresetId);
                  if (preset) preset.includeLombok = event.target.checked;
                });
              }}
            />
            <span>Include Lombok</span>
          </label>
          <label className="alpha-checkbox">
            <input
              type="checkbox"
              checked={activePreset.addSwaggerAnnotations}
              onChange={(event) => {
                store.update((draft) => {
                  const preset = draft.presets.find((candidate) => candidate.id === draft.activePresetId);
                  if (preset) preset.addSwaggerAnnotations = event.target.checked;
                });
              }}
            />
            <span>Add Swagger</span>
          </label>
        </div>
      </section>

      <section className="alpha-section">
        <div className="alpha-section-title">Params</div>
        <div className="alpha-param-list">
          {activeDocument.params.length === 0 ? (
            <div className="alpha-empty">No params yet.</div>
          ) : (
            activeDocument.params.map((param) => (
              <div key={param.id} className="alpha-param-card">
                <div className="alpha-param-grid">
                  <label className="alpha-field">
                    <span>Name</span>
                    <input
                      value={param.name}
                      onChange={(event) => updateActiveDocument(store, (document) => {
                        const current = document.params.find((candidate) => candidate.id === param.id);
                        if (current) current.name = event.target.value;
                      })}
                    />
                  </label>
                  <label className="alpha-field">
                    <span>Source</span>
                    <select
                      value={param.source}
                      onChange={(event) => updateActiveDocument(store, (document) => {
                        const current = document.params.find((candidate) => candidate.id === param.id);
                        if (current) current.source = event.target.value as typeof current.source;
                      })}
                    >
                      <option value="query">query</option>
                      <option value="path">path</option>
                      <option value="header">header</option>
                    </select>
                  </label>
                  <label className="alpha-field">
                    <span>Java Type</span>
                    <select
                      value={param.javaType}
                      onChange={(event) => updateActiveDocument(store, (document) => {
                        const current = document.params.find((candidate) => candidate.id === param.id);
                        if (current) current.javaType = event.target.value as typeof current.javaType;
                      })}
                    >
                      <option value="String">String</option>
                      <option value="int">int</option>
                      <option value="long">long</option>
                      <option value="double">double</option>
                      <option value="boolean">boolean</option>
                      <option value="Object">Object</option>
                    </select>
                  </label>
                  <label className="alpha-field">
                    <span>Sample</span>
                    <input
                      value={param.sampleValue ?? ''}
                      onChange={(event) => updateActiveDocument(store, (document) => {
                        const current = document.params.find((candidate) => candidate.id === param.id);
                        if (current) current.sampleValue = event.target.value;
                      })}
                    />
                  </label>
                  <label className="alpha-field alpha-field-span-2">
                    <span>Description</span>
                    <input
                      value={param.description ?? ''}
                      onChange={(event) => updateActiveDocument(store, (document) => {
                        const current = document.params.find((candidate) => candidate.id === param.id);
                        if (current) current.description = event.target.value;
                      })}
                    />
                  </label>
                </div>
                <div className="alpha-inline-actions">
                  <label className="alpha-checkbox">
                    <input
                      type="checkbox"
                      checked={param.required}
                      onChange={(event) => updateActiveDocument(store, (document) => {
                        const current = document.params.find((candidate) => candidate.id === param.id);
                        if (current) current.required = event.target.checked;
                      })}
                    />
                    <span>Required</span>
                  </label>
                  <button
                    type="button"
                    className="ghost-button small-button"
                    onClick={() => updateActiveDocument(store, (document) => {
                      document.params = document.params.filter((candidate) => candidate.id !== param.id);
                    })}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="alpha-inline-actions">
          <button
            type="button"
            className="ghost-button small-button"
            onClick={() => updateActiveDocument(store, (document) => {
              addDocumentParam(document);
            })}
          >
            Add param
          </button>
        </div>
      </section>

      <section className="alpha-section">
        <div className="alpha-section-title">Quick Import</div>
        <div className="alpha-form-grid">
          <label className="alpha-field">
            <span>Format</span>
            <select value={importFormat} onChange={(event) => setImportFormat(event.target.value as QuickImportFormat)}>
              <option value="curl">cURL</option>
              <option value="http">Raw HTTP</option>
              <option value="postman">Postman</option>
              <option value="openapi">OpenAPI</option>
            </select>
          </label>
          <div className="alpha-field alpha-field-span-2">
            <span>Paste source</span>
            <textarea
              className="alpha-textarea"
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder="Paste cURL, raw HTTP, Postman JSON, or OpenAPI JSON here."
            />
          </div>
        </div>
        <div className="alpha-inline-actions">
          <button
            type="button"
            className="ghost-button small-button"
            onClick={() => {
              let result: QuickImportResult | undefined;
              store.update((draft) => {
                result = applyQuickImportToWorkspace(draft, importText, importFormat, false);
              });
              setImportStatus(result?.error ?? 'Imported into the active document.');
            }}
          >
            Replace current
          </button>
          <button
            type="button"
            className="ghost-button small-button"
            onClick={() => {
              let result: QuickImportResult | undefined;
              store.update((draft) => {
                result = applyQuickImportToWorkspace(draft, importText, importFormat, true);
              });
              setImportStatus(result?.error ?? 'Imported as new document(s).');
            }}
          >
            Add as new
          </button>
        </div>
        {importStatus ? <div className="alpha-status">{importStatus}</div> : null}
      </section>

      <section className="alpha-section">
        <div className="alpha-section-title">Schema Overrides</div>
        <div className="alpha-schema-sections">
          {([
            { scope: 'request', title: 'Request Spec', rows: snapshot.requestAnalysis.schema.rows },
            { scope: 'response', title: 'Response Spec', rows: snapshot.responseAnalysis.schema.rows },
          ] as const).map((section) => (
            <div key={section.scope} className="alpha-schema-block">
              <div className="alpha-inline-heading">
                <strong>{section.title}</strong>
                <button
                  type="button"
                  className="ghost-button small-button"
                  onClick={() => updateActiveDocument(store, (document) => {
                    document.activeResultTab = section.scope === 'request' ? 'request-spec' : 'response-spec';
                  })}
                >
                  Open tab
                </button>
              </div>
              <div className="alpha-schema-list">
                {section.rows.length === 0 ? (
                  <div className="alpha-empty">No fields extracted yet.</div>
                ) : (
                  section.rows.map((row) => (
                    <div key={`${section.scope}-${row.path}`} className="alpha-schema-card">
                      <div className="alpha-schema-header">
                        <code>{row.path}</code>
                        {row.type !== row.inferredType ? <span className="alpha-meta">inferred: {row.inferredType}</span> : null}
                      </div>
                      <div className="alpha-param-grid">
                        <label className="alpha-field">
                          <span>Type</span>
                          <select
                            value={row.type}
                            onChange={(event) => updateActiveDocument(store, (document) => {
                              updateDocumentSchemaOverride(document, section.scope, row.path, 'type', event.target.value);
                            })}
                          >
                            {TYPE_OPTIONS.map((type) => <option key={type} value={type}>{type}</option>)}
                          </select>
                        </label>
                        <label className="alpha-field">
                          <span>Format</span>
                          <input
                            value={row.format ?? ''}
                            onChange={(event) => updateActiveDocument(store, (document) => {
                              updateDocumentSchemaOverride(document, section.scope, row.path, 'format', event.target.value);
                            })}
                          />
                        </label>
                        <label className="alpha-field alpha-field-span-2">
                          <span>Description</span>
                          <input
                            value={row.description ?? ''}
                            onChange={(event) => updateActiveDocument(store, (document) => {
                              updateDocumentSchemaOverride(document, section.scope, row.path, 'description', event.target.value);
                            })}
                          />
                        </label>
                        <label className="alpha-field">
                          <span>Enum</span>
                          <input
                            value={(row.enumValues ?? []).join(', ')}
                            onChange={(event) => updateActiveDocument(store, (document) => {
                              updateDocumentSchemaOverride(document, section.scope, row.path, 'enumValues', event.target.value);
                            })}
                          />
                        </label>
                        <label className="alpha-field">
                          <span>Example</span>
                          <input
                            value={row.example ?? ''}
                            onChange={(event) => updateActiveDocument(store, (document) => {
                              updateDocumentSchemaOverride(document, section.scope, row.path, 'example', event.target.value);
                            })}
                          />
                        </label>
                      </div>
                      <div className="alpha-inline-actions">
                        <label className="alpha-checkbox">
                          <input
                            type="checkbox"
                            checked={row.required}
                            onChange={(event) => updateActiveDocument(store, (document) => {
                              updateDocumentSchemaOverride(document, section.scope, row.path, 'required', event.target.checked);
                            })}
                          />
                          <span>Required</span>
                        </label>
                        <label className="alpha-checkbox">
                          <input
                            type="checkbox"
                            checked={row.nullable}
                            onChange={(event) => updateActiveDocument(store, (document) => {
                              updateDocumentSchemaOverride(document, section.scope, row.path, 'nullable', event.target.checked);
                            })}
                          />
                          <span>Nullable</span>
                        </label>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="alpha-section">
        <div className="alpha-section-title">Actions</div>
        <div className="alpha-action-grid">
          <button
            type="button"
            className="ghost-button small-button"
            onClick={() => {
              updateActiveDocument(store, (document) => {
                const snapshotRecord = createSnapshot(document);
                document.snapshots.unshift(snapshotRecord);
                document.compareSnapshotId = snapshotRecord.id;
                document.activeResultTab = 'changes';
              });
            }}
          >
            Save snapshot
          </button>
          <button
            type="button"
            className="ghost-button small-button"
            onClick={() => {
              updateActiveDocument(store, (document) => {
                document.requestRaw = maskSensitiveText(document.requestRaw);
                document.responseRaw = maskSensitiveText(document.responseRaw);
                document.requestVariants = maskVariants(document.requestVariants);
                document.responseVariants = maskVariants(document.responseVariants);
              });
            }}
          >
            Mask data
          </button>
          <button
            type="button"
            className="ghost-button small-button"
            onClick={() => {
              downloadText('api-spec-workspace.json', exportWorkspace(snapshot.workspace));
            }}
          >
            Export workspace
          </button>
          <button
            type="button"
            className="ghost-button small-button"
            onClick={async () => {
              await navigator.clipboard.writeText(getActiveResultText(snapshot));
            }}
          >
            Copy result
          </button>
        </div>
      </section>

      <section className="alpha-section alpha-section-fill">
        <div className="alpha-section-title">Snapshots</div>
        <div className="alpha-snapshot-list">
          {activeDocument.snapshots.length === 0 ? (
            <div className="alpha-empty">No snapshots yet.</div>
          ) : (
            activeDocument.snapshots.map((snapshotItem) => {
              const selected = activeDocument.compareSnapshotId === snapshotItem.id;
              return (
                <article key={snapshotItem.id} className={selected ? 'alpha-snapshot alpha-snapshot-active' : 'alpha-snapshot'}>
                  <div className="alpha-snapshot-title">{snapshotItem.name}</div>
                  <div className="alpha-snapshot-meta">{snapshotItem.createdAt}</div>
                  <div className="alpha-inline-actions">
                    <button
                      type="button"
                      className="ghost-button small-button"
                      onClick={() => {
                        updateActiveDocument(store, (document) => {
                          document.compareSnapshotId = snapshotItem.id;
                          document.activeResultTab = 'changes';
                        });
                      }}
                    >
                      Compare
                    </button>
                    <button
                      type="button"
                      className="ghost-button small-button"
                      onClick={() => {
                        updateActiveDocument(store, (document) => {
                          restoreDocumentFromSnapshot(document, snapshotItem);
                        });
                      }}
                    >
                      Restore
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>
      </div>
    </div>
  );
}

const panelComponents = {
  explorer: ExplorerPanel,
  editors: EditorsPanel,
  output: OutputPanel,
  issues: IssuesPanel,
  inspector: InspectorPanel,
};

interface DockviewWorkbenchProps {
  store: Store;
  hidden: boolean;
}

function createDefaultAlphaPanels(api: DockviewApi): void {
  api.addPanel({
    id: 'editors',
    component: 'editors',
    title: 'Editors',
  });
  api.addPanel({
    id: 'explorer',
    component: 'explorer',
    title: 'Explorer',
    position: {
      referencePanel: 'editors',
      direction: 'left',
    },
  });
  api.addPanel({
    id: 'inspector',
    component: 'inspector',
    title: 'Inspector',
    position: {
      referencePanel: 'explorer',
      direction: 'below',
    },
  });
  api.addPanel({
    id: 'output',
    component: 'output',
    title: 'Output',
    position: {
      referencePanel: 'editors',
      direction: 'right',
    },
  });
  api.addPanel({
    id: 'issues',
    component: 'issues',
    title: 'Issues',
    position: {
      referencePanel: 'output',
      direction: 'below',
    },
  });
}

export function DockviewWorkbench({ store, hidden }: DockviewWorkbenchProps) {
  const initializedRef = useRef(false);
  const layoutListenerRef = useRef<DockviewIDisposable | null>(null);

  useEffect(() => {
    return () => {
      layoutListenerRef.current?.dispose();
      layoutListenerRef.current = null;
      initializedRef.current = false;
    };
  }, []);

  return (
    <WorkbenchStoreContext.Provider value={store}>
      <div className={hidden ? 'alpha-shell alpha-shell-hidden' : 'alpha-shell'}>
        <DockviewReact
          className="dockview-theme-abyss alpha-dockview"
          components={panelComponents}
          onReady={(event) => {
            if (initializedRef.current) return;
            initializedRef.current = true;

            const savedLayout = loadDockviewLayout();
            if (savedLayout) {
              try {
                event.api.fromJSON(savedLayout);
              } catch {
                clearDockviewLayout();
                createDefaultAlphaPanels(event.api);
              }
            } else {
              createDefaultAlphaPanels(event.api);
            }

            saveDockviewLayout(event.api.toJSON());
            layoutListenerRef.current?.dispose();
            layoutListenerRef.current = event.api.onDidLayoutChange(() => {
              saveDockviewLayout(event.api.toJSON());
            });
          }}
        />
      </div>
    </WorkbenchStoreContext.Provider>
  );
}
