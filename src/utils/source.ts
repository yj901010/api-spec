import type { SourcePosition, SourceRange } from '../types.js';

export function clonePosition(position: SourcePosition): SourcePosition {
  return { index: position.index, line: position.line, column: position.column };
}

export function createRange(start: SourcePosition, end: SourcePosition): SourceRange {
  return { start: clonePosition(start), end: clonePosition(end) };
}

export function combineRanges(a: SourceRange, b: SourceRange): SourceRange {
  return {
    start: clonePosition(a.start),
    end: clonePosition(b.end),
  };
}

export function emptyRange(): SourceRange {
  return {
    start: { index: 0, line: 1, column: 1 },
    end: { index: 0, line: 1, column: 1 },
  };
}
