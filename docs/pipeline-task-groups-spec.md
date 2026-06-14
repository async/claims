# Pipeline Task Groups Spec

Status: proposed.

`@async/claims` wants to expose a helper that can be mounted as one logical task group:

```ts
import { claimsTasks } from "@async/claims/pipeline";
import { definePipeline, job, sh, task } from "@async/pipeline";

export default definePipeline({
  name: "app",
  tasks: {
    claims: claimsTasks({ task, sh })
  },
  jobs: {
    verify: job({ target: ["claims"] })
  }
});
```

Current `@async/pipeline` does not accept this. `tasks` entries must be task definitions, and local task ids cannot contain `:` because `:` is reserved for source task refs.

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
    index: task({ run: sh`async-claims check` }),
    report: task({ run: sh`async-claims check --format json --no-fail --output claims-report.json` })
  }
}
```

Flattening rules:

- A nested object key path is joined with `.`.
- A child named `index` is the default task for its group and flattens to the group path.
- Other children flatten to `group.child`.
- Nested groups can repeat the rule, so `docs.claims.report` is valid.

Example:

```ts
tasks: {
  claims: {
    index: task(...),
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
- A group cannot contain both an `index` task and a sibling that would flatten to the same id.
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
     // index at path ["claims", "index"] flattens to "claims".
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

### Normalizes index

```ts
const pipeline = definePipeline({
  name: "app",
  tasks: {
    claims: {
      index: task({ run: sh`async-claims check` }),
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
      index: task({ run: sh`echo grouped` })
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

## Open Decision

Relative dependency resolution needs one explicit rule for root-local dependencies from inside a group. The recommended MVP is:

- `dependsOn: ["report"]` inside group `claims` resolves to `claims.report` when that sibling exists.
- `dependsOn: ["build"]` resolves to root task `build` when no `claims.build` exists.
- If both exist, fail as ambiguous and require the flattened id, such as `claims.build` or `build`.
