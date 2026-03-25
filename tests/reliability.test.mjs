import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeInput } from '../build/core/analyzer.js';
import { maskSensitiveText, maskVariants } from '../build/core/mask.js';
import { renderAxiosSnippet } from '../build/core/http-client.js';
import { buildJsonSchema } from '../build/core/json-schema.js';
import { applyOpenApiImport } from '../build/core/openapi-import.js';
import {
  canTogglePanel,
  computeIssueSelection,
  computeWorkspaceColumns,
  describePanelState,
  describeSplitterState,
  nudgeLayoutWithKeyboard,
  renderGutterHtml,
} from '../build/ui/helpers.js';
import { renderDocumentList, renderTabs } from '../build/ui/renderers.js';
import { Store, createSnapshot, exportWorkspace } from '../build/state/store.js';
import { truncate } from '../build/utils/strings.js';
import { addDocumentParam, applyQuickImportToWorkspace, updateDocumentSchemaOverride } from '../build/web/workbench-actions.js';
import { loadDockviewLayout, saveDockviewLayout } from '../build/web/dockview-layout.js';
import { deriveCodeMirrorSelection, listWorkbenchIssues, restoreDocumentFromSnapshot } from '../build/web/workbench-helpers.js';

function createMemoryStorage(initial = new Map()) {
  const storage = initial;
  return {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
    clear() {
      storage.clear();
    },
    dump() {
      return new Map(storage);
    },
  };
}

test('analyzeInput reports stable line and column for invalid object entry', () => {
  const result = analyzeInput(
    `{
  "alpha": 1,
  "beta" 2
}`,
    'request',
  );

  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]?.code, 'INVALID_COLON');
  assert.equal(result.issues[0]?.range.start.line, 3);
  assert.equal(result.issues[0]?.range.start.column, 3);
});

test('analyzeInput de-duplicates repeated mismatch issues', () => {
  const result = analyzeInput(
    `{
  "items": [1, 2, 3}
}`,
    'request',
  );

  const mismatchIssues = result.issues.filter((issue) => issue.code === 'MISMATCH_BRACE');
  assert.equal(mismatchIssues.length, 1);
  assert.equal(mismatchIssues[0]?.range.start.line, 2);
  assert.equal(mismatchIssues[0]?.range.start.column, 20);
});

test('maskSensitiveText and maskVariants redact common secrets consistently', () => {
  const raw = JSON.stringify(
    {
      email: 'user@example.com',
      phone: '01012341234',
      card: '1234567890123456',
      authorization: 'Bearer abcdefghijklmnopqrstuvwxyz',
      accessToken: 'token-value',
      note: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
    },
    null,
    2,
  );

  const masked = maskSensitiveText(raw);
  const maskedVariants = maskVariants([{ id: 'v1', name: 'Variant 1', enabled: true, raw }]);

  assert.doesNotMatch(masked, /user@example\.com/);
  assert.match(masked, /masked@example\.com/);
  assert.match(masked, /010-\*\*\*\*-\*\*\*\*/);
  assert.match(masked, /12\*{8}56/);
  assert.match(masked, /"authorization": "\*\*\*MASKED\*\*\*"/);
  assert.match(masked, /Authorization: Bearer \*\*\*MASKED\*\*\*/);
  assert.match(masked, /"\s*accessToken"\s*:\s*"\*\*\*MASKED\*\*\*"/);
  assert.equal(maskedVariants[0]?.id, 'v1');
  assert.notEqual(maskedVariants[0]?.raw, raw);
});

test('Store keeps working when localStorage persistence is blocked', () => {
  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {},
    clear() {},
  };

  try {
    const store = new Store();
    store.update((draft) => {
      draft.documents[0].name = 'Offline Safe';
    });
    store.replace({
      ...store.snapshot().workspace,
      documents: [
        {
          ...store.snapshot().workspace.documents[0],
          name: 'Replace Safe',
        },
      ],
      activeDocumentId: store.snapshot().workspace.documents[0].id,
    });
    store.reset();

    assert.ok(store.snapshot().workspace.documents.length > 0);
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test('workspace export and replace round-trip preserves core document state', () => {
  const originalLocalStorage = globalThis.localStorage;
  const storage = createMemoryStorage();
  globalThis.localStorage = storage;

  try {
    const sourceStore = new Store();
    sourceStore.update((draft) => {
      draft.documents[0].name = 'Round Trip';
      draft.documents[0].requestRaw = '{"userId":99}';
      draft.documents[0].responseRaw = '{"success":false}';
      draft.documents[0].requestMode = 'form-urlencoded';
      draft.documents[0].tags = ['qa', 'roundtrip'];
      draft.layout.collapsedPanels.left = true;
      draft.layout.editorSplit = 61;
    });

    const exported = exportWorkspace(sourceStore.snapshot().workspace);

    const targetStorage = createMemoryStorage();
    globalThis.localStorage = targetStorage;
    const targetStore = new Store();
    targetStore.replace(JSON.parse(exported));
    const snapshot = targetStore.snapshot();

    assert.equal(snapshot.activeDocument.name, 'Round Trip');
    assert.equal(snapshot.activeDocument.requestRaw, '{"userId":99}');
    assert.equal(snapshot.activeDocument.responseRaw, '{"success":false}');
    assert.equal(snapshot.activeDocument.requestMode, 'form-urlencoded');
    assert.deepEqual(snapshot.activeDocument.tags, ['qa', 'roundtrip']);
    assert.equal(snapshot.workspace.layout.collapsedPanels.left, true);
    assert.equal(snapshot.workspace.layout.editorSplit, 61);
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test('Store migrates legacy workspace shape into current multi-document state', () => {
  const originalLocalStorage = globalThis.localStorage;
  const storage = createMemoryStorage(
    new Map([
      [
        'api-spec-studio.workspace.v3',
        JSON.stringify({
          requestRaw: '{"legacy":true}',
          responseRaw: '{"ok":true}',
          endpoint: {
            endpointPath: '/legacy',
            httpMethod: 'GET',
          },
          params: [{ name: 'traceId', source: 'header', javaType: 'String', required: false }],
          activeResultTab: 'openapi',
        }),
      ],
    ]),
  );
  globalThis.localStorage = storage;

  try {
    const store = new Store();
    const snapshot = store.snapshot();

    assert.equal(snapshot.workspace.documents.length, 1);
    assert.equal(snapshot.activeDocument.requestRaw, '{"legacy":true}');
    assert.equal(snapshot.activeDocument.responseRaw, '{"ok":true}');
    assert.equal(snapshot.activeDocument.endpoint.endpointPath, '/legacy');
    assert.equal(snapshot.activeDocument.endpoint.httpMethod, 'GET');
    assert.equal(snapshot.activeDocument.activeResultTab, 'openapi');
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test('Store snapshot stays referentially stable until workspace changes', () => {
  const store = new Store();
  const first = store.snapshot();
  const second = store.snapshot();

  assert.equal(first, second);

  store.update((draft) => {
    draft.documents[0].name = 'Changed';
  });

  const third = store.snapshot();
  assert.notEqual(first, third);
  assert.equal(third.activeDocument.name, 'Changed');
});

test('applyQuickImportToWorkspace reports empty input and can replace from curl', () => {
  const store = new Store();
  const workspace = structuredClone(store.snapshot().workspace);

  const empty = applyQuickImportToWorkspace(workspace, '   ', 'curl', false);
  assert.equal(empty.changed, false);
  assert.match(empty.error ?? '', /empty/i);

  const replaced = applyQuickImportToWorkspace(
    workspace,
    `curl -X POST "http://localhost/orders/42?status=READY" -H "Content-Type: application/json" -d "{\"name\":\"neo\"}"`,
    'curl',
    false,
  );

  assert.equal(replaced.changed, true);
  assert.equal(workspace.documents[0]?.endpoint.httpMethod, 'POST');
  assert.equal(workspace.documents[0]?.endpoint.endpointPath, '/orders/{orderId}');
  assert.equal(workspace.documents[0]?.requestMode, 'json');
  assert.equal(workspace.documents[0]?.params.some((param) => param.name === 'status' && param.source === 'query'), true);
});

test('addDocumentParam appends a default editable param', () => {
  const store = new Store();
  const document = structuredClone(store.snapshot().activeDocument);
  const before = document.params.length;

  addDocumentParam(document);

  assert.equal(document.params.length, before + 1);
  assert.equal(document.params.at(-1)?.name, 'newParam');
  assert.equal(document.params.at(-1)?.source, 'query');
});

test('updateDocumentSchemaOverride stores typed override fields on the document', () => {
  const store = new Store();
  const document = structuredClone(store.snapshot().activeDocument);

  updateDocumentSchemaOverride(document, 'request', 'items[].price', 'type', 'number');
  updateDocumentSchemaOverride(document, 'request', 'items[].price', 'required', true);
  updateDocumentSchemaOverride(document, 'request', 'items[].price', 'nullable', true);
  updateDocumentSchemaOverride(document, 'request', 'items[].price', 'format', 'int64');
  updateDocumentSchemaOverride(document, 'request', 'items[].price', 'description', 'Unit price');
  updateDocumentSchemaOverride(document, 'request', 'items[].price', 'enumValues', '100, 200');
  updateDocumentSchemaOverride(document, 'request', 'items[].price', 'example', '100');

  assert.deepEqual(document.schemaOverrides.request['items[].price'], {
    path: 'items[].price',
    type: 'number',
    required: true,
    nullable: true,
    format: 'int64',
    description: 'Unit price',
    enumValues: ['100', '200'],
    example: '100',
  });
});

test('renderAxiosSnippet avoids duplicate query serialization and uses encoded body types', () => {
  const snippet = renderAxiosSnippet(
    {
      id: 'doc-1',
      name: 'Submit Order',
      requestRaw: '{"status":"READY"}',
      responseRaw: '{"ok":true}',
      requestVariants: [],
      responseVariants: [],
      endpoint: {
        packageName: 'com.example.api',
        basePath: '/api',
        endpointPath: '/orders/{orderId}',
        httpMethod: 'POST',
        controllerClassName: 'OrderController',
        serviceClassName: 'OrderService',
        methodName: 'submitOrder',
      },
      params: [
        { id: 'p1', name: 'orderId', source: 'path', javaType: 'long', required: true, sampleValue: '1', description: '' },
        { id: 'p2', name: 'status', source: 'query', javaType: 'String', required: false, sampleValue: 'READY', description: '' },
      ],
      tags: [],
      requestMode: 'form-urlencoded',
      schemaOverrides: { request: {}, response: {} },
      snapshots: [],
      activeResultTab: 'axios',
    },
    {
      id: 'preset-1',
      name: 'Preset',
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
    },
  );

  assert.match(snippet, /const url = urlPath;/);
  assert.doesNotMatch(snippet, /query\.append/);
  assert.match(snippet, /const body = new URLSearchParams/);
  assert.match(snippet, /params: \{ status: params\.status \}/);
});

test('buildJsonSchema emits draft-2020-12 compatible nullable types', () => {
  const schema = buildJsonSchema(
    {
      name: 'email',
      path: 'email',
      type: 'string',
      required: false,
      nullable: true,
      description: 'Optional email',
      children: [],
    },
    'Nullable Field',
  );

  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.deepEqual(schema.type, ['string', 'null']);
  assert.equal('nullable' in schema, false);
});

test('createSnapshot is immutable and compare snapshot generates change report', () => {
  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = createMemoryStorage();

  try {
    const store = new Store();
    const document = store.snapshot().activeDocument;
    const snapshot = createSnapshot(document, 'Before');

    store.update((draft) => {
      draft.documents[0].snapshots.push(snapshot);
      draft.documents[0].requestRaw = '{"userId":"changed"}';
      draft.documents[0].compareSnapshotId = snapshot.id;
    });

    const current = store.snapshot();
    assert.equal(snapshot.state.requestRaw, document.requestRaw);
    assert.equal(current.changeReport?.snapshotName, 'Before');
    assert.ok(current.changeReport?.items.some((item) => item.scope === 'request'));
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test('invalid import input returns null without mutating template document', () => {
  const template = {
    id: 'doc-1',
    name: 'Template',
    requestRaw: '{"userId":10}',
    responseRaw: '{"ok":true}',
    requestVariants: [],
    responseVariants: [],
    endpoint: {
      packageName: 'com.example.api',
      basePath: '/api',
      endpointPath: '/orders/{orderId}',
      httpMethod: 'POST',
      controllerClassName: 'OrderController',
      serviceClassName: 'OrderService',
      methodName: 'saveOrder',
    },
    params: [],
    tags: ['keep'],
    requestMode: 'json',
    schemaOverrides: { request: {}, response: {} },
    snapshots: [],
    activeResultTab: 'openapi',
  };

  const before = JSON.stringify(template);
  const imported = applyOpenApiImport('not-json', template);

  assert.equal(imported, null);
  assert.equal(JSON.stringify(template), before);
});

test('Store preserves per-document active tabs and compare state across document switches', () => {
  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = createMemoryStorage();

  try {
    const store = new Store();
    const initial = store.snapshot();
    const firstId = initial.workspace.documents[0].id;
    const secondId = initial.workspace.documents[1].id;

    store.update((draft) => {
      draft.documents[0].activeResultTab = 'markdown';
      const snapshot = createSnapshot(draft.documents[0], 'Doc1');
      draft.documents[0].snapshots.push(snapshot);
      draft.documents[0].compareSnapshotId = snapshot.id;
      draft.documents[1].activeResultTab = 'openapi';
      draft.activeDocumentId = secondId;
    });

    let current = store.snapshot();
    assert.equal(current.activeDocument.id, secondId);
    assert.equal(current.activeDocument.activeResultTab, 'openapi');

    store.update((draft) => {
      draft.activeDocumentId = firstId;
    });

    current = store.snapshot();
    assert.equal(current.activeDocument.id, firstId);
    assert.equal(current.activeDocument.activeResultTab, 'markdown');
    assert.ok(current.changeReport);
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test('Store clamps malformed layout values during replace', () => {
  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = createMemoryStorage();

  try {
    const store = new Store();
    const base = store.snapshot().workspace;

    store.replace({
      ...base,
      layout: {
        columnSizes: [0, -20, 999],
        editorSplit: 999,
        collapsedPanels: { left: true, center: false, right: true },
        maximizedPanel: 'invalid',
        showOnlyDiffChanges: true,
      },
    });

    const snapshot = store.snapshot();
    assert.deepEqual(snapshot.workspace.layout.columnSizes, [35, 31, 999]);
    assert.equal(snapshot.workspace.layout.editorSplit, 80);
    assert.deepEqual(snapshot.workspace.layout.collapsedPanels, { left: true, center: false, right: true });
    assert.equal(snapshot.workspace.layout.maximizedPanel, null);
    assert.equal(snapshot.workspace.layout.showOnlyDiffChanges, true);
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test('Store repairs invalid active ids and empty collections on replace', () => {
  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = createMemoryStorage();

  try {
    const store = new Store();
    store.replace({
      documents: [],
      activeDocumentId: 'missing-doc',
      presets: [],
      activePresetId: 'missing-preset',
      layout: {
        columnSizes: [35, 31, 34],
        editorSplit: 52,
        collapsedPanels: { left: false, center: false, right: false },
        maximizedPanel: null,
        showOnlyDiffChanges: false,
      },
      lastSavedAt: 'legacy',
    });

    const snapshot = store.snapshot();
    assert.equal(snapshot.workspace.documents.length, 1);
    assert.equal(snapshot.workspace.activeDocumentId, snapshot.workspace.documents[0].id);
    assert.ok(snapshot.workspace.presets.length > 0);
    assert.equal(snapshot.workspace.activePresetId, snapshot.workspace.presets[0].id);
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test('renderGutterHtml marks highest severity and selected line', () => {
  const html = renderGutterHtml(
    'line1\nline2\nline3',
    [
      {
        target: 'request',
        level: 'warning',
        code: 'COMMENT_FOUND',
        message: 'warning',
        range: { start: { index: 0, line: 2, column: 1 }, end: { index: 1, line: 2, column: 2 } },
      },
      {
        target: 'request',
        level: 'error',
        code: 'INVALID_COLON',
        message: 'error',
        range: { start: { index: 0, line: 2, column: 1 }, end: { index: 1, line: 2, column: 2 } },
      },
    ],
    {
      target: 'request',
      level: 'error',
      code: 'INVALID_COLON',
      message: 'error',
      range: { start: { index: 0, line: 2, column: 1 }, end: { index: 1, line: 2, column: 2 } },
    },
  );

  assert.match(html, /gutter-error gutter-active/);
  assert.match(html, /gutter-line-no">2</);
  assert.match(html, /gutter-line-no">3</);
});

test('computeIssueSelection falls back when line-height is non-numeric', () => {
  const selection = computeIssueSelection(
    {
      target: 'request',
      level: 'error',
      code: 'INVALID_COLON',
      message: 'error',
      range: {
        start: { index: 10, line: 4, column: 3 },
        end: { index: 10, line: 4, column: 3 },
      },
    },
    'normal',
  );

  assert.deepEqual(selection, {
    selectionStart: 10,
    selectionEnd: 11,
    scrollTop: 40,
  });
});

test('computeWorkspaceColumns reflects maximized and collapsed layout state', () => {
  const normal = computeWorkspaceColumns({
    columnSizes: [35, 31, 34],
    editorSplit: 52,
    collapsedPanels: { left: false, center: false, right: false },
    maximizedPanel: null,
    showOnlyDiffChanges: false,
  });
  const maximized = computeWorkspaceColumns({
    columnSizes: [35, 31, 34],
    editorSplit: 52,
    collapsedPanels: { left: false, center: false, right: false },
    maximizedPanel: 'center',
    showOnlyDiffChanges: false,
  });
  const collapsed = computeWorkspaceColumns({
    columnSizes: [35, 31, 34],
    editorSplit: 52,
    collapsedPanels: { left: true, center: false, right: false },
    maximizedPanel: null,
    showOnlyDiffChanges: false,
  });

  assert.match(normal, /12px/);
  assert.match(maximized, /^0px 0px calc\(calc\(100% - 0px\) \* 1\.000000\) 0px 0px$/);
  assert.match(collapsed, /^0px 0px calc\(calc\(100% - 12px\) \* 0\.\d+\) 12px calc\(calc\(100% - 12px\) \* 0\.\d+\)$/);
});

test('dockview layout persistence round-trips valid layouts and ignores invalid ones', () => {
  const storage = createMemoryStorage();
  const layout = {
    grid: {
      root: {
        type: 'leaf',
        data: {
          views: ['editors'],
          activeView: 'editors',
          id: 'group-1',
        },
        size: 100,
      },
      height: 900,
      width: 1400,
      orientation: 'horizontal',
    },
    panels: {
      editors: {
        id: 'editors',
        contentComponent: 'editors',
        title: 'Editors',
      },
    },
    activeGroup: 'group-1',
  };

  assert.equal(saveDockviewLayout(layout, storage), true);
  assert.deepEqual(loadDockviewLayout(storage), layout);

  storage.setItem('api-spec-studio.alpha-dockview-layout.v1', '{"broken":true}');
  assert.equal(loadDockviewLayout(storage), null);
});

test('describePanelState disables collapsing the final visible panel', () => {
  const layout = {
    columnSizes: [35, 31, 34],
    editorSplit: 52,
    collapsedPanels: { left: false, center: true, right: true },
    maximizedPanel: null,
    showOnlyDiffChanges: false,
  };
  const state = describePanelState(layout, 'left');

  assert.equal(canTogglePanel(layout, 'left'), false);
  assert.equal(state.toggleLabel, '접기');
  assert.equal(state.toggleExpanded, true);
  assert.equal(state.toggleDisabled, true);
});

test('describePanelState disables collapsing the maximized panel while keeping restore state', () => {
  const layout = {
    columnSizes: [35, 31, 34],
    editorSplit: 52,
    collapsedPanels: { left: false, center: false, right: false },
    maximizedPanel: 'center',
    showOnlyDiffChanges: false,
  };
  const state = describePanelState(layout, 'center');

  assert.equal(canTogglePanel(layout, 'center'), false);
  assert.equal(state.maximized, true);
  assert.equal(state.toggleDisabled, true);
  assert.equal(state.toggleExpanded, true);
});

test('describeSplitterState hides unusable workspace splitters and exposes slider values', () => {
  const maximized = describeSplitterState(
    {
      columnSizes: [35, 31, 34],
      editorSplit: 52,
      collapsedPanels: { left: false, center: true, right: true },
      maximizedPanel: 'left',
      showOnlyDiffChanges: false,
    },
    'left-center',
  );
  const editor = describeSplitterState(
    {
      columnSizes: [35, 31, 34],
      editorSplit: 52,
      collapsedPanels: { left: false, center: false, right: false },
      maximizedPanel: null,
      showOnlyDiffChanges: false,
    },
    'request-response',
  );

  assert.equal(maximized.hidden, true);
  assert.equal(editor.hidden, false);
  assert.equal(editor.valueNow, 52);
  assert.match(editor.valueText, /요청 52%, 응답 48%/);
});

test('nudgeLayoutWithKeyboard adjusts splitter values and respects bounds', () => {
  const baseLayout = {
    columnSizes: [35, 31, 34],
    editorSplit: 52,
    collapsedPanels: { left: false, center: false, right: false },
    maximizedPanel: null,
    showOnlyDiffChanges: false,
  };

  const widerLeft = nudgeLayoutWithKeyboard(baseLayout, 'left-center', 'ArrowRight');
  const topMin = nudgeLayoutWithKeyboard(baseLayout, 'request-response', 'Home');
  const hiddenNoop = nudgeLayoutWithKeyboard(
    {
      ...baseLayout,
      collapsedPanels: { left: true, center: false, right: false },
    },
    'left-center',
    'ArrowRight',
  );

  assert.ok(widerLeft);
  assert.ok((widerLeft.columnSizes[0] ?? 0) > 35);
  assert.ok((widerLeft.columnSizes[1] ?? 0) < 31);
  assert.equal(topMin?.editorSplit, 20);
  assert.equal(hiddenNoop, null);
});

test('truncate appends a single ellipsis when text exceeds max length', () => {
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('abc', 4), 'abc');
  assert.equal(truncate('abc', 1), 'a');
});

test('renderTabs exposes tab accessibility metadata', () => {
  const html = renderTabs('openapi');

  assert.match(html, /role="tablist"/);
  assert.match(html, /data-tab="openapi"[\s\S]*aria-selected="true"/);
  assert.match(html, /aria-label="OpenAPI 탭 열기"/);
});

test('renderDocumentList exposes active and actionable document controls', () => {
  const html = renderDocumentList(
    {
      workspace: {
        documents: [
          {
            id: 'doc-1',
            name: 'Active Doc',
            endpoint: { httpMethod: 'GET', basePath: '/api', endpointPath: '/active' },
            tags: ['core'],
          },
          {
            id: 'doc-2',
            name: 'Second Doc',
            endpoint: { httpMethod: 'POST', basePath: '/api', endpointPath: '/second' },
            tags: ['extra'],
          },
        ],
        activeDocumentId: 'doc-1',
      },
    },
    '',
  );

  assert.match(html, /data-document-id="doc-1"[\s\S]*aria-current="true"/);
  assert.match(html, /aria-label="Active Doc 엔드포인트 선택"/);
  assert.match(html, /data-action="duplicate-document"/);
});
test('deriveCodeMirrorSelection expands zero-length ranges and skips disabled issues', () => {
  const selection = deriveCodeMirrorSelection({
    target: 'request',
    level: 'error',
    code: 'INVALID_COLON',
    message: 'missing colon',
    range: {
      start: { index: 11, line: 2, column: 4 },
      end: { index: 11, line: 2, column: 4 },
    },
  }, 'request-1');
  const hidden = deriveCodeMirrorSelection({
    target: 'response',
    level: 'info',
    code: 'COMMENT_FOUND',
    message: 'comment',
    navigable: false,
    range: {
      start: { index: 0, line: 1, column: 1 },
      end: { index: 1, line: 1, column: 2 },
    },
  });

  assert.deepEqual(selection, {
    from: 11,
    to: 12,
    token: 'request-1',
  });
  assert.equal(hidden, null);
});

test('listWorkbenchIssues preserves source indices across request and response', () => {
  const items = listWorkbenchIssues({
    requestAnalysis: {
      issues: [
        {
          target: 'request',
          level: 'error',
          code: 'INVALID_COLON',
          message: 'bad request',
          range: {
            start: { index: 1, line: 1, column: 2 },
            end: { index: 2, line: 1, column: 3 },
          },
        },
      ],
    },
    responseAnalysis: {
      issues: [
        {
          target: 'response',
          level: 'warning',
          code: 'TRAILING_COMMA',
          message: 'bad response',
          range: {
            start: { index: 3, line: 2, column: 1 },
            end: { index: 4, line: 2, column: 2 },
          },
        },
      ],
    },
  });

  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => [item.target, item.index]), [['request', 0], ['response', 0]]);
});

test('restoreDocumentFromSnapshot applies snapshot state and switches to changes tab', () => {
  const document = {
    id: 'doc-1',
    name: 'Current',
    requestRaw: '{"before":true}',
    responseRaw: '{"before":true}',
    requestVariants: [],
    responseVariants: [],
    endpoint: {
      packageName: 'com.example',
      basePath: '/api',
      endpointPath: '/before',
      httpMethod: 'POST',
      controllerClassName: 'BeforeController',
      serviceClassName: 'BeforeService',
      methodName: 'before',
    },
    params: [],
    tags: ['old'],
    requestMode: 'json',
    schemaOverrides: { request: {}, response: {} },
    snapshots: [],
    compareSnapshotId: undefined,
    activeResultTab: 'controller',
  };

  restoreDocumentFromSnapshot(document, {
    id: 'snap-1',
    name: 'Snapshot 1',
    createdAt: '2026-03-26 00:00:00',
    state: {
      name: 'Restored',
      requestRaw: '{"after":true}',
      responseRaw: '{"ok":true}',
      requestVariants: [{ id: 'rv', name: 'rv', raw: '{"x":1}', enabled: true }],
      responseVariants: [],
      endpoint: {
        packageName: 'com.example',
        basePath: '/restored',
        endpointPath: '/orders/{id}',
        httpMethod: 'PUT',
        controllerClassName: 'RestoredController',
        serviceClassName: 'RestoredService',
        methodName: 'restoreOrder',
      },
      params: [],
      tags: ['restored'],
      requestMode: 'multipart/form-data',
      schemaOverrides: { request: { payload: { path: 'payload', type: 'object' } }, response: {} },
    },
  });

  assert.equal(document.name, 'Restored');
  assert.equal(document.endpoint.endpointPath, '/orders/{id}');
  assert.equal(document.requestMode, 'multipart/form-data');
  assert.equal(document.compareSnapshotId, 'snap-1');
  assert.equal(document.activeResultTab, 'changes');
  assert.deepEqual(document.tags, ['restored']);
});
