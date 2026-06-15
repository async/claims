import { agent, definePipeline, env, job, sh, task } from "@async/pipeline";

export default definePipeline({
  name: "async-claims-agent-loop",
  agents: {
    codex: {
      command: ["codex", "exec"],
      model: env.var("ASYNC_AGENT_MODEL", { default: "gpt-5-codex" })
    },
    mock: {
      command: ["node", "scripts/mock-claims-repair.js"],
      model: "mock"
    }
  },
  tasks: {
    claims: task({
      description: "Blocking deterministic claims check for the clean project.",
      inputs: ["README.md", "tests/claims.json", "tests/claims.coverage.json", "tests/**/*.test.js"],
      cache: true,
      run: sh`async-claims check`
    }),
    "claims-repair-context": task({
      description: "Test-blind stale-anchor context for a stale fixture.",
      inputs: ["fixtures/stale/README.md", "fixtures/stale/tests/claims.json"],
      outputs: ["claims-repair-context.json"],
      cache: true,
      run: sh`async-claims repair-context --registry fixtures/stale/tests/claims.json --output claims-repair-context.json`
    }),
    "claims-repair-suggest": task({
      description: "Suggest anchor updates as JSON; never inspect tests or coverage mappings.",
      dependsOn: ["claims-repair-context"],
      inputs: ["claims-repair-context.json", "fixtures/stale/README.md"],
      outputs: ["claims-anchor-updates.json"],
      cache: false,
      run: agent({
        use: env.var("ASYNC_AGENT", { default: "mock" }),
        stdoutTo: "claims-anchor-updates.json",
        prompt: [
          "Read claims-repair-context.json first.",
          "Use fixtures/stale/README.md to verify replacement anchors.",
          "Do not inspect tests or coverage mappings.",
          "Write JSON to claims-anchor-updates.json with updates and needsReview arrays.",
          "Do not apply the patch."
        ].join("\n")
      })
    }),
    "claims-repair-patch": task({
      description: "Convert reviewed anchor suggestions into a patch.",
      dependsOn: ["claims-repair-suggest"],
      inputs: ["claims-anchor-updates.json", "fixtures/stale/README.md", "fixtures/stale/tests/claims.json"],
      outputs: ["claims.patch"],
      cache: true,
      run: sh`async-claims patch-anchors --registry fixtures/stale/tests/claims.json --suggestions claims-anchor-updates.json --output claims.patch`
    }),
    "claims-repair": task({
      description: "Run the propose-only repair loop through patch generation.",
      dependsOn: ["claims-repair-patch"],
      cache: false,
      run: sh`true`
    })
  },
  jobs: {
    verify: job({ target: ["claims", "claims-repair"] })
  }
});
