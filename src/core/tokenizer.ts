import type { AnalysisTarget, ParseIssue, Token, TokenKind } from '../types.js';
import { createRange } from '../utils/source.js';

interface Cursor {
  index: number;
  line: number;
  column: number;
}

interface TokenizeResult {
  tokens: Token[];
  issues: ParseIssue[];
}

const SINGLE_CHAR_TOKENS: Record<string, TokenKind> = {
  '{': 'lbrace',
  '}': 'rbrace',
  '[': 'lbracket',
  ']': 'rbracket',
  ':': 'colon',
  ',': 'comma',
};

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t';
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_$-]/.test(char);
}

function cloneCursor(cursor: Cursor): Cursor {
  return { index: cursor.index, line: cursor.line, column: cursor.column };
}

function createIssue(
  target: AnalysisTarget,
  level: ParseIssue['level'],
  code: ParseIssue['code'],
  message: string,
  start: Cursor,
  end: Cursor,
  extra: Partial<ParseIssue> = {},
): ParseIssue {
  return {
    target,
    level,
    code,
    message,
    range: createRange(start, end),
    ...extra,
  };
}

export function tokenize(input: string, target: AnalysisTarget): TokenizeResult {
  const cursor: Cursor = { index: 0, line: 1, column: 1 };
  const tokens: Token[] = [];
  const issues: ParseIssue[] = [];

  const current = (): string => input[cursor.index] ?? '';
  const peek = (offset = 1): string => input[cursor.index + offset] ?? '';

  const advance = (): string => {
    const char = input[cursor.index] ?? '';

    if (char === '\n') {
      cursor.index += 1;
      cursor.line += 1;
      cursor.column = 1;
      return char;
    }

    cursor.index += 1;
    cursor.column += 1;
    return char;
  };

  const pushToken = (kind: TokenKind, value: string, start: Cursor, end: Cursor): void => {
    tokens.push({ kind, value, range: createRange(start, end) });
  };

  while (cursor.index < input.length) {
    const char = current();

    if (isWhitespace(char)) {
      advance();
      continue;
    }

    const start = cloneCursor(cursor);

    const singleKind = SINGLE_CHAR_TOKENS[char as keyof typeof SINGLE_CHAR_TOKENS];
    if (singleKind) {
      advance();
      pushToken(singleKind, char, start, cloneCursor(cursor));
      continue;
    }

    if (char === '.' && peek() === '.' && peek(2) === '.') {
      advance();
      advance();
      advance();
      pushToken('ellipsis', '...', start, cloneCursor(cursor));
      continue;
    }

    if (char === '/' && peek() === '/') {
      advance();
      advance();
      let value = '';
      while (cursor.index < input.length && current() !== '\n') {
        value += advance();
      }
      pushToken('comment', value.trim(), start, cloneCursor(cursor));
      issues.push(
        createIssue(target, 'info', 'COMMENT_FOUND', '한 줄 주석을 설명으로 반영했습니다.', start, cloneCursor(cursor)),
      );
      continue;
    }

    if (char === '/' && peek() === '*') {
      advance();
      advance();
      let value = '';
      let closed = false;
      while (cursor.index < input.length) {
        if (current() === '*' && peek() === '/') {
          advance();
          advance();
          closed = true;
          break;
        }
        value += advance();
      }

      if (!closed) {
        issues.push(
          createIssue(
            target,
            'error',
            'UNCLOSED_BLOCK_COMMENT',
            '닫히지 않은 블록 주석입니다.',
            start,
            cloneCursor(cursor),
            { suggestion: '/* ... */ 형태로 주석을 닫아주세요.' },
          ),
        );
      }

      pushToken('comment', value.trim(), start, cloneCursor(cursor));
      if (closed) {
        issues.push(
          createIssue(target, 'info', 'COMMENT_FOUND', '블록 주석을 설명으로 반영했습니다.', start, cloneCursor(cursor)),
        );
      }
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      advance();
      let value = '';
      let closed = false;

      while (cursor.index < input.length) {
        const currentChar = current();
        if (currentChar === '\\') {
          value += advance();
          if (cursor.index < input.length) {
            value += advance();
          }
          continue;
        }

        if (currentChar === quote) {
          advance();
          closed = true;
          break;
        }

        value += advance();
      }

      if (!closed) {
        issues.push(
          createIssue(
            target,
            'error',
            'UNCLOSED_STRING',
            '문자열이 닫히지 않았습니다.',
            start,
            cloneCursor(cursor),
            { suggestion: `${quote} 로 문자열을 닫아주세요.` },
          ),
        );
      }

      pushToken('string', value, start, cloneCursor(cursor));
      continue;
    }

    if (char === '-' || isDigit(char)) {
      let value = '';
      if (char === '-') {
        value += advance();
      }

      let hasDigit = false;
      while (isDigit(current())) {
        hasDigit = true;
        value += advance();
      }

      if (current() === '.') {
        value += advance();
        while (isDigit(current())) {
          hasDigit = true;
          value += advance();
        }
      }

      if ((current() === 'e' || current() === 'E') && (isDigit(peek()) || ['+', '-'].includes(peek()))) {
        value += advance();
        if (current() === '+' || current() === '-') {
          value += advance();
        }
        while (isDigit(current())) {
          hasDigit = true;
          value += advance();
        }
      }

      if (!hasDigit || Number.isNaN(Number(value))) {
        issues.push(
          createIssue(target, 'error', 'INVALID_NUMBER', '숫자 형식이 올바르지 않습니다.', start, cloneCursor(cursor)),
        );
      }

      pushToken('number', value, start, cloneCursor(cursor));
      continue;
    }

    if (isIdentifierStart(char)) {
      let value = '';
      while (isIdentifierPart(current())) {
        value += advance();
      }

      if (value === 'true' || value === 'false') {
        pushToken('boolean', value, start, cloneCursor(cursor));
      } else if (value === 'null') {
        pushToken('null', value, start, cloneCursor(cursor));
      } else {
        pushToken('identifier', value, start, cloneCursor(cursor));
      }
      continue;
    }

    advance();
    issues.push(
      createIssue(
        target,
        'error',
        'UNEXPECTED_CHARACTER',
        `예상하지 못한 문자 '${char}' 입니다.`,
        start,
        cloneCursor(cursor),
      ),
    );
  }

  const eofPosition = cloneCursor(cursor);
  pushToken('eof', '', eofPosition, eofPosition);

  return { tokens, issues };
}
