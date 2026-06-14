# Changelog

## 0.1.0

- Initial standalone `@async/claims` package with deterministic claim registry checks.
- Added CLI commands `async-claims check` and `async-claims init`.
- Added JSON schemas, library exports, docs, and runnable examples.
- Added `@async/claims/pipeline` helper for generating standard `@async/pipeline` task maps without adding a pipeline runtime dependency.
- Added `claimsTasks()` and a proposed `@async/pipeline` task-groups spec for `tasks: { claims: claimsTasks(...) }`.
