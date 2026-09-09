#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parse, stringify, diffDocuments, IniParseError } from './parser.js';

function printUsage(): void {
  console.error(`usage: ini-strict <command> <file> [--lenient]
       ini-strict diff <file> <file> [--lenient]

commands:
  validate   parse the file and exit non-zero on the first error
  to-json    parse the file and print it as JSON
  format     parse the file and print it back out in normalized form
  diff       compare two files' parsed values and print what changed

flags:
  --lenient          recover from duplicate keys/sections, malformed lines,
                     and unterminated quotes instead of failing
  --preserve-format  (format only) keep comments, blank lines, and existing
                     key order instead of emitting a fully normalized file`);
}

function readOrExit(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`ini-strict: cannot read ${file}: ${(err as Error).message}`);
    return null;
  }
}

function runDiff(fileA: string, fileB: string, lenient: boolean): number {
  const textA = readOrExit(fileA);
  const textB = readOrExit(fileB);
  if (textA === null || textB === null) {
    return 1;
  }

  let lines: string[];
  try {
    const docA = parse(textA, { lenient });
    const docB = parse(textB, { lenient });
    lines = diffDocuments(docA, docB);
  } catch (err) {
    if (err instanceof IniParseError) {
      console.error(`ini-strict: ${err.message} (line ${err.line})`);
    } else {
      console.error(`ini-strict: ${(err as Error).message}`);
    }
    return 1;
  }

  if (lines.length === 0) {
    console.log('no differences');
    return 0;
  }
  for (const line of lines) {
    console.log(line);
  }
  return 1;
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  if (!command) {
    printUsage();
    return 1;
  }

  if (command === 'diff') {
    const [fileA, fileB, ...flags] = rest;
    if (!fileA || !fileB) {
      printUsage();
      return 1;
    }
    return runDiff(fileA, fileB, flags.includes('--lenient'));
  }

  const [file, ...flags] = rest;
  if (!file) {
    printUsage();
    return 1;
  }

  const lenient = flags.includes('--lenient');
  const preserveFormatting = command === 'format' && flags.includes('--preserve-format');

  const text = readOrExit(file);
  if (text === null) {
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
