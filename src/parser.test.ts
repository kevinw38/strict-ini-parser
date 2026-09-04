import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, stringify, IniParseError } from './parser.js';

test('parses global keys and section keys', () => {
  const doc = parse(`
name = top

[server]
host = 0.0.0.0
port = 8080
`);
  assert.deepEqual(doc.global, { name: 'top' });
  assert.deepEqual(doc.sections, { server: { host: '0.0.0.0', port: '8080' } });
});

test('supports : as a separator alongside =', () => {
  const doc = parse('key: value');
  assert.equal(doc.global.key, 'value');
});

test('ignores ; and # comment lines and blank lines', () => {
  const doc = parse(`
; comment
# also a comment

key = value
`);
  assert.deepEqual(doc.global, { key: 'value' });
});

test('strict mode throws on duplicate section names', () => {
  const text = `[a]\nx = 1\n\n[a]\ny = 2\n`;
  assert.throws(() => parse(text), (err: unknown) => {
    assert.ok(err instanceof IniParseError);
    assert.equal(err.line, 4);
    assert.match(err.message, /duplicate section "a"/);
    return true;
  });
});

test('lenient mode merges duplicate sections', () => {
  const text = `[a]\nx = 1\n\n[a]\ny = 2\n`;
  const doc = parse(text, { lenient: true });
  assert.deepEqual(doc.sections.a, { x: '1', y: '2' });
});

test('strict mode throws on duplicate keys', () => {
  const text = `x = 1\nx = 2\n`;
  assert.throws(() => parse(text), (err: unknown) => {
    assert.ok(err instanceof IniParseError);
    assert.equal(err.line, 2);
    assert.match(err.message, /duplicate key "x" in top level/);
    return true;
  });
});

test('lenient mode keeps the last value for duplicate keys', () => {
  const doc = parse(`x = 1\nx = 2\n`, { lenient: true });
  assert.equal(doc.global.x, '2');
});

test('strict mode throws on a line with no separator', () => {
  assert.throws(() => parse('not a key value line'), (err: unknown) => {
    assert.ok(err instanceof IniParseError);
    assert.equal(err.line, 1);
    assert.match(err.message, /expected "key = value"/);
    return true;
  });
});

test('lenient mode skips lines with no separator', () => {
  const doc = parse('garbage\nkey = value', { lenient: true });
  assert.deepEqual(doc.global, { key: 'value' });
});

test('strict mode throws on a malformed section header', () => {
  assert.throws(() => parse('[unterminated'), (err: unknown) => {
    assert.ok(err instanceof IniParseError);
    assert.match(err.message, /malformed section header/);
    return true;
  });
});

test('strict mode throws on an empty section name', () => {
  assert.throws(() => parse('[]'), (err: unknown) => {
    assert.ok(err instanceof IniParseError);
    assert.match(err.message, /section name cannot be empty/);
    return true;
  });
});

test('strict mode throws on an empty key', () => {
  assert.throws(() => parse(' = value'), (err: unknown) => {
    assert.ok(err instanceof IniParseError);
    assert.match(err.message, /key cannot be empty/);
    return true;
  });
});

test('strict mode throws on an unterminated quoted value', () => {
  assert.throws(() => parse('key = "no closing quote'), (err: unknown) => {
    assert.ok(err instanceof IniParseError);
    assert.match(err.message, /unterminated quoted value/);
    return true;
  });
});

test('lenient mode keeps an unterminated quoted value as literal text', () => {
  const doc = parse('key = "no closing quote', { lenient: true });
  assert.equal(doc.global.key, '"no closing quote');
});

test('strict mode throws on text trailing a closing quote', () => {
  assert.throws(() => parse('key = "value" extra'), (err: unknown) => {
    assert.ok(err instanceof IniParseError);
    assert.match(err.message, /unexpected text after closing quote/);
    return true;
  });
});

test('strict mode throws on an unknown escape sequence', () => {
  assert.throws(() => parse('key = "bad \\q escape"'), (err: unknown) => {
    assert.ok(err instanceof IniParseError);
    assert.match(err.message, /unknown escape sequence/);
    return true;
  });
});

test('lenient mode keeps an unknown escape sequence literally', () => {
  const doc = parse('key = "bad \\q escape"', { lenient: true });
  assert.equal(doc.global.key, 'bad \\q escape');
});

test('double-quoted values resolve standard escape sequences', () => {
  const doc = parse('key = "a\\nb\\tc\\\\d\\"e"');
  assert.equal(doc.global.key, 'a\nb\tc\\d"e');
});

test('single-quoted values do not process escape sequences', () => {
  const doc = parse("key = 'a\\nb'");
  assert.equal(doc.global.key, 'a\\nb');
});

test('unquoted values keep interior whitespace but not surrounding it', () => {
  const doc = parse('key =   hello   world   ');
  assert.equal(doc.global.key, 'hello   world');
});

test('an empty value is allowed', () => {
  const doc = parse('key =');
  assert.equal(doc.global.key, '');
});

test('stringify round-trips a parsed document', () => {
  const original = `top = value\n\n[server]\nhost = 0.0.0.0\nport = 8080\n`;
  const doc = parse(original);
  assert.deepEqual(parse(stringify(doc)), doc);
});

test('stringify quotes values that need it and leaves plain values bare', () => {
  const doc = parse('plain = value\nspaced = "  padded  "\nempty = ""');
  const text = stringify(doc);
  assert.match(text, /^plain = value$/m);
  assert.match(text, /^spaced = "  padded  "$/m);
  assert.match(text, /^empty = ""$/m);
});

test('without preserveFormatting, stringify drops comments as before', () => {
  const doc = parse('; note\nkey = value\n');
  assert.equal(stringify(doc), 'key = value\n');
});

test('preserveFormatting round-trips comments, blank lines, and order untouched', () => {
  const original =
    '; top of file\ntop = value\n\n[server]\n; server settings\nhost = 0.0.0.0\nport = 8080\n';
  const doc = parse(original, { preserveFormatting: true });
  assert.equal(stringify(doc), original);
});

test('preserveFormatting keeps comments while picking up an edited value', () => {
  const original = '[server]\n; the bind port\nport = 8080\n';
  const doc = parse(original, { preserveFormatting: true });
  doc.sections.server.port = '9090';
  assert.equal(stringify(doc), '[server]\n; the bind port\nport = 9090\n');
});

test('preserveFormatting drops the line for a deleted key', () => {
  const original = 'a = 1\nb = 2\nc = 3\n';
  const doc = parse(original, { preserveFormatting: true });
  delete doc.global.b;
  assert.equal(stringify(doc), 'a = 1\nc = 3\n');
});

test('preserveFormatting drops a whole deleted section, including its comments', () => {
  const original = 'x = 1\n\n[old]\n; unused now\ny = 2\n';
  const doc = parse(original, { preserveFormatting: true });
  delete doc.sections.old;
  assert.equal(stringify(doc), 'x = 1\n');
});

test('preserveFormatting appends a key added to an existing section in place', () => {
  const original = '[server]\nhost = 0.0.0.0\n\n[other]\nz = 1\n';
  const doc = parse(original, { preserveFormatting: true });
  doc.sections.server.port = '8080';
  assert.equal(stringify(doc), '[server]\nhost = 0.0.0.0\nport = 8080\n\n[other]\nz = 1\n');
});

test('preserveFormatting appends a brand new section at the end', () => {
  const original = '[server]\nhost = 0.0.0.0\n';
  const doc = parse(original, { preserveFormatting: true });
  doc.sections.client = { timeout: '30' };
  assert.equal(stringify(doc), '[server]\nhost = 0.0.0.0\n\n[client]\ntimeout = 30\n');
});

test('preserveFormatting appends a new global key ahead of the first section', () => {
  const original = 'top = value\n\n[server]\nhost = 0.0.0.0\n';
  const doc = parse(original, { preserveFormatting: true });
  doc.global.extra = 'added';
  assert.equal(stringify(doc), 'top = value\nextra = added\n\n[server]\nhost = 0.0.0.0\n');
});
