import type { AnalysisResult, AnalysisTarget } from '../types.js';
import { formatNormalized } from './pretty.js';
import { parseTokens } from './parser.js';
import { inferSchema } from './schema.js';
import { tokenize } from './tokenizer.js';

function sortIssues<T extends { range: { start: { index: number } }; level: string }>(issues: T[]): T[] {
  const severityRank = { error: 0, warning: 1, info: 2 } as const;
  return [...issues].sort((left, right) => {
    if (left.range.start.index !== right.range.start.index) {
      return left.range.start.index - right.range.start.index;
    }
    return severityRank[left.level as keyof typeof severityRank] - severityRank[right.level as keyof typeof severityRank];
  });
}

function dedupeIssues<T extends { code?: string; message?: string; range: { start: { index: number; line: number; column: number }; end: { index: number } }; level: string }>(
  issues: T[],
): T[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = [
      issue.level,
      issue.code || '',
      issue.message || '',
      issue.range.start.index,
      issue.range.start.line,
      issue.range.start.column,
      issue.range.end.index,
    ].join('|');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function analyzeInput(raw: string, target: Extract<AnalysisTarget, 'request' | 'response'>): AnalysisResult {
  const tokenized = tokenize(raw, target);
  const parsed = parseTokens(tokenized.tokens, target);
  const schema = inferSchema(parsed.ast, target);
  const issues = sortIssues(dedupeIssues([...tokenized.issues, ...parsed.issues, ...schema.issues]));

  return {
    target,
    raw,
    tokens: tokenized.tokens,
    ast: parsed.ast,
    normalizedText: formatNormalized(parsed.ast),
    issues,
    schema,
  };
}
