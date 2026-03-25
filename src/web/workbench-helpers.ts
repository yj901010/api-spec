import type { AppSnapshot, DocumentSnapshot, EndpointDocument, ParseIssue } from '../types.js';

export interface CodeMirrorSelection {
  from: number;
  to: number;
  token: string;
}

export interface WorkbenchIssueItem {
  key: string;
  target: 'request' | 'response';
  index: number;
  issue: ParseIssue;
  disabled: boolean;
}

export function deriveCodeMirrorSelection(issue: ParseIssue | undefined, token = 'issue-selection'): CodeMirrorSelection | null {
  if (!issue || issue.navigable === false) {
    return null;
  }

  return {
    from: issue.range.start.index,
    to: Math.max(issue.range.end.index, issue.range.start.index + 1),
    token,
  };
}

export function listWorkbenchIssues(snapshot: AppSnapshot): WorkbenchIssueItem[] {
  const requestItems = snapshot.requestAnalysis.issues.map((issue, index) => ({
    key: `request-${issue.code}-${index}`,
    target: 'request' as const,
    index,
    issue,
    disabled: issue.navigable === false,
  }));
  const responseItems = snapshot.responseAnalysis.issues.map((issue, index) => ({
    key: `response-${issue.code}-${index}`,
    target: 'response' as const,
    index,
    issue,
    disabled: issue.navigable === false,
  }));

  return [...requestItems, ...responseItems];
}

export function restoreDocumentFromSnapshot(document: EndpointDocument, snapshot: DocumentSnapshot): void {
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
}
