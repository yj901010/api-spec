import type { AnalysisResult, EndpointDocument, FieldSchema, GenerationPreset } from '../types.js';
import { astToValue } from './pretty.js';
import { indent, toCamelCase, toPascalCase } from '../utils/strings.js';

interface DtoField {
  name: string;
  javaType: string;
  description?: string;
}

interface DtoClassDef {
  name: string;
  description?: string;
  fields: DtoField[];
  nested: DtoClassDef[];
  isRoot: boolean;
  notes: string[];
}

export interface DtoArtifact {
  className: string;
  rootJavaType: string;
  code: string;
  fileName: string;
}

function safeSuffix(value: string): string {
  const suffix = toPascalCase(value || 'Dto');
  return suffix || 'Dto';
}

function singularize(name: string): string {
  const pascal = toPascalCase(name);
  if (pascal.endsWith('List')) {
    return pascal.slice(0, -4) || 'Item';
  }
  if (pascal.endsWith('ies')) {
    return `${pascal.slice(0, -3)}y`;
  }
  if (pascal.endsWith('s') && pascal.length > 1) {
    return pascal.slice(0, -1);
  }
  return pascal || 'Item';
}

function primitiveJavaType(type: string, example?: string): string {
  switch (type) {
    case 'string':
      return 'String';
    case 'boolean':
      return 'Boolean';
    case 'number':
      if (typeof example === 'string' && example.includes('.')) {
        return 'Double';
      }
      return 'Long';
    case 'null':
    case 'mixed':
      return 'Object';
    default:
      return 'Object';
  }
}

function dtoAnnotations(preset: GenerationPreset): string[] {
  if (!preset.includeLombok) {
    return [];
  }
  return ['@Getter', '@Setter', '@Builder', '@NoArgsConstructor', '@AllArgsConstructor'];
}

function dtoImports(def: DtoClassDef, preset: GenerationPreset): string[] {
  const imports = new Set<string>();

  const visit = (classDef: DtoClassDef): void => {
    for (const field of classDef.fields) {
      if (field.javaType.startsWith('List<')) {
        imports.add('import java.util.List;');
      }
    }
    for (const nested of classDef.nested) {
      visit(nested);
    }
  };
  visit(def);

  if (preset.includeLombok) {
    imports.add('import lombok.AllArgsConstructor;');
    imports.add('import lombok.Builder;');
    imports.add('import lombok.Getter;');
    imports.add('import lombok.NoArgsConstructor;');
    imports.add('import lombok.Setter;');
  }

  return Array.from(imports).sort();
}

function gettersAndSetters(fields: DtoField[]): string {
  if (fields.length === 0) {
    return '';
  }

  return fields
    .map((field) => {
      const methodSuffix = toPascalCase(field.name) || 'Value';
      const getterPrefix = field.javaType === 'Boolean' ? 'get' : 'get';
      return `public ${field.javaType} ${getterPrefix}${methodSuffix}() {
    return ${field.name};
}

public void set${methodSuffix}(${field.javaType} ${field.name}) {
    this.${field.name} = ${field.name};
}`;
    })
    .join('\n\n');
}

function arrayItemShape(schema: FieldSchema): FieldSchema | null {
  if (schema.children.length > 0) {
    return {
      name: `${schema.name}Item`,
      path: `${schema.path}[]`,
      type: 'object',
      required: true,
      description: schema.description,
      example: undefined,
      children: schema.children,
      hasAdditionalFields: schema.hasAdditionalFields,
      hasOmittedItems: schema.hasOmittedItems,
      itemType: schema.itemType,
    };
  }
  return null;
}

function buildObjectDef(schema: FieldSchema, className: string): DtoClassDef {
  const fields: DtoField[] = [];
  const nested: DtoClassDef[] = [];
  const notes: string[] = [];

  if (schema.hasAdditionalFields) {
    notes.push('additional fields possible');
  }
  if (schema.hasOmittedItems) {
    notes.push('omitted items in example');
  }

  for (const child of schema.children) {
    const fieldName = toCamelCase(child.name) || 'value';
    if (child.type === 'object') {
      const nestedName = toPascalCase(child.name) || 'Nested';
      nested.push(buildObjectDef(child, nestedName));
      fields.push({ name: fieldName, javaType: nestedName, description: child.description });
      continue;
    }

    if (child.type.startsWith('array<')) {
      const itemShape = arrayItemShape(child);
      if (itemShape) {
        const nestedName = `${singularize(child.name)}Item`;
        nested.push(buildObjectDef(itemShape, nestedName));
        fields.push({ name: fieldName, javaType: `List<${nestedName}>`, description: child.description });
      } else {
        const itemType = child.itemType ? primitiveJavaType(child.itemType) : 'Object';
        fields.push({ name: fieldName, javaType: `List<${itemType}>`, description: child.description });
      }
      continue;
    }

    fields.push({
      name: fieldName,
      javaType: primitiveJavaType(child.type, child.example),
      description: child.description,
    });
  }

  return {
    name: className,
    description: schema.description,
    fields,
    nested,
    isRoot: false,
    notes,
  };
}

function renderClass(def: DtoClassDef, preset: GenerationPreset, depth = 0): string {
  const lines: string[] = [];
  const annotations = dtoAnnotations(preset);
  const indentation = '    '.repeat(depth);

  for (const annotation of annotations) {
    lines.push(`${indentation}${annotation}`);
  }
  if (def.description) {
    lines.push(`${indentation}/** ${def.description} */`);
  }
  for (const note of def.notes) {
    lines.push(`${indentation}// ${note}`);
  }

  const declaration = depth === 0 ? `public class ${def.name} {` : `public static class ${def.name} {`;
  lines.push(`${indentation}${declaration}`);

  if (def.fields.length === 0) {
    lines.push(`${indentation}    // no fields inferred from example`);
  }

  for (const field of def.fields) {
    if (field.description) {
      lines.push(`${indentation}    /** ${field.description} */`);
    }
    lines.push(`${indentation}    private ${field.javaType} ${field.name};`);
    lines.push('');
  }

  if (!preset.includeLombok && def.fields.length > 0) {
    lines.push(indent(gettersAndSetters(def.fields), (depth + 1) * 4));
    lines.push('');
  }

  for (const nested of def.nested) {
    lines.push(renderClass(nested, preset, depth + 1));
    lines.push('');
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  lines.push(`${indentation}}`);
  return lines.join('\n');
}

function rootTypeNote(rootJavaType: string): string {
  if (rootJavaType.startsWith('List<')) {
    return `// root payload type: ${rootJavaType}`;
  }
  if (rootJavaType !== 'Object' && rootJavaType !== 'String') {
    return `// root payload type: ${rootJavaType}`;
  }
  return '';
}

function wrapRootArray(schema: FieldSchema, wrapperName: string, wrapperField: string): DtoClassDef {
  const itemShape = arrayItemShape(schema);
  const nested: DtoClassDef[] = [];
  let fieldType = 'List<Object>';
  if (itemShape) {
    const itemClassName = `${singularize(wrapperField)}Item`;
    nested.push(buildObjectDef(itemShape, itemClassName));
    fieldType = `List<${itemClassName}>`;
  } else if (schema.itemType) {
    fieldType = `List<${primitiveJavaType(schema.itemType)}>`;
  }

  return {
    name: wrapperName,
    description: schema.description,
    fields: [
      {
        name: toCamelCase(wrapperField) || 'items',
        javaType: fieldType,
        description: 'wrapped root array payload',
      },
    ],
    nested,
    isRoot: true,
    notes: ['root array wrapped for controller compatibility'],
  };
}

function buildDtoArtifact(
  schema: FieldSchema | null,
  preset: GenerationPreset,
  className: string,
  kind: 'request' | 'response',
  rootArrayStrategy: 'block' | 'wrap',
  wrapperField: string,
  analysis: AnalysisResult,
): DtoArtifact {
  const fileName = `${className}.java`;
  if (!schema) {
    const code = `public class ${className} {\n    // no parseable ${kind} schema\n}\n`;
    return { className, rootJavaType: 'Object', code, fileName };
  }

  if (schema.type === 'object') {
    const rootDef = buildObjectDef(schema, className);
    rootDef.isRoot = true;
    const imports = dtoImports(rootDef, preset);
    const code = `${imports.join('\n')}${imports.length > 0 ? '\n\n' : ''}${renderClass(rootDef, preset)}\n`;
    return { className, rootJavaType: className, code, fileName };
  }

  if (schema.type.startsWith('array<')) {
    if (kind === 'request' && rootArrayStrategy === 'wrap') {
      const wrapped = wrapRootArray(schema, className, wrapperField);
      const imports = dtoImports(wrapped, preset);
      const code = `${imports.join('\n')}${imports.length > 0 ? '\n\n' : ''}${renderClass(wrapped, preset)}\n`;
      return { className, rootJavaType: className, code, fileName };
    }

    const itemShape = arrayItemShape(schema);
    const itemClassName = `${className}Item`;
    const rootJavaType = itemShape ? `List<${itemClassName}>` : `List<${schema.itemType ? primitiveJavaType(schema.itemType) : 'Object'}>`;
    if (itemShape) {
      const itemDef = buildObjectDef(itemShape, itemClassName);
      itemDef.isRoot = true;
      const imports = dtoImports(itemDef, preset);
      const note = rootTypeNote(rootJavaType);
      const code = `${imports.join('\n')}${imports.length > 0 ? '\n\n' : ''}${note ? `${note}\n` : ''}${renderClass(itemDef, preset)}\n`;
      return { className, rootJavaType, code, fileName };
    }

    const example = analysis.ast ? JSON.stringify(astToValue(analysis.ast), null, 2) : '[]';
    const code = `${rootTypeNote(rootJavaType)}\n// primitive array example\n// ${example.replace(/\n/g, '\n// ')}\n`;
    return { className, rootJavaType, code, fileName };
  }

  const primitiveType = primitiveJavaType(schema.type, schema.example);
  const code = `// plain ${kind} payload\n// root type: ${primitiveType}\n// example: ${analysis.ast ? JSON.stringify(astToValue(analysis.ast)) : 'null'}\n`;
  return { className, rootJavaType: primitiveType, code, fileName };
}

export function generateDtoArtifacts(
  document: EndpointDocument,
  preset: GenerationPreset,
  request: AnalysisResult,
  response: AnalysisResult,
): { requestDto: DtoArtifact; responseDto: DtoArtifact; bundle: string } {
  const suffix = safeSuffix(preset.dtoSuffix);
  const baseName = toPascalCase(document.endpoint.methodName || document.name || 'Generated');
  const requestClassName = `${baseName}Request${suffix}`;
  const responseClassName = `${baseName}Response${suffix}`;

  const requestDto = buildDtoArtifact(
    request.schema.root,
    preset,
    requestClassName,
    'request',
    preset.rootArrayRequestStrategy,
    preset.rootArrayWrapperField,
    request,
  );

  const responseDto = buildDtoArtifact(
    response.schema.root,
    preset,
    responseClassName,
    'response',
    'block',
    preset.rootArrayWrapperField,
    response,
  );

  const bundle = `// Request DTO\n${requestDto.code}\n\n// Response DTO\n${responseDto.code}`;
  return { requestDto, responseDto, bundle };
}
