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
  /**
   * Remember comments, blank lines, and line order well enough that
   * stringify() can reproduce them instead of emitting a normalized file.
   * Off by default because it costs a bit of extra bookkeeping during parse
   * that most callers (validate, to-json) never need.
   */
  preserveFormatting?: boolean;
}

export interface IniDocument {
  /** Keys assigned before the first [section] header. */
  global: Record<string, string>;
  /** Section name -> its keys, in the order sections first appeared. */
  sections: Record<string, Record<string, string>>;
}

// A verbatim line (comment or blank) belongs to whichever scope was open
// when it was read; `scope` is null for the top level, otherwise a section
// name. Entry lines don't store their value here - stringify reads it live
// from the document so edits made after parsing show up on round-trip.
type LineToken =
  | { kind: 'text'; scope: string | null; text: string }
  | { kind: 'section'; name: string; text: string }
  | { kind: 'entry'; scope: string | null; key: string };

// Keyed by the document object identity, not its contents, so plain
// object literals built by hand fall back to stringify's normalized output.
const layouts = new WeakMap<IniDocument, LineToken[]>();

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
  const preserveFormatting = options.preserveFormatting ?? false;
  const global: Record<string, string> = {};
  const sections: Record<string, Record<string, string>> = {};
  const layout: LineToken[] = [];

  let current: Record<string, string> = global;
  let currentName: string | null = null;

  const lines = input.split(/\r\n|\r|\n/);
  // A trailing line terminator makes split() emit one extra empty element
  // that isn't a real blank line; stringify always adds its own trailing
  // newline, so recording that artifact as a token would double it up.
  const trailingArtifactIndex = /\r\n$|\r$|\n$/.test(input) ? lines.length - 1 : -1;

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const trimmed = lines[i].trim();

    if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      if (preserveFormatting && i !== trailingArtifactIndex) {
        layout.push({ kind: 'text', scope: currentName, text: lines[i] });
      }
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
      if (preserveFormatting) {
        layout.push({ kind: 'section', name, text: lines[i] });
      }
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
    if (preserveFormatting) {
      layout.push({ kind: 'entry', scope: currentName, key });
    }
  }

  if (preserveFormatting) {
    attachLeadingCommentsToFollowingSection(layout);
  }

  const doc = { global, sections };
  if (preserveFormatting) {
    layouts.set(doc, layout);
  }
  return doc;
}

// Blank lines and comments sitting directly above a [section] header almost
// always describe or separate that section rather than the one before it,
// so re-home them under it. That way deleting a section also removes its
// leading blurb instead of leaving it stranded against the prior section.
function attachLeadingCommentsToFollowingSection(layout: LineToken[]): void {
  let pendingSectionName: string | null = null;
  for (let i = layout.length - 1; i >= 0; i--) {
    const token = layout[i];
    if (token.kind === 'section') {
      pendingSectionName = token.name;
      continue;
    }
    if (token.kind === 'text' && pendingSectionName !== null) {
      token.scope = pendingSectionName;
      continue;
    }
    pendingSectionName = null;
  }
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
  const layout = layouts.get(doc);
  if (layout) {
    return stringifyWithLayout(doc, layout);
  }

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
    out.push(formatEntryLine(key, value));
  }
}

function formatEntryLine(key: string, value: string): string {
  return `${key} = ${needsQuoting(value) ? quote(value) : value}`;
}

// Replays the recorded line order, dropping lines whose key or section was
// deleted since parsing and pulling current values for the ones that
// remain, then appends anything added to the document after the fact.
function stringifyWithLayout(doc: IniDocument, layout: LineToken[]): string {
  const out: string[] = [];
  const globalEmitted = new Set<string>();
  const sectionEmitted = new Map<string, Set<string>>();
  const lastLineOfScope = new Map<string | null, number>();
  const sectionSeen = new Set<string>();

  for (const token of layout) {
    if (token.kind === 'section') {
      sectionSeen.add(token.name);
      if (!Object.prototype.hasOwnProperty.call(doc.sections, token.name)) {
        continue;
      }
      out.push(token.text);
      lastLineOfScope.set(token.name, out.length - 1);
      continue;
    }

    if (token.scope !== null && !Object.prototype.hasOwnProperty.call(doc.sections, token.scope)) {
      continue;
    }

    if (token.kind === 'text') {
      out.push(token.text);
      lastLineOfScope.set(token.scope, out.length - 1);
      continue;
    }

    const scopeObj = token.scope === null ? doc.global : doc.sections[token.scope];
    if (!Object.prototype.hasOwnProperty.call(scopeObj, token.key)) {
      continue;
    }
    out.push(formatEntryLine(token.key, scopeObj[token.key]));
    lastLineOfScope.set(token.scope, out.length - 1);
    if (token.scope === null) {
      globalEmitted.add(token.key);
    } else {
      let seen = sectionEmitted.get(token.scope);
      if (!seen) {
        seen = new Set();
        sectionEmitted.set(token.scope, seen);
      }
      seen.add(token.key);
    }
  }

  const insertions: Array<{ afterLine: number; lines: string[] }> = [];

  const newGlobalKeys = Object.keys(doc.global).filter((key) => !globalEmitted.has(key));
  if (newGlobalKeys.length > 0) {
    insertions.push({
      afterLine: lastLineOfScope.get(null) ?? -1,
      lines: newGlobalKeys.map((key) => formatEntryLine(key, doc.global[key])),
    });
  }

  const newSectionBlocks: string[] = [];
  for (const [name, entries] of Object.entries(doc.sections)) {
    const emitted = sectionEmitted.get(name) ?? new Set<string>();
    const newKeys = Object.keys(entries).filter((key) => !emitted.has(key));
    if (sectionSeen.has(name)) {
      if (newKeys.length > 0) {
        insertions.push({
          afterLine: lastLineOfScope.get(name) ?? out.length - 1,
          lines: newKeys.map((key) => formatEntryLine(key, entries[key])),
        });
      }
    } else {
      if (newSectionBlocks.length > 0 || out.length > 0) {
        newSectionBlocks.push('');
      }
      newSectionBlocks.push(`[${name}]`);
      for (const key of newKeys) {
        newSectionBlocks.push(formatEntryLine(key, entries[key]));
      }
    }
  }

  insertions.sort((a, b) => b.afterLine - a.afterLine);
  for (const { afterLine, lines } of insertions) {
    out.splice(afterLine + 1, 0, ...lines);
  }

  out.push(...newSectionBlocks);

  return out.join('\n') + '\n';
}

/**
 * Compares two parsed documents key by key and reports what changed, in the
 * style of a unified diff: "- " for a value only the left side has (or the
 * old value of something that changed), "+ " for the right side's version.
 * Formatting differences (quoting, comments, key order) never show up here
 * since this works on the parsed values, not the source text.
 */
export function diffDocuments(left: IniDocument, right: IniDocument): string[] {
  const lines: string[] = [];
  diffScope('', left.global, right.global, lines);

  const sectionNames = new Set([...Object.keys(left.sections), ...Object.keys(right.sections)]);
  for (const name of [...sectionNames].sort()) {
    diffScope(`[${name}] `, left.sections[name] ?? {}, right.sections[name] ?? {}, lines);
  }

  return lines;
}

function diffScope(
  label: string,
  left: Record<string, string>,
  right: Record<string, string>,
  lines: string[],
): void {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of [...keys].sort()) {
    const inLeft = Object.prototype.hasOwnProperty.call(left, key);
    const inRight = Object.prototype.hasOwnProperty.call(right, key);
    if (inLeft && !inRight) {
      lines.push(`- ${label}${key} = ${left[key]}`);
    } else if (!inLeft && inRight) {
      lines.push(`+ ${label}${key} = ${right[key]}`);
    } else if (inLeft && inRight && left[key] !== right[key]) {
      lines.push(`- ${label}${key} = ${left[key]}`);
      lines.push(`+ ${label}${key} = ${right[key]}`);
    }
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
