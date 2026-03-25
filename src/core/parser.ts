import type {
  AnalysisTarget,
  ArrayNode,
  AstNode,
  ObjectEntry,
  ObjectNode,
  ParseIssue,
  PrimitiveNode,
  SourceRange,
  Token,
} from '../types.js';
import { combineRanges } from '../utils/source.js';
import { normalizeWhitespace } from '../utils/strings.js';

interface ParseResult {
  ast: AstNode | null;
  issues: ParseIssue[];
}

class Parser {
  private index = 0;
  private readonly issues: ParseIssue[] = [];

  constructor(
    private readonly tokens: Token[],
    private readonly target: AnalysisTarget,
  ) {}

  parse(): ParseResult {
    const leadingComments = this.consumeComments();
    const ast = this.parseValue('$', this.commentsToDescription(leadingComments));
    this.consumeComments();

    if (!this.is('eof')) {
      const token = this.current();
      this.pushIssue('error', 'UNEXPECTED_TOKEN', '루트 값 뒤에 해석되지 않은 토큰이 남아 있습니다.', token.range, {
        actual: token.kind,
        suggestion: '추가 토큰을 제거하거나 올바른 JSON-like 구조로 맞춰주세요.',
      });
    }

    return { ast, issues: this.issues };
  }

  private current(offset = 0): Token {
    const resolvedIndex = Math.min(Math.max(this.index + offset, 0), this.tokens.length - 1);
    return this.tokens[resolvedIndex]!;
  }

  private is(kind: Token['kind'], offset = 0): boolean {
    return this.current(offset).kind === kind;
  }

  private advance(): Token {
    const token = this.current();
    if (this.index < this.tokens.length - 1) {
      this.index += 1;
    }
    return token;
  }

  private match(kind: Token['kind']): Token | null {
    if (this.is(kind)) {
      return this.advance();
    }
    return null;
  }

  private pushIssue(
    level: ParseIssue['level'],
    code: ParseIssue['code'],
    message: string,
    range: SourceRange,
    extra: Partial<ParseIssue> = {},
  ): void {
    this.issues.push({ target: this.target, level, code, message, range, ...extra });
  }

  private consumeComments(): Token[] {
    const comments: Token[] = [];
    while (this.is('comment')) {
      comments.push(this.advance());
    }
    return comments;
  }

  private commentsToDescription(comments: Token[]): string | undefined {
    if (comments.length === 0) {
      return undefined;
    }

    const merged = comments
      .map((comment) => normalizeWhitespace(comment.value.replace(/^\/+/, '').replace(/^\*+/, '')))
      .filter(Boolean)
      .join(' ');

    return merged || undefined;
  }

  private parseValue(path: string, description?: string): AstNode | null {
    const comments = this.consumeComments();
    const effectiveDescription = description ?? this.commentsToDescription(comments);
    const token = this.current();

    switch (token.kind) {
      case 'lbrace':
        return this.parseObject(path, effectiveDescription);
      case 'lbracket':
        return this.parseArray(path, effectiveDescription);
      case 'string': {
        const current = this.advance();
        return {
          type: 'string',
          value: current.value,
          path,
          range: current.range,
          description: effectiveDescription,
        } satisfies PrimitiveNode;
      }
      case 'number': {
        const current = this.advance();
        return {
          type: 'number',
          value: Number(current.value),
          path,
          range: current.range,
          description: effectiveDescription,
        } satisfies PrimitiveNode;
      }
      case 'boolean': {
        const current = this.advance();
        return {
          type: 'boolean',
          value: current.value === 'true',
          path,
          range: current.range,
          description: effectiveDescription,
        } satisfies PrimitiveNode;
      }
      case 'null': {
        const current = this.advance();
        this.pushIssue('warning', 'NULL_VALUE', 'null 값은 타입 추론이 제한될 수 있습니다.', current.range);
        return {
          type: 'null',
          value: null,
          path,
          range: current.range,
          description: effectiveDescription,
        } satisfies PrimitiveNode;
      }
      case 'identifier': {
        const current = this.advance();
        return {
          type: 'identifier',
          value: current.value,
          path,
          range: current.range,
          description: effectiveDescription,
        } satisfies PrimitiveNode;
      }
      case 'rbrace': {
        const current = this.advance();
        this.pushIssue(
          'error',
          'MISMATCH_BRACE',
          '`}` 가 나왔지만 여기서는 값이 필요합니다. 직전에 `]` 로 닫아야 하는 배열이 있는지 확인해주세요.',
          current.range,
          { expected: 'value', actual: 'rbrace' },
        );
        return null;
      }
      case 'rbracket': {
        const current = this.advance();
        this.pushIssue(
          'error',
          'MISMATCH_BRACKET',
          '`]` 가 나왔지만 여기서는 값이 필요합니다. 직전에 `}` 로 닫아야 하는 객체가 있는지 확인해주세요.',
          current.range,
          { expected: 'value', actual: 'rbracket' },
        );
        return null;
      }
      case 'eof':
        this.pushIssue('error', 'UNEXPECTED_EOF', '값을 읽는 중에 입력이 끝났습니다.', token.range);
        return null;
      default: {
        const current = this.advance();
        this.pushIssue('error', 'UNEXPECTED_TOKEN', `예상하지 못한 토큰 '${current.kind}' 입니다.`, current.range);
        return null;
      }
    }
  }

  private parseObject(path: string, description?: string): ObjectNode {
    const start = this.advance();
    const entries: ObjectEntry[] = [];
    let hasAdditionalFields = false;
    let trailingComma = false;

    while (!this.is('eof')) {
      const leadingComments = this.consumeComments();
      const token = this.current();

      if (token.kind === 'rbrace') {
        const end = this.advance();
        if (trailingComma) {
          this.pushIssue('warning', 'TRAILING_COMMA', '객체 마지막 콤마는 제거했습니다.', end.range);
        }
        return {
          type: 'object',
          path,
          entries,
          hasAdditionalFields,
          description,
          range: combineRanges(start.range, end.range),
        } satisfies ObjectNode;
      }

      if (token.kind === 'comma') {
        this.pushIssue('warning', 'RECOVERY', '불필요한 콤마를 건너뛰었습니다.', token.range);
        this.advance();
        trailingComma = true;
        continue;
      }

      if (token.kind === 'ellipsis') {
        hasAdditionalFields = true;
        this.pushIssue(
          'warning',
          'OBJECT_ELLIPSIS',
          '객체 내부의 ... 는 추가 필드 가능성으로 해석했습니다.',
          token.range,
          { suggestion: '문서 상에는 additional fields 가능으로 표시됩니다.' },
        );
        this.advance();
        this.consumeComments();
        if (this.match('comma')) {
          trailingComma = true;
        }
        continue;
      }

      if (token.kind === 'rbracket') {
        this.pushIssue(
          'error',
          'MISMATCH_BRACKET',
          '객체를 닫는 중에는 `}` 가 와야 하는데 `]` 가 나왔습니다.',
          token.range,
          { expected: 'rbrace', actual: 'rbracket' },
        );
        const end = this.advance();
        return {
          type: 'object',
          path,
          entries,
          hasAdditionalFields,
          description,
          range: combineRanges(start.range, end.range),
        } satisfies ObjectNode;
      }

      const keyToken = this.current();
      if (keyToken.kind !== 'string' && keyToken.kind !== 'identifier') {
        this.pushIssue('error', 'UNEXPECTED_TOKEN', '객체 키는 문자열 또는 식별자여야 합니다.', keyToken.range, {
          actual: keyToken.kind,
          suggestion: '예: "userId": 10',
        });
        this.recover(['comma', 'rbrace']);
        if (this.match('comma')) {
          trailingComma = true;
        }
        continue;
      }

      this.advance();
      const key = keyToken.value;
      const entryDescription = this.commentsToDescription(leadingComments);

      if (!this.match('colon')) {
        this.pushIssue('error', 'INVALID_COLON', '객체 키 뒤에 `:` 가 필요합니다.', this.current(-1)?.range ?? keyToken.range, {
          suggestion: '예: "userId": 10',
        });
      }

      const valuePath = path === '$' ? key : `${path}.${key}`;
      const value = this.parseValue(valuePath, entryDescription);
      const trailingComments = this.consumeComments();
      const finalDescription = entryDescription ?? this.commentsToDescription(trailingComments);

      if (value) {
        if (!value.description && finalDescription) {
          value.description = finalDescription;
        }

        entries.push({
          key,
          keyRange: keyToken.range,
          value,
          description: finalDescription,
        });
      }

      if (this.match('comma')) {
        trailingComma = true;
        continue;
      }

      trailingComma = false;
      if (this.is('rbrace')) {
        continue;
      }

      if (this.is('rbracket')) {
        this.pushIssue(
          'error',
          'MISMATCH_BRACKET',
          '객체를 닫는 중에는 `}` 가 와야 하는데 `]` 가 나왔습니다.',
          this.current().range,
          { expected: 'rbrace', actual: 'rbracket' },
        );
        continue;
      }

      if (this.is('eof')) {
        break;
      }

      this.pushIssue('error', 'UNEXPECTED_TOKEN', '객체 속성 뒤에는 `,` 또는 `}` 가 와야 합니다.', this.current().range);
      this.recover(['comma', 'rbrace']);
      if (this.match('comma')) {
        trailingComma = true;
      }
    }

    this.pushIssue('error', 'UNEXPECTED_EOF', '`{` 로 시작한 객체가 닫히지 않았습니다.', start.range, {
      suggestion: '`}` 를 추가해 주세요.',
    });

    const end = this.current().range;
    return {
      type: 'object',
      path,
      entries,
      hasAdditionalFields,
      description,
      range: combineRanges(start.range, end),
    } satisfies ObjectNode;
  }

  private parseArray(path: string, description?: string): ArrayNode {
    const start = this.advance();
    const items: AstNode[] = [];
    let hasOmittedItems = false;
    let itemDescription: string | undefined;
    let trailingComma = false;
    let itemIndex = 0;

    while (!this.is('eof')) {
      const leadingComments = this.consumeComments();
      const token = this.current();

      if (token.kind === 'rbracket') {
        const end = this.advance();
        if (trailingComma) {
          this.pushIssue('warning', 'TRAILING_COMMA', '배열 마지막 콤마는 제거했습니다.', end.range);
        }
        if (items.length === 0 && !hasOmittedItems) {
          this.pushIssue('warning', 'EMPTY_ARRAY', '빈 배열은 요소 타입 추론이 제한됩니다.', combineRanges(start.range, end.range));
        }
        return {
          type: 'array',
          path,
          items,
          hasOmittedItems,
          description,
          itemDescription,
          range: combineRanges(start.range, end.range),
        } satisfies ArrayNode;
      }

      if (token.kind === 'comma') {
        this.pushIssue('warning', 'RECOVERY', '불필요한 콤마를 건너뛰었습니다.', token.range);
        this.advance();
        trailingComma = true;
        continue;
      }

      if (token.kind === 'ellipsis') {
        hasOmittedItems = true;
        if (!itemDescription) {
          itemDescription = this.commentsToDescription(leadingComments);
        }
        this.pushIssue('warning', 'ELLIPSIS', '배열의 ... 는 추가 요소 생략으로 해석했습니다.', token.range);
        this.advance();
        this.consumeComments();
        if (this.match('comma')) {
          trailingComma = true;
        }
        continue;
      }

      if (token.kind === 'rbrace') {
        this.pushIssue(
          'error',
          'MISMATCH_BRACE',
          '배열을 닫는 중에는 `]` 가 와야 하는데 `}` 가 나왔습니다.',
          token.range,
          { expected: 'rbracket', actual: 'rbrace' },
        );
        const end = this.advance();
        return {
          type: 'array',
          path,
          items,
          hasOmittedItems,
          description,
          itemDescription,
          range: combineRanges(start.range, end.range),
        } satisfies ArrayNode;
      }

      const leadDescription = this.commentsToDescription(leadingComments);
      if (leadDescription && !itemDescription) {
        itemDescription = leadDescription;
      }
      const item = this.parseValue(`${path}[${itemIndex}]`, leadDescription);
      const trailingComments = this.consumeComments();
      const itemComment = leadDescription ?? this.commentsToDescription(trailingComments);
      if (item) {
        if (itemComment && !item.description) {
          item.description = itemComment;
        }
        items.push(item);
        itemIndex += 1;
      }

      if (this.match('comma')) {
        trailingComma = true;
        continue;
      }

      trailingComma = false;
      if (this.is('rbracket')) {
        continue;
      }

      if (this.is('rbrace')) {
        this.pushIssue(
          'error',
          'MISMATCH_BRACE',
          '배열을 닫는 중에는 `]` 가 와야 하는데 `}` 가 나왔습니다.',
          this.current().range,
          { expected: 'rbracket', actual: 'rbrace' },
        );
        continue;
      }

      if (this.is('eof')) {
        break;
      }

      this.pushIssue('error', 'UNEXPECTED_TOKEN', '배열 요소 뒤에는 `,` 또는 `]` 가 와야 합니다.', this.current().range);
      this.recover(['comma', 'rbracket']);
      if (this.match('comma')) {
        trailingComma = true;
      }
    }

    this.pushIssue('error', 'UNEXPECTED_EOF', '`[` 로 시작한 배열이 닫히지 않았습니다.', start.range, {
      suggestion: '`]` 를 추가해 주세요.',
    });

    return {
      type: 'array',
      path,
      items,
      hasOmittedItems,
      description,
      itemDescription,
      range: combineRanges(start.range, this.current().range),
    } satisfies ArrayNode;
  }

  private recover(kinds: Token['kind'][]): void {
    while (!this.is('eof') && !kinds.includes(this.current().kind)) {
      this.advance();
    }
  }
}

export function parseTokens(tokens: Token[], target: AnalysisTarget): ParseResult {
  const parser = new Parser(tokens, target);
  return parser.parse();
}
