import type { DiffLine, DiffResult } from '../types.js';

function buildMatrix(left: string[], right: string[]): number[][] {
  const matrix = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let row = left.length - 1; row >= 0; row -= 1) {
    for (let column = right.length - 1; column >= 0; column -= 1) {
      matrix[row]![column] = left[row] === right[column]
        ? 1 + matrix[row + 1]![column + 1]!
        : Math.max(matrix[row + 1]![column]!, matrix[row]![column + 1]!);
    }
  }
  return matrix;
}

function splitLines(value: string): string[] {
  if (!value) {
    return [];
  }
  return value.replace(/\r\n/g, '\n').split('\n');
}

function pairChanges(lines: DiffLine[]): DiffLine[] {
  const paired: DiffLine[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index]!;
    const next = lines[index + 1];
    if (
      current.status === 'removed' &&
      next &&
      next.status === 'added'
    ) {
      paired.push({
        leftNumber: current.leftNumber,
        leftText: current.leftText,
        rightNumber: next.rightNumber,
        rightText: next.rightText,
        status: 'changed',
      });
      index += 1;
      continue;
    }
    if (
      current.status === 'added' &&
      next &&
      next.status === 'removed'
    ) {
      paired.push({
        leftNumber: next.leftNumber,
        leftText: next.leftText,
        rightNumber: current.rightNumber,
        rightText: current.rightText,
        status: 'changed',
      });
      index += 1;
      continue;
    }
    paired.push(current);
  }

  return paired;
}

export function buildDiff(original: string, normalized: string): DiffResult {
  const left = splitLines(original);
  const right = splitLines(normalized);
  const matrix = buildMatrix(left, right);

  const lines: DiffLine[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      lines.push({
        leftNumber: leftIndex + 1,
        leftText: left[leftIndex]!,
        rightNumber: rightIndex + 1,
        rightText: right[rightIndex]!,
        status: 'unchanged',
      });
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    if (matrix[leftIndex + 1]![rightIndex]! >= matrix[leftIndex]![rightIndex + 1]!) {
      lines.push({
        leftNumber: leftIndex + 1,
        leftText: left[leftIndex]!,
        rightNumber: null,
        rightText: '',
        status: 'removed',
      });
      leftIndex += 1;
      continue;
    }

    lines.push({
      leftNumber: null,
      leftText: '',
      rightNumber: rightIndex + 1,
      rightText: right[rightIndex]!,
      status: 'added',
    });
    rightIndex += 1;
  }

  while (leftIndex < left.length) {
    lines.push({
      leftNumber: leftIndex + 1,
      leftText: left[leftIndex]!,
      rightNumber: null,
      rightText: '',
      status: 'removed',
    });
    leftIndex += 1;
  }

  while (rightIndex < right.length) {
    lines.push({
      leftNumber: null,
      leftText: '',
      rightNumber: rightIndex + 1,
      rightText: right[rightIndex]!,
      status: 'added',
    });
    rightIndex += 1;
  }

  const paired = pairChanges(lines);
  return {
    lines: paired,
    changeCount: paired.filter((line) => line.status !== 'unchanged').length,
  };
}
