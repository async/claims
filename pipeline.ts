import { agent, definePipeline, env, job, sh, task, trigger } from "@async/pipeline";

const packageInputs = [
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "src/**/*.ts",
  "schema/**/*.json",
  "tests/**/*.js",
  "tests/claims.json",
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
    claude: {
      command: ["claude", "-p"],
      model: env.var("ASYNC_AGENT_MODEL", { default: "claude-sonnet-4-6" })
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
      cache: true
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
      inputs: ["tests/claims.json", "README.md", "CHANGELOG.md", "docs/**/*.md", "tests/**/*.test.js"],
      cache: true,
      run: sh`node dist/cli.js check`
    }),
    "claims.report": task({
      description: "Write a non-failing JSON claims report for repair suggestions.",
      dependsOn: ["build"],
      inputs: ["tests/claims.json", "README.md", "CHANGELOG.md", "docs/**/*.md", "tests/**/*.test.js"],
      outputs: ["claims-report.json"],
      cache: true,
      run: sh`node dist/cli.js check --format json --no-fail --output claims-report.json`
    }),
    "claims.repair": task({
      description: "Draft a reviewable registry patch. Propose-only: a human reviews and applies.",
      dependsOn: ["claims.report"],
      inputs: ["claims-report.json", "tests/claims.json", "README.md", "CHANGELOG.md", "docs/**/*.md"],
      outputs: ["claims.patch"],
      cache: true,
      run: agent({
        use: env.var("ASYNC_AGENT", { default: "claude" }),
        stdoutTo: "claims.patch",
        prompt: [
          "Read claims-report.json and tests/claims.json.",
          "For stale anchors, locate the current exact promise text in the source file.",
          "Output only a unified diff against tests/claims.json.",
          "Preserve claim ids and tests arrays.",
          "Never delete claims or apply the patch. Deletions and test sufficiency are human review decisions."
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
      description: "Build the simple README-backed GitHub Pages site.",
      inputs: [...docsInputs, "scripts/build-pages.js"],
      outputs: [".async/pages/index.html"],
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
    "publish.preview": task({
      description: "Publish a pull-request preview package to GitHub Packages.",
      dependsOn: ["verify"],
      cache: false,
      run: sh`async-pipeline publish github pr --package .`
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
    preview: job({
      description: "Publish a pull-request preview package to GitHub Packages.",
      target: ["publish.preview"],
      trigger: ["pr"],
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN")
      },
      github: {
        permissions: {
          contents: "read",
          issues: "write",
          pullRequests: "write",
          packages: "write"
        }
      }
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
    pages: job({
      description: "Build and deploy the README-backed documentation site to GitHub Pages.",
      target: ["docs.site"],
      trigger: ["manual", "pr", "main"],
      github: {
        pages: {
          build: {
            kind: "static",
            path: ".async/pages"
          },
          environment: {
            name: "github-pages",
            url: "${{ steps.deployment.outputs.page_url }}"
          }
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
