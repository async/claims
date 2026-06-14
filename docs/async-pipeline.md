# Async Pipeline Loop

`@async/claims` does not run agents. `@async/pipeline` can orchestrate the full loop while the claims checker remains the authority.

The examples below use `pipeline.mjs` snippets because they are copyable into a package-less demo. In a TypeScript or `"type": "module"` project, use the local package convention for the pipeline file.

## Flat Form

Use `claims()` to generate the standard flat task map. `@async/claims` emits portable pipeline declarations and does not import `@async/pipeline`.

```ts
import { claims } from "@async/claims/pipeline";
import { definePipeline, env, job } from "@async/pipeline";

export default definePipeline({
  name: "claims",
  agents: {
    claude: {
      command: ["claude", "-p"],
      model: env.var("ASYNC_AGENT_MODEL", { default: "claude-sonnet-4-6" })
    },
    mock: {
      command: ["node", "scripts/mock-claims-repair.js"],
      model: "mock"
    }
  },
  tasks: claims(),
  jobs: {
    verify: job({ target: ["claims"] })
  }
});
```

```ts
tasks: claims({
  registry: "tests/claims.json",
  testFiles: ["tests/**/*.test.js"],
  docs: ["README.md", "docs/**/*.md"]
})
```

For older pipeline versions that do not support portable declaration nodes, `claims({ task, sh, agent, env })` remains available as a compatibility form.

## Task Group Form

`claimsWorkflowTasks()` is the API shape for pipeline task groups:

```ts
import { claimsWorkflowTasks } from "@async/claims/pipeline";
import { definePipeline, env, job } from "@async/pipeline";

export default definePipeline({
  name: "claims",
  agents: {
    claude: {
      command: ["claude", "-p"],
      model: env.var("ASYNC_AGENT_MODEL", { default: "claude-sonnet-4-6" })
    }
  },
  tasks: {
    claims: claimsWorkflowTasks()
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
claims.repair
```

The helper returns a group with `default`, `report`, and `repair` children. Pipeline flattens the reserved `default` child to the mounted group id, so the public root task is `claims`, not `claims.default`.

The separator rules are intentional: `.` is for local task groups, and `:` remains the source namespace delimiter. A source task ref can combine them, for example `storefront:claims.report`.

`claimsWorkflowTasks()` attaches non-enumerable declaration metadata under `Symbol.for("@async/pipeline.declaration")` with kind `section.tasks`. That matches the pipeline declaration protocol while avoiding a runtime dependency on `@async/pipeline`.

See [pipeline-task-groups-spec.md](pipeline-task-groups-spec.md) for the pipeline feature spec and current upstream notes. Until task groups are available in the installed `@async/pipeline` version, use the flat `claims()` helper.

For a deterministic-only task group, omit the repair task:

```ts
tasks: {
  claims: claimsWorkflowTasks({ repair: false })
}
```

## Expanded Form

The helper expands to the same shape you can write by hand.

```js
import { definePipeline, sh, task } from "@async/pipeline";

export default definePipeline({
  name: "claims",
  tasks: {
    claims: task({
      description: "Block release when docs promises drift from registered tests.",
      inputs: ["tests/claims.json", "README.md", "docs/**/*.md", "tests/**/*.test.js"],
      cache: true,
      run: sh`async-claims check`
    })
  }
});
```

## Non-Failing Report

```js
"claims-report": task({
  description: "Write machine-readable claim failures for repair suggestions.",
  inputs: ["tests/claims.json", "README.md", "docs/**/*.md", "tests/**/*.test.js"],
  outputs: ["claims-report.json"],
  cache: true,
  run: sh`async-claims check --format json --no-fail --output claims-report.json`
})
```

## Propose-Only Repair

```js
import { agent, env } from "@async/pipeline";

"claims-repair": task({
  description: "Draft a reviewable registry patch. Never apply it automatically.",
  dependsOn: ["claims-report"],
  inputs: ["claims-report.json", "tests/claims.json", "README.md", "docs/**/*.md"],
  outputs: ["claims.patch"],
  cache: true,
  run: agent({
    use: env.var("ASYNC_AGENT", { default: "mock" }),
    stdoutTo: "claims.patch",
    prompt: [
      "Read claims-report.json and the registry.",
      "For stale anchors, locate the current exact promise text in the source file.",
      "Output only a unified diff against tests/claims.json.",
      "Do not delete claims. Deletions and test sufficiency are human review decisions."
    ].join("\\n")
  })
})
```

Review the patch before applying it:

```sh
git apply --check claims.patch
```

## Advisory Scout

```js
"claims-scout": task({
  description: "Advisory doc-diff scan for possible unregistered promises.",
  inputs: ["README.md", "docs/**/*.md", "tests/claims.json"],
  outputs: ["claims-scout.md"],
  cache: true,
  run: agent({
    use: env.var("ASYNC_AGENT", { default: "claude" }),
    stdoutTo: "claims-scout.md",
    prompt: "Report added or changed documentation promises that appear to lack tests/claims.json entries. Advisory only; do not fail release."
  })
})
```

`claims-scout` should not block release. Promise recognition is judgment; `async-claims check` only blocks on mechanical facts it can prove.

## Repository Scripts

This repository syncs package scripts from root `pipeline.ts`. Use those scripts for local tasks:

```sh
pnpm run pipeline:verify
pnpm run pipeline:task:claims
pnpm run pipeline:task:claims.report
pnpm run pipeline:task:claims.repair
pnpm run pipeline:sync:check
pnpm run pipeline:github:check
pnpm run pages:build
pnpm run release:check
```
