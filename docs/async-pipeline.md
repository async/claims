# Async Pipeline Loop

`@async/claims` does not run agents during `check`. `@async/pipeline` can orchestrate the optional repair loop while the claims checker remains the authority.

## Task Group Form

Use `claimsTasks()` to generate the standard task group. `@async/claims` emits portable pipeline declarations and does not import `@async/pipeline`.

```ts
import { claimsTasks } from "@async/claims/pipeline";
import { definePipeline, job } from "@async/pipeline";

export default definePipeline({
  name: "claims",
  tasks: {
    claims: claimsTasks()
  },
  jobs: {
    verify: job({ target: ["claims"] })
  }
});
```

That should flatten to local task ids:

```text
claims
claims.report
claims.repair.context
claims.repair.patch
```

The helper returns a group with `default`, `report`, and `repair` children. Pipeline flattens the reserved `default` child to the mounted group id, so the public root task is `claims`, not `claims.default`.

`claimsWorkflowTasks()` remains a compatibility alias for one release cycle. New code should use `claimsTasks()`.

For a deterministic-only task group, omit the repair tasks:

```ts
tasks: {
  claims: claimsTasks({ repair: false })
}
```

## Agent Suggestion Step

The agent step is explicit as a repair subtask, but the protocol filenames are hidden behind claims-local defaults:

```ts
import { claimsSuggestTask, claimsTasks } from "@async/claims/pipeline";
import { definePipeline, env, job } from "@async/pipeline";

export default definePipeline({
  name: "claims",
  agents: {
    codex: {
      command: ["codex", "exec"],
      model: env.var("ASYNC_AGENT_MODEL", { default: "gpt-5-codex" })
    }
  },
  tasks: {
    claims: claimsTasks({
      tasks: {
        "repair.suggest": claimsSuggestTask({
          dependsOn: ["claims.repair.context"],
          use: env.var("ASYNC_AGENT", { default: "codex" })
        })
      }
    })
  },
  jobs: {
    verify: job({ target: ["claims"] }),
    repairClaims: job({ target: ["claims.repair.suggest", "claims.repair.patch"] })
  }
});
```

`claimsSuggestTask()` reads `claims-repair-context.json` plus declared docs inputs, writes `claims-anchor-updates.json`, and defaults to `cache: false`. Its prompt tells the agent not to inspect tests, test titles, `claims.coverage.json`, or coverage mappings.

Prompt helpers return strings or string arrays; arrays are joined with newlines, and function templates are not accepted in v1.

To move repair files in one place:

```ts
claimsTasks({
  namedFiles: {
    "repair.context": ".claims/repair-context.json",
    "repair.suggestions": ".claims/anchor-updates.json",
    "repair.patch": ".claims/repair.patch"
  }
})
```

## Expanded Form

The helper expands to the same shape you can write by hand.

```ts
import { definePipeline, sh, task } from "@async/pipeline";

export default definePipeline({
  name: "claims",
  tasks: {
    claims: task({
      description: "Block release when docs promises drift from registered tests.",
      inputs: ["tests/claims.json", "tests/claims.coverage.json", "README.md", "docs/**/*.md", "tests/**/*.test.js"],
      cache: true,
      run: sh`async-claims check`
    }),
    "claims.repair.context": task({
      description: "Write test-blind stale-anchor context.",
      inputs: ["tests/claims.json", "README.md", "docs/**/*.md"],
      outputs: ["claims-repair-context.json"],
      cache: true,
      run: sh`async-claims repair-context --output claims-repair-context.json`
    }),
    "claims.repair.patch": task({
      description: "Convert reviewed anchor suggestions into a patch.",
      dependsOn: ["claims.repair.context"],
      inputs: ["tests/claims.json", "claims-repair-context.json", "claims-anchor-updates.json", "README.md", "docs/**/*.md"],
      outputs: ["claims.patch"],
      cache: true,
      run: sh`async-claims patch-anchors --suggestions claims-anchor-updates.json --output claims.patch`
    })
  }
});
```

Review the patch before applying it:

```sh
git apply --check claims.patch
```

## Advisory Scout

```ts
"claims.scout": task({
  description: "Advisory doc-diff scan for possible unregistered promises.",
  inputs: ["README.md", "docs/**/*.md", "tests/claims.json"],
  outputs: ["claims-scout.md"],
  cache: false,
  run: agent({
    use: env.var("ASYNC_AGENT", { default: "codex" }),
    stdoutTo: "claims-scout.md",
    prompt: "Report added or changed documentation promises that appear to lack tests/claims.json entries. Advisory only; do not fail release."
  })
})
```

`claims.scout` should not block release. Promise recognition is judgment; `async-claims check` only blocks on mechanical facts it can prove.

## Repository Scripts

This repository syncs package scripts from root `pipeline.ts`. Use those scripts for local tasks:

```sh
pnpm run pipeline:verify
pnpm run pipeline:task:claims
pnpm run pipeline:task:claims.report
pnpm run pipeline:task:claims.repair.context
pnpm run pipeline:task:claims.repair.suggest
pnpm run pipeline:task:claims.repair.patch
pnpm run pipeline:sync:check
pnpm run pipeline:github:check
pnpm run pages:build
pnpm run release:check
```
