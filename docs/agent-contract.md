# Agent Contract

Use this snippet in `AGENTS.md` for projects that want AI workers to keep documented promises registered without letting model output become the authority.

```md
## Claims

- Register every behavioral promise in README.md, docs/, AGENTS.md, and CHANGELOG.md in tests/claims.json.
- Map each claim id to enforcing PROMISE: test titles in tests/claims.coverage.json.
- Each claim needs an id, source file, and exact anchor text.
- Promise tests are Node test titles beginning with PROMISE: .
- Run async-claims check before declaring work complete.
- If async-claims check reports stale anchors, read claims-repair-context.json and propose claims-anchor-updates.json.
- Do not inspect tests or tests/claims.coverage.json when suggesting anchor repairs.
- Never auto-apply model-generated edits. Patches from agents are review input only.
- Review owns test sufficiency. The checker proves that the mapping exists, not that a test is strong enough.
```

The strict boundary is useful on purpose: agents can find likely anchor updates, but `async-claims check` remains the deterministic release gate.
