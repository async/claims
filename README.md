# @async/claims

`@async/claims` is a deterministic claims engine for documentation promises. It checks that documented promises stay anchored to source text and mapped to real tests. It does not call models or edit files during `check`.

A clean registry passes only when every registered anchor exists in its source file, every referenced test title exists in the configured test files, and every `PROMISE: ` test title is mapped.

`async-claims check` reports stale anchors, missing referenced tests, duplicate claim ids, and unmapped promise tests with stable failure codes.

The checker can read custom test files with a configurable regular expression whose first capture group is the test title.

`async-claims check --format json --output claims-report.json --no-fail` writes a machine-readable report and exits zero for claim failures.

Invalid configuration is a usage error and exits with code 2.

`async-claims init` creates starter config and registry files, and refuses to overwrite them unless `--force` is passed.

The package has no runtime dependency on `@async/pipeline`; pipeline examples use it only to orchestrate commands and propose reviewable patches.

The pipeline helper `claims()` builds the standard flat task map without importing `@async/pipeline` from `@async/claims`.

The task-group helper `claimsWorkflowTasks()` returns a nested task group for pipeline task-groups syntax: `tasks: { claims: claimsWorkflowTasks() }`.

Both helpers attach non-enumerable async-pipeline declaration metadata with `Symbol.for("@async/pipeline.declaration")`, so a host pipeline can recognize the task section without `@async/claims` importing `@async/pipeline`.

## Install

```sh
pnpm add -D @async/claims
```

The package is ESM TypeScript, requires Node `>=24`, and ships the `async-claims` binary.

## Quickstart

Create a registry:

```json
{
  "$schema": "https://async.dev/schemas/claims.schema.json",
  "claims": [
    {
      "id": "readme.cache-inputs",
      "source": "README.md",
      "anchor": "Cache behavior is explicit through declared inputs.",
      "tests": [
        "PROMISE: cache inputs isolate invalidation"
      ]
    }
  ]
}
```

Write a Node test with a mapped promise title:

```js
import assert from "node:assert/strict";
import test from "node:test";

test("PROMISE: cache inputs isolate invalidation", () => {
  assert.equal(true, true);
});
```

Run the check:

```sh
async-claims check
```

By default the checker reads `tests/claims.json`, scans `tests/**/*.test.js`, extracts Node test titles from `test("title", ...)`, and treats titles beginning with `PROMISE: ` as promises that must be registered.

## Full Loop With Pipeline

For projects using `@async/pipeline`, import the claims workflow as a task group:

```ts
import { claimsWorkflowTasks } from "@async/claims/pipeline";
import { definePipeline, job } from "@async/pipeline";

export default definePipeline({
  name: "release",
  tasks: {
    claims: claimsWorkflowTasks()
  },
  jobs: {
    verify: job({ target: ["claims"] }),
    repairClaims: job({ target: ["claims.report", "claims.repair"] })
  }
});
```

Use the direct value rather than `{ ...claimsWorkflowTasks() }`; the helper already returns the subgroup and keeps pipeline declaration metadata attached. Pipeline expands that group to these local task ids:

```text
claims
claims.report
claims.repair
```

Internally, the group root is the reserved `default` child from `claimsWorkflowTasks()`. Pipeline publishes that child as `claims`, not `claims.default`.

The intended loop is:

1. A human or planning agent updates docs and `tests/claims.json` in the same plan. Each registry entry names the exact source anchor and the `PROMISE: ` tests expected to cover it.
2. `claims` runs `async-claims check` and blocks release on mechanical drift.
3. `claims.report` writes `claims-report.json` with `--no-fail`, so agents can read failures without turning the pipeline red.
4. `claims.repair` can propose a registry or anchor patch as `claims.patch`; review applies it or rejects it.
5. If tests are missing, add a separate project task that proposes test patches only. Do not let an agent silently edit docs or claims just to make the checker pass.

Put `tests/claims.json`, docs, and test globs in task inputs so pipeline reruns the claims workflow whenever the contract changes. `async-claims check` remains the release authority; human review owns whether a mapped test is sufficient.

## CLI

```sh
async-claims check
async-claims check --format json --output claims-report.json --no-fail
async-claims init
```

Extra check options:

```sh
async-claims check --registry tests/claims.json
async-claims check --test-files "tests/**/*.test.js,checks/**/*.js"
async-claims check --test-title-regex "^case: (.+)$"
async-claims check --promise-prefix "PROMISE: "
```

Exit codes:

- `0`: all checks passed, or claim failures were reported with `--no-fail`.
- `1`: claim failures were found.
- `2`: configuration or registry shape was invalid.

## Config

`claims.config.json` is optional:

```json
{
  "$schema": "./schema/claims.config.schema.json",
  "registry": "tests/claims.json",
  "testFiles": ["tests/**/*.test.js"],
  "testTitlePattern": "^\\s*test\\(\\s*\"((?:[^\"\\\\]|\\\\.)*)\"",
  "promisePrefix": "PROMISE: "
}
```

## Library

```ts
import { checkClaims, loadConfig } from "@async/claims";

const config = await loadConfig();
const report = await checkClaims({ registry: config.registry });

if (!report.ok) {
  for (const failure of report.failures) {
    console.error(failure.code, failure.message);
  }
}
```

The package exports `checkClaims(options): Promise<ClaimsReport>`, `loadConfig(options): Promise<ClaimsConfig>`, `Claim`, `ClaimsConfig`, `ClaimsFailure`, and `ClaimsReport`.

## Failure Codes

- `invalid_config`: config or registry JSON is missing required shape.
- `empty_registry`: the registry contains no valid claims.
- `duplicate_id`: two claims share an id.
- `missing_source`: a claim source file does not exist.
- `stale_anchor`: a claim anchor no longer appears verbatim in its source.
- `missing_referenced_test`: a claim references a test title that was not discovered.
- `unmapped_promise_test`: a discovered `PROMISE: ` test title is not registered by any claim.

## Agent Boundary

Agents only propose. The authoritative step is always:

```sh
async-claims check
```

Use `--format json --no-fail` to give an agent machine-readable context, then require a human to review any proposed diff. The checker proves that the claim-to-test mapping exists; review still owns whether the test sufficiently exercises the promise.

See [docs/agent-contract.md](docs/agent-contract.md) and [docs/async-pipeline.md](docs/async-pipeline.md).
