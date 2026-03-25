import type { AppSnapshot, ChangeReport, DiffResult, ExampleVariant, GeneratedTab, ParseIssue, SchemaRow } from '../types.js';
import { escapeHtml, truncate } from '../utils/strings.js';

const TAB_LABELS: Record<GeneratedTab, string> = {
  'request-spec': 'Request Spec',
  'response-spec': 'Response Spec',
  payload: 'Payload',
  controller: 'Controller',
  'service-interface': 'Service Interface',
  'service-impl': 'Service Impl',
  dto: 'DTO',
  openapi: 'OpenAPI',
  curl: 'cURL',
  'json-schema': 'JSON Schema',
  'mock-request': 'Mock Request',
  'mock-response': 'Mock Response',
  fetch: 'fetch()',
  axios: 'axios',
  markdown: 'Markdown',
  changes: 'Changes',
};

const TYPE_OPTIONS = ['string', 'number', 'boolean', 'object', 'array<string>', 'array<number>', 'array<boolean>', 'array<object>', 'mixed', 'null'];

function renderIssue(issue: ParseIssue, index: number): string {
  const position = issue.range.start.line > 0 ? `${issue.range.start.line}:${issue.range.start.column}` : '-';
  const suggestion = issue.suggestion ? `<div class="issue-suggestion">${escapeHtml(issue.suggestion)}</div>` : '';
  const sourceLabel = issue.sourceLabel ? `<span class="mini-pill">${escapeHtml(issue.sourceLabel)}</span>` : '';
  const disabled = issue.target === 'config' || issue.navigable === false ? 'issue-card-static' : '';
  const ariaLabel = `${issue.level} ${issue.code} ${position} ${issue.message}`;
  return `
    <button type="button" class="issue-card issue-${issue.level} ${disabled}" data-action="jump-issue" data-issue-index="${index}" data-target="${issue.target}" aria-label="${escapeHtml(ariaLabel)}">
      <div class="issue-meta">
        <span class="pill pill-${issue.level}">${issue.level.toUpperCase()}</span>
        <span class="issue-code">${escapeHtml(issue.code)}</span>
        <span class="issue-pos">${escapeHtml(position)}</span>
        ${sourceLabel}
      </div>
      <div class="issue-message">${escapeHtml(issue.message)}</div>
      ${suggestion}
    </button>
  `;
}

export function renderIssues(issues: ParseIssue[]): string {
  if (issues.length === 0) {
    return '<div class="empty-state">이슈가 없습니다.</div>';
  }
  return `<div class="issue-list">${issues.map((issue, index) => renderIssue(issue, index)).join('')}</div>`;
}

export function renderEditableSchemaTable(rows: SchemaRow[], scope: 'request' | 'response'): string {
  if (rows.length === 0) {
    return '<div class="empty-state">추론된 필드가 없습니다.</div>';
  }

  return `
    <div class="table-wrap">
      <table class="spec-table editable-spec-table">
        <thead>
          <tr>
            <th>Path</th>
            <th>Type</th>
            <th>Required</th>
            <th>Nullable</th>
            <th>Format</th>
            <th>Description</th>
            <th>Enum</th>
            <th>Example</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td>
                    <code>${escapeHtml(row.path)}</code>
                    ${row.type !== row.inferredType ? `<div class="row-subtext">inferred: ${escapeHtml(row.inferredType)}</div>` : ''}
                  </td>
                  <td>
                    <select data-action="schema-edit" data-scope="${scope}" data-path="${escapeHtml(row.path)}" data-field="type">
                      ${TYPE_OPTIONS.map((type) => `<option value="${type}" ${row.type === type ? 'selected' : ''}>${type}</option>`).join('')}
                    </select>
                  </td>
                  <td class="checkbox-cell"><input data-action="schema-edit" data-scope="${scope}" data-path="${escapeHtml(row.path)}" data-field="required" type="checkbox" ${row.required ? 'checked' : ''} /></td>
                  <td class="checkbox-cell"><input data-action="schema-edit" data-scope="${scope}" data-path="${escapeHtml(row.path)}" data-field="nullable" type="checkbox" ${row.nullable ? 'checked' : ''} /></td>
                  <td><input data-action="schema-edit" data-scope="${scope}" data-path="${escapeHtml(row.path)}" data-field="format" type="text" value="${escapeHtml(row.format || '')}" /></td>
                  <td><input data-action="schema-edit" data-scope="${scope}" data-path="${escapeHtml(row.path)}" data-field="description" type="text" value="${escapeHtml(row.description || '')}" /></td>
                  <td><input data-action="schema-edit" data-scope="${scope}" data-path="${escapeHtml(row.path)}" data-field="enumValues" type="text" value="${escapeHtml((row.enumValues || []).join(', '))}" /></td>
                  <td><input data-action="schema-edit" data-scope="${scope}" data-path="${escapeHtml(row.path)}" data-field="example" type="text" value="${escapeHtml(row.example || '')}" /></td>
                  <td>${row.notes.length > 0 ? row.notes.map((note) => `<span class="mini-pill">${escapeHtml(note)}</span>`).join(' ') : '-'}</td>
                </tr>
              `,
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

export function renderPreview(title: string, normalizedText: string, flags: string[] = []): string {
  return `
    <section class="preview-card">
      <div class="preview-header">
        <h3>${escapeHtml(title)}</h3>
        <div class="preview-badges">${flags.map((flag) => `<span class="mini-pill">${escapeHtml(flag)}</span>`).join('')}</div>
      </div>
      <pre class="code-block">${escapeHtml(normalizedText || '// 파싱 가능한 값이 없습니다.')}</pre>
    </section>
  `;
}

export function renderDiffCard(title: string, diff: DiffResult, showOnlyChanges: boolean): string {
  const lines = showOnlyChanges ? diff.lines.filter((line) => line.status !== 'unchanged') : diff.lines;
  return `
    <section class="preview-card">
      <div class="preview-header">
        <h3>${escapeHtml(title)}</h3>
        <div class="preview-badges">
          <span class="mini-pill">변경 ${diff.changeCount}</span>
          <span class="mini-pill">${showOnlyChanges ? '변경 라인만' : '전체 라인'}</span>
        </div>
      </div>
      <div class="diff-wrap">
        <table class="diff-table">
          <thead>
            <tr>
              <th>Original</th>
              <th>Normalized</th>
            </tr>
          </thead>
          <tbody>
            ${lines
              .map(
                (line) => `
                  <tr class="diff-row diff-${line.status}">
                    <td>
                      <div class="diff-line"><span class="diff-line-no">${line.leftNumber ?? ''}</span><code>${escapeHtml(line.leftText || ' ')}</code></div>
                    </td>
                    <td>
                      <div class="diff-line"><span class="diff-line-no">${line.rightNumber ?? ''}</span><code>${escapeHtml(line.rightText || ' ')}</code></div>
                    </td>
                  </tr>
                `,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

export function renderTabs(activeTab: GeneratedTab): string {
  return `
    <div class="tabs" role="tablist" aria-label="Generated outputs">
      ${Object.entries(TAB_LABELS)
        .map(
          ([key, label]) => `
            <button
              type="button"
              class="tab-button ${key === activeTab ? 'tab-button-active' : ''}"
              data-action="change-tab"
              data-tab="${key}"
              role="tab"
              aria-selected="${key === activeTab ? 'true' : 'false'}"
              aria-label="${escapeHtml(label)} 탭 열기"
            >
              ${escapeHtml(label)}
            </button>
          `,
        )
        .join('')}
    </div>
  `;
}

export function renderChangeReport(report: ChangeReport | null): string {
  if (!report) {
    return '<div class="empty-state">비교할 스냅샷을 선택하면 변경점이 표시됩니다.</div>';
  }
  if (report.items.length === 0) {
    return `<div class="empty-state">선택한 스냅샷(${escapeHtml(report.snapshotName)}) 대비 변경점이 없습니다.</div>`;
  }
  return `
    <div class="change-report">
      <div class="change-summary">
        <span class="mini-pill">비교 기준: ${escapeHtml(report.snapshotName)}</span>
        <span class="mini-pill">Breaking ${report.breakingCount}</span>
      </div>
      <div class="table-wrap">
        <table class="spec-table">
          <thead>
            <tr>
              <th>Scope</th>
              <th>Path</th>
              <th>Change</th>
              <th>Before</th>
              <th>After</th>
              <th>Breaking</th>
            </tr>
          </thead>
          <tbody>
            ${report.items
              .map(
                (item) => `
                  <tr>
                    <td>${escapeHtml(item.scope)}</td>
                    <td><code>${escapeHtml(item.path)}</code></td>
                    <td>${escapeHtml(item.type)}</td>
                    <td>${escapeHtml(item.before || '-')}</td>
                    <td>${escapeHtml(item.after || '-')}</td>
                    <td>${item.breaking ? '<span class="pill pill-warning">YES</span>' : 'NO'}</td>
                  </tr>
                `,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

export function renderGeneratedContent(snapshot: AppSnapshot): string {
  const tab = snapshot.activeDocument.activeResultTab;
  switch (tab) {
    case 'request-spec':
      return renderEditableSchemaTable(snapshot.requestAnalysis.schema.rows, 'request');
    case 'response-spec':
      return renderEditableSchemaTable(snapshot.responseAnalysis.schema.rows, 'response');
    case 'payload':
      return `<pre class="code-block" data-copy-source="payload">${escapeHtml(snapshot.generated.payloadText)}</pre>`;
    case 'controller':
      return `<pre class="code-block" data-copy-source="controller">${escapeHtml(snapshot.generated.controllerCode)}</pre>`;
    case 'service-interface':
      return `<pre class="code-block" data-copy-source="service-interface">${escapeHtml(snapshot.generated.serviceInterfaceCode)}</pre>`;
    case 'service-impl':
      return `<pre class="code-block" data-copy-source="service-impl">${escapeHtml(snapshot.generated.serviceImplementationCode)}</pre>`;
    case 'dto':
      return `<pre class="code-block" data-copy-source="dto">${escapeHtml(snapshot.generated.dtoCode)}</pre>`;
    case 'openapi':
      return `<pre class="code-block" data-copy-source="openapi">${escapeHtml(snapshot.generated.openApiYaml)}</pre>`;
    case 'curl':
      return `<pre class="code-block" data-copy-source="curl">${escapeHtml(snapshot.generated.curlText)}</pre>`;
    case 'json-schema':
      return `<pre class="code-block" data-copy-source="json-schema">${escapeHtml(snapshot.generated.jsonSchemaText)}</pre>`;
    case 'mock-request':
      return `<pre class="code-block" data-copy-source="mock-request">${escapeHtml(snapshot.generated.mockRequestText)}</pre>`;
    case 'mock-response':
      return `<pre class="code-block" data-copy-source="mock-response">${escapeHtml(snapshot.generated.mockResponseText)}</pre>`;
    case 'fetch':
      return `<pre class="code-block" data-copy-source="fetch">${escapeHtml(snapshot.generated.fetchText)}</pre>`;
    case 'axios':
      return `<pre class="code-block" data-copy-source="axios">${escapeHtml(snapshot.generated.axiosText)}</pre>`;
    case 'markdown':
      return `<pre class="code-block" data-copy-source="markdown">${escapeHtml(snapshot.generated.markdownText)}</pre>`;
    case 'changes':
      return renderChangeReport(snapshot.changeReport);
    default:
      return '';
  }
}

export function renderSummary(snapshot: AppSnapshot): string {
  const issues = [
    ...snapshot.requestAnalysis.issues,
    ...snapshot.responseAnalysis.issues,
    ...snapshot.generated.issues,
  ];
  const errorCount = issues.filter((issue) => issue.level === 'error').length;
  const warningCount = issues.filter((issue) => issue.level === 'warning').length;

  return `
    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-label">Request Type</div>
        <div class="summary-value">${escapeHtml(snapshot.requestAnalysis.ast?.type ?? '-')}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Response Java</div>
        <div class="summary-value">${escapeHtml(snapshot.generated.responseJavaType)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Variants</div>
        <div class="summary-value">R ${snapshot.requestAnalysis.schema.variantCount} / S ${snapshot.responseAnalysis.schema.variantCount}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Errors / Warnings</div>
        <div class="summary-value">${errorCount} / ${warningCount}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Request Mode</div>
        <div class="summary-value">${escapeHtml(snapshot.activeDocument.requestMode)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Breaking Changes</div>
        <div class="summary-value">${snapshot.changeReport?.breakingCount ?? 0}</div>
      </div>
    </div>
  `;
}

export function renderIssueGroups(snapshot: AppSnapshot): string {
  return `
    <div class="issue-group-grid">
      <section class="panel-section compact-section">
        <div class="panel-title-row">
          <h3>Request Issues</h3>
          <span class="mini-pill">${snapshot.requestAnalysis.issues.length}</span>
        </div>
        ${renderIssues(snapshot.requestAnalysis.issues)}
      </section>
      <section class="panel-section compact-section">
        <div class="panel-title-row">
          <h3>Response Issues</h3>
          <span class="mini-pill">${snapshot.responseAnalysis.issues.length}</span>
        </div>
        ${renderIssues(snapshot.responseAnalysis.issues)}
      </section>
      <section class="panel-section compact-section">
        <div class="panel-title-row">
          <h3>Generation Issues</h3>
          <span class="mini-pill">${snapshot.generated.issues.length}</span>
        </div>
        ${renderIssues(snapshot.generated.issues)}
      </section>
    </div>
  `;
}

export function renderDocumentList(snapshot: AppSnapshot, filterText = ''): string {
  const filteredDocuments = snapshot.workspace.documents.filter((document) => {
    if (!filterText.trim()) {
      return true;
    }
    const haystack = `${document.name} ${document.endpoint.httpMethod} ${document.endpoint.basePath}${document.endpoint.endpointPath} ${(document.tags || []).join(' ')}`.toLowerCase();
    return haystack.includes(filterText.toLowerCase());
  });

  return `
    <div class="endpoint-list">
      ${filteredDocuments
        .map((document) => {
          const active = document.id === snapshot.workspace.activeDocumentId;
          return `
            <div class="endpoint-card ${active ? 'endpoint-card-active' : ''}">
              <button type="button" class="endpoint-select" data-action="select-document" data-document-id="${escapeHtml(document.id)}" aria-current="${active ? 'true' : 'false'}" aria-label="${escapeHtml(`${document.name} 엔드포인트 선택`)}">
                <div class="endpoint-card-main">
                  <div class="endpoint-card-title">${escapeHtml(document.name)}</div>
                  <div class="endpoint-card-meta">${escapeHtml(document.endpoint.httpMethod)} · ${escapeHtml(`${document.endpoint.basePath}${document.endpoint.endpointPath}`)}</div>
                  <div class="endpoint-card-tags">${(document.tags || []).map((tag) => `<span class="mini-pill">${escapeHtml(tag)}</span>`).join(' ')}</div>
                </div>
              </button>
              <div class="endpoint-card-actions">
                <button type="button" class="icon-button small-button" data-action="duplicate-document" data-document-id="${escapeHtml(document.id)}">복제</button>
                ${snapshot.workspace.documents.length > 1 ? `<button type="button" class="icon-button small-button" data-action="remove-document" data-document-id="${escapeHtml(document.id)}">삭제</button>` : ''}
              </div>
            </div>
          `;
        })
        .join('')}
      ${filteredDocuments.length === 0 ? '<div class="empty-state">검색 결과가 없습니다.</div>' : ''}
    </div>
  `;
}

export function renderPresetList(snapshot: AppSnapshot): string {
  return `
    <div class="preset-list">
      ${snapshot.workspace.presets
        .map((preset) => {
          const active = preset.id === snapshot.workspace.activePresetId;
          return `
            <button type="button" class="preset-card ${active ? 'preset-card-active' : ''}" data-action="select-preset" data-preset-id="${escapeHtml(preset.id)}" aria-pressed="${active ? 'true' : 'false'}" aria-label="${escapeHtml(`${preset.name} 프리셋 선택`)}">
              <div>
                <div class="preset-card-title">${escapeHtml(preset.name)}</div>
                <div class="preset-card-meta">${escapeHtml(`${preset.rootArrayRequestStrategy.toUpperCase()} · ${preset.requestBodyVariableName} · ${preset.dtoSuffix}`)}</div>
              </div>
              <div class="preset-card-meta">${preset.addSwaggerAnnotations ? 'Swagger' : 'Plain'}</div>
            </button>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderVariantCard(scope: 'request' | 'response', variant: ExampleVariant): string {
  return `
    <div class="variant-card" data-variant-id="${escapeHtml(variant.id)}" data-scope="${scope}">
      <div class="variant-card-header">
        <label class="checkbox-inline"><input data-action="variant-toggle" data-scope="${scope}" data-variant-id="${escapeHtml(variant.id)}" type="checkbox" ${variant.enabled ? 'checked' : ''} /> 사용</label>
        <input data-action="variant-edit" data-scope="${scope}" data-variant-id="${escapeHtml(variant.id)}" data-field="name" type="text" value="${escapeHtml(variant.name)}" />
        <button type="button" class="icon-button small-button" data-action="remove-variant" data-scope="${scope}" data-variant-id="${escapeHtml(variant.id)}">삭제</button>
      </div>
      <textarea class="variant-textarea" data-action="variant-edit" data-scope="${scope}" data-variant-id="${escapeHtml(variant.id)}" data-field="raw" spellcheck="false">${escapeHtml(variant.raw)}</textarea>
    </div>
  `;
}

export function renderVariantSection(scope: 'request' | 'response', variants: ExampleVariant[]): string {
  return `
    <div class="variant-list">
      ${variants.length === 0 ? '<div class="empty-state">추가 예시가 없습니다.</div>' : variants.map((variant) => renderVariantCard(scope, variant)).join('')}
    </div>
  `;
}

export function renderSnapshotList(snapshot: AppSnapshot): string {
  const snapshots = snapshot.activeDocument.snapshots;
  if (snapshots.length === 0) {
    return '<div class="empty-state">저장된 스냅샷이 없습니다.</div>';
  }

  return `
    <div class="snapshot-list">
      ${snapshots
        .map((item) => {
          const selected = snapshot.activeDocument.compareSnapshotId === item.id;
          return `
            <div class="snapshot-card ${selected ? 'snapshot-card-active' : ''}">
              <label class="snapshot-select-row">
                <input type="radio" name="compareSnapshot" data-action="select-snapshot" data-snapshot-id="${escapeHtml(item.id)}" ${selected ? 'checked' : ''} />
                <div>
                  <div class="snapshot-title">${escapeHtml(item.name)}</div>
                  <div class="snapshot-meta">${escapeHtml(item.createdAt)}</div>
                </div>
              </label>
              <div class="row-actions">
                <button type="button" class="ghost-button small-button" data-action="restore-snapshot" data-snapshot-id="${escapeHtml(item.id)}">복원</button>
                <button type="button" class="ghost-button small-button" data-action="delete-snapshot" data-snapshot-id="${escapeHtml(item.id)}">삭제</button>
              </div>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}
