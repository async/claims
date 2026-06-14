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
}

export interface ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue = unknown> {
  task: (definition: ClaimsPipelineTaskDefinition<RunStep>) => TaskDefinition;
  sh: (strings: TemplateStringsArray, ...values: unknown[]) => RunStep;
  agent?: (definition: ClaimsPipelineAgentStep<EnvValue>) => RunStep;
  env?: {
    var: (name: string, options?: { default?: string }) => EnvValue;
  };
}

export interface ClaimsPipelineOptions {
  /** Task id for the blocking check. Defaults to "claims". */
  checkId?: string;
  /** Task id for the non-failing JSON report. Defaults to "claims-report". */
  reportId?: string;
  /** Task id for the propose-only patch task. Defaults to "claims-repair". */
  repairId?: string;
  /** Include the JSON report task. Defaults to true. */
  report?: boolean;
  /** Include the repair task. Defaults to true when agent and env primitives are supplied. */
  repair?: boolean;
  /** Registry path passed to async-claims and tracked as a task input. */
  registry?: string;
  /** Optional config path passed to async-claims and tracked as a task input. */
  config?: string;
  /** Test file globs passed to async-claims and tracked as task inputs. */
  testFiles?: string[];
  /** Documentation inputs tracked by the generated tasks. */
  docs?: string[];
  /** Additional inputs tracked by the generated check and report tasks. */
  extraInputs?: string[];
  /** JSON report output path. Defaults to "claims-report.json". */
  reportOutput?: string;
  /** Repair patch output path. Defaults to "claims.patch". */
  patchOutput?: string;
  /** Environment variable used to select the repair agent profile. Defaults to "ASYNC_AGENT". */
  agentEnv?: string;
  /** Default repair agent profile. Defaults to "claude". */
  defaultAgent?: string;
  /** Override the repair prompt. */
  repairPrompt?: string;
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
  use: string | PortableEnvVarRef;
  prompt: string;
  model?: string | PortableEnvVarRef;
  stdoutTo?: string;
}

export type PortableRunStep = PortableShellStep | PortableAgentStep;
export type PortableTaskDefinition = ClaimsPipelineTaskDefinition<PortableRunStep>;

export interface ClaimsPipelineTaskGroup<TaskDefinition> {
  /** Default task for the group. The task-groups spec flattens this to the group id. */
  default: TaskDefinition;
  /** Non-failing JSON report task. */
  report?: TaskDefinition;
  /** Propose-only registry patch task. */
  repair?: TaskDefinition;
}

export const ASYNC_PIPELINE_DECLARATION = Symbol.for("@async/pipeline.declaration");
export const ASYNC_PIPELINE_DECLARATION_VERSION = 1;
const taskSectionDeclarationKind = "section.tasks";

const defaultDocs = ["README.md", "AGENTS.md", "CHANGELOG.md", "docs/**/*.md"];
const defaultRegistry = "tests/claims.json";
const defaultTestFiles = ["tests/**/*.test.js"];

export function claimsWorkflowTasks(options?: Omit<ClaimsPipelineOptions, "checkId" | "reportId" | "repairId">): ClaimsPipelineTaskGroup<PortableTaskDefinition>;
export function claimsWorkflowTasks<TaskDefinition, RunStep, EnvValue = unknown>(
  primitives: ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue>,
  options?: Omit<ClaimsPipelineOptions, "checkId" | "reportId" | "repairId">
): ClaimsPipelineTaskGroup<TaskDefinition>;
export function claimsWorkflowTasks<TaskDefinition, RunStep, EnvValue = unknown>(
  primitivesOrOptions?: ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue> | Omit<ClaimsPipelineOptions, "checkId" | "reportId" | "repairId">,
  maybeOptions: Omit<ClaimsPipelineOptions, "checkId" | "reportId" | "repairId"> = {}
): ClaimsPipelineTaskGroup<TaskDefinition> | ClaimsPipelineTaskGroup<PortableTaskDefinition> {
  const { primitives, options, portable } = normalizeHelperArgs(primitivesOrOptions, maybeOptions);
  const generated = claims(primitives, {
    ...options,
    checkId: "default",
    reportId: "report",
    repairId: "repair",
    repair: options.repair ?? portable
  });
  return brandAsyncPipelineDeclaration({
    default: generated.default as TaskDefinition,
    ...(generated.report ? { report: generated.report } : {}),
    ...(generated.repair ? { repair: generated.repair } : {})
  } as ClaimsPipelineTaskGroup<TaskDefinition>, taskSectionDeclarationKind);
}

export function claimsTasks(options?: Omit<ClaimsPipelineOptions, "checkId" | "reportId" | "repairId">): ClaimsPipelineTaskGroup<PortableTaskDefinition>;
export function claimsTasks<TaskDefinition, RunStep, EnvValue = unknown>(
  primitives: ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue>,
  options?: Omit<ClaimsPipelineOptions, "checkId" | "reportId" | "repairId">
): ClaimsPipelineTaskGroup<TaskDefinition>;
export function claimsTasks<TaskDefinition, RunStep, EnvValue = unknown>(
  primitivesOrOptions?: ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue> | Omit<ClaimsPipelineOptions, "checkId" | "reportId" | "repairId">,
  maybeOptions: Omit<ClaimsPipelineOptions, "checkId" | "reportId" | "repairId"> = {}
): ClaimsPipelineTaskGroup<TaskDefinition> | ClaimsPipelineTaskGroup<PortableTaskDefinition> {
  return claimsWorkflowTasks(primitivesOrOptions as ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue>, maybeOptions);
}

export function claims(options?: ClaimsPipelineOptions): Record<string, PortableTaskDefinition>;
export function claims<TaskDefinition, RunStep, EnvValue = unknown>(
  primitives: ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue>,
  options?: ClaimsPipelineOptions
): Record<string, TaskDefinition>;
export function claims<TaskDefinition, RunStep, EnvValue = unknown>(
  primitivesOrOptions?: ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue> | ClaimsPipelineOptions,
  maybeOptions: ClaimsPipelineOptions = {}
): Record<string, TaskDefinition> | Record<string, PortableTaskDefinition> {
  const { primitives, options, portable } = normalizeHelperArgs(primitivesOrOptions, maybeOptions);
  const registry = options.registry ?? defaultRegistry;
  const testFiles = options.testFiles ?? defaultTestFiles;
  const docs = options.docs ?? defaultDocs;
  const reportOutput = options.reportOutput ?? "claims-report.json";
  const patchOutput = options.patchOutput ?? "claims.patch";
  const checkId = options.checkId ?? "claims";
  const reportId = options.reportId ?? "claims-report";
  const repairId = options.repairId ?? "claims-repair";
  const includeReport = options.report ?? true;
  const includeRepair = options.repair ?? (portable || Boolean(primitives.agent && primitives.env));

  if (includeRepair && (!primitives.agent || !primitives.env)) {
    throw new Error("claims({ repair: true }) requires agent and env primitives.");
  }

  const inputs = unique([
    ...(options.config ? [options.config] : []),
    registry,
    ...testFiles,
    ...docs,
    ...(options.extraInputs ?? [])
  ]);
  const commandOptions = asyncClaimsOptions({ config: options.config, registry: options.registry, testFiles: options.testFiles });
  const tasks: Record<string, TaskDefinition> = {
    [checkId]: primitives.task({
      description: "Claim coverage checks: every registered doc claim still exists verbatim and is enforced by a named test; every PROMISE test is registered.",
      inputs,
      cache: true,
      run: shell(primitives.sh, `async-claims check${commandOptions}`)
    })
  };

  if (includeReport || includeRepair) {
    tasks[reportId] = primitives.task({
      description: "Write a non-failing JSON claims report for repair suggestions.",
      inputs,
      outputs: [reportOutput],
      cache: true,
      run: shell(primitives.sh, `async-claims check${commandOptions} --format json --no-fail --output ${shellQuote(reportOutput)}`)
    });
  }

  if (includeRepair) {
    tasks[repairId] = primitives.task({
      description: "Draft a unified diff for claims registry repair. Propose-only: a human reviews and applies.",
      dependsOn: [reportId],
      inputs: unique([reportOutput, registry, ...docs]),
      outputs: [patchOutput],
      cache: true,
      run: primitives.agent?.({
        use: primitives.env?.var(options.agentEnv ?? "ASYNC_AGENT", { default: options.defaultAgent ?? "claude" }) ?? (options.defaultAgent ?? "claude"),
        stdoutTo: patchOutput,
        prompt: options.repairPrompt ?? defaultRepairPrompt({ registry, reportOutput })
      }) as RunStep
    });
  }

  return brandAsyncPipelineDeclaration(tasks, taskSectionDeclarationKind);
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

function asyncClaimsOptions(options: { config?: string; registry?: string; testFiles?: string[] }): string {
  const parts = [];
  if (options.config) parts.push("--config", options.config);
  if (options.registry) parts.push("--registry", options.registry);
  if (options.testFiles) parts.push("--test-files", options.testFiles.join(","));
  return parts.length > 0 ? ` ${parts.map(shellQuote).join(" ")}` : "";
}

function defaultRepairPrompt(options: { registry: string; reportOutput: string }): string {
  return [
    `Read ${options.reportOutput} and ${options.registry}.`,
    "For stale anchors, locate the current exact promise text in the source file.",
    `Output only a unified diff against ${options.registry}.`,
    "Preserve claim ids and tests arrays.",
    "Never delete claims or apply the patch. Deletions and test sufficiency are human review decisions."
  ].join("\n");
}

function shell<RunStep>(sh: ClaimsPipelinePrimitives<unknown, RunStep>["sh"], command: string): RunStep {
  return sh([command] as unknown as TemplateStringsArray);
}

function normalizeHelperArgs<TaskDefinition, RunStep, EnvValue>(
  primitivesOrOptions: ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue> | ClaimsPipelineOptions | undefined,
  maybeOptions: ClaimsPipelineOptions
): {
  primitives: ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue>;
  options: ClaimsPipelineOptions;
  portable: boolean;
} {
  if (isClaimsPipelinePrimitives(primitivesOrOptions)) {
    return {
      primitives: primitivesOrOptions as ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue>,
      options: maybeOptions,
      portable: false
    };
  }
  return {
    primitives: portablePrimitives() as unknown as ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue>,
    options: (primitivesOrOptions ?? {}) as ClaimsPipelineOptions,
    portable: true
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
        stdoutTo: definition.stdoutTo
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
