# Changelog

## 0.2.0 - 2026-06-15

- Split claim anchors from test coverage into `claims.json` and `claims.coverage.json`.
- Added `async-claims repair-context` and `async-claims patch-anchors` for test-blind anchor repair workflows.
- Added the `claims.coverage` schema export and coverage-aware config defaults for `tests/` and `test/` folders.
- Updated pipeline helpers with `claimsTasks()`, `claimsSuggestTask()`, prompt helpers, and explicit repair subtasks.
- Updated docs, examples, claims registries, and API surface metadata for the repair loop.

## 0.1.0 - 2026-06-14

- Initial standalone `@async/claims` package with deterministic claim registry checks.
- Added CLI commands `async-claims check` and `async-claims init`.
- Added JSON schemas, library exports, docs, and runnable examples.
- Added `@async/claims/pipeline` helper for generating standard `@async/pipeline` task maps without adding a pipeline runtime dependency.
- Added `claimsWorkflowTasks()` and a `@async/pipeline` task-groups spec for `tasks: { claims: claimsWorkflowTasks() }`, using `default` as the group root child.
- Branded `claims()` and `claimsWorkflowTasks()` task sections with non-enumerable async-pipeline declaration metadata via `Symbol.for("@async/pipeline.declaration")`.
- Added the repo-local `pipeline.ts`, generated `@async/pipeline` workflow, GitHub Pages build, release/preview lifecycle scripts, and API surface ledger for the first release.
