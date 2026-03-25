import type { EndpointDocument, SchemaOverride, WorkspaceState } from '../types.js';
import { applyCurlImport } from '../core/curl.js';
import { applyRawHttpImport } from '../core/http-import.js';
import { applyOpenApiImport } from '../core/openapi-import.js';
import { applyPostmanCollectionImport } from '../core/postman-import.js';
import { createEmptyDocumentTemplate, createEmptyParam, duplicateDocumentTemplate } from '../state/store.js';

export type QuickImportFormat = 'curl' | 'http' | 'postman' | 'openapi';

export interface QuickImportResult {
  changed: boolean;
  error?: string;
}

export type SchemaOverrideField = 'type' | 'required' | 'nullable' | 'description' | 'format' | 'enumValues' | 'example';

function appendDocuments(workspace: WorkspaceState, documents: EndpointDocument[]): void {
  for (const document of documents) {
    workspace.documents.push(document);
  }
  if (documents.length > 0) {
    workspace.activeDocumentId = documents[documents.length - 1]!.id;
  }
}

export function applyQuickImportToWorkspace(
  workspace: WorkspaceState,
  raw: string,
  format: QuickImportFormat,
  asNewDocuments: boolean,
): QuickImportResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { changed: false, error: 'Import content is empty.' };
  }

  const current = workspace.documents.find((document) => document.id === workspace.activeDocumentId);
  if (!current) {
    return { changed: false, error: 'No active document available.' };
  }

  const template = createEmptyDocumentTemplate();

  if (format === 'curl') {
    const imported = applyCurlImport(trimmed, current);
    if (!imported) return { changed: false, error: 'Could not parse cURL input.' };
    if (asNewDocuments) {
      const created = duplicateDocumentTemplate({ ...current, ...imported, id: current.id, snapshots: [], compareSnapshotId: undefined });
      workspace.documents.push(created);
      workspace.activeDocumentId = created.id;
    } else {
      Object.assign(current, imported);
    }
    return { changed: true };
  }

  if (format === 'http') {
    const imported = applyRawHttpImport(trimmed, current);
    if (!imported) return { changed: false, error: 'Could not parse raw HTTP input.' };
    if (asNewDocuments) {
      const created = duplicateDocumentTemplate({ ...current, ...imported, id: current.id, snapshots: [], compareSnapshotId: undefined });
      workspace.documents.push(created);
      workspace.activeDocumentId = created.id;
    } else {
      Object.assign(current, imported);
    }
    return { changed: true };
  }

  if (format === 'postman') {
    const importedDocs = applyPostmanCollectionImport(trimmed, template);
    if (!importedDocs || importedDocs.length === 0) {
      return { changed: false, error: 'Could not parse Postman collection.' };
    }
    if (asNewDocuments) {
      appendDocuments(workspace, importedDocs);
    } else {
      const first = importedDocs[0]!;
      Object.assign(current, { ...first, id: current.id, snapshots: current.snapshots, compareSnapshotId: current.compareSnapshotId });
    }
    return { changed: true };
  }

  const importedDocs = applyOpenApiImport(trimmed, template);
  if (!importedDocs || importedDocs.length === 0) {
    return { changed: false, error: 'Could not parse OpenAPI input.' };
  }
  if (asNewDocuments) {
    appendDocuments(workspace, importedDocs);
  } else {
    const first = importedDocs[0]!;
    Object.assign(current, { ...first, id: current.id, snapshots: current.snapshots, compareSnapshotId: current.compareSnapshotId });
  }
  return { changed: true };
}

export function addDocumentParam(document: EndpointDocument): void {
  document.params.push(createEmptyParam());
}

export function updateDocumentSchemaOverride(
  document: EndpointDocument,
  scope: 'request' | 'response',
  path: string,
  field: SchemaOverrideField,
  value: string | boolean,
): void {
  if (!path) return;

  const bucket = document.schemaOverrides[scope];
  const current: SchemaOverride = bucket[path] ?? { path };

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
}
