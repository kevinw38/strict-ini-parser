#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parse, stringify, IniParseError } from './parser.js';

function printUsage(): void {
  console.error(`usage: ini-strict <command> <file> [--lenient]

commands:
  validate   parse the file and exit non-zero on the first error
  to-json    parse the file and print it as JSON
  format     parse the file and print it back out in normalized form

flags:
  --lenient          recover from duplicate keys/sections, malformed lines,
                     and unterminated quotes instead of failing
  --preserve-format  (format only) keep comments, blank lines, and existing
                     key order instead of emitting a fully normalized file`);
}

function main(argv: string[]): number {
  const [command, file, ...rest] = argv;
  if (!command || !file) {
    printUsage();
    return 1;
  }

  const lenient = rest.includes('--lenient');
  const preserveFormatting = command === 'format' && rest.includes('--preserve-format');

  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`ini-strict: cannot read ${file}: ${(err as Error).message}`);
    return 1;
  }

  try {
    const doc = parse(text, { lenient, preserveFormatting });
    switch (command) {
      case 'validate':
        console.log('ok');
        return 0;
      case 'to-json':
        console.log(JSON.stringify(doc, null, 2));
        return 0;
      case 'format':
        process.stdout.write(stringify(doc));
        return 0;
      default:
        printUsage();
        return 1;
    }
  } catch (err) {
    if (err instanceof IniParseError) {
      console.error(`ini-strict: ${file}:${err.line}: ${err.message}`);
    } else {
      console.error(`ini-strict: ${(err as Error).message}`);
    }
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
