# Pipeline Task Groups Spec

Status: task groups and branded declarations were present on `async/pipeline` main as package version `0.2.5`; no npm `@async/pipeline@0.3.0` or GitHub `v0.3.0` tag was visible during verification on June 14, 2026. This spec updates the group-root key to documented `default` behavior before the pipeline release.

`@async/claims` wants to expose a helper that can be mounted as one logical task group:

```ts
import { claimsWorkflowTasks } from "@async/claims/pipeline";
import { definePipeline, job } from "@async/pipeline";

export default definePipeline({
  name: "app",
  tasks: {
    claims: claimsWorkflowTasks()
  },
  jobs: {
    verify: job({ target: ["claims"] })
  }
});
```

Current `async/pipeline` main accepts nested task groups and branded declaration sections. The spec below remains as the implementation contract for packages that want to target released `default` group-root behavior.

## Pipeline Release Spec

Target this behavior for the next `@async/pipeline` release that documents task groups:

- `PipelineDefinition.tasks` accepts a tree of task definitions and task-group objects.
- A task group may contain a reserved `default` child. That child flattens to the group id itself.
- The reserved `default` child is never exposed as `.default`; `tasks: { claims: { default: task(...) } }` publishes `claims`, not `claims.default`.
- Other children flatten with `.`, so `claims.report` and `claims.repair` are local task ids.
- `:` remains only the source namespace separator. `storefront:claims.report` means source `storefront`, local task `claims.report`.
- Dependency refs inside a group resolve relative to that group when they name a sibling or descendant.
- Branded declaration metadata under `Symbol.for("@async/pipeline.declaration")` is recognized for task sections, task definitions, shell steps, agent steps, and env var refs.
- Declaration metadata is a discriminator only. Pipeline still validates every normalized task and rejects unknown or malformed fields.

Release checklist for pipeline:

1. Replace any unreleased `index` group-default behavior with documented `default` behavior.
2. Add or update tests for `default` flattening, no `claims.default` public id, relative dependencies, flattened id collisions, source refs with `.`, declaration-branded task groups, and sync-generated scripts.
3. Update pipeline README/API docs to show:

   ```ts
   tasks: {
     claims: claimsWorkflowTasks()
   }
   ```

   and the resulting task ids:

   ```text
   claims
   claims.report
   claims.repair
   ```

4. Smoke against `@async/claims`:

   ```ts
   import { claimsWorkflowTasks } from "@async/claims/pipeline";
   import { definePipeline, job } from "@async/pipeline";

   const pipeline = definePipeline({
     name: "claims-smoke",
     tasks: { claims: claimsWorkflowTasks() },
     jobs: { verify: job({ target: ["claims", "claims.report", "claims.repair"] }) }
   });

   console.log(Object.keys(pipeline.tasks).sort());
   ```

   Expected output:

   ```text
   claims
   claims.report
   claims.repair
   ```

5. Cut the pipeline release only after `pnpm test`, pipeline package dry-run packing, and the `@async/claims` smoke above pass.

Because no npm `@async/pipeline` release was visible with task groups during verification, `default` can be the first documented public key. If pipeline wants to preserve unreleased-main compatibility, it may keep `index` as a hidden deprecated alias, but docs and examples should use only `default`.

## Goals

- Let packages expose mounted task groups without depending on `@async/pipeline`.
- Keep `:` reserved for source namespaces such as `storefront:test`.
- Use `.` for local task-group paths such as `claims.report`.
- Let a group expose a default task that is runnable by the group id, such as `async-pipeline run-task claims`.
- Preserve existing flat task definitions and existing source refs.

## Non-Goals

- Do not allow local task ids containing `:`.
- Do not infer task groups from package names or npm metadata.
- Do not make plugin packages import `@async/pipeline` internally.

## Proposed API

`PipelineDefinition.tasks` accepts task definitions or nested task-group objects:

```ts
tasks: {
  claims: {
    default: task({ run: sh`async-claims check` }),
    report: task({ run: sh`async-claims check --format json --no-fail --output claims-report.json` })
  }
}
```

Flattening rules:

- A nested object key path is joined with `.`.
- A child named `default` is the default task for its group and flattens to the group path.
- Other children flatten to `group.child`.
- Nested groups can repeat the rule, so `docs.claims.report` is valid.

Example:

```ts
tasks: {
  claims: {
    default: task(...),
    report: task(...),
    repair: task(...)
  }
}
```

Normalizes to:

```text
claims
claims.report
claims.repair
```

## Task Refs

Task refs keep the existing source namespace grammar:

```text
[source ":"] local-task-path
```

Examples:

```text
claims
claims.report
storefront:test
storefront:claims.report
```

`:` and `.` mean different things:

- `:` selects a source pipeline namespace.
- `.` selects a local task group path inside the selected pipeline.

## Dependencies

Inside a task group, dependency refs without `:` are relative to the containing group when they match a sibling or descendant.

```ts
tasks: {
  claims: {
    report: task(...),
    repair: task({ dependsOn: ["report"] })
  }
}
```

Normalizes to:

```ts
{
  "claims.report": task(...),
  "claims.repair": task({ dependsOn: ["claims.report"] })
}
```

Absolute local refs can be written in their flattened form from the root, for example `build` or `docs.links`. If a relative and root-local ref are both possible, pipeline should reject the ambiguous ref and ask for the flattened id.

## Validation

- Group keys must be non-empty and cannot contain `:`.
- Group keys should not contain `.` in the nested form; use nesting instead.
- A group cannot contain both a `default` task and a sibling that would flatten to the same id.
- A flattened task id cannot collide with an existing flat task id.
- Source ids still cannot contain `:`.
- Local task ids still cannot contain `:`.

## CLI Behavior

The existing commands work with flattened ids:

```sh
async-pipeline run-task claims
async-pipeline run-task claims.report
async-pipeline run-task storefront:claims.report
```

No new CLI separator is needed.

## Sync Behavior

Task sync should treat flattened ids as task ids. With the default `pipeline` prefix:

```json
{
  "scripts": {
    "pipeline:task:claims": "async-pipeline run-task claims",
    "pipeline:task:claims.report": "async-pipeline run-task claims.report"
  }
}
```

The generated script namespace can keep using `:` because that is package-manager script naming, not pipeline task-ref parsing.

## Declaration Symbol

Helper packages should not import `@async/pipeline` only to brand task sections. They can create the shared declaration symbol directly:

```ts
const ASYNC_PIPELINE_DECLARATION = Symbol.for("@async/pipeline.declaration");

Object.defineProperty(taskGroup, ASYNC_PIPELINE_DECLARATION, {
  value: { kind: "section.tasks", version: 1 },
  enumerable: false,
  configurable: false,
  writable: false
});
```

This matches the upstream protocol from `packages/pipeline-core/src/declaration.ts`. The brand is a discriminator, not trust: pipeline still validates every task object and rejects unknown fields.

## Implementation Plan For `@async/pipeline`

Likely files:

- `packages/pipeline-core/src/index.ts`: widen `PipelineDefinition["tasks"]`, normalize task groups before existing task normalization, resolve relative dependencies, and keep `parseTaskRef` source parsing unchanged.
- `tests/core.test.js`: add task-group normalization, dependency resolution, collision, validation, and graph tests.
- `tests/cli.test.js`: prove `async-pipeline run-task claims.report` and dry-run output work.
- `tests/sync.test.js`: prove synced task scripts use flattened task ids.
- `docs/api.md` and `README.md`: document `.` local groups versus `:` source namespaces.

Suggested core implementation shape:

1. Add a `TaskGroupDefinition` type:

   ```ts
   type TaskTreeDefinition = TaskDefinition | TaskGroupDefinition;
   interface TaskGroupDefinition {
     [childId: string]: TaskTreeDefinition;
   }
   ```

2. Add a task-definition discriminator before normalization:

   ```ts
   function isTaskDefinition(value: unknown): value is TaskDefinition {
     return isObject(value) && (
       "run" in value ||
       "steps" in value ||
       "dependsOn" in value ||
       "inputs" in value ||
       "outputs" in value ||
       "cache" in value ||
       "retry" in value ||
       "timeout" in value ||
       "requires" in value ||
       "description" in value
     );
   }
   ```

3. Flatten `definition.tasks` before the existing `for (const [id, taskDefinition] of Object.entries(...))` loop:

   ```ts
   function flattenTaskDefinitions(
     entries: Record<string, TaskTreeDefinition>,
     path: string[] = []
   ): Record<string, TaskDefinition> {
     // default at path ["claims", "default"] flattens to "claims".
     // other children flatten with "." joins.
   }
   ```

4. While flattening, carry each task's containing group path so `dependsOn: ["report"]` inside `claims.repair` can become `claims.report`.

5. Run existing `validateLocalTaskId()` against every flattened id. Keep its `:` rejection.

6. Leave `parseTaskRef()` unchanged. It should still split only on the first `:`:

   ```text
   storefront:claims.report -> source storefront, task claims.report
   ```

## Acceptance Tests

### Normalizes default

```ts
const pipeline = definePipeline({
  name: "app",
  tasks: {
    claims: {
      default: task({ run: sh`async-claims check` }),
      report: task({ run: sh`async-claims check --format json --no-fail` })
    }
  },
  jobs: { verify: job({ target: "claims" }) }
});

assert.deepEqual(Object.keys(pipeline.tasks).sort(), ["claims", "claims.report"]);
```

### Resolves relative sibling dependencies

```ts
const pipeline = definePipeline({
  name: "app",
  tasks: {
    claims: {
      report: task({ run: sh`report` }),
      repair: task({ dependsOn: ["report"], run: sh`repair` })
    }
  },
  jobs: { verify: job({ target: "claims.repair" }) }
});

assert.deepEqual(pipeline.tasks["claims.repair"].dependsOn, ["claims.report"]);
```

### Keeps colon for source refs

```ts
assert.deepEqual(parseTaskRef("storefront:claims.report"), {
  source: "storefront",
  taskId: "claims.report"
});
```

### Rejects colon in local group keys

```ts
assert.throws(() => definePipeline({
  name: "app",
  tasks: {
    "claims:bad": task({ run: sh`echo bad` })
  },
  jobs: { verify: job({ target: "claims:bad" }) }
}), /cannot contain ":"/);
```

### Rejects flattened collisions

```ts
assert.throws(() => definePipeline({
  name: "app",
  tasks: {
    claims: task({ run: sh`echo root` }),
    claims: {
      default: task({ run: sh`echo grouped` })
    }
  },
  jobs: { verify: job({ target: "claims" }) }
}), /duplicate task id|collision/i);
```

In a real object literal the duplicate top-level key above cannot coexist. The practical collision test should use `claims.report` as a flat key plus `claims: { report: ... }`.

### Runs grouped task from CLI

```sh
async-pipeline run-task claims.report --dry-run
```

Expected plan contains `claims.report`.

### Runs source grouped task from CLI

```sh
async-pipeline run-task storefront:claims.report --dry-run
```

Expected source namespace is `storefront`, task id is `claims.report`.

## Backward Compatibility

- Existing flat tasks keep the same ids.
- Existing source refs with `:` keep the same behavior.
- Existing task ids containing `.` continue to work as flat ids.
- A flat id and a grouped id that normalize to the same id must fail loudly.
- Local task ids containing `:` remain invalid.
- If a prerelease implementation already accepted `index` as the group default key, pipeline may keep it as a deprecated alias, but `default` is the documented key.

## Open Decision

Relative dependency resolution needs one explicit rule for root-local dependencies from inside a group. The recommended MVP is:

- `dependsOn: ["report"]` inside group `claims` resolves to `claims.report` when that sibling exists.
- `dependsOn: ["build"]` resolves to root task `build` when no `claims.build` exists.
- If both exist, fail as ambiguous and require the flattened id, such as `claims.build` or `build`.
