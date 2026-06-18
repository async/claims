import { agent, definePipeline, env, job, sh, task, trigger } from "@async/pipeline";

const packageInputs = [
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "src/**/*.ts",
  "schema/**/*.json",
  "tests/**/*.js",
  "tests/claims.json",
  "tests/claims.coverage.json",
  "README.md",
  "CHANGELOG.md",
  "docs/**/*.md",
  "api-contract.json",
  "API_SURFACE.md"
];

const docsInputs = ["README.md", "CHANGELOG.md", "docs/**/*.md"];

export default definePipeline({
  name: "async-claims",
  agents: {
    codex: {
      command: ["codex", "exec"],
      model: env.var("ASYNC_AGENT_MODEL", { default: "gpt-5-codex" })
    }
  },
  triggers: {
    manual: trigger.manual(),
    pr: trigger.github({ events: ["pull_request"] }),
    main: trigger.github({ events: ["push"], branches: ["main"] }),
    release: trigger.github({ events: ["release"] })
  },
  sync: {
    github: {
      nodeVersion: 24,
      cache: true,
      packagePreviews: true,
      pages: { target: "docs.site" }
    },
    tasks: {
      prefix: "pipeline",
      runners: ["package"],
      targets: "root",
      jobs: "all",
      tasks: "all",
      scripts: {
        "github:check": "github check",
        "github:generate": "github generate",
        "pages": "run-task docs.site",
        "publish:github:release": "publish github release --package .",
        "publish:npm": "publish npm --package .",
        "release:doctor": "release doctor --package .",
        "release:ensure": "release ensure --package .",
        "sync:check": "sync check",
        "sync:generate": "sync generate"
      }
    }
  },
  tasks: {
    build: task({
      description: "Compile the TypeScript package and make the CLI executable.",
      inputs: ["package.json", "tsconfig.json", "src/**/*.ts", "schema/**/*.json"],
      outputs: ["dist"],
      cache: true,
      run: sh`tsc -p tsconfig.json && chmod +x dist/cli.js`
    }),
    test: task({
      description: "Run the package test suite after build.",
      dependsOn: ["build"],
      inputs: packageInputs,
      cache: true,
      run: sh`node --test tests/*.test.js`
    }),
    claims: task({
      description: "Authoritative claims check: every registered doc promise is anchored and mapped to a real test.",
      dependsOn: ["build"],
      inputs: ["tests/claims.json", "tests/claims.coverage.json", "README.md", "CHANGELOG.md", "docs/**/*.md", "tests/**/*.test.js"],
      cache: true,
      run: sh`node dist/cli.js check`
    }),
    "claims.report": task({
      description: "Write a non-failing JSON claims report for release diagnostics.",
      dependsOn: ["build"],
      inputs: ["tests/claims.json", "tests/claims.coverage.json", "README.md", "CHANGELOG.md", "docs/**/*.md", "tests/**/*.test.js"],
      outputs: ["claims-report.json"],
      cache: true,
      run: sh`node dist/cli.js check --format json --no-fail --output claims-report.json`
    }),
    "claims.repair.context": task({
      description: "Write a test-blind claims repair context for stale-anchor suggestion agents.",
      dependsOn: ["build"],
      inputs: ["tests/claims.json", "README.md", "CHANGELOG.md", "docs/**/*.md"],
      outputs: ["claims-repair-context.json"],
      cache: true,
      run: sh`node dist/cli.js repair-context --output claims-repair-context.json`
    }),
    "claims.repair.suggest": task({
      description: "Ask an agent to propose claim-anchor updates as JSON. Test and coverage mappings stay hidden.",
      dependsOn: ["claims.repair.context"],
      inputs: ["claims-repair-context.json", "README.md", "AGENTS.md", "CHANGELOG.md", "docs/**/*.md"],
      outputs: ["claims-anchor-updates.json"],
      cache: false,
      run: agent({
        use: env.var("ASYNC_AGENT", { default: "codex" }),
        stdoutTo: "claims-anchor-updates.json",
        prompt: [
          "You are proposing claim-anchor repairs for @async/claims.",
          "Be balanced: propose high-confidence mechanical fixes and use needsReview for judgment calls.",
          "",
          "Read claims-repair-context.json first. Treat it as the deterministic work queue.",
          "Inspect only the declared markdown and documentation inputs to verify replacement anchors.",
          "Do not inspect tests, test titles, claims.coverage.json, or coverage mappings.",
          "Write JSON to claims-anchor-updates.json with this shape:",
          "{\"updates\":[{\"claimId\":\"...\",\"anchor\":\"...\",\"reason\":\"...\"}],\"needsReview\":[{\"claimId\":\"...\",\"reason\":\"...\"}]}",
          "Use needsReview instead of guessing when a claim was deleted, split, merged, made vague, or cannot be matched with high confidence.",
          "Do not edit files and do not output prose outside the JSON object."
        ].join("\n")
      })
    }),
    "claims.repair.patch": task({
      description: "Convert reviewed anchor suggestions into a patch against the claims registry.",
      dependsOn: ["claims.repair.suggest"],
      inputs: ["tests/claims.json", "claims-repair-context.json", "claims-anchor-updates.json", "README.md", "CHANGELOG.md", "docs/**/*.md"],
      outputs: ["claims.patch"],
      cache: true,
      run: sh`node dist/cli.js patch-anchors --suggestions claims-anchor-updates.json --output claims.patch`
    }),
    "claims.repair": task({
      description: "Run the full propose-only claims repair loop through patch generation.",
      dependsOn: ["claims.repair.patch"],
      cache: false,
      run: sh`true`
    }),
    "claims.maintain": task({
      description: "Ask an agent for claims detector and workflow improvements without weakening the release gate.",
      inputs: ["src/**/*.ts", "tests/**/*.js", "README.md", "docs/**/*.md"],
      outputs: ["claims-maintain.md"],
      cache: false,
      run: agent({
        use: env.var("ASYNC_AGENT", { default: "codex" }),
        stdoutTo: "claims-maintain.md",
        prompt: [
          "You are maintaining the @async/claims release gate.",
          "Be balanced: propose high-confidence mechanical fixes and use needsReview for judgment calls.",
          "Suggest detector, schema, or workflow improvements that preserve deterministic release authority.",
          "Do not weaken checks to make a release pass.",
          "Separate mechanical fixes from judgment calls and list the verification command that should decide."
        ].join("\n")
      })
    }),
    "api.surface": task({
      description: "Check the semantic API contract manifest and generated API surface ledger.",
      inputs: ["api-contract.json", "API_SURFACE.md"],
      cache: true,
      run: sh`api-contract check --manifest api-contract.json && api-contract ledger --manifest api-contract.json --check API_SURFACE.md`
    }),
    "docs.site": task({
      description: "Build the standardized GitHub Pages documentation site.",
      inputs: [...docsInputs, "scripts/build-pages.js"],
      outputs: [".async/pages/**"],
      cache: true,
      // @async/pipeline TODO: replace this fallback when pipeline provides a first-class README-to-Pages builder.
      run: sh`node scripts/build-pages.js`
    }),
    "pack.check": task({
      description: "Verify package contents with npm dry-run packing.",
      dependsOn: ["build", "api.surface"],
      inputs: packageInputs,
      cache: false,
      run: sh`npm --cache .async/npm-cache pack --dry-run`
    }),
    "publish.snapshot": task({
      description: "Publish a main-branch snapshot package to GitHub Packages.",
      dependsOn: ["verify"],
      cache: false,
      run: sh`async-pipeline publish github main --package .`
    }),
    "publish.stable": task({
      description: "Publish the stable GitHub Packages mirror, then npm, then run release doctor.",
      dependsOn: ["publish.stable.github"],
      cache: false,
      run: [
        sh`async-pipeline publish npm --package .`,
        sh`async-pipeline release doctor --package .`
      ]
    }),
    "publish.stable.github": task({
      description: "Publish the stable package mirror to GitHub Packages before npm publishing.",
      dependsOn: ["release.ensure"],
      cache: false,
      run: sh`async-pipeline publish github release --package .`
    }),
    "release.ensure": task({
      description: "Create or verify the release tag and GitHub Release before package publishing.",
      dependsOn: ["verify"],
      cache: false,
      run: sh`async-pipeline release ensure --package .`
    }),
    "release.doctor": task({
      description: "Verify npm, GitHub Packages, and GitHub Release state for the package.",
      cache: false,
      run: sh`async-pipeline release doctor --package .`
    }),
    verify: task({
      description: "Run all local release checks.",
      dependsOn: ["test", "claims", "api.surface", "pack.check"],
      inputs: packageInputs,
      cache: false,
      run: sh`true`
    })
  },
  jobs: {
    verify: job({
      description: "Build, test, claims-check, API-surface check, and package dry-run.",
      target: ["verify"],
      trigger: ["manual", "pr", "main"]
    }),
    snapshot: job({
      description: "Publish a main-branch snapshot package to GitHub Packages.",
      target: ["publish.snapshot"],
      trigger: ["main"],
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN")
      },
      github: {
        permissions: {
          contents: "read",
          packages: "write"
        }
      }
    }),
    publish: job({
      description: "Publish the stable GitHub Packages mirror and npm package from a release.",
      target: ["publish.stable"],
      trigger: ["manual", "release"],
      environment: {
        name: "npm-publish",
        url: "https://www.npmjs.com/package/@async/claims"
      },
      requires: {
        provenance: true
      },
      env: {
        NODE_AUTH_TOKEN: env.secret("NPM_TOKEN"),
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN")
      },
      github: {
        permissions: {
          contents: "write",
          idToken: "write",
          packages: "write"
        }
      }
    }),
    releaseDoctor: job({
      description: "Check published package and release state.",
      target: ["release.doctor"],
      trigger: ["manual", "release"],
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN")
      },
      github: {
        permissions: {
          contents: "read",
          packages: "read"
        }
      }
    })
  }
});
