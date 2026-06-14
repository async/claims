import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

export type ClaimsFailureCode =
  | "invalid_config"
  | "empty_registry"
  | "duplicate_id"
  | "missing_source"
  | "stale_anchor"
  | "missing_referenced_test"
  | "unmapped_promise_test";

export interface Claim {
  id: string;
  source: string;
  anchor: string;
  tests: string[];
}

export interface ClaimsConfig {
  rootDir: string;
  registry: string;
  testFiles: string[];
  testTitlePattern: string;
  promisePrefix: string;
}

export interface LoadConfigOptions {
  cwd?: string;
  config?: string;
  registry?: string;
  testFiles?: string[];
  testTitlePattern?: string;
  promisePrefix?: string;
}

export interface CheckClaimsOptions extends LoadConfigOptions {}

export interface ClaimsFailure {
  code: ClaimsFailureCode;
  message: string;
  claimId?: string;
  path?: string;
  anchor?: string;
  testTitle?: string;
}

export interface ClaimsReport {
  ok: boolean;
  config: ClaimsConfig;
  claims: Claim[];
  failures: ClaimsFailure[];
  counts: {
    claims: number;
    sources: number;
    testFiles: number;
    testTitles: number;
    referencedTests: number;
    promiseTests: number;
  };
  testTitles: string[];
  promiseTests: string[];
}

export interface InitClaimsOptions {
  cwd?: string;
  force?: boolean;
}

const defaultConfig: Omit<ClaimsConfig, "rootDir"> = {
  registry: "tests/claims.json",
  testFiles: ["tests/**/*.test.js"],
  testTitlePattern: "^\\s*test\\(\\s*\"((?:[^\"\\\\]|\\\\.)*)\"",
  promisePrefix: "PROMISE: "
};

const configFileName = "claims.config.json";

class ClaimsConfigError extends Error {
  readonly failures: ClaimsFailure[];

  constructor(failures: ClaimsFailure[]) {
    super(failures.map((failure) => failure.message).join("\n"));
    this.name = "ClaimsConfigError";
    this.failures = failures;
  }
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<ClaimsConfig> {
  const rootDir = resolve(options.cwd ?? process.cwd());
  const configPath = resolve(rootDir, options.config ?? configFileName);
  const config = { ...defaultConfig };
  const failures: ClaimsFailure[] = [];

  const configText = await readOptionalFile(configPath);
  if (configText !== null) {
    let raw: unknown;
    try {
      raw = JSON.parse(configText);
    } catch (error) {
      throw new ClaimsConfigError([
        invalidConfig(`Could not parse ${relativePath(rootDir, configPath)}: ${errorMessage(error)}.`, relativePath(rootDir, configPath))
      ]);
    }

    if (!isPlainObject(raw)) {
      failures.push(invalidConfig(`${relativePath(rootDir, configPath)} must contain a JSON object.`, relativePath(rootDir, configPath)));
    } else {
      const allowed = new Set(["$schema", "registry", "testFiles", "testTitlePattern", "promisePrefix"]);
      for (const key of Object.keys(raw)) {
        if (!allowed.has(key)) {
          failures.push(invalidConfig(`${relativePath(rootDir, configPath)} has unknown field "${key}".`, relativePath(rootDir, configPath)));
        }
      }
      if ("registry" in raw) {
        if (typeof raw.registry === "string" && raw.registry.length > 0) config.registry = raw.registry;
        else failures.push(invalidConfig(`${relativePath(rootDir, configPath)} field "registry" must be a non-empty string.`, relativePath(rootDir, configPath)));
      }
      if ("testFiles" in raw) {
        if (isStringArray(raw.testFiles) && raw.testFiles.length > 0) config.testFiles = raw.testFiles;
        else failures.push(invalidConfig(`${relativePath(rootDir, configPath)} field "testFiles" must be a non-empty string array.`, relativePath(rootDir, configPath)));
      }
      if ("testTitlePattern" in raw) {
        if (typeof raw.testTitlePattern === "string" && raw.testTitlePattern.length > 0) config.testTitlePattern = raw.testTitlePattern;
        else failures.push(invalidConfig(`${relativePath(rootDir, configPath)} field "testTitlePattern" must be a non-empty string.`, relativePath(rootDir, configPath)));
      }
      if ("promisePrefix" in raw) {
        if (typeof raw.promisePrefix === "string" && raw.promisePrefix.length > 0) config.promisePrefix = raw.promisePrefix;
        else failures.push(invalidConfig(`${relativePath(rootDir, configPath)} field "promisePrefix" must be a non-empty string.`, relativePath(rootDir, configPath)));
      }
    }
  }

  if (options.registry !== undefined) config.registry = options.registry;
  if (options.testFiles !== undefined) config.testFiles = options.testFiles;
  if (options.testTitlePattern !== undefined) config.testTitlePattern = options.testTitlePattern;
  if (options.promisePrefix !== undefined) config.promisePrefix = options.promisePrefix;

  if (config.registry.length === 0) failures.push(invalidConfig("Config field \"registry\" must be a non-empty string."));
  if (config.testFiles.length === 0 || config.testFiles.some((pattern) => pattern.length === 0)) {
    failures.push(invalidConfig("Config field \"testFiles\" must contain at least one non-empty pattern."));
  }
  try {
    new RegExp(config.testTitlePattern, "gm");
  } catch (error) {
    failures.push(invalidConfig(`Config field "testTitlePattern" is not a valid regular expression: ${errorMessage(error)}.`));
  }

  if (failures.length > 0) {
    throw new ClaimsConfigError(failures);
  }

  return {
    rootDir,
    registry: normalizeConfigPath(config.registry),
    testFiles: config.testFiles.map(normalizeConfigPath),
    testTitlePattern: config.testTitlePattern,
    promisePrefix: config.promisePrefix
  };
}

export async function checkClaims(options: CheckClaimsOptions = {}): Promise<ClaimsReport> {
  let config: ClaimsConfig;
  try {
    config = await loadConfig(options);
  } catch (error) {
    const failures = error instanceof ClaimsConfigError ? error.failures : [invalidConfig(errorMessage(error))];
    return emptyReport(options.cwd, failures);
  }

  const failures: ClaimsFailure[] = [];
  const registryPath = resolve(config.rootDir, config.registry);
  const registryText = await readOptionalFile(registryPath);
  if (registryText === null) {
    failures.push(invalidConfig(`Registry file ${config.registry} does not exist.`, config.registry));
    return report(config, [], failures, [], []);
  }

  const claims = parseClaimsRegistry(registryText, config.registry, failures);
  validateClaims(config.registry, claims, failures);
  await checkAnchors(config, claims, failures);

  const testFiles = await collectMatchingFiles(config.rootDir, config.testFiles);
  const testTitles = await collectTestTitles(config, testFiles, failures);
  const referencedTests = collectReferencedTests(claims);
  for (const claim of claims) {
    for (const title of claim.tests) {
      if (!testTitles.has(title)) {
        failures.push({
          code: "missing_referenced_test",
          claimId: claim.id,
          testTitle: title,
          message: `claim "${claim.id}": no test titled "${title}" exists in ${config.testFiles.join(", ")}. The claim is documented but unenforced.`
        });
      }
    }
  }

  for (const title of [...testTitles].sort()) {
    if (title.startsWith(config.promisePrefix) && !referencedTests.has(title)) {
      failures.push({
        code: "unmapped_promise_test",
        testTitle: title,
        message: `unmapped promise: test "${title}" is not registered in ${config.registry}. Add the claim it enforces.`
      });
    }
  }

  return report(config, claims, failures, [...testTitles].sort(), testFiles);
}

export async function initClaims(options: InitClaimsOptions = {}): Promise<{ created: string[]; overwritten: string[] }> {
  const rootDir = resolve(options.cwd ?? process.cwd());
  const configPath = join(rootDir, configFileName);
  const registryPath = join(rootDir, defaultConfig.registry);
  const targets = [configPath, registryPath];
  const existing = [];
  for (const target of targets) {
    if (await exists(target)) existing.push(relativePath(rootDir, target));
  }
  if (existing.length > 0 && !options.force) {
    throw new Error(`Refusing to overwrite existing file(s): ${existing.join(", ")}. Re-run with --force to replace them.`);
  }

  const configBody = `${JSON.stringify({
    $schema: "https://async.dev/schemas/claims.config.schema.json",
    registry: defaultConfig.registry,
    testFiles: defaultConfig.testFiles,
    testTitlePattern: defaultConfig.testTitlePattern,
    promisePrefix: defaultConfig.promisePrefix
  }, null, 2)}\n`;
  const registryBody = `${JSON.stringify({
    $schema: "https://async.dev/schemas/claims.schema.json",
    $comment: "Register every documented promise here. Each anchor must appear verbatim in source, and each test title must exist in configured test files.",
    claims: []
  }, null, 2)}\n`;

  await mkdir(dirname(configPath), { recursive: true });
  await mkdir(dirname(registryPath), { recursive: true });
  const overwritten = existing;
  await writeFile(configPath, configBody, "utf8");
  await writeFile(registryPath, registryBody, "utf8");
  const created = targets.map((target) => relativePath(rootDir, target)).filter((target) => !overwritten.includes(target));
  return { created, overwritten };
}

export function formatTextReport(report: ClaimsReport): string {
  if (report.ok) {
    return `Claims checks passed: ${report.counts.claims} claim(s) anchored across ${report.counts.sources} doc(s), ${report.counts.referencedTests} enforcing test(s) present, ${report.counts.promiseTests} promise test(s) all registered.`;
  }
  return report.failures.map((failure) => `CLAIMS ${failure.code} ${failure.message}`).join("\n");
}

export function hasInvalidConfigFailure(report: ClaimsReport): boolean {
  return report.failures.some((failure) => failure.code === "invalid_config");
}

function parseClaimsRegistry(text: string, path: string, failures: ClaimsFailure[]): Claim[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    failures.push(invalidConfig(`Could not parse ${path}: ${errorMessage(error)}.`, path));
    return [];
  }
  if (!isPlainObject(raw)) {
    failures.push(invalidConfig(`${path} must contain a JSON object.`, path));
    return [];
  }
  if (!("claims" in raw)) {
    failures.push(invalidConfig(`${path} is missing a "claims" array.`, path));
    return [];
  }
  if (!Array.isArray(raw.claims)) {
    failures.push(invalidConfig(`${path} field "claims" must be an array.`, path));
    return [];
  }

  const claims: Claim[] = [];
  raw.claims.forEach((entry, index) => {
    const label = claimLabel(entry, index);
    if (!isPlainObject(entry)) {
      failures.push(invalidConfig(`${path}: claim at index ${index} must be an object.`, path));
      return;
    }
    const id = typeof entry.id === "string" ? entry.id : "";
    const source = typeof entry.source === "string" ? entry.source : "";
    const anchor = typeof entry.anchor === "string" ? entry.anchor : "";
    const tests = isStringArray(entry.tests) ? entry.tests : [];
    if (id.length === 0) failures.push(invalidConfig(`${path}: claim ${label} is missing an "id".`, path));
    if (source.length === 0) failures.push(invalidConfig(`${path}: claim ${label} is missing a "source" file.`, path));
    if (anchor.length === 0) failures.push(invalidConfig(`${path}: claim ${label} is missing an "anchor".`, path));
    if (!isStringArray(entry.tests) || entry.tests.length === 0) {
      failures.push(invalidConfig(`${path}: claim ${label} lists no enforcing tests. Every registered claim needs at least one.`, path));
    }
    if (id.length > 0 && source.length > 0 && anchor.length > 0 && tests.length > 0) {
      claims.push({ id, source: normalizeConfigPath(source), anchor, tests });
    }
  });
  return claims;
}

function validateClaims(path: string, claims: Claim[], failures: ClaimsFailure[]): void {
  if (claims.length === 0) {
    failures.push({
      code: "empty_registry",
      path,
      message: `${path} has no claims; the registry must not be empty.`
    });
  }
  const seenIds = new Set<string>();
  for (const claim of claims) {
    if (seenIds.has(claim.id)) {
      failures.push({
        code: "duplicate_id",
        claimId: claim.id,
        path,
        message: `${path}: duplicate claim id "${claim.id}".`
      });
    }
    seenIds.add(claim.id);
  }
}

async function checkAnchors(config: ClaimsConfig, claims: Claim[], failures: ClaimsFailure[]): Promise<void> {
  const sourceCache = new Map<string, string | null>();
  for (const claim of claims) {
    let text = sourceCache.get(claim.source);
    if (text === undefined) {
      text = await readOptionalFile(resolve(config.rootDir, claim.source));
      sourceCache.set(claim.source, text);
    }
    if (text === null) {
      failures.push({
        code: "missing_source",
        claimId: claim.id,
        path: claim.source,
        message: `claim "${claim.id}": source file ${claim.source} does not exist.`
      });
      continue;
    }
    if (!text.includes(claim.anchor)) {
      failures.push({
        code: "stale_anchor",
        claimId: claim.id,
        path: claim.source,
        anchor: claim.anchor,
        message: `claim "${claim.id}": anchor no longer appears in ${claim.source}. If the claim was reworded, update the anchor; if the claim was dropped, remove the entry.\n  anchor: ${claim.anchor}`
      });
    }
  }
}

async function collectTestTitles(config: ClaimsConfig, files: string[], failures: ClaimsFailure[]): Promise<Set<string>> {
  const titles = new Set<string>();
  let pattern: RegExp;
  try {
    pattern = new RegExp(config.testTitlePattern, "gm");
  } catch (error) {
    failures.push(invalidConfig(`Config field "testTitlePattern" is not a valid regular expression: ${errorMessage(error)}.`));
    return titles;
  }

  for (const path of files) {
    const text = await readFile(resolve(config.rootDir, path), "utf8");
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const title = match[1];
      if (title !== undefined) titles.add(decodeJsStringFragment(title));
    }
  }
  return titles;
}

function collectReferencedTests(claims: Claim[]): Set<string> {
  const referenced = new Set<string>();
  for (const claim of claims) {
    for (const title of claim.tests) referenced.add(title);
  }
  return referenced;
}

function report(config: ClaimsConfig, claims: Claim[], failures: ClaimsFailure[], testTitles: string[], testFiles: string[]): ClaimsReport {
  const sourceCount = new Set(claims.map((claim) => claim.source)).size;
  const referencedTests = collectReferencedTests(claims);
  const promiseTests = testTitles.filter((title) => title.startsWith(config.promisePrefix));
  return {
    ok: failures.length === 0,
    config,
    claims,
    failures,
    counts: {
      claims: claims.length,
      sources: sourceCount,
      testFiles: testFiles.length,
      testTitles: testTitles.length,
      referencedTests: referencedTests.size,
      promiseTests: promiseTests.length
    },
    testTitles,
    promiseTests
  };
}

function emptyReport(cwd: string | undefined, failures: ClaimsFailure[]): ClaimsReport {
  const rootDir = resolve(cwd ?? process.cwd());
  return report({
    rootDir,
    registry: defaultConfig.registry,
    testFiles: [...defaultConfig.testFiles],
    testTitlePattern: defaultConfig.testTitlePattern,
    promisePrefix: defaultConfig.promisePrefix
  }, [], failures, [], []);
}

async function collectMatchingFiles(rootDir: string, patterns: string[]): Promise<string[]> {
  const allFiles = await walk(rootDir);
  const includePatterns = patterns.filter((pattern) => !pattern.startsWith("!"));
  const excludePatterns = patterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1));
  const includes = includePatterns.map(globToRegExp);
  const excludes = excludePatterns.map(globToRegExp);
  return allFiles
    .filter((path) => includes.some((pattern) => pattern.test(path)))
    .filter((path) => !excludes.some((pattern) => pattern.test(path)))
    .sort();
}

async function walk(rootDir: string, dir = rootDir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist" || entry.name === ".async") continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(rootDir, fullPath));
    } else if (entry.isFile()) {
      files.push(relativePath(rootDir, fullPath));
    }
  }
  return files;
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizeConfigPath(pattern);
  const segments = normalized.split("/");
  let source = "^";
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === "**") {
      if (index > 0) source += "/";
      source += "(?:[^/]+/)*";
      continue;
    }
    if (index > 0 && segments[index - 1] !== "**") source += "/";
    source += globSegmentToRegExp(segment ?? "");
  }
  source += "$";
  return new RegExp(source);
}

function globSegmentToRegExp(segment: string): string {
  let source = "";
  for (const char of segment) {
    if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += escapeRegExp(char);
  }
  return source;
}

function decodeJsStringFragment(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/"/g, "\\\"")}"`) as string;
  } catch {
    return value;
  }
}

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function normalizeConfigPath(path: string): string {
  return path.replace(/\\/g, "/").split(sep).join("/");
}

function relativePath(rootDir: string, path: string): string {
  const relativePathValue = relative(rootDir, path) || ".";
  return normalizeConfigPath(relativePathValue);
}

function invalidConfig(message: string, path?: string): ClaimsFailure {
  return { code: "invalid_config", message, ...(path ? { path } : {}) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0);
}

function claimLabel(entry: unknown, index: number): string {
  if (isPlainObject(entry) && typeof entry.id === "string" && entry.id.length > 0) return `"${entry.id}"`;
  return `at index ${index}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
