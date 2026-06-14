# Async Pipeline Loop

`@async/claims` does not run agents. `@async/pipeline` can orchestrate the full loop while the claims checker remains the authority.

The examples below use `pipeline.mjs` snippets because they are copyable into a package-less demo. In a TypeScript or `"type": "module"` project, use the local package convention for the pipeline file.

## Short Form Today

Use `claims()` to generate the standard task map. `@async/claims` still does not depend on `@async/pipeline`; the pipeline primitives are passed in by the app.

```ts
import { claims } from "@async/claims/pipeline";
import { agent, definePipeline, env, job, sh, task } from "@async/pipeline";

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
  tasks: claims({ task, sh, agent, env }),
  jobs: {
    verify: job({ target: ["claims"] })
  }
});
```

Passing only `{ task, sh }` creates `claims` and `claims-report`. Passing `{ task, sh, agent, env }` also creates `claims-repair`.

```ts
tasks: claims({ task, sh }, {
  registry: "tests/claims.json",
  testFiles: ["tests/**/*.test.js"],
  docs: ["README.md", "docs/**/*.md"]
})
```

## Task Group Form

`claimsTasks()` is the API shape for the proposed pipeline task-groups feature:

```ts
import { claimsTasks } from "@async/claims/pipeline";
import { agent, definePipeline, env, job, sh, task } from "@async/pipeline";

export default definePipeline({
  name: "claims",
  tasks: {
    claims: claimsTasks({ task, sh, agent, env })
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

The separator rules are intentional: `.` is for local task groups, and `:` remains the source namespace delimiter. A source task ref can combine them, for example `storefront:claims.report`.

See [pipeline-task-groups-spec.md](pipeline-task-groups-spec.md) for the pipeline feature spec. Until that lands in `@async/pipeline`, use the flat `claims()` helper.

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
