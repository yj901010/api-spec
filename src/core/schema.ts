import type { ArrayNode, AstNode, FieldSchema, ParseIssue, SchemaOverride, SchemaResult, SchemaRow } from '../types.js';
import { emptyRange } from '../utils/source.js';
import { formatExample } from './pretty.js';

const JAVA_RESERVED = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'do',
  'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof',
  'int', 'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static',
  'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while',
]);

function primitiveType(node: AstNode): string {
  switch (node.type) {
    case 'identifier':
      return 'string';
    default:
      return node.type;
  }
}

function exampleFromNode(node: AstNode): unknown {
  switch (node.type) {
    case 'object': {
      const output: Record<string, unknown> = {};
      for (const entry of node.entries) {
        output[entry.key] = exampleFromNode(entry.value);
      }
      return output;
    }
    case 'array':
      return node.items.map(exampleFromNode);
    case 'identifier':
      return String(node.value);
    default:
      return node.value;
  }
}

function inferNode(node: AstNode, name: string, path: string, required = true, description?: string): FieldSchema {
  if (node.type === 'object') {
    return {
      name,
      path,
      type: 'object',
      inferredType: 'object',
      required,
      description: description ?? node.description,
      example: undefined,
      children: node.entries.map((entry) => inferNode(entry.value, entry.key, path === '$' ? entry.key : `${path}.${entry.key}`, true, entry.description ?? entry.value.description)),
      hasAdditionalFields: node.hasAdditionalFields,
    };
  }

  if (node.type === 'array') {
    const itemSchema = mergeArrayItems(node, path, name);
    const itemType = itemSchema?.type ?? 'unknown';
    return {
      name,
      path,
      type: `array<${itemType}>`,
      inferredType: `array<${itemType}>`,
      required,
      description: description ?? node.description,
      example: node.items.length > 0 ? formatExample(node.items.map((item) => exampleFromNode(item))) : '[]',
      children: itemSchema ? itemSchema.children : [],
      itemType,
      hasOmittedItems: node.hasOmittedItems,
      hasAdditionalFields: itemSchema?.hasAdditionalFields,
      format: undefined,
      enumValues: [],
      nullable: false,
    };
  }

  const type = primitiveType(node);
  return {
    name,
    path,
    type,
    inferredType: type,
    required,
    description: description ?? node.description,
    example: formatExample(exampleFromNode(node)),
    children: [],
    format: detectFormat(type, formatExample(exampleFromNode(node))),
    enumValues: [],
    nullable: type === 'null',
  };
}

function mergeArrayItems(node: ArrayNode, path: string, name: string): FieldSchema | null {
  if (node.items.length === 0) {
    return null;
  }

  const first = node.items[0]!;
  const itemPath = `${path}[]`;
  let merged = inferNode(first, `${name}[]`, itemPath, true, node.itemDescription ?? first.description);

  for (let index = 1; index < node.items.length; index += 1) {
    const current = node.items[index]!;
    merged = mergeSchemas(merged, inferNode(current, `${name}[]`, itemPath, true, current.description));
  }

  return merged;
}

export function cloneSchema(schema: FieldSchema | null): FieldSchema | null {
  return schema ? structuredClone(schema) : null;
}

export function mergeSchemas(base: FieldSchema, incoming: FieldSchema): FieldSchema {
  if (base.type === incoming.type && !base.type.startsWith('array<') && base.type !== 'object') {
    return {
      ...base,
      inferredType: base.inferredType ?? base.type,
      description: base.description ?? incoming.description,
      example: base.example ?? incoming.example,
      format: base.format ?? incoming.format,
      enumValues: base.enumValues && base.enumValues.length > 0 ? base.enumValues : incoming.enumValues,
      nullable: Boolean(base.nullable || incoming.nullable),
    };
  }

  if (base.type === 'object' && incoming.type === 'object') {
    const mergedChildren = mergeObjectChildren(base.children, incoming.children);
    return {
      ...base,
      description: base.description ?? incoming.description,
      hasAdditionalFields: base.hasAdditionalFields || incoming.hasAdditionalFields,
      children: mergedChildren,
      nullable: Boolean(base.nullable || incoming.nullable),
    };
  }

  if (base.type.startsWith('array<') && incoming.type.startsWith('array<')) {
    return {
      ...base,
      description: base.description ?? incoming.description,
      hasOmittedItems: base.hasOmittedItems || incoming.hasOmittedItems,
      hasAdditionalFields: base.hasAdditionalFields || incoming.hasAdditionalFields,
      itemType: base.itemType === incoming.itemType ? base.itemType : 'mixed',
      type: base.itemType === incoming.itemType ? base.type : 'array<mixed>',
      inferredType: base.itemType === incoming.itemType ? base.type : 'array<mixed>',
      children: mergeObjectChildren(base.children, incoming.children),
      nullable: Boolean(base.nullable || incoming.nullable),
    };
  }

  return {
    ...base,
    type: 'mixed',
    inferredType: base.inferredType ?? base.type,
    description: base.description ?? incoming.description,
    example: base.example ?? incoming.example,
    children: mergeObjectChildren(base.children, incoming.children),
    nullable: Boolean(base.nullable || incoming.nullable),
  };
}

function mergeObjectChildren(base: FieldSchema[], incoming: FieldSchema[]): FieldSchema[] {
  const map = new Map<string, FieldSchema>();

  for (const child of base) {
    map.set(child.path, { ...child, children: child.children.map((current) => structuredClone(current)) });
  }

  for (const child of incoming) {
    if (map.has(child.path)) {
      const existing = map.get(child.path)!;
      const merged = mergeSchemas(existing, child);
      merged.required = existing.required && child.required;
      map.set(child.path, merged);
    } else {
      map.set(child.path, { ...structuredClone(child), required: false });
    }
  }

  for (const existing of base) {
    const found = incoming.find((candidate) => candidate.path === existing.path);
    if (!found) {
      const current = map.get(existing.path)!;
      current.required = false;
      map.set(existing.path, current);
    }
  }

  return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
}

export function mergeSchemaRoots(roots: Array<FieldSchema | null>): FieldSchema | null {
  const validRoots = roots.filter((root): root is FieldSchema => Boolean(root));
  if (validRoots.length === 0) {
    return null;
  }
  let merged = structuredClone(validRoots[0]!);
  for (let index = 1; index < validRoots.length; index += 1) {
    merged = mergeSchemas(merged, structuredClone(validRoots[index]!));
  }
  return merged;
}

function parseType(type: string): { base: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'mixed'; itemType?: string } {
  if (type === 'object' || type === 'string' || type === 'number' || type === 'boolean' || type === 'null' || type === 'mixed') {
    return { base: type };
  }
  const arrayMatch = type.match(/^array<(.+)>$/);
  if (arrayMatch) {
    return { base: 'array', itemType: arrayMatch[1] };
  }
  return { base: 'string' };
}

function normalizeSchemaForType(node: FieldSchema): FieldSchema {
  const parsed = parseType(node.type);
  if (parsed.base === 'object') {
    return {
      ...node,
      type: 'object',
      itemType: undefined,
    };
  }
  if (parsed.base === 'array') {
    return {
      ...node,
      itemType: parsed.itemType || node.itemType || 'string',
      type: `array<${parsed.itemType || node.itemType || 'string'}>`,
      children: parsed.itemType === 'object' ? node.children : [],
    };
  }
  return {
    ...node,
    type: parsed.base,
    itemType: undefined,
    children: [],
  };
}

export function applySchemaOverrides(root: FieldSchema | null, overrides: Record<string, SchemaOverride>): FieldSchema | null {
  if (!root) {
    return null;
  }

  const visit = (node: FieldSchema): FieldSchema | null => {
    const override = overrides[node.path];
    if (override?.include === false) {
      return null;
    }

    let current: FieldSchema = { ...structuredClone(node) };
    if (override) {
      current = {
        ...current,
        type: override.type ?? current.type,
        required: override.required ?? current.required,
        description: override.description ?? current.description,
        example: override.example ?? current.example,
        format: override.format ?? current.format,
        enumValues: override.enumValues ?? current.enumValues,
        nullable: override.nullable ?? current.nullable,
      };
      current = normalizeSchemaForType(current);
    }

    current.children = current.children
      .map((child) => visit(child))
      .filter((child): child is FieldSchema => Boolean(child));
    return current;
  };

  return visit(root);
}

export function schemaRowsFromRoot(schema: FieldSchema | null): SchemaRow[] {
  if (!schema) {
    return [];
  }

  const rows: SchemaRow[] = [];
  const visit = (node: FieldSchema, isRoot = false): void => {
    if (!isRoot || node.type !== 'object') {
      rows.push({
        path: node.path,
        name: node.name,
        type: node.type,
        inferredType: node.inferredType ?? node.type,
        required: node.required,
        description: node.description ?? '',
        example: node.example ?? '',
        notes: [
          ...(node.hasOmittedItems ? ['생략된 추가 요소 있음'] : []),
          ...(node.hasAdditionalFields ? ['추가 필드 가능'] : []),
          ...(node.type === 'mixed' ? ['혼합 타입'] : []),
        ],
        format: node.format,
        enumValues: node.enumValues ?? [],
        nullable: Boolean(node.nullable),
        include: true,
      });
    }

    for (const child of node.children) {
      visit(child);
    }
  };

  visit(schema, true);
  return rows;
}

function detectFormat(type: string, example?: string): string | undefined {
  if (type !== 'string' || !example) {
    return undefined;
  }
  const normalized = example.replace(/^"|"$/g, '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return 'date';
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(normalized)) {
    return 'date-time';
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    return 'uuid';
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return 'email';
  }
  return undefined;
}

function hasSensitivePattern(example?: string): boolean {
  if (!example) {
    return false;
  }
  const normalized = example.replace(/^"|"$/g, '');
  return (
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ||
    /^01[0-9]-?\d{3,4}-?\d{4}$/.test(normalized) ||
    /(?:Bearer\s+)?[A-Za-z0-9-_]{20,}/.test(normalized) ||
    /^\d{10,16}$/.test(normalized)
  );
}

function collectSchemaIssues(node: FieldSchema, target: 'request' | 'response', issues: ParseIssue[]): void {
  if (node.type === 'mixed') {
    issues.push({
      target,
      level: 'warning',
      code: 'MIXED_ARRAY_TYPES',
      message: `${node.path} 경로에서 혼합 타입이 감지되었습니다.`,
      range: emptyRange(),
      suggestion: '가능하면 배열 요소 타입을 통일해 주세요.',
      navigable: false,
    });
  }

  if (node.type === 'null') {
    issues.push({
      target,
      level: 'warning',
      code: 'NULL_VALUE',
      message: `${node.path} 경로는 null 값만 보여 타입 확정이 어렵습니다.`,
      range: emptyRange(),
      navigable: false,
    });
  }

  if (/[\-_]/.test(node.name) && node.path !== '$') {
    issues.push({
      target,
      level: 'info',
      code: 'NAMING_STYLE',
      message: `${node.path} 필드명은 camelCase 가 아니어서 Java 코드 생성 시 이름 보정이 필요할 수 있습니다.`,
      range: emptyRange(),
      navigable: false,
    });
  }

  if (JAVA_RESERVED.has(node.name)) {
    issues.push({
      target,
      level: 'warning',
      code: 'JAVA_RESERVED_WORD',
      message: `${node.path} 필드명은 Java 예약어와 충돌할 수 있습니다.`,
      range: emptyRange(),
      navigable: false,
    });
  }

  if (node.format) {
    issues.push({
      target,
      level: 'info',
      code: 'FORMAT_HINT',
      message: `${node.path} 값은 '${node.format}' 포맷으로 보입니다.`,
      range: emptyRange(),
      navigable: false,
    });
  }

  if (hasSensitivePattern(node.example)) {
    issues.push({
      target,
      level: 'warning',
      code: 'SENSITIVE_DATA',
      message: `${node.path} 예시값이 민감정보처럼 보입니다. export 전에 마스킹을 권장합니다.`,
      range: emptyRange(),
      suggestion: '상단의 민감값 마스킹 기능으로 예시를 정리하세요.',
      navigable: false,
    });
  }

  for (const child of node.children) {
    collectSchemaIssues(child, target, issues);
  }
}

export function schemaResultFromRoot(
  root: FieldSchema | null,
  target: 'request' | 'response',
  variantNames: string[] = [],
): SchemaResult {
  const rows = schemaRowsFromRoot(root);
  const issues: ParseIssue[] = [];
  if (root) {
    collectSchemaIssues(root, target, issues);
  }
  return {
    root,
    rows,
    issues,
    variantCount: variantNames.length,
    variantNames,
  };
}

export function inferSchema(ast: AstNode | null, target: 'request' | 'response'): SchemaResult {
  if (!ast) {
    return { root: null, rows: [], issues: [], variantCount: 0, variantNames: [] };
  }

  const root = inferNode(ast, '$', '$', true, ast.description);
  return schemaResultFromRoot(root, target, []);
}
