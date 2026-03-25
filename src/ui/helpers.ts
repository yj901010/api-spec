import type { LayoutState, ParseIssue } from '../types.js';

export type WorkspacePanel = 'left' | 'center' | 'right';
export type WorkspaceSplitter = 'left-center' | 'center-right' | 'request-response';

const WORKSPACE_PANELS: WorkspacePanel[] = ['left', 'center', 'right'];
const PANEL_SPLIT_MIN = 20;
const PANEL_SPLIT_MAX = 80;
const EDITOR_SPLIT_MIN = 20;
const EDITOR_SPLIT_MAX = 80;

function lineCount(value: string): number {
  return Math.max(1, value.split('\n').length);
}

function panelLabel(panel: WorkspacePanel): string {
  if (panel === 'left') return '왼쪽 패널';
  if (panel === 'center') return '가운데 패널';
  return '오른쪽 패널';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pairRatio(layout: LayoutState, firstIndex: number, secondIndex: number): number {
  const first = layout.columnSizes[firstIndex] ?? 0;
  const second = layout.columnSizes[secondIndex] ?? 0;
  const total = first + second;
  if (total <= 0) return 50;
  return (first / total) * 100;
}

function setPairRatio(layout: LayoutState, firstIndex: number, secondIndex: number, ratioPercent: number): void {
  const first = layout.columnSizes[firstIndex] ?? 0;
  const second = layout.columnSizes[secondIndex] ?? 0;
  const total = first + second;
  if (total <= 0) return;
  const clampedRatio = clamp(ratioPercent, PANEL_SPLIT_MIN, PANEL_SPLIT_MAX) / 100;
  layout.columnSizes[firstIndex] = total * clampedRatio;
  layout.columnSizes[secondIndex] = total * (1 - clampedRatio);
}

export function highestIssueLevel(levels: ParseIssue['level'][]): ParseIssue['level'] | undefined {
  if (levels.includes('error')) return 'error';
  if (levels.includes('warning')) return 'warning';
  if (levels.includes('info')) return 'info';
  return undefined;
}

export function renderGutterHtml(source: string, issues: ParseIssue[], selectedIssue?: ParseIssue): string {
  const totalLines = lineCount(source);
  const issuesByLine = new Map<number, ParseIssue['level'][]>();

  for (const issue of issues) {
    const line = issue.range.start.line || 1;
    const current = issuesByLine.get(line) ?? [];
    current.push(issue.level);
    issuesByLine.set(line, current);
  }

  const selectedLine = selectedIssue?.range.start.line;

  return Array.from({ length: totalLines }, (_, index) => {
    const lineNo = index + 1;
    const severity = highestIssueLevel(issuesByLine.get(lineNo) ?? []);
    const markerClass = severity ? `gutter-${severity}` : '';
    const activeClass = selectedLine === lineNo ? 'gutter-active' : '';
    return `<div class="gutter-line ${markerClass} ${activeClass}"><span class="gutter-line-no">${lineNo}</span><span class="gutter-marker"></span></div>`;
  }).join('');
}

export function computeWorkspaceColumns(layout: LayoutState): string {
  const collapsedWidth = 64;
  const gutterWidth = layout.maximizedPanel ? 0 : 12;
  const panels: Array<'left' | 'center' | 'right'> = ['left', 'center', 'right'];
  const effectiveCollapsed = { ...layout.collapsedPanels };
  const hiddenWidth = layout.maximizedPanel ? 0 : collapsedWidth;

  if (layout.maximizedPanel) {
    effectiveCollapsed.left = layout.maximizedPanel !== 'left';
    effectiveCollapsed.center = layout.maximizedPanel !== 'center';
    effectiveCollapsed.right = layout.maximizedPanel !== 'right';
  }

  const visibleWeights = panels.map((panel, index) => (effectiveCollapsed[panel] ? 0 : layout.columnSizes[index]!));
  const visibleWeightSum = visibleWeights.reduce((sum, value) => sum + value, 0) || 1;
  const fixedPanels = panels.filter((panel) => effectiveCollapsed[panel]).length * hiddenWidth;
  const gutterCount = layout.maximizedPanel ? 0 : 2;
  const remainingExpr = `calc(100% - ${fixedPanels + gutterCount * gutterWidth}px)`;

  const panelWidth = (panel: 'left' | 'center' | 'right', index: number): string => {
    if (effectiveCollapsed[panel]) return `${hiddenWidth}px`;
    return `calc(${remainingExpr} * ${(visibleWeights[index]! / visibleWeightSum).toFixed(6)})`;
  };

  return `${panelWidth('left', 0)} ${gutterCount > 0 ? `${gutterWidth}px` : '0px'} ${panelWidth('center', 1)} ${gutterCount > 0 ? `${gutterWidth}px` : '0px'} ${panelWidth('right', 2)}`;
}

export function canTogglePanel(layout: LayoutState, panel: WorkspacePanel): boolean {
  if (layout.maximizedPanel === panel) return false;
  const isCollapsed = layout.collapsedPanels[panel];
  if (isCollapsed) return true;
  const visibleCount = WORKSPACE_PANELS.filter((candidate) => !layout.collapsedPanels[candidate]).length;
  return visibleCount > 1;
}

export function describePanelState(layout: LayoutState, panel: WorkspacePanel): {
  collapsed: boolean;
  maximized: boolean;
  toggleLabel: string;
  toggleExpanded: boolean;
  toggleDisabled: boolean;
  maximizeLabel: string;
} {
  const collapsed = layout.maximizedPanel ? layout.maximizedPanel !== panel : layout.collapsedPanels[panel];
  const maximized = layout.maximizedPanel === panel;
  return {
    collapsed,
    maximized,
    toggleLabel: collapsed ? '열기' : '접기',
    toggleExpanded: !collapsed,
    toggleDisabled: maximized || (!collapsed && !canTogglePanel(layout, panel)),
    maximizeLabel: maximized ? '복원' : '최대화',
  };
}

export function describeSplitterState(layout: LayoutState, splitter: WorkspaceSplitter): {
  hidden: boolean;
  valueMin: number;
  valueMax: number;
  valueNow: number;
  valueText: string;
} {
  if (splitter === 'request-response') {
    const valueNow = clamp(layout.editorSplit, EDITOR_SPLIT_MIN, EDITOR_SPLIT_MAX);
    return {
      hidden: false,
      valueMin: EDITOR_SPLIT_MIN,
      valueMax: EDITOR_SPLIT_MAX,
      valueNow,
      valueText: `요청 ${Math.round(valueNow)}%, 응답 ${Math.round(100 - valueNow)}%`,
    };
  }

  const [firstPanel, secondPanel, firstIndex, secondIndex] = splitter === 'left-center'
    ? (['left', 'center', 0, 1] as const)
    : (['center', 'right', 1, 2] as const);
  const hidden = Boolean(layout.maximizedPanel) || layout.collapsedPanels[firstPanel] || layout.collapsedPanels[secondPanel];
  const valueNow = clamp(pairRatio(layout, firstIndex, secondIndex), PANEL_SPLIT_MIN, PANEL_SPLIT_MAX);
  return {
    hidden,
    valueMin: PANEL_SPLIT_MIN,
    valueMax: PANEL_SPLIT_MAX,
    valueNow,
    valueText: `${panelLabel(firstPanel)} ${Math.round(valueNow)}%, ${panelLabel(secondPanel)} ${Math.round(100 - valueNow)}%`,
  };
}

export function nudgeLayoutWithKeyboard(
  layout: LayoutState,
  splitter: WorkspaceSplitter,
  key: string,
  shiftKey = false,
): LayoutState | null {
  const next = structuredClone(layout);
  const step = shiftKey ? 10 : 4;

  if (splitter === 'request-response') {
    if (key === 'ArrowUp') next.editorSplit = clamp(next.editorSplit - step, EDITOR_SPLIT_MIN, EDITOR_SPLIT_MAX);
    else if (key === 'ArrowDown') next.editorSplit = clamp(next.editorSplit + step, EDITOR_SPLIT_MIN, EDITOR_SPLIT_MAX);
    else if (key === 'Home') next.editorSplit = EDITOR_SPLIT_MIN;
    else if (key === 'End') next.editorSplit = EDITOR_SPLIT_MAX;
    else return null;
    return next;
  }

  if (describeSplitterState(layout, splitter).hidden) {
    return null;
  }

  const [firstIndex, secondIndex] = splitter === 'left-center' ? [0, 1] : [1, 2];
  const currentRatio = pairRatio(next, firstIndex, secondIndex);
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    setPairRatio(next, firstIndex, secondIndex, currentRatio - step);
  } else if (key === 'ArrowRight' || key === 'ArrowDown') {
    setPairRatio(next, firstIndex, secondIndex, currentRatio + step);
  } else if (key === 'Home') {
    setPairRatio(next, firstIndex, secondIndex, PANEL_SPLIT_MIN);
  } else if (key === 'End') {
    setPairRatio(next, firstIndex, secondIndex, PANEL_SPLIT_MAX);
  } else {
    return null;
  }

  return next;
}

export function computeIssueSelection(issue: ParseIssue | undefined, lineHeightValue: string): {
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
} | null {
  if (!issue || issue.navigable === false) {
    return null;
  }

  const parsedLineHeight = parseFloat(lineHeightValue);
  const lineHeight = Number.isFinite(parsedLineHeight) && parsedLineHeight > 0 ? parsedLineHeight : 20;
  const selectionStart = issue.range.start.index;
  const selectionEnd = Math.max(issue.range.end.index, selectionStart + 1);
  const line = issue.range.start.line || 1;

  return {
    selectionStart,
    selectionEnd,
    scrollTop: Math.max(0, (line - 2) * lineHeight),
  };
}
