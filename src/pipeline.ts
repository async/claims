export type ClaimsPromptIntensity = "balanced" | "strict" | "adversarial";
export type ClaimsPromptTemplate = string | string[];
export type ClaimsNamedFileKey = "repair.context" | "repair.suggestions" | "repair.patch";
export type ClaimsNamedFiles = Partial<Record<ClaimsNamedFileKey, string>>;

export interface ClaimsPipelineTaskDefinition<RunStep> {
  description: string;
  dependsOn?: string[];
  inputs: string[];
  outputs?: string[];
  cache: boolean;
  run: RunStep;
}

export interface ClaimsPipelineAgentStep<EnvValue> {
  use: string | EnvValue;
  stdoutTo: string;
  prompt: string;
  model?: string | EnvValue;
}

export interface ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue = unknown> {
  task: (definition: ClaimsPipelineTaskDefinition<RunStep>) => TaskDefinition;
  sh: (strings: TemplateStringsArray, ...values: unknown[]) => RunStep;
  agent?: (definition: ClaimsPipelineAgentStep<EnvValue>) => RunStep;
  env?: {
    var: (name: string, options?: { default?: string }) => EnvValue;
  };
}

export interface ClaimsSuggestTaskOptions<EnvValue = unknown> {
  dependsOn?: string[];
  use: string | EnvValue;
  model?: string | EnvValue;
  intensity?: ClaimsPromptIntensity;
  prompt?: ClaimsPromptTemplate;
  cache?: boolean;
  description?: string;
  inputs?: string[];
  outputs?: string[];
}

export interface ClaimsPipelineOptions<ExtensionTask = unknown> {
  /** Task id for the blocking check. Defaults to "claims" in flat form. */
  checkId?: string;
  /** Task id for the non-failing JSON report. Defaults to "claims.report" in flat form. */
  reportId?: string;
  /** Task id prefix for repair tasks. Defaults to "claims.repair" in flat form. */
  repairId?: string;
  /** Include the JSON report task. Defaults to true. */
  report?: boolean;
  /** Include deterministic repair protocol tasks. Defaults to true. */
  repair?: boolean;
  /** Claims registry path passed to async-claims and tracked as a task input. */
  registry?: string;
  /** Claims coverage path passed to async-claims and tracked as a task input. */
  coverage?: string;
  /** Optional config path passed to async-claims and tracked as a task input. */
  config?: string;
  /** Test file globs passed to async-claims and tracked as task inputs. */
  testFiles?: string[];
  /** Documentation inputs tracked by generated tasks and visible to repair agents. */
  docs?: string[];
  /** Additional inputs tracked by the generated check and report tasks. */
  extraInputs?: string[];
  /** JSON report output path. Defaults to "claims-report.json". */
  reportOutput?: string;
  /** Claims-local protocol file overrides. */
  namedFiles?: ClaimsNamedFiles;
  /** Additional relative tasks under this claims task group. */
  tasks?: Record<string, ExtensionTask | ClaimsSuggestTaskDefinition<unknown>>;
}

export interface AsyncPipelineDeclarationMetadata {
  kind: string;
  version: number;
}

export interface PortableEnvVarRef {
  kind: "async-pipeline.env.var";
  name: string;
  default?: string;
}

export interface PortableShellStep {
  kind: "shell";
  command: string;
}

export interface PortableAgentStep {
  kind: "agent";
  use: string | PortableEnvVarRef | unknown;
  prompt: string;
  model?: string | PortableEnvVarRef | unknown;
  stdoutTo?: string;
}

export type PortableRunStep = PortableShellStep | PortableAgentStep;
export type PortableTaskDefinition = ClaimsPipelineTaskDefinition<PortableRunStep>;

export interface ClaimsRepairTaskGroup<TaskDefinition> {
  context: TaskDefinition;
  patch: TaskDefinition;
  [taskId: string]: TaskDefinition;
}

export interface ClaimsPipelineTaskGroup<TaskDefinition> {
  /** Default task for the group. The task-groups spec flattens this to the group id. */
  default: TaskDefinition;
  /** Non-failing JSON report task. */
  report?: TaskDefinition;
  /** Deterministic repair protocol tasks and optional repair subtasks. */
  repair: ClaimsRepairTaskGroup<TaskDefinition>;
}

export interface ClaimsSuggestTaskDefinition<EnvValue = unknown> {
  readonly kind: "claims.suggestTask";
  readonly options: ClaimsSuggestTaskOptions<EnvValue>;
  readonly [CLAIMS_SUGGEST_TASK]: true;
}

export const ASYNC_PIPELINE_DECLARATION = Symbol.for("@async/pipeline.declaration");
export const ASYNC_PIPELINE_DECLARATION_VERSION = 1;
const CLAIMS_SUGGEST_TASK = Symbol.for("@async/claims.suggestTask");
const taskSectionDeclarationKind = "section.tasks";

const defaultDocs = ["README.md", "AGENTS.md", "CHANGELOG.md", "docs/**/*.md"];
const defaultRegistry = "tests/claims.json";
const defaultCoverage = "tests/claims.coverage.json";
const defaultTestFiles = ["tests/**/*.test.js"];
const defaultReportOutput = "claims-report.json";
const defaultNamedFiles: Required<Record<ClaimsNamedFileKey, string>> = {
  "repair.context": "claims-repair-context.json",
  "repair.suggestions": "claims-anchor-updates.json",
  "repair.patch": "claims.patch"
};

export function claimsTasks(options?: Omit<ClaimsPipelineOptions<PortableTaskDefinition>, "checkId" | "reportId" | "repairId">): ClaimsPipelineTaskGroup<PortableTaskDefinition> {
  const primitives = portablePrimitives();
  return buildClaimsTaskGroup(primitives, options ?? {});
}

export function claimsWorkflowTasks(options?: Omit<ClaimsPipelineOptions<PortableTaskDefinition>, "checkId" | "reportId" | "repairId">): ClaimsPipelineTaskGroup<PortableTaskDefinition> {
  return claimsTasks(options);
}

export function claims(options?: ClaimsPipelineOptions<PortableTaskDefinition>): Record<string, PortableTaskDefinition>;
export function claims<TaskDefinition, RunStep, EnvValue = unknown>(
  primitives: ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue>,
  options?: ClaimsPipelineOptions<TaskDefinition>
): Record<string, TaskDefinition>;
export function claims<TaskDefinition, RunStep, EnvValue = unknown>(
  primitivesOrOptions?: ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue> | ClaimsPipelineOptions<TaskDefinition>,
  maybeOptions: ClaimsPipelineOptions<TaskDefinition> = {}
): Record<string, TaskDefinition> | Record<string, PortableTaskDefinition> {
  const { primitives, options } = normalizeHelperArgs(primitivesOrOptions, maybeOptions);
  const group = buildClaimsTaskGroup(primitives, options);
  const checkId = options.checkId ?? "claims";
  const reportId = options.reportId ?? "claims.report";
  const repairId = options.repairId ?? "claims.repair";
  const flat: Record<string, TaskDefinition> = {
    [checkId]: group.default
  };
  if (group.report) flat[reportId] = group.report;
  for (const [key, taskDefinition] of Object.entries(group.repair)) {
    flat[`${repairId}.${key}`] = taskDefinition;
  }
  return brandAsyncPipelineDeclaration(flat, taskSectionDeclarationKind);
}

export function claimsSuggestTask<EnvValue = unknown>(options: ClaimsSuggestTaskOptions<EnvValue>): ClaimsSuggestTaskDefinition<EnvValue> {
  return {
    kind: "claims.suggestTask",
    options,
    [CLAIMS_SUGGEST_TASK]: true
  };
}

export function renderPromptTemplate(template: ClaimsPromptTemplate): string {
  if (typeof template === "string") return template;
  if (Array.isArray(template) && template.every((line) => typeof line === "string")) return template.join("\n");
  throw new Error("Prompt template must be a string or string array. Function templates are not supported in v1.");
}

export function claimsSuggestPrompt(options: { intensity?: ClaimsPromptIntensity; namedFiles?: ClaimsNamedFiles } = {}): string[] {
  const intensity = options.intensity ?? "balanced";
  const files = resolveNamedFiles(options.namedFiles);
  return [
    "You are proposing claim-anchor repairs for @async/claims.",
    intensityInstruction(intensity),
    "",
    `Read ${files["repair.context"]} first. Treat it as the deterministic work queue.`,
    "Inspect only the declared markdown and documentation inputs to verify replacement anchors.",
    "Do not inspect tests, test titles, claims.coverage.json, or coverage mappings.",
    `Write JSON to ${files["repair.suggestions"]} with this shape:`,
    "{\"updates\":[{\"claimId\":\"...\",\"anchor\":\"...\",\"reason\":\"...\"}],\"needsReview\":[{\"claimId\":\"...\",\"reason\":\"...\"}]}",
    "Use needsReview instead of guessing when a claim was deleted, split, merged, made vague, or cannot be matched with high confidence.",
    "Do not edit files and do not output prose outside the JSON object."
  ];
}

export function claimsScoutPrompt(options: { intensity?: ClaimsPromptIntensity } = {}): string[] {
  const intensity = options.intensity ?? "balanced";
  return [
    "You are scouting documentation for behavioral promises that may need @async/claims registration.",
    intensityInstruction(intensity),
    "Scan markdown inputs for concrete, testable promises.",
    "Flag vague, duplicate, or non-testable statements instead of forcing them into claims.",
    "Return candidate claim ids, source files, exact anchors, and open questions. Do not modify files."
  ];
}

export function claimsRegisterPrompt(options: { intensity?: ClaimsPromptIntensity } = {}): string[] {
  const intensity = options.intensity ?? "balanced";
  return [
    "You are registering approved documentation promises for @async/claims.",
    intensityInstruction(intensity),
    "Propose entries for claims.json and coverage TODOs for claims.coverage.json.",
    "Keep claim anchors exact, stable, and testable.",
    "Do not invent test coverage. Mark missing test mappings as TODOs for humans or deterministic tests."
  ];
}

export function claimsMaintainPrompt(options: { intensity?: ClaimsPromptIntensity } = {}): string[] {
  const intensity = options.intensity ?? "balanced";
  return [
    "You are maintaining the @async/claims release gate.",
    intensityInstruction(intensity),
    "Suggest detector, schema, or workflow improvements that preserve deterministic release authority.",
    "Do not weaken checks to make a release pass.",
    "Separate mechanical fixes from judgment calls and list the verification command that should decide."
  ];
}

export function brandAsyncPipelineDeclaration<T extends object>(value: T, kind: string): T {
  const existing = readAsyncPipelineDeclaration(value);
  if (existing) {
    if (existing.kind !== kind) {
      throw new Error(`Cannot brand async-pipeline declaration kind "${kind}" over existing kind "${existing.kind}".`);
    }
    if (existing.version !== ASYNC_PIPELINE_DECLARATION_VERSION) {
      throw new Error(`Unsupported async-pipeline declaration version ${existing.version} for "${existing.kind}".`);
    }
    return value;
  }

  Object.defineProperty(value, ASYNC_PIPELINE_DECLARATION, {
    value: { kind, version: ASYNC_PIPELINE_DECLARATION_VERSION },
    enumerable: false,
    configurable: false,
    writable: false
  });
  return value;
}

export function readAsyncPipelineDeclaration(value: unknown): AsyncPipelineDeclarationMetadata | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const metadata = (value as { [ASYNC_PIPELINE_DECLARATION]?: unknown })[ASYNC_PIPELINE_DECLARATION];
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const kind = (metadata as { kind?: unknown }).kind;
  const version = (metadata as { version?: unknown }).version;
  if (typeof kind !== "string" || typeof version !== "number") return undefined;
  return { kind, version };
}

function buildClaimsTaskGroup<TaskDefinition, RunStep, EnvValue>(
  primitives: ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue>,
  options: Omit<ClaimsPipelineOptions<TaskDefinition>, "checkId" | "reportId" | "repairId">
): ClaimsPipelineTaskGroup<TaskDefinition> {
  const registry = options.registry ?? defaultRegistry;
  const coverage = options.coverage ?? defaultCoverage;
  const testFiles = options.testFiles ?? defaultTestFiles;
  const docs = options.docs ?? defaultDocs;
  const reportOutput = options.reportOutput ?? defaultReportOutput;
  const files = resolveNamedFiles(options.namedFiles);
  const includeReport = options.report ?? true;
  const includeRepair = options.repair ?? true;
  const commandOptions = asyncClaimsOptions({ config: options.config, registry: options.registry, coverage: options.coverage, testFiles: options.testFiles });
  const checkInputs = unique([
    ...(options.config ? [options.config] : []),
    registry,
    coverage,
    ...testFiles,
    ...docs,
    ...(options.extraInputs ?? [])
  ]);
  const contextInputs = unique([
    ...(options.config ? [options.config] : []),
    registry,
    ...docs,
    ...(options.extraInputs ?? [])
  ]);

  const group: ClaimsPipelineTaskGroup<TaskDefinition> = {
    default: primitives.task({
      description: "Claim coverage checks: every registered doc claim still exists verbatim and is enforced by a named test; every PROMISE test is registered.",
      inputs: checkInputs,
      cache: true,
      run: shell(primitives.sh, `async-claims check${commandOptions}`)
    }),
    repair: brandAsyncPipelineDeclaration({
      context: primitives.task({
        description: "Write a test-blind claims repair context for stale-anchor suggestion agents.",
        inputs: contextInputs,
        outputs: [files["repair.context"]],
        cache: true,
        run: shell(primitives.sh, `async-claims repair-context${commandOptions} --output ${shellQuote(files["repair.context"])}`)
      }),
      patch: primitives.task({
        description: "Convert reviewed anchor suggestions into a patch against the claims registry.",
        dependsOn: options.tasks && "repair.suggest" in options.tasks ? ["claims.repair.suggest"] : ["claims.repair.context"],
        inputs: unique([registry, files["repair.context"], files["repair.suggestions"], ...docs]),
        outputs: [files["repair.patch"]],
        cache: true,
        run: shell(primitives.sh, `async-claims patch-anchors${commandOptions} --suggestions ${shellQuote(files["repair.suggestions"])} --output ${shellQuote(files["repair.patch"])}`)
      })
    }, taskSectionDeclarationKind)
  };

  if (includeReport) {
    group.report = primitives.task({
      description: "Write a non-failing JSON claims report for release diagnostics.",
      inputs: checkInputs,
      outputs: [reportOutput],
      cache: true,
      run: shell(primitives.sh, `async-claims check${commandOptions} --format json --no-fail --output ${shellQuote(reportOutput)}`)
    });
  }

  if (!includeRepair) {
    group.repair = brandAsyncPipelineDeclaration({} as ClaimsRepairTaskGroup<TaskDefinition>, taskSectionDeclarationKind);
  } else {
    addExtensionTasks(group, primitives, options, files, docs);
  }

  return brandAsyncPipelineDeclaration(group, taskSectionDeclarationKind);
}

function addExtensionTasks<TaskDefinition, RunStep, EnvValue>(
  group: ClaimsPipelineTaskGroup<TaskDefinition>,
  primitives: ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue>,
  options: Omit<ClaimsPipelineOptions<TaskDefinition>, "checkId" | "reportId" | "repairId">,
  files: Required<Record<ClaimsNamedFileKey, string>>,
  docs: string[]
): void {
  for (const [key, value] of Object.entries(options.tasks ?? {})) {
    if (key.startsWith("claims.")) {
      throw new Error(`claimsTasks({ tasks }) keys are relative to the claims group; use "${key.slice("claims.".length)}" instead of "${key}".`);
    }
    if (key === "repair.context" || key === "repair.patch") {
      throw new Error(`claimsTasks({ tasks }) cannot replace built-in task "${key}".`);
    }
    const taskDefinition = isClaimsSuggestTaskDefinition(value)
      ? buildClaimsSuggestTask(primitives, value.options as ClaimsSuggestTaskOptions<EnvValue>, files, docs)
      : value as TaskDefinition;
    assignRelativeTask(group, key, taskDefinition);
  }
}

function buildClaimsSuggestTask<TaskDefinition, RunStep, EnvValue>(
  primitives: ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue>,
  options: ClaimsSuggestTaskOptions<EnvValue>,
  files: Required<Record<ClaimsNamedFileKey, string>>,
  docs: string[]
): TaskDefinition {
  if (!primitives.agent) {
    throw new Error("claimsSuggestTask() requires an async-pipeline agent primitive.");
  }
  const prompt = renderPromptTemplate(options.prompt ?? claimsSuggestPrompt({ intensity: options.intensity, namedFiles: files }));
  const step: ClaimsPipelineAgentStep<EnvValue> = {
    use: options.use,
    stdoutTo: files["repair.suggestions"],
    prompt,
    ...(options.model !== undefined ? { model: options.model } : {})
  };
  return primitives.task({
    description: options.description ?? "Ask an agent to propose claim-anchor updates as JSON. Test and coverage mappings stay hidden.",
    dependsOn: options.dependsOn ?? ["claims.repair.context"],
    inputs: unique([files["repair.context"], ...docs, ...(options.inputs ?? [])]),
    outputs: unique([files["repair.suggestions"], ...(options.outputs ?? [])]),
    cache: options.cache ?? false,
    run: primitives.agent(step)
  });
}

function assignRelativeTask<TaskDefinition>(group: ClaimsPipelineTaskGroup<TaskDefinition>, key: string, taskDefinition: TaskDefinition): void {
  const parts = key.split(".");
  if (parts.length === 1) {
    const part = parts[0];
    if (!part) throw new Error("claimsTasks({ tasks }) keys must be non-empty.");
    (group as unknown as Record<string, TaskDefinition>)[part] = taskDefinition;
    return;
  }
  if (parts[0] !== "repair" || parts.length !== 2 || !parts[1]) {
    throw new Error(`claimsTasks({ tasks }) key "${key}" must be a direct task id or repair.<name>.`);
  }
  group.repair[parts[1]] = taskDefinition;
}

function isClaimsSuggestTaskDefinition(value: unknown): value is ClaimsSuggestTaskDefinition<unknown> {
  return typeof value === "object"
    && value !== null
    && (value as { [CLAIMS_SUGGEST_TASK]?: unknown })[CLAIMS_SUGGEST_TASK] === true;
}

function asyncClaimsOptions(options: { config?: string; registry?: string; coverage?: string; testFiles?: string[] }): string {
  const parts = [];
  if (options.config) parts.push("--config", options.config);
  if (options.registry) parts.push("--registry", options.registry);
  if (options.coverage) parts.push("--coverage", options.coverage);
  if (options.testFiles) parts.push("--test-files", options.testFiles.join(","));
  return parts.length > 0 ? ` ${parts.map(shellQuote).join(" ")}` : "";
}

function intensityInstruction(intensity: ClaimsPromptIntensity): string {
  if (intensity === "strict") {
    return "Be strict: reject ambiguous matches and send uncertain cases to needsReview.";
  }
  if (intensity === "adversarial") {
    return "Be adversarial: challenge whether each suggested update preserves the same claim, and use needsReview unless the evidence is strong.";
  }
  return "Be balanced: propose high-confidence mechanical fixes and use needsReview for judgment calls.";
}

function resolveNamedFiles(namedFiles: ClaimsNamedFiles | undefined): Required<Record<ClaimsNamedFileKey, string>> {
  return {
    "repair.context": namedFiles?.["repair.context"] ?? defaultNamedFiles["repair.context"],
    "repair.suggestions": namedFiles?.["repair.suggestions"] ?? defaultNamedFiles["repair.suggestions"],
    "repair.patch": namedFiles?.["repair.patch"] ?? defaultNamedFiles["repair.patch"]
  };
}

function shell<RunStep>(sh: ClaimsPipelinePrimitives<unknown, RunStep>["sh"], command: string): RunStep {
  return sh([command] as unknown as TemplateStringsArray);
}

function normalizeHelperArgs<TaskDefinition, RunStep, EnvValue>(
  primitivesOrOptions: ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue> | ClaimsPipelineOptions<TaskDefinition> | undefined,
  maybeOptions: ClaimsPipelineOptions<TaskDefinition>
): {
  primitives: ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue>;
  options: ClaimsPipelineOptions<TaskDefinition>;
} {
  if (isClaimsPipelinePrimitives(primitivesOrOptions)) {
    return {
      primitives: primitivesOrOptions as ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue>,
      options: maybeOptions
    };
  }
  return {
    primitives: portablePrimitives() as unknown as ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue>,
    options: (primitivesOrOptions ?? {}) as ClaimsPipelineOptions<TaskDefinition>
  };
}

function isClaimsPipelinePrimitives(value: unknown): value is ClaimsPipelinePrimitives<unknown, unknown, unknown> {
  return typeof value === "object"
    && value !== null
    && "task" in value
    && "sh" in value
    && typeof (value as { task?: unknown }).task === "function"
    && typeof (value as { sh?: unknown }).sh === "function";
}

function portablePrimitives(): ClaimsPipelinePrimitives<PortableTaskDefinition, PortableRunStep, PortableEnvVarRef> {
  return {
    task(definition) {
      return brandAsyncPipelineDeclaration({ ...definition }, "task");
    },
    sh(strings, ...values) {
      let command = "";
      for (let index = 0; index < strings.length; index += 1) {
        command += strings[index] ?? "";
        if (index < values.length) command += String(values[index]);
      }
      return brandAsyncPipelineDeclaration({ kind: "shell", command }, "shell");
    },
    agent(definition) {
      const step: PortableAgentStep = {
        kind: "agent",
        use: definition.use,
        prompt: definition.prompt,
        stdoutTo: definition.stdoutTo,
        ...(definition.model !== undefined ? { model: definition.model } : {})
      };
      return brandAsyncPipelineDeclaration(step, "agent");
    },
    env: {
      var(name, options) {
        return brandAsyncPipelineDeclaration({
          kind: "async-pipeline.env.var",
          name,
          ...(options?.default ? { default: options.default } : {})
        }, "env.var");
      }
    }
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=,@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
