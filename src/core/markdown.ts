import type { AnalysisResult, EndpointDocument, GenerationPreset, SchemaRow } from '../types.js';

function renderRows(rows: SchemaRow[]): string {
  if (rows.length === 0) {
    return '_No inferred fields._';
  }
  const header = '| Path | Type | Required | Description | Example | Notes |\n|---|---|---:|---|---|---|';
  const body = rows
    .map((row) => `| \`${row.path}\` | ${row.type} | ${row.required ? 'Y' : 'N'} | ${row.description || '-'} | \`${(row.example || '').replace(/\|/g, '\\|')}\` | ${row.notes.join(', ') || '-'} |`)
    .join('\n');
  return `${header}\n${body}`;
}

export function renderMarkdownDocument(
  document: EndpointDocument,
  preset: GenerationPreset,
  request: AnalysisResult,
  response: AnalysisResult,
  payloadText: string,
): string {
  const requestMode = document.requestMode || 'json';
  const tags = Array.isArray(document.tags) ? document.tags : [];
  return `# ${document.name}\n\n## Endpoint\n\n- Method: **${document.endpoint.httpMethod}**\n- Path: \`${document.endpoint.basePath || ''}${document.endpoint.endpointPath || ''}\`\n- Request Mode: **${requestMode}**\n- Preset: **${preset.name}**\n- Tags: ${tags.length > 0 ? tags.join(', ') : '-'}\n\n## Params\n\n${document.params.length === 0 ? '_No params._' : document.params.map((param) => `- ${param.source} \`${param.name}\` (${param.javaType})${param.required ? ' required' : ''}${param.description ? ` — ${param.description}` : ''}`).join('\n')}\n\n## Request Example\n\n\`\`\`json\n${payloadText}\n\`\`\`\n\n## Request Schema\n\n${renderRows(request.schema.rows)}\n\n## Response Example\n\n\`\`\`json\n${response.normalizedText || document.responseRaw}\n\`\`\`\n\n## Response Schema\n\n${renderRows(response.schema.rows)}\n`;
}
