import { agent, definePipeline, env, job, sh, task } from "@async/pipeline";

export default definePipeline({
  name: "async-claims-agent-loop",
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
  tasks: {
    claims: task({
      description: "Blocking deterministic claims check for the clean project.",
      inputs: ["README.md", "tests/claims.json", "tests/**/*.test.js"],
      cache: true,
      run: sh`async-claims check`
    }),
    "claims-report": task({
      description: "Non-failing JSON report for a stale fixture.",
      inputs: ["fixtures/stale/README.md", "fixtures/stale/tests/claims.json", "fixtures/stale/tests/**/*.test.js"],
      outputs: ["claims-report.json"],
      cache: true,
      run: sh`async-claims check --registry fixtures/stale/tests/claims.json --test-files "fixtures/stale/tests/**/*.test.js" --format json --no-fail --output claims-report.json`
    }),
    "claims-repair": task({
      description: "Draft a unified diff for review; never apply it automatically.",
      dependsOn: ["claims-report"],
      inputs: ["claims-report.json", "fixtures/stale/README.md", "fixtures/stale/tests/claims.json"],
      outputs: ["claims.patch"],
      cache: true,
      run: agent({
        use: env.var("ASYNC_AGENT", { default: "mock" }),
        stdoutTo: "claims.patch",
        prompt: [
          "Read claims-report.json and fixtures/stale/tests/claims.json.",
          "For stale anchors, locate the current exact promise text in fixtures/stale/README.md.",
          "Output only a unified diff against fixtures/stale/tests/claims.json.",
          "Do not apply the patch."
        ].join("\n")
      })
    })
  },
  jobs: {
    verify: job({ target: ["claims", "claims-report", "claims-repair"] })
  }
});
