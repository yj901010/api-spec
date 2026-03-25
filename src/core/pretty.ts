import type { AstNode } from '../types.js';

export function astToValue(node: AstNode): unknown {
  switch (node.type) {
    case 'object': {
      const output: Record<string, unknown> = {};
      for (const entry of node.entries) {
        output[entry.key] = astToValue(entry.value);
      }
      return output;
    }
    case 'array':
      return node.items.map((item) => astToValue(item));
    case 'identifier':
    case 'string':
      return String(node.value);
    case 'number':
    case 'boolean':
    case 'null':
      return node.value;
    default:
      return null;
  }
}

export function formatNormalized(node: AstNode | null): string {
  if (!node) {
    return '';
  }

  return JSON.stringify(astToValue(node), null, 2);
}

export function formatExample(value: unknown): string {
  if (value === undefined) {
    return '';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}
