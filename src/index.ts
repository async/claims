import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";

export type ClaimsFailureCode =
  | "invalid_config"
  | "empty_registry"
  | "duplicate_id"
  | "missing_claim_coverage"
  | "unknown_coverage_claim"
  | "missing_source"
  | "stale_anchor"
  | "missing_referenced_test"
  | "unmapped_promise_test";

export interface Claim {
  id: string;
  source: string;
  anchor: string;
}

export interface ClaimCoverage {
  claimId: string;
  tests: string[];
}

export interface ClaimsConfig {
  rootDir: string;
  registry: string;
  coverage: string;
  testFiles: string[];
  testTitlePattern: string;
  promisePrefix: string;
}

export interface LoadConfigOptions {
  cwd?: string;
  config?: string;
  registry?: string;
  coverage?: string;
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
  coverage: ClaimCoverage[];
  failures: ClaimsFailure[];
  counts: {
    claims: number;
    coverage: number;
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

export interface ClaimsRepairContext {
  format: "async-claims.repair-context.v1";
  registry: string;
  claims: Claim[];
  failures: ClaimsFailure[];
  counts: {
    claims: number;
    failures: number;
  };
}

export interface CreateRepairContextOptions extends LoadConfigOptions {}

export interface ClaimsAnchorSuggestionUpdate {
  claimId: string;
  anchor: string;
  reason?: string;
}

export interface ClaimsAnchorSuggestionReview {
  claimId: string;
  reason: string;
}

export interface ClaimsAnchorSuggestions {
  updates?: ClaimsAnchorSuggestionUpdate[];
  needsReview?: ClaimsAnchorSuggestionReview[];
}

export interface CreateAnchorPatchOptions extends LoadConfigOptions {
  suggestions?: string;
}

export interface ClaimsAnchorPatch {
  patch: string;
  updated: number;
  needsReview: number;
}

const defaultTestTitlePattern = "^\\s*test\\(\\s*\"((?:[^\"\\\\]|\\\\.)*)\"";
const defaultPromisePrefix = "PROMISE: ";
const defaultClaimsFolder = "tests";
const candidateClaimsFolders = ["tests", "test"] as const;
const claimsFileName = "claims.json";
const coverageFileName = "claims.coverage.json";
const configFileName = "claims.config.json";
const defaultSuggestionsFile = "claims-anchor-updates.json";

class ClaimsConfigError extends Error {
  readonly failures: ClaimsFailure[];

  constructor(failures: ClaimsFailure[]) {
    super(failures.map((failure) => failure.message).join("\n"));
    this.name = "ClaimsConfigError";
    this.failures = failures;
  }
}

interface MutableConfig {
  registry?: string;
  coverage?: string;
  testFiles?: string[];
  testTitlePattern: string;
  promisePrefix: string;
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<ClaimsConfig> {
  const rootDir = resolve(options.cwd ?? process.cwd());
  const configPath = resolve(rootDir, options.config ?? configFileName);
  const config: MutableConfig = {
    testTitlePattern: defaultTestTitlePattern,
    promisePrefix: defaultPromisePrefix
  };
  const explicit = {
    registry: false,
    coverage: false,
    testFiles: false
  };
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
      const allowed = new Set(["$schema", "registry", "coverage", "testFiles", "testTitlePattern", "promisePrefix"]);
      for (const key of Object.keys(raw)) {
        if (!allowed.has(key)) {
          failures.push(invalidConfig(`${relativePath(rootDir, configPath)} has unknown field "${key}".`, relativePath(rootDir, configPath)));
        }
      }
      if ("registry" in raw) {
        if (typeof raw.registry === "string" && raw.registry.length > 0) {
          config.registry = raw.registry;
          explicit.registry = true;
        } else {
          failures.push(invalidConfig(`${relativePath(rootDir, configPath)} field "registry" must be a non-empty string.`, relativePath(rootDir, configPath)));
        }
      }
      if ("coverage" in raw) {
        if (typeof raw.coverage === "string" && raw.coverage.length > 0) {
          config.coverage = raw.coverage;
          explicit.coverage = true;
        } else {
          failures.push(invalidConfig(`${relativePath(rootDir, configPath)} field "coverage" must be a non-empty string.`, relativePath(rootDir, configPath)));
        }
      }
      if ("testFiles" in raw) {
        if (isStringArray(raw.testFiles) && raw.testFiles.length > 0) {
          config.testFiles = raw.testFiles;
          explicit.testFiles = true;
        } else {
          failures.push(invalidConfig(`${relativePath(rootDir, configPath)} field "testFiles" must be a non-empty string array.`, relativePath(rootDir, configPath)));
        }
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

  if (options.registry !== undefined) {
    config.registry = options.registry;
    explicit.registry = true;
  }
  if (options.coverage !== undefined) {
    config.coverage = options.coverage;
    explicit.coverage = true;
  }
  if (options.testFiles !== undefined) {
    config.testFiles = options.testFiles;
    explicit.testFiles = true;
  }
  if (options.testTitlePattern !== undefined) config.testTitlePattern = options.testTitlePattern;
  if (options.promisePrefix !== undefined) config.promisePrefix = options.promisePrefix;

  const paths = await resolveConfigPaths(rootDir, config, explicit, failures);

  if (paths.registry.length === 0) failures.push(invalidConfig("Config field \"registry\" must be a non-empty string."));
  if (paths.coverage.length === 0) failures.push(invalidConfig("Config field \"coverage\" must be a non-empty string."));
  if (paths.testFiles.length === 0 || paths.testFiles.some((pattern) => pattern.length === 0)) {
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
    registry: normalizeConfigPath(paths.registry),
    coverage: normalizeConfigPath(paths.coverage),
    testFiles: paths.testFiles.map(normalizeConfigPath),
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
    return report(config, [], [], failures, [], []);
  }

  const coveragePath = resolve(config.rootDir, config.coverage);
  const coverageText = await readOptionalFile(coveragePath);
  const claims = parseClaimsRegistry(registryText, config.registry, failures);
  validateClaims(config.registry, claims, failures);
  await checkAnchors(config, claims, failures);

  let coverage: ClaimCoverage[] = [];
  if (coverageText === null) {
    failures.push(invalidConfig(`Coverage file ${config.coverage} does not exist.`, config.coverage));
  } else {
    coverage = parseCoverageRegistry(coverageText, config.coverage, failures);
    validateCoverage(config.coverage, claims, coverage, failures);
  }

  const testFiles = await collectMatchingFiles(config.rootDir, config.testFiles);
  const testTitles = await collectTestTitles(config, testFiles, failures);
  const referencedTests = collectReferencedTests(coverage);
  for (const entry of coverage) {
    for (const title of entry.tests) {
      if (!testTitles.has(title)) {
        failures.push({
          code: "missing_referenced_test",
          claimId: entry.claimId,
          testTitle: title,
          message: `claim "${entry.claimId}": no test titled "${title}" exists in ${config.testFiles.join(", ")}. The claim is documented but unenforced.`
        });
      }
    }
  }

  for (const title of [...testTitles].sort()) {
    if (title.startsWith(config.promisePrefix) && !referencedTests.has(title)) {
      failures.push({
        code: "unmapped_promise_test",
        testTitle: title,
        message: `unmapped promise: test "${title}" is not registered in ${config.coverage}. Add the claim it enforces.`
      });
    }
  }

  return report(config, claims, coverage, failures, [...testTitles].sort(), testFiles);
}

export async function createRepairContext(options: CreateRepairContextOptions = {}): Promise<ClaimsRepairContext> {
  let config: ClaimsConfig;
  try {
    config = await loadConfig(options);
  } catch (error) {
    const failures = error instanceof ClaimsConfigError ? error.failures : [invalidConfig(errorMessage(error))];
    return {
      format: "async-claims.repair-context.v1",
      registry: options.registry ?? `${defaultClaimsFolder}/${claimsFileName}`,
      claims: [],
      failures,
      counts: { claims: 0, failures: failures.length }
    };
  }

  const failures: ClaimsFailure[] = [];
  const registryText = await readOptionalFile(resolve(config.rootDir, config.registry));
  if (registryText === null) {
    failures.push(invalidConfig(`Registry file ${config.registry} does not exist.`, config.registry));
    return {
      format: "async-claims.repair-context.v1",
      registry: config.registry,
      claims: [],
      failures,
      counts: { claims: 0, failures: failures.length }
    };
  }

  const claims = parseClaimsRegistry(registryText, config.registry, failures);
  validateClaims(config.registry, claims, failures);
  await checkAnchors(config, claims, failures);
  return {
    format: "async-claims.repair-context.v1",
    registry: config.registry,
    claims,
    failures,
    counts: { claims: claims.length, failures: failures.length }
  };
}

export async function createAnchorPatch(options: CreateAnchorPatchOptions = {}): Promise<ClaimsAnchorPatch> {
  const config = await loadConfig(options);
  const registryPath = resolve(config.rootDir, config.registry);
  const registryText = await readOptionalFile(registryPath);
  if (registryText === null) {
    throw new ClaimsConfigError([invalidConfig(`Registry file ${config.registry} does not exist.`, config.registry)]);
  }

  const suggestionsPath = normalizeConfigPath(options.suggestions ?? defaultSuggestionsFile);
  const suggestionsText = await readOptionalFile(resolve(config.rootDir, suggestionsPath));
  if (suggestionsText === null) {
    throw new ClaimsConfigError([invalidConfig(`Suggestions file ${suggestionsPath} does not exist.`, suggestionsPath)]);
  }

  const failures: ClaimsFailure[] = [];
  const claims = parseClaimsRegistry(registryText, config.registry, failures);
  validateClaims(config.registry, claims, failures);
  const suggestions = parseAnchorSuggestions(suggestionsText, suggestionsPath, failures);
  if (suggestions.needsReview.length > 0) {
    for (const review of suggestions.needsReview) {
      failures.push({
        code: "invalid_config",
        claimId: review.claimId,
        message: `claim "${review.claimId}" needs review before patching: ${review.reason}`
      });
    }
  }

  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  for (const update of suggestions.updates) {
    const claim = claimById.get(update.claimId);
    if (!claim) {
      failures.push({
        code: "unknown_coverage_claim",
        claimId: update.claimId,
        path: suggestionsPath,
        message: `${suggestionsPath}: update references unknown claim id "${update.claimId}".`
      });
      continue;
    }
    const sourceText = await readOptionalFile(resolve(config.rootDir, claim.source));
    if (sourceText === null) {
      failures.push({
        code: "missing_source",
        claimId: claim.id,
        path: claim.source,
        message: `claim "${claim.id}": source file ${claim.source} does not exist.`
      });
      continue;
    }
    if (!sourceText.includes(update.anchor)) {
      failures.push({
        code: "stale_anchor",
        claimId: claim.id,
        path: claim.source,
        anchor: update.anchor,
        message: `claim "${claim.id}": suggested anchor does not appear in ${claim.source}.\n  anchor: ${update.anchor}`
      });
    }
  }

  if (failures.length > 0) {
    throw new ClaimsConfigError(failures);
  }

  if (suggestions.updates.length === 0) {
    return { patch: "", updated: 0, needsReview: 0 };
  }

  const raw = parseJsonObject(registryText, config.registry);
  const updatesByClaimId = new Map(suggestions.updates.map((update) => [update.claimId, update]));
  const rawClaims = Array.isArray(raw.claims) ? raw.claims : [];
  raw.claims = rawClaims.map((entry) => {
    if (!isPlainObject(entry) || typeof entry.id !== "string") return entry;
    const update = updatesByClaimId.get(entry.id);
    if (!update) return entry;
    return { ...entry, anchor: update.anchor };
  });
  const updatedRegistry = `${JSON.stringify(raw, null, 2)}\n`;
  return {
    patch: unifiedDiff(config.registry, registryText, updatedRegistry),
    updated: suggestions.updates.length,
    needsReview: suggestions.needsReview.length
  };
}

export async function initClaims(options: InitClaimsOptions = {}): Promise<{ created: string[]; overwritten: string[] }> {
  const rootDir = resolve(options.cwd ?? process.cwd());
  const configPath = join(rootDir, configFileName);
  const registryPath = join(rootDir, defaultClaimsFolder, claimsFileName);
  const coveragePath = join(rootDir, defaultClaimsFolder, coverageFileName);
  const targets = [configPath, registryPath, coveragePath];
  const existing = [];
  for (const target of targets) {
    if (await exists(target)) existing.push(relativePath(rootDir, target));
  }
  if (existing.length > 0 && !options.force) {
    throw new Error(`Refusing to overwrite existing file(s): ${existing.join(", ")}. Re-run with --force to replace them.`);
  }

  const configBody = `${JSON.stringify({
    $schema: "https://async.dev/schemas/claims.config.schema.json",
    registry: `${defaultClaimsFolder}/${claimsFileName}`,
    coverage: `${defaultClaimsFolder}/${coverageFileName}`,
    testFiles: [`${defaultClaimsFolder}/**/*.test.js`],
    testTitlePattern: defaultTestTitlePattern,
    promisePrefix: defaultPromisePrefix
  }, null, 2)}\n`;
  const registryBody = `${JSON.stringify({
    $schema: "https://async.dev/schemas/claims.schema.json",
    $comment: "Register every documented promise here. Each anchor must appear verbatim in source. Test mappings live in claims.coverage.json.",
    claims: []
  }, null, 2)}\n`;
  const coverageBody = `${JSON.stringify({
    $schema: "https://async.dev/schemas/claims.coverage.schema.json",
    $comment: "Map each claim id to the PROMISE: test titles that enforce it. Keep this file away from repair agents.",
    coverage: []
  }, null, 2)}\n`;

  await mkdir(dirname(configPath), { recursive: true });
  await mkdir(dirname(registryPath), { recursive: true });
  await mkdir(dirname(coveragePath), { recursive: true });
  const overwritten = existing;
  await writeFile(configPath, configBody, "utf8");
  await writeFile(registryPath, registryBody, "utf8");
  await writeFile(coveragePath, coverageBody, "utf8");
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

async function resolveConfigPaths(
  rootDir: string,
  config: MutableConfig,
  explicit: { registry: boolean; coverage: boolean; testFiles: boolean },
  failures: ClaimsFailure[]
): Promise<{ registry: string; coverage: string; testFiles: string[] }> {
  let folder: string;
  if (explicit.registry) {
    folder = configFolder(config.registry ?? `${defaultClaimsFolder}/${claimsFileName}`);
  } else if (explicit.coverage) {
    folder = configFolder(config.coverage ?? `${defaultClaimsFolder}/${coverageFileName}`);
  } else {
    folder = await detectClaimsFolder(rootDir, failures);
  }

  const registry = config.registry ?? joinConfigPath(folder, claimsFileName);
  const coverage = config.coverage ?? joinConfigPath(folder, coverageFileName);
  const testFiles = config.testFiles ?? [testGlobForFolder(folder)];
  return { registry, coverage, testFiles };
}

async function detectClaimsFolder(rootDir: string, failures: ClaimsFailure[]): Promise<string> {
  const foldersWithClaims = [];
  for (const folder of candidateClaimsFolders) {
    const hasRegistry = await exists(join(rootDir, folder, claimsFileName));
    const hasCoverage = await exists(join(rootDir, folder, coverageFileName));
    if (hasRegistry || hasCoverage) foldersWithClaims.push(folder);
  }
  if (foldersWithClaims.length === 1) return foldersWithClaims[0] ?? defaultClaimsFolder;
  if (foldersWithClaims.length > 1) {
    failures.push(invalidConfig(`Both tests/ and test/ contain claims files. Set "registry" or "coverage" in ${configFileName} to choose one.`));
    return defaultClaimsFolder;
  }

  const existingFolders = [];
  for (const folder of candidateClaimsFolders) {
    if (await isDirectory(join(rootDir, folder))) existingFolders.push(folder);
  }
  if (existingFolders.length === 1) return existingFolders[0] ?? defaultClaimsFolder;
  if (existingFolders.length > 1) {
    failures.push(invalidConfig(`Both tests/ and test/ exist but neither contains ${claimsFileName} or ${coverageFileName}. Set "registry" or "coverage" in ${configFileName}.`));
    return defaultClaimsFolder;
  }
  return defaultClaimsFolder;
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
  validateObjectKeys(path, raw, new Set(["$schema", "$comment", "claims"]), failures);
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
    validateObjectKeys(`${path}: claim ${label}`, entry, new Set(["id", "source", "anchor"]), failures, path);
    const id = typeof entry.id === "string" ? entry.id : "";
    const source = typeof entry.source === "string" ? entry.source : "";
    const anchor = typeof entry.anchor === "string" ? entry.anchor : "";
    if (id.length === 0) failures.push(invalidConfig(`${path}: claim ${label} is missing an "id".`, path));
    if (source.length === 0) failures.push(invalidConfig(`${path}: claim ${label} is missing a "source" file.`, path));
    if (anchor.length === 0) failures.push(invalidConfig(`${path}: claim ${label} is missing an "anchor".`, path));
    if (id.length > 0 && source.length > 0 && anchor.length > 0) {
      claims.push({ id, source: normalizeConfigPath(source), anchor });
    }
  });
  return claims;
}

function parseCoverageRegistry(text: string, path: string, failures: ClaimsFailure[]): ClaimCoverage[] {
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
  validateObjectKeys(path, raw, new Set(["$schema", "$comment", "coverage"]), failures);
  if (!("coverage" in raw)) {
    failures.push(invalidConfig(`${path} is missing a "coverage" array.`, path));
    return [];
  }
  if (!Array.isArray(raw.coverage)) {
    failures.push(invalidConfig(`${path} field "coverage" must be an array.`, path));
    return [];
  }

  const coverage: ClaimCoverage[] = [];
  raw.coverage.forEach((entry, index) => {
    const label = coverageLabel(entry, index);
    if (!isPlainObject(entry)) {
      failures.push(invalidConfig(`${path}: coverage at index ${index} must be an object.`, path));
      return;
    }
    validateObjectKeys(`${path}: coverage ${label}`, entry, new Set(["claimId", "tests"]), failures, path);
    const claimId = typeof entry.claimId === "string" ? entry.claimId : "";
    const tests = isStringArray(entry.tests) ? entry.tests : [];
    if (claimId.length === 0) failures.push(invalidConfig(`${path}: coverage ${label} is missing a "claimId".`, path));
    if (!isStringArray(entry.tests) || entry.tests.length === 0) {
      failures.push(invalidConfig(`${path}: coverage ${label} lists no enforcing tests. Every registered claim needs at least one.`, path));
    }
    if (claimId.length > 0 && tests.length > 0) {
      coverage.push({ claimId, tests });
    }
  });
  return coverage;
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

function validateCoverage(path: string, claims: Claim[], coverage: ClaimCoverage[], failures: ClaimsFailure[]): void {
  const claimIds = new Set(claims.map((claim) => claim.id));
  const coveredClaimIds = new Set<string>();
  for (const entry of coverage) {
    if (coveredClaimIds.has(entry.claimId)) {
      failures.push(invalidConfig(`${path}: duplicate coverage entry for claim "${entry.claimId}".`, path));
    }
    coveredClaimIds.add(entry.claimId);
    if (!claimIds.has(entry.claimId)) {
      failures.push({
        code: "unknown_coverage_claim",
        claimId: entry.claimId,
        path,
        message: `${path}: coverage references unknown claim id "${entry.claimId}".`
      });
    }
  }
  for (const claim of claims) {
    if (!coveredClaimIds.has(claim.id)) {
      failures.push({
        code: "missing_claim_coverage",
        claimId: claim.id,
        path,
        message: `claim "${claim.id}": no coverage entry exists in ${path}.`
      });
    }
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

function collectReferencedTests(coverage: ClaimCoverage[]): Set<string> {
  const referenced = new Set<string>();
  for (const entry of coverage) {
    for (const title of entry.tests) referenced.add(title);
  }
  return referenced;
}

function report(config: ClaimsConfig, claims: Claim[], coverage: ClaimCoverage[], failures: ClaimsFailure[], testTitles: string[], testFiles: string[]): ClaimsReport {
  const sourceCount = new Set(claims.map((claim) => claim.source)).size;
  const referencedTests = collectReferencedTests(coverage);
  const promiseTests = testTitles.filter((title) => title.startsWith(config.promisePrefix));
  return {
    ok: failures.length === 0,
    config,
    claims,
    coverage,
    failures,
    counts: {
      claims: claims.length,
      coverage: coverage.length,
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
  const registry = `${defaultClaimsFolder}/${claimsFileName}`;
  const coverage = `${defaultClaimsFolder}/${coverageFileName}`;
  return report({
    rootDir,
    registry,
    coverage,
    testFiles: [`${defaultClaimsFolder}/**/*.test.js`],
    testTitlePattern: defaultTestTitlePattern,
    promisePrefix: defaultPromisePrefix
  }, [], [], failures, [], []);
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

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function normalizeConfigPath(path: string): string {
  return path.replace(/\\/g, "/").split(sep).join("/");
}

function configFolder(path: string): string {
  const folder = posix.dirname(normalizeConfigPath(path));
  return folder === "." ? "" : folder;
}

function joinConfigPath(folder: string, fileName: string): string {
  return folder.length > 0 ? `${folder}/${fileName}` : fileName;
}

function testGlobForFolder(folder: string): string {
  return folder.length > 0 ? `${folder}/**/*.test.js` : "**/*.test.js";
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

function coverageLabel(entry: unknown, index: number): string {
  if (isPlainObject(entry) && typeof entry.claimId === "string" && entry.claimId.length > 0) return `"${entry.claimId}"`;
  return `at index ${index}`;
}

function validateObjectKeys(label: string, value: Record<string, unknown>, allowed: Set<string>, failures: ClaimsFailure[], path?: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      failures.push(invalidConfig(`${label} has unknown field "${key}".`, path ?? label));
    }
  }
}

function parseAnchorSuggestions(text: string, path: string, failures: ClaimsFailure[]): { updates: ClaimsAnchorSuggestionUpdate[]; needsReview: ClaimsAnchorSuggestionReview[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    failures.push(invalidConfig(`Could not parse ${path}: ${errorMessage(error)}.`, path));
    return { updates: [], needsReview: [] };
  }
  if (!isPlainObject(raw)) {
    failures.push(invalidConfig(`${path} must contain a JSON object.`, path));
    return { updates: [], needsReview: [] };
  }
  validateObjectKeys(path, raw, new Set(["updates", "needsReview"]), failures);
  const updates = parseAnchorSuggestionUpdates(raw.updates, path, failures);
  const needsReview = parseAnchorSuggestionReviews(raw.needsReview, path, failures);
  return { updates, needsReview };
}

function parseAnchorSuggestionUpdates(value: unknown, path: string, failures: ClaimsFailure[]): ClaimsAnchorSuggestionUpdate[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    failures.push(invalidConfig(`${path} field "updates" must be an array.`, path));
    return [];
  }
  const updates: ClaimsAnchorSuggestionUpdate[] = [];
  value.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      failures.push(invalidConfig(`${path}: update at index ${index} must be an object.`, path));
      return;
    }
    validateObjectKeys(`${path}: update at index ${index}`, entry, new Set(["claimId", "anchor", "reason"]), failures, path);
    const claimId = typeof entry.claimId === "string" ? entry.claimId : "";
    const anchor = typeof entry.anchor === "string" ? entry.anchor : "";
    const reason = typeof entry.reason === "string" ? entry.reason : undefined;
    if (claimId.length === 0) failures.push(invalidConfig(`${path}: update at index ${index} is missing a "claimId".`, path));
    if (anchor.length === 0) failures.push(invalidConfig(`${path}: update at index ${index} is missing an "anchor".`, path));
    if (claimId.length > 0 && anchor.length > 0) updates.push({ claimId, anchor, ...(reason ? { reason } : {}) });
  });
  return updates;
}

function parseAnchorSuggestionReviews(value: unknown, path: string, failures: ClaimsFailure[]): ClaimsAnchorSuggestionReview[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    failures.push(invalidConfig(`${path} field "needsReview" must be an array.`, path));
    return [];
  }
  const reviews: ClaimsAnchorSuggestionReview[] = [];
  value.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      failures.push(invalidConfig(`${path}: needsReview at index ${index} must be an object.`, path));
      return;
    }
    validateObjectKeys(`${path}: needsReview at index ${index}`, entry, new Set(["claimId", "reason"]), failures, path);
    const claimId = typeof entry.claimId === "string" ? entry.claimId : "";
    const reason = typeof entry.reason === "string" ? entry.reason : "";
    if (claimId.length === 0) failures.push(invalidConfig(`${path}: needsReview at index ${index} is missing a "claimId".`, path));
    if (reason.length === 0) failures.push(invalidConfig(`${path}: needsReview at index ${index} is missing a "reason".`, path));
    if (claimId.length > 0 && reason.length > 0) reviews.push({ claimId, reason });
  });
  return reviews;
}

function parseJsonObject(text: string, path: string): Record<string, unknown> {
  const raw = JSON.parse(text) as unknown;
  if (!isPlainObject(raw)) throw new Error(`${path} must contain a JSON object.`);
  return raw;
}

function unifiedDiff(filePath: string, before: string, after: string): string {
  if (before === after) return "";
  const beforeLines = splitPatchLines(before);
  const afterLines = splitPatchLines(after);
  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
    ""
  ].join("\n");
}

function splitPatchLines(value: string): string[] {
  const trimmed = value.endsWith("\n") ? value.slice(0, -1) : value;
  return trimmed.length === 0 ? [] : trimmed.split("\n");
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
