# Async Pipeline Agent Loop Example

This example keeps `@async/claims` deterministic and lets `@async/pipeline` orchestrate the optional repair loop.

```sh
pnpm install
async-pipeline run-task claims
async-pipeline run-task claims-report
ASYNC_AGENT=mock async-pipeline run-task claims-repair
git apply --check claims.patch
```

The clean project check passes. The stale fixture writes `claims-report.json`. The mock agent profile emits `claims.patch`, and `git apply --check claims.patch` proves the patch is reviewable before a human applies it.

To use a real local model-backed profile instead of the deterministic mock:

```sh
ASYNC_AGENT=claude async-pipeline run-task claims-repair
```
