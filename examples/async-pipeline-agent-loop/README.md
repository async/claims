# Async Pipeline Agent Loop Example

This example keeps `@async/claims` deterministic and lets `@async/pipeline` orchestrate the optional repair loop.

```sh
pnpm install
pnpm run pipeline:claims
pnpm run pipeline:claims-repair-context
pnpm run pipeline:claims-repair:mock
pnpm run pipeline:patch:check
```

The clean project check passes. The stale fixture writes `claims-repair-context.json`. The mock agent profile emits `claims-anchor-updates.json`, `patch-anchors` converts it into `claims.patch`, and `git apply --check claims.patch` proves the patch is reviewable before a human applies it.

To use a real local model-backed profile instead of the deterministic mock:

```sh
ASYNC_AGENT=codex pnpm run pipeline:claims-repair
```
