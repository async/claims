# @async/claims API Surface Ledger

This file is the generated review ledger for semantic API contract features. It is current-state contract documentation, not a changelog or tutorial.

## Async Claims Package Surface

Contract: `@async/claims.package`

### Cli

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `cli.check` | async-claims check command | public | stable | active |  | [docs](https://github.com/async/claim#cli) |
| `cli.check.json-report` | Non-failing JSON claims report | public | stable | active |  | [docs](https://github.com/async/claim#agent-boundary) |
| `cli.init` | async-claims init command | public | stable | active |  | [docs](https://github.com/async/claim#cli) |

### Package Exports

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `export.root.checkClaims` | Root checkClaims library export | public | stable | active |  | [docs](https://github.com/async/claim#library) |
| `export.root.loadConfig` | Root loadConfig library export | public | stable | active |  | [docs](https://github.com/async/claim#library) |
| `export.root.types` | Root TypeScript report and config type exports | public | stable | active |  | [docs](https://github.com/async/claim#library) |

### Pipeline Helpers

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `export.pipeline.claims` | Flat claims pipeline task helper | beta | preview | active |  | [docs](https://github.com/async/claim#full-loop-with-pipeline) |
| `export.pipeline.claimsTasks` | Task-group helper alias | beta | preview | active |  | [docs](https://github.com/async/claim#full-loop-with-pipeline) |
| `export.pipeline.claimsWorkflowTasks` | Nested claims workflow task-group helper | beta | preview | active |  | [docs](https://github.com/async/claim#full-loop-with-pipeline) |
| `export.pipeline.declarationMetadata` | Async Pipeline declaration metadata helpers | beta | preview | active |  | [docs](https://github.com/async/claim#full-loop-with-pipeline) |

### Schemas

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `schema.claims` | Claims registry JSON schema export | public | stable | active |  | [docs](https://github.com/async/claim#quickstart) |
| `schema.claimsConfig` | Claims config JSON schema export | public | stable | active |  | [docs](https://github.com/async/claim#config) |

## Async API Contract CLI

Contract: `@async/api-contract.cli`

### Cli

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `cli.check` | API contract manifest validation | public | stable | active |  |  |
| `cli.ledger` | API surface ledger generation and drift check | public | stable | active |  |  |

## Supported Surfaces

| Contract | Hash | Features |
| --- | --- | --- |
| `@async/claims.package` | `sha256:8809f9a2255531927421cd35ae447b17000db5c7316e63063cc5e2e52a5ea89b` | `cli.check`, `cli.check.json-report`, `cli.init`, `export.pipeline.claims`, `export.pipeline.claimsTasks`, `export.pipeline.claimsWorkflowTasks`, `export.pipeline.declarationMetadata`, `export.root.checkClaims`, `export.root.loadConfig`, `export.root.types`, `schema.claims`, `schema.claimsConfig` |

## Required Surfaces

| Contract | Hash | Features |
| --- | --- | --- |
| `@async/api-contract.cli` | `sha256:109f7d81379d251bd8df213020a09e5cb60ff5a0725701b944d95d5de35ba4bf` | `cli.check`, `cli.ledger` |
| `@async/pipeline.cli` | `sha256:d98fbabdc807d0a093266381164ba0442c8fe65c172b9fc7009280f91b236e8e` | `cli.github.check`, `cli.github.generate`, `cli.publish.github`, `cli.publish.npm`, `cli.release.doctor`, `cli.run`, `cli.run-task`, `cli.sync.check`, `cli.sync.generate` |
| `@async/pipeline.declaration` | `sha256:728002aaf6f493ec91ba8d9cedb77a36a1ede13d64279c8f2b1e947382237435` | `agent.stdoutTo`, `agent.step`, `config.definePipeline`, `config.env`, `config.github.pages`, `config.job`, `config.sync.github`, `config.sync.tasks`, `config.task`, `config.trigger.github`, `config.trigger.manual`, `step.shell` |
