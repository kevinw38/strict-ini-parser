# strict-ini-parser

INI doesn't have a real spec, so every parser you've used has quietly made
its own decisions about the ambiguous cases:

- Two `[database]` sections in the same file — merged, or an error?
- A key set twice in one section — last one wins, or an error?
- A line with no `=` in it — skipped, or an error?
- A quoted value with no closing quote — read to end of line, or an error?

Most parsers pick "silently do something reasonable" for all of these,
which means a typo'd config file loads without complaint and you find out
something is wrong later, somewhere else, when the value you expected isn't
there. This library picks "throw" for all of them by default. If you're
reading a file you don't fully trust or control, pass `lenient: true` (or
`--lenient` on the CLI) to get the forgiving behavior back.

## Install

No package is published yet. Clone the repo and build it:

```
npm install
npm run build
```

Run the test suite with `npm test` (it builds first, then runs the compiled
tests with Node's built-in test runner).

## Library usage

```ts
import { parse, stringify, IniParseError } from 'strict-ini-parser';

const text = `
[server]
host = 0.0.0.0
port = 8080

[server]
port = 9090
`;

try {
  parse(text);
} catch (err) {
  if (err instanceof IniParseError) {
    console.error(`line ${err.line}: ${err.message}`);
    // line 6: duplicate section "server"
  }
}

// With the escape hatch, the second [server] block merges into the first
// and its port overwrites the earlier one.
const doc = parse(text, { lenient: true });
console.log(doc.sections.server); // { host: '0.0.0.0', port: '9090' }

console.log(stringify(doc));
```

`parse` returns an `IniDocument`:

```ts
interface IniDocument {
  global: Record<string, string>;              // keys before the first [section]
  sections: Record<string, Record<string, string>>;
}
```

Values keep whatever quoting rules were used in the source: `key = "  spaced  "`
preserves the leading and trailing spaces, `key = plain` does not. Inline
comments after a value (`key = value ; note`) are not stripped — the whole
remainder of the line is the value. If you want a comment, put it on its own
line.

By default `stringify` emits a fully normalized file and drops comments.
Pass `{ preserveFormatting: true }` to `parse` to keep comments, blank
lines, and the original key/section order for round-tripping:

```ts
const original = 'timeout = 30\n\n; the main listener\n[server]\nhost = 0.0.0.0\n';
const doc = parse(original, { preserveFormatting: true });
delete doc.sections.server; // its leading comment and blank line go with it
stringify(doc);
// "timeout = 30\n"
```

A comment or blank line directly above a `[section]` header is treated as
belonging to that section, so deleting the section removes its leading
comment too rather than leaving it stranded above whatever came before.
Sections and keys added after parsing are appended in place (new keys at
the end of their section, new sections at the end of the file); documents
built by hand instead of via `parse` fall back to the normalized output.

## CLI usage

```
ini-strict validate config.ini
ini-strict validate config.ini --lenient
ini-strict to-json config.ini
ini-strict format config.ini --lenient
ini-strict format config.ini --preserve-format
```

`validate` exits 1 and prints `file:line: message` on the first problem it
finds. `to-json` prints the parsed `IniDocument` as JSON. `format` re-emits
the file with consistent spacing and quoting; add `--preserve-format` to
keep comments, blank lines, and key order instead of normalizing them away.

## What "strict" checks

- No duplicate section names.
- No duplicate keys within a section (or at the top level).
- Every non-blank, non-comment line is either a `[section]` header or a
  `key = value` / `key : value` pair.
- Quoted values (`"..."` or `'...'`) must have a matching closing quote and
  nothing but whitespace after it.

`--lenient` turns each of these into "recover and keep going" instead of an
error: duplicate sections merge, duplicate keys use the last value seen,
lines that don't parse are skipped, and unterminated quotes are kept as
literal text.

## License

MIT, see [LICENSE](LICENSE).
