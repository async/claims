# @async/claims

`@async/claims` is a deterministic claims engine for documentation promises. It checks that documented promises stay anchored to source text and mapped to real tests. It does not call models or edit files during `check`.

A clean registry passes only when every registered anchor exists in its source file, every claim id is mapped in `claims.coverage.json`, every referenced test title exists in the configured test files, and every `PROMISE: ` test title is mapped.

`async-claims check` reports stale anchors, missing claim coverage, unknown coverage claim ids, missing referenced tests, duplicate claim ids, and unmapped promise tests with stable failure codes.

The checker can read custom test files with a configurable regular expression whose first capture group is the test title.

`async-claims check --format json --output claims-report.json --no-fail` writes a machine-readable report and exits zero for claim failures.

Invalid configuration is a usage error and exits with code 2.

`async-claims init` creates starter config, claims, and coverage files, and refuses to overwrite them unless `--force` is passed.

The package has no runtime dependency on `@async/pipeline`; pipeline examples use it only to orchestrate commands and propose reviewable patches.

The pipeline helper `claims()` builds the standard flat task map without importing `@async/pipeline` from `@async/claims`.

The primary task-group helper `claimsTasks()` returns a nested task group for pipeline task-groups syntax: `tasks: { claims: claimsTasks() }`.

The helpers attach non-enumerable async-pipeline declaration metadata with `Symbol.for("@async/pipeline.declaration")`, so a host pipeline can recognize the task section without `@async/claims` importing `@async/pipeline`.

## Install

```sh
pnpm add -D @async/claims
```

The package is ESM TypeScript, requires Node `>=24`, and ships the `async-claims` binary.

## Quickstart

Create a claims registry:

```json
{
  "$schema": "https://async.dev/schemas/claims.schema.json",
  "claims": [
    {
      "id": "readme.cache-inputs",
      "source": "README.md",
      "anchor": "Cache behavior is explicit through declared inputs."
    }
  ]
}
```

Map claim ids to tests in the coverage registry:

```json
{
  "$schema": "https://async.dev/schemas/claims.coverage.schema.json",
  "coverage": [
    {
      "claimId": "readme.cache-inputs",
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

By default the checker detects `tests/` or `test/`, reads `claims.json` and `claims.coverage.json` from that folder, scans `**/*.test.js` under the same folder, extracts Node test titles from `test("title", ...)`, and treats titles beginning with `PROMISE: ` as promises that must be registered.

In this repository, use the generated pipeline-backed package script:

```sh
pnpm run pipeline:task:claims
```

## Codex Getting-Started Prompts

Use these prompts from the target repository root. Start with the deterministic setup prompt, then add the repair loop only after the claims check passes.

Initial setup prompt:

```text
Set up @async/claims in this repository as a deterministic release gate.

Requirements:
- Inspect README.md, docs/**/*.md, AGENTS.md, CHANGELOG.md, package.json, and the existing test folder before editing.
- Install @async/claims as a dev dependency if it is missing.
- Run async-claims init or create the equivalent files.
- Use the detected test folder. If both tests/ and test/ exist and neither already contains claims files, ask before choosing.
- Put doc anchors only in <test-folder>/claims.json.
- Put claim-to-test mappings only in <test-folder>/claims.coverage.json.
- Keep each claim anchor exact, stable, and testable.
- Every mapped test title must exist in the configured test files.
- Add or rename tests with the PROMISE: prefix only when the repository already has a real test for that behavior, or create the missing test.
- Do not add agent repair tasks yet.
- Verify with async-claims check or the repository's pipeline claims task.
```

Pipeline repair-loop prompt:

```text
Add the optional @async/claims repair loop using @async/pipeline.

Requirements:
- Keep async-claims check as the release authority.
- Import claimsTasks and claimsSuggestTask from @async/claims/pipeline.
- Mount the helper as tasks: { claims: claimsTasks(...) }.
- Do not pass task or sh into claimsTasks.
- Add a repair.suggest subtask with claimsSuggestTask.
- Make repair.suggest depend on the explicit task id claims.repair.context.
- Let the root pipeline own the agents block and default ASYNC_AGENT to codex.
- Do not expose tests, test titles, claims.coverage.json, or coverage mappings to the repair agent.
- Keep the visible repair stages as claims.repair.context, claims.repair.suggest, and claims.repair.patch.
- Use the default repair filenames unless the repo has a reason to override namedFiles in one place.
- Run the pipeline sync check, the claims task, and the repair-context task before calling the setup complete.
```

## Full Loop With Pipeline

For projects using `@async/pipeline`, import the claims workflow as a task group:

```ts
import { claimsTasks } from "@async/claims/pipeline";
import { definePipeline, job } from "@async/pipeline";

export default definePipeline({
  name: "release",
  tasks: {
    claims: claimsTasks()
  },
  jobs: {
    verify: job({ target: ["claims"] }),
    repairClaims: job({ target: ["claims.repair.context"] })
  }
});
```

Use the direct value rather than `{ ...claimsTasks() }`; the helper already returns the subgroup and keeps pipeline declaration metadata attached. Pipeline expands that group to these local task ids:

```text
claims
claims.report
claims.repair.context
claims.repair.patch
```

Internally, the group root is the reserved `default` child from `claimsTasks()`. Pipeline publishes that child as `claims`, not `claims.default`.

The intended loop is:

1. A human or planning agent updates docs, `tests/claims.json`, and `tests/claims.coverage.json` in the same plan. The claims registry names exact source anchors; the coverage registry maps claim ids to `PROMISE: ` tests.
2. `claims` runs `async-claims check` and blocks release on mechanical drift.
3. `claims.report` writes `claims-report.json` with `--no-fail` for release diagnostics.
4. `claims.repair.context` writes a test-blind `claims-repair-context.json` for stale-anchor repair agents.
5. An optional `claims.repair.suggest` agent writes `claims-anchor-updates.json`; it must not read tests or coverage mappings.
6. `claims.repair.patch` turns accepted suggestions into `claims.patch`; review applies it or rejects it.
7. If tests are missing, add a separate project task that proposes test patches only. Do not let an agent silently edit docs or claims just to make the checker pass.

Put `tests/claims.json`, `tests/claims.coverage.json`, docs, and test globs in task inputs so pipeline reruns the claims workflow whenever the contract changes. `async-claims check` remains the release authority; human review owns whether a mapped test is sufficient.

To add an agent suggestion step while keeping filenames hidden behind claims-local defaults:

```ts
import { claimsSuggestTask, claimsTasks } from "@async/claims/pipeline";
import { definePipeline, env } from "@async/pipeline";

export default definePipeline({
  name: "release",
  tasks: {
    claims: claimsTasks({
      tasks: {
        "repair.suggest": claimsSuggestTask({
          dependsOn: ["claims.repair.context"],
          use: env.var("ASYNC_AGENT", { default: "codex" })
        })
      }
    })
  }
});
```

If a repo wants different repair file paths, set them once:

```ts
claimsTasks({
  namedFiles: {
    "repair.context": ".claims/repair-context.json",
    "repair.suggestions": ".claims/anchor-updates.json",
    "repair.patch": ".claims/repair.patch"
  }
})
```

For this repository, run the generated pipeline scripts:

```sh
pnpm run pipeline:verify
pnpm run pipeline:task:claims.report
pnpm run pipeline:task:claims.repair.context
pnpm run pipeline:task:claims.repair.suggest
pnpm run pipeline:task:claims.repair.patch
pnpm run pipeline:sync:check
pnpm run pipeline:github:check
pnpm run release:check
```

## CLI

```sh
async-claims check
async-claims check --format json --output claims-report.json --no-fail
async-claims repair-context --output claims-repair-context.json
async-claims patch-anchors --suggestions claims-anchor-updates.json --output claims.patch
async-claims init
```

Extra check options:

```sh
async-claims check --registry tests/claims.json
async-claims check --coverage tests/claims.coverage.json
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
  "coverage": "tests/claims.coverage.json",
  "testFiles": ["tests/**/*.test.js"],
  "testTitlePattern": "^\\s*test\\(\\s*\"((?:[^\"\\\\]|\\\\.)*)\"",
  "promisePrefix": "PROMISE: "
}
```

## Library

```ts
import { checkClaims, loadConfig } from "@async/claims";

const config = await loadConfig();
const report = await checkClaims({
  registry: config.registry,
  coverage: config.coverage
});

if (!report.ok) {
  for (const failure of report.failures) {
    console.error(failure.code, failure.message);
  }
}
```

The package exports `checkClaims(options): Promise<ClaimsReport>`, `loadConfig(options): Promise<ClaimsConfig>`, `Claim`, `ClaimCoverage`, `ClaimsConfig`, `ClaimsFailure`, and `ClaimsReport`.

## Failure Codes

- `invalid_config`: config or registry JSON is missing required shape.
- `empty_registry`: the registry contains no valid claims.
- `duplicate_id`: two claims share an id.
- `missing_claim_coverage`: a claim has no entry in `claims.coverage.json`.
- `unknown_coverage_claim`: a coverage entry references an unknown claim id.
- `missing_source`: a claim source file does not exist.
- `stale_anchor`: a claim anchor no longer appears verbatim in its source.
- `missing_referenced_test`: a claim references a test title that was not discovered.
- `unmapped_promise_test`: a discovered `PROMISE: ` test title is not registered by any claim.

## Agent Boundary

Agents only propose. The authoritative step is always:

```sh
async-claims check
```

Use `repair-context` to give an agent test-blind stale-anchor context, then require a human to review any suggestions before running `patch-anchors`. The checker proves that the claim-to-test mapping exists; review still owns whether the test sufficiently exercises the promise.

See [docs/agent-contract.md](docs/agent-contract.md) and [docs/async-pipeline.md](docs/async-pipeline.md).
