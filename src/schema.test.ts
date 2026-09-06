import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from './parser.js';
import { validate, SchemaValidationError } from './schema.js';

test('converts strings to the declared type', () => {
  const doc = parse('[server]\nhost = 0.0.0.0\nport = 8080\ndebug = true\n');
  const config = validate(doc, {
    sections: {
      server: {
        host: { type: 'string', required: true },
        port: { type: 'number', required: true },
        debug: { type: 'boolean', required: true },
      },
    },
  });
  assert.equal(config.sections.server.host, '0.0.0.0');
  assert.equal(config.sections.server.port, 8080);
  assert.equal(config.sections.server.debug, true);
});

test('validates global keys', () => {
  const doc = parse('name = demo\n');
  const config = validate(doc, {
    global: { name: { type: 'string', required: true } },
  });
  assert.equal(config.global.name, 'demo');
});

test('fills in a default when the key is missing', () => {
  const doc = parse('[server]\nhost = 0.0.0.0\n');
  const config = validate(doc, {
    sections: {
      server: {
        host: { type: 'string', required: true },
        port: { type: 'number', default: 8080 },
      },
    },
  });
  assert.equal(config.sections.server.port, 8080);
});

test('a missing optional field with no default is undefined', () => {
  const doc = parse('[server]\nhost = 0.0.0.0\n');
  const config = validate(doc, {
    sections: {
      server: {
        host: { type: 'string', required: true },
        timeout: { type: 'number' },
      },
    },
  });
  assert.equal(config.sections.server.timeout, undefined);
});

test('throws on a missing required key', () => {
  const doc = parse('[server]\nhost = 0.0.0.0\n');
  assert.throws(
    () =>
      validate(doc, {
        sections: { server: { port: { type: 'number', required: true } } },
      }),
    (err: unknown) => {
      assert.ok(err instanceof SchemaValidationError);
      assert.match(err.message, /section "server": missing required key "port"/);
      return true;
    },
  );
});

test('throws on a missing section entirely', () => {
  const doc = parse('top = value\n');
  assert.throws(
    () =>
      validate(doc, {
        sections: { server: { host: { type: 'string', required: true } } },
      }),
    (err: unknown) => {
      assert.ok(err instanceof SchemaValidationError);
      assert.match(err.message, /section "server": missing required key "host"/);
      return true;
    },
  );
});

test('throws on a value that does not match its declared type', () => {
  const doc = parse('[server]\nport = not-a-number\n');
  assert.throws(
    () =>
      validate(doc, {
        sections: { server: { port: { type: 'number', required: true } } },
      }),
    (err: unknown) => {
      assert.ok(err instanceof SchemaValidationError);
      assert.match(err.message, /key "port" is not a valid number \("not-a-number"\)/);
      return true;
    },
  );
});

test('rejects a blank string for a numeric field instead of coercing it to zero', () => {
  const doc = parse('port =');
  assert.throws(
    () =>
      validate(doc, {
        global: { port: { type: 'number', required: true } },
      }),
    (err: unknown) => {
      assert.ok(err instanceof SchemaValidationError);
      assert.match(err.message, /top level: key "port" is not a valid number/);
      return true;
    },
  );
});

test('collects every error across sections instead of stopping at the first', () => {
  const doc = parse('[a]\nx = 1\n\n[b]\ny = not-a-number\n');
  assert.throws(
    () =>
      validate(doc, {
        sections: {
          a: { missing: { type: 'string', required: true } },
          b: { y: { type: 'number', required: true } },
        },
      }),
    (err: unknown) => {
      assert.ok(err instanceof SchemaValidationError);
      assert.equal(err.errors.length, 2);
      return true;
    },
  );
});

test('boolean fields only accept the literal strings "true" and "false"', () => {
  const doc = parse('flag = yes');
  assert.throws(
    () =>
      validate(doc, {
        global: { flag: { type: 'boolean', required: true } },
      }),
    (err: unknown) => {
      assert.ok(err instanceof SchemaValidationError);
      assert.match(err.message, /key "flag" is not a valid boolean \("yes"\)/);
      return true;
    },
  );
});
