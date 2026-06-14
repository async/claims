#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  checkClaims,
  formatTextReport,
  hasInvalidConfigFailure,
  initClaims,
  type CheckClaimsOptions
} from "./index.js";

interface CheckCliOptions extends CheckClaimsOptions {
  format: "text" | "json";
  output?: string;
  noFail: boolean;
}

const args = process.argv.slice(2);
const command = args[0] ?? "help";

try {
  if (command === "check") {
    const options = parseCheckArgs(args.slice(1));
    const report = await checkClaims(options);
    const rendered = options.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : `${formatTextReport(report)}\n`;
    if (options.output) {
      const outputPath = resolve(process.cwd(), options.output);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, rendered, "utf8");
    } else if (report.ok || options.format === "json" || options.noFail) {
      process.stdout.write(rendered);
    } else {
      process.stderr.write(rendered);
    }

    if (hasInvalidConfigFailure(report)) process.exitCode = 2;
    else if (!report.ok && !options.noFail) process.exitCode = 1;
  } else if (command === "init") {
    const { force } = parseInitArgs(args.slice(1));
    const result = await initClaims({ force });
    const created = result.created.length > 0 ? `created ${result.created.join(", ")}` : "";
    const overwritten = result.overwritten.length > 0 ? `overwrote ${result.overwritten.join(", ")}` : "";
    process.stdout.write(`Initialized async-claims${created || overwritten ? ` (${[created, overwritten].filter(Boolean).join("; ")})` : ""}.\n`);
  } else if (command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(helpText());
  } else if (command === "--version" || command === "-v") {
    process.stdout.write("0.1.0\n");
  } else {
    process.stderr.write(`Unknown command "${command}".\n\n${helpText()}`);
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function parseCheckArgs(values: string[]): CheckCliOptions {
  const options: CheckCliOptions = { format: "text", noFail: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--format") {
      const format = requireValue(values, index, value);
      index += 1;
      if (format !== "text" && format !== "json") throw new Error("--format must be \"text\" or \"json\".");
      options.format = format;
    } else if (value === "--output") {
      options.output = requireValue(values, index, value);
      index += 1;
    } else if (value === "--no-fail") {
      options.noFail = true;
    } else if (value === "--config") {
      options.config = requireValue(values, index, value);
      index += 1;
    } else if (value === "--registry") {
      options.registry = requireValue(values, index, value);
      index += 1;
    } else if (value === "--test-files") {
      options.testFiles = splitPatterns(requireValue(values, index, value));
      index += 1;
    } else if (value === "--test-title-regex") {
      options.testTitlePattern = requireValue(values, index, value);
      index += 1;
    } else if (value === "--promise-prefix") {
      options.promisePrefix = requireValue(values, index, value);
      index += 1;
    } else if (value === "--help" || value === "-h") {
      process.stdout.write(helpText());
      process.exit(0);
    } else {
      throw new Error(`Unknown option "${value}".`);
    }
  }
  return options;
}

function parseInitArgs(values: string[]): { force: boolean } {
  let force = false;
  for (const value of values) {
    if (value === "--force") force = true;
    else if (value === "--help" || value === "-h") {
      process.stdout.write(helpText());
      process.exit(0);
    } else {
      throw new Error(`Unknown option "${value}".`);
    }
  }
  return { force };
}

function requireValue(values: string[], index: number, option: string): string {
  const next = values[index + 1];
  if (next === undefined || next.startsWith("--")) throw new Error(`${option} requires a value.`);
  return next;
}

function splitPatterns(value: string): string[] {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function helpText(): string {
  return `async-claims

Usage:
  async-claims check [--format text|json] [--output file] [--no-fail]
  async-claims init [--force]

Check options:
  --config file             Config path, default claims.config.json
  --registry file           Registry path, default tests/claims.json
  --test-files patterns     Comma-separated glob patterns, default tests/**/*.test.js
  --test-title-regex regex  Regex whose first capture is the test title
  --promise-prefix text     Promise-test prefix, default "PROMISE: "
`;
}
