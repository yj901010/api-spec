import type { AnalysisResult, AnalysisTarget, ExampleVariant, SchemaOverride } from '../types.js';
import { analyzeInput } from './analyzer.js';
import { applySchemaOverrides, mergeSchemaRoots, schemaResultFromRoot } from './schema.js';

function decorateVariantIssues(result: AnalysisResult, variant: ExampleVariant): AnalysisResult['issues'] {
  return result.issues.map((issue) => ({
    ...issue,
    message: `[${variant.name}] ${issue.message}`,
    sourceLabel: variant.name,
    navigable: false,
  }));
}

function dedupeIssues(issues: AnalysisResult['issues']): AnalysisResult['issues'] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = [issue.level, issue.code, issue.message, issue.sourceLabel || '', issue.range.start.index, issue.range.start.line].join('|');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function analyzeVariantSet(
  primaryRaw: string,
  variants: ExampleVariant[],
  target: Extract<AnalysisTarget, 'request' | 'response'>,
  overrides: Record<string, SchemaOverride> = {},
): AnalysisResult {
  const primary = analyzeInput(primaryRaw, target);
  const enabledVariants = variants.filter((variant) => variant.enabled && variant.raw.trim().length > 0);
  const variantResults = enabledVariants.map((variant) => ({ variant, result: analyzeInput(variant.raw, target) }));
  const mergedRoot = mergeSchemaRoots([primary.schema.root, ...variantResults.map(({ result }) => result.schema.root)]);
  const overriddenRoot = applySchemaOverrides(mergedRoot, overrides);
  const schema = schemaResultFromRoot(overriddenRoot, target, enabledVariants.map((variant) => variant.name));

  return {
    ...primary,
    issues: dedupeIssues([
      ...primary.issues,
      ...variantResults.flatMap(({ variant, result }) => decorateVariantIssues(result, variant)),
      ...schema.issues,
    ]),
    schema,
    variants: structuredClone(variants),
  };
}
