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

export interface ClaimsPipelineTaskGroup<TaskDefinition> {
  /** Default task for the group. The task-groups spec flattens this to the group id. */
  index: TaskDefinition;
  /** Non-failing JSON report task. */
  report?: TaskDefinition;
  /** Propose-only registry patch task. */
  repair?: TaskDefinition;
}

const defaultDocs = ["README.md", "AGENTS.md", "CHANGELOG.md", "docs/**/*.md"];
const defaultRegistry = "tests/claims.json";
const defaultTestFiles = ["tests/**/*.test.js"];

export function claimsTasks<TaskDefinition, RunStep, EnvValue = unknown>(
  primitives: ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue>,
  options: Omit<ClaimsPipelineOptions, "checkId" | "reportId" | "repairId"> = {}
): ClaimsPipelineTaskGroup<TaskDefinition> {
  const generated = claims(primitives, {
    ...options,
    checkId: "index",
    reportId: "report",
    repairId: "repair"
  });
  return {
    index: generated.index as TaskDefinition,
    ...(generated.report ? { report: generated.report } : {}),
    ...(generated.repair ? { repair: generated.repair } : {})
  };
}

export function claims<TaskDefinition, RunStep, EnvValue = unknown>(
  primitives: ClaimsPipelinePrimitives<TaskDefinition, RunStep, EnvValue>,
  options: ClaimsPipelineOptions = {}
): Record<string, TaskDefinition> {
  const registry = options.registry ?? defaultRegistry;
  const testFiles = options.testFiles ?? defaultTestFiles;
  const docs = options.docs ?? defaultDocs;
  const reportOutput = options.reportOutput ?? "claims-report.json";
  const patchOutput = options.patchOutput ?? "claims.patch";
  const checkId = options.checkId ?? "claims";
  const reportId = options.reportId ?? "claims-report";
  const repairId = options.repairId ?? "claims-repair";
  const includeReport = options.report ?? true;
  const includeRepair = options.repair ?? Boolean(primitives.agent && primitives.env);

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

  return tasks;
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

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=,@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
