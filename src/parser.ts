/**
 * INI has no formal spec, so every parser makes its own calls on the
 * ambiguous parts: duplicate keys, duplicate sections, unterminated quotes,
 * lines with no separator. This one refuses to guess by default and throws
 * instead, because a silently dropped or overwritten config value is a much
 * worse bug than a parse error at startup. Pass { lenient: true } to fall
 * back to "best effort" behavior for files you don't control.
 */

export interface ParseOptions {
  lenient?: boolean;
}

export interface IniDocument {
  /** Keys assigned before the first [section] header. */
  global: Record<string, string>;
  /** Section name -> its keys, in the order sections first appeared. */
  sections: Record<string, Record<string, string>>;
}

export class IniParseError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(message);
    this.name = 'IniParseError';
    this.line = line;
  }
}

export function parse(input: string, options: ParseOptions = {}): IniDocument {
  const lenient = options.lenient ?? false;
  const global: Record<string, string> = {};
  const sections: Record<string, Record<string, string>> = {};

  let current: Record<string, string> = global;
  let currentName: string | null = null;

  const lines = input.split(/\r\n|\r|\n/);

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const trimmed = lines[i].trim();

    if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      continue;
    }

    if (trimmed.startsWith('[')) {
      const pattern = lenient ? /^\[(.*)\]/ : /^\[([^\]]*)\]$/;
      const match = pattern.exec(trimmed);
      if (!match) {
        throw new IniParseError(`malformed section header: "${trimmed}"`, lineNumber);
      }
      const name = match[1].trim();
      if (name === '' && !lenient) {
        throw new IniParseError('section name cannot be empty', lineNumber);
      }
      if (Object.prototype.hasOwnProperty.call(sections, name)) {
        if (!lenient) {
          throw new IniParseError(`duplicate section "${name}"`, lineNumber);
        }
        current = sections[name];
      } else {
        current = {};
        sections[name] = current;
      }
      currentName = name;
      continue;
    }

    const eq = trimmed.indexOf('=');
    const colon = trimmed.indexOf(':');
    const sepIndex = eq === -1 ? colon : colon === -1 ? eq : Math.min(eq, colon);

    if (sepIndex === -1) {
      if (!lenient) {
        throw new IniParseError(`expected "key = value", got "${trimmed}"`, lineNumber);
      }
      continue;
    }

    const key = trimmed.slice(0, sepIndex).trim();
    const valueRaw = trimmed.slice(sepIndex + 1).trim();

    if (key === '') {
      if (!lenient) {
        throw new IniParseError('key cannot be empty', lineNumber);
      }
      continue;
    }

    const value = parseValue(valueRaw, lenient, lineNumber);

    if (Object.prototype.hasOwnProperty.call(current, key) && !lenient) {
      const where = currentName === null ? 'top level' : `section "${currentName}"`;
      throw new IniParseError(`duplicate key "${key}" in ${where}`, lineNumber);
    }
    current[key] = value;
  }

  return { global, sections };
}

function parseValue(raw: string, lenient: boolean, lineNumber: number): string {
  if (raw.length === 0) {
    return raw;
  }

  const openQuote = raw[0];
  if (openQuote !== '"' && openQuote !== "'") {
    return raw;
  }

  let result = '';
  let i = 1;
  let closedAt = -1;

  while (i < raw.length) {
    const ch = raw[i];

    if (openQuote === '"' && ch === '\\' && i + 1 < raw.length) {
      const next = raw[i + 1];
      const escaped = unescape(next);
      if (escaped === null) {
        if (!lenient) {
          throw new IniParseError(`unknown escape sequence "\\${next}"`, lineNumber);
        }
        result += ch + next;
      } else {
        result += escaped;
      }
      i += 2;
      continue;
    }

    if (ch === openQuote) {
      closedAt = i;
      break;
    }

    result += ch;
    i++;
  }

  if (closedAt === -1) {
    if (!lenient) {
      throw new IniParseError('unterminated quoted value', lineNumber);
    }
    return raw;
  }

  const trailing = raw.slice(closedAt + 1).trim();
  if (trailing !== '' && !lenient) {
    throw new IniParseError(`unexpected text after closing quote: "${trailing}"`, lineNumber);
  }

  return result;
}

function unescape(ch: string): string | null {
  switch (ch) {
    case '"':
      return '"';
    case '\\':
      return '\\';
    case 'n':
      return '\n';
    case 't':
      return '\t';
    case '0':
      return '\0';
    default:
      return null;
  }
}

export function stringify(doc: IniDocument): string {
  const out: string[] = [];
  writeEntries(doc.global, out);
  for (const [name, entries] of Object.entries(doc.sections)) {
    if (out.length > 0) {
      out.push('');
    }
    out.push(`[${name}]`);
    writeEntries(entries, out);
  }
  return out.join('\n') + '\n';
}

function writeEntries(entries: Record<string, string>, out: string[]): void {
  for (const [key, value] of Object.entries(entries)) {
    out.push(`${key} = ${needsQuoting(value) ? quote(value) : value}`);
  }
}

function needsQuoting(value: string): boolean {
  return value === '' || value !== value.trim() || value.includes('\n') || value.includes('\r');
}

function quote(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}
