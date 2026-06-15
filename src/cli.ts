#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  checkClaims,
  createAnchorPatch,
  createRepairContext,
  formatTextReport,
  hasInvalidConfigFailure,
  initClaims,
  type CheckClaimsOptions,
  type CreateAnchorPatchOptions,
  type CreateRepairContextOptions
} from "./index.js";

interface CheckCliOptions extends CheckClaimsOptions {
  format: "text" | "json";
  output?: string;
  noFail: boolean;
}

interface RepairContextCliOptions extends CreateRepairContextOptions {
  output?: string;
}

interface PatchAnchorsCliOptions extends CreateAnchorPatchOptions {
  output: string;
}

const args = process.argv.slice(2);
const command = args[0] ?? "help";

try {
  if (command === "check") {
    const options = parseCheckArgs(args.slice(1));
    const report = await checkClaims(options);
    const rendered = options.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : `${formatTextReport(report)}\n`;
    if (options.output) {
      await writeOutput(options.output, rendered);
    } else if (report.ok || options.format === "json" || options.noFail) {
      process.stdout.write(rendered);
    } else {
      process.stderr.write(rendered);
    }

    if (hasInvalidConfigFailure(report)) process.exitCode = 2;
    else if (!report.ok && !options.noFail) process.exitCode = 1;
  } else if (command === "repair-context") {
    const options = parseRepairContextArgs(args.slice(1));
    const context = await createRepairContext(options);
    const rendered = `${JSON.stringify(context, null, 2)}\n`;
    if (options.output) await writeOutput(options.output, rendered);
    else process.stdout.write(rendered);
    if (context.failures.some((failure) => failure.code === "invalid_config")) process.exitCode = 2;
  } else if (command === "patch-anchors") {
    const options = parsePatchAnchorsArgs(args.slice(1));
    const result = await createAnchorPatch(options);
    await writeOutput(options.output, result.patch);
    process.stdout.write(`Wrote ${options.output} with ${result.updated} anchor update(s).\n`);
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
    } else if (parseSharedCheckOption(options, values, index)) {
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

function parseRepairContextArgs(values: string[]): RepairContextCliOptions {
  const options: RepairContextCliOptions = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--output") {
      options.output = requireValue(values, index, value);
      index += 1;
    } else if (parseSharedCheckOption(options, values, index)) {
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

function parsePatchAnchorsArgs(values: string[]): PatchAnchorsCliOptions {
  const options: PatchAnchorsCliOptions = { output: "claims.patch" };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--suggestions") {
      options.suggestions = requireValue(values, index, value);
      index += 1;
    } else if (value === "--output") {
      options.output = requireValue(values, index, value);
      index += 1;
    } else if (parseSharedCheckOption(options, values, index)) {
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

function parseSharedCheckOption(options: CheckClaimsOptions, values: string[], index: number): boolean {
  const value = values[index];
  if (value === "--config") {
    options.config = requireValue(values, index, value);
    return true;
  }
  if (value === "--registry") {
    options.registry = requireValue(values, index, value);
    return true;
  }
  if (value === "--coverage") {
    options.coverage = requireValue(values, index, value);
    return true;
  }
  if (value === "--test-files") {
    options.testFiles = splitPatterns(requireValue(values, index, value));
    return true;
  }
  if (value === "--test-title-regex") {
    options.testTitlePattern = requireValue(values, index, value);
    return true;
  }
  if (value === "--promise-prefix") {
    options.promisePrefix = requireValue(values, index, value);
    return true;
  }
  return false;
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

async function writeOutput(path: string, value: string): Promise<void> {
  const outputPath = resolve(process.cwd(), path);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, value, "utf8");
}

function helpText(): string {
  return `async-claims

Usage:
  async-claims check [--format text|json] [--output file] [--no-fail]
  async-claims repair-context [--output file]
  async-claims patch-anchors [--suggestions file] [--output file]
  async-claims init [--force]

Check options:
  --config file             Config path, default claims.config.json
  --registry file           Claims registry path, default detected tests/claims.json or test/claims.json
  --coverage file           Coverage registry path, default detected tests/claims.coverage.json or test/claims.coverage.json
  --test-files patterns     Comma-separated glob patterns, default detected tests/**/*.test.js or test/**/*.test.js
  --test-title-regex regex  Regex whose first capture is the test title
  --promise-prefix text     Promise-test prefix, default "PROMISE: "

Repair options:
  --suggestions file        Anchor suggestions JSON, default claims-anchor-updates.json
  --output file             Output path for JSON context or patch
`;
}
