import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  checkClaims,
  createAnchorPatch,
  createRepairContext,
  loadConfig
} from "../dist/index.js";

test("PROMISE: clean split registry passes", async () => {
  const cwd = await project({
    readme: "Cache behavior is explicit through declared inputs.\n",
    tests: `import test from "node:test";\n\ntest("PROMISE: cache inputs isolate invalidation", () => {});\n`,
    claims: [
      claim({
        id: "readme.cache-inputs",
        anchor: "Cache behavior is explicit through declared inputs."
      })
    ],
    coverage: [
      coverage({
        claimId: "readme.cache-inputs",
        tests: ["PROMISE: cache inputs isolate invalidation"]
      })
    ]
  });

  const report = await checkClaims({ cwd });

  assert.equal(report.ok, true);
  assert.equal(report.counts.claims, 1);
  assert.equal(report.counts.coverage, 1);
  assert.deepEqual(report.failures, []);
});

test("PROMISE: stale anchor fails", async () => {
  const cwd = await project({
    readme: "Cache behavior now uses declared inputs.\n",
    tests: `import test from "node:test";\n\ntest("PROMISE: cache inputs isolate invalidation", () => {});\n`,
    claims: [
      claim({
        id: "readme.cache-inputs",
        anchor: "Cache behavior is explicit through declared inputs."
      })
    ],
    coverage: [
      coverage({
        claimId: "readme.cache-inputs",
        tests: ["PROMISE: cache inputs isolate invalidation"]
      })
    ]
  });

  const report = await checkClaims({ cwd });

  assert.equal(report.ok, false);
  assert.equal(report.failures[0]?.code, "stale_anchor");
  assert.equal(report.failures[0]?.claimId, "readme.cache-inputs");
});

test("PROMISE: missing referenced test fails", async () => {
  const cwd = await project({
    readme: "Cache behavior is explicit through declared inputs.\n",
    tests: `import test from "node:test";\n\ntest("ordinary test", () => {});\n`,
    claims: [
      claim({
        id: "readme.cache-inputs",
        anchor: "Cache behavior is explicit through declared inputs."
      })
    ],
    coverage: [
      coverage({
        claimId: "readme.cache-inputs",
        tests: ["PROMISE: cache inputs isolate invalidation"]
      })
    ]
  });

  const report = await checkClaims({ cwd });

  assert.equal(report.ok, false);
  assert.equal(report.failures[0]?.code, "missing_referenced_test");
  assert.equal(report.failures[0]?.testTitle, "PROMISE: cache inputs isolate invalidation");
});

test("PROMISE: unmapped promise test fails", async () => {
  const cwd = await project({
    readme: "Cache behavior is explicit through declared inputs.\n",
    tests: [
      `import test from "node:test";`,
      `test("PROMISE: cache inputs isolate invalidation", () => {});`,
      `test("PROMISE: unregistered promise", () => {});`
    ].join("\n"),
    claims: [
      claim({
        id: "readme.cache-inputs",
        anchor: "Cache behavior is explicit through declared inputs."
      })
    ],
    coverage: [
      coverage({
        claimId: "readme.cache-inputs",
        tests: ["PROMISE: cache inputs isolate invalidation"]
      })
    ]
  });

  const report = await checkClaims({ cwd });

  assert.equal(report.ok, false);
  assert.equal(report.failures.at(-1)?.code, "unmapped_promise_test");
  assert.equal(report.failures.at(-1)?.testTitle, "PROMISE: unregistered promise");
});

test("PROMISE: duplicate ids fail deterministically", async () => {
  const cwd = await project({
    readme: [
      "Cache behavior is explicit through declared inputs.",
      "Reports are written as JSON."
    ].join("\n"),
    tests: [
      `import test from "node:test";`,
      `test("PROMISE: cache inputs isolate invalidation", () => {});`,
      `test("PROMISE: reports are machine-readable", () => {});`
    ].join("\n"),
    claims: [
      claim({
        id: "readme.duplicate",
        anchor: "Cache behavior is explicit through declared inputs."
      }),
      claim({
        id: "readme.duplicate",
        anchor: "Reports are written as JSON."
      })
    ],
    coverage: [
      coverage({
        claimId: "readme.duplicate",
        tests: ["PROMISE: cache inputs isolate invalidation"]
      })
    ]
  });

  const report = await checkClaims({ cwd });

  assert.equal(report.ok, false);
  assert.equal(report.failures[0]?.code, "duplicate_id");
  assert.equal(report.failures[0]?.claimId, "readme.duplicate");
});

test("PROMISE: custom regex discovers non-node test titles", async () => {
  const cwd = await project({
    readme: "Reports are written as JSON.\n",
    testPath: "checks/report.case",
    tests: "case: reports are machine-readable\n",
    claims: [
      claim({
        id: "readme.json-report",
        anchor: "Reports are written as JSON."
      })
    ],
    coverage: [
      coverage({
        claimId: "readme.json-report",
        tests: ["reports are machine-readable"]
      })
    ],
    config: {
      registry: "tests/claims.json",
      coverage: "tests/claims.coverage.json",
      testFiles: ["checks/*.case"],
      testTitlePattern: "^case: (.+)$",
      promisePrefix: "PROMISE: "
    }
  });

  const report = await checkClaims({ cwd });

  assert.equal(report.ok, true);
  assert.deepEqual(report.testTitles, ["reports are machine-readable"]);
});

test("PROMISE: defaults detect test folder when it owns claims files", async () => {
  const cwd = await project({
    folder: "test",
    readme: "Cache behavior is explicit through declared inputs.\n",
    tests: `import test from "node:test";\n\ntest("PROMISE: cache inputs isolate invalidation", () => {});\n`,
    claims: [
      claim({
        id: "readme.cache-inputs",
        anchor: "Cache behavior is explicit through declared inputs."
      })
    ],
    coverage: [
      coverage({
        claimId: "readme.cache-inputs",
        tests: ["PROMISE: cache inputs isolate invalidation"]
      })
    ]
  });

  const config = await loadConfig({ cwd });
  const report = await checkClaims({ cwd });

  assert.equal(config.registry, "test/claims.json");
  assert.equal(config.coverage, "test/claims.coverage.json");
  assert.deepEqual(config.testFiles, ["test/**/*.test.js"]);
  assert.equal(report.ok, true);
});

test("PROMISE: defaults fail when test and tests exist without claims files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "async-claims-ambiguous-"));
  await mkdir(join(cwd, "test"), { recursive: true });
  await mkdir(join(cwd, "tests"), { recursive: true });

  const report = await checkClaims({ cwd });

  assert.equal(report.ok, false);
  assert.equal(report.failures[0]?.code, "invalid_config");
  assert.match(report.failures[0]?.message ?? "", /Both tests\/ and test\/ exist/);
});

test("PROMISE: missing coverage entry fails", async () => {
  const cwd = await project({
    readme: "Cache behavior is explicit through declared inputs.\n",
    tests: `import test from "node:test";\n\ntest("PROMISE: cache inputs isolate invalidation", () => {});\n`,
    claims: [
      claim({
        id: "readme.cache-inputs",
        anchor: "Cache behavior is explicit through declared inputs."
      })
    ],
    coverage: []
  });

  const report = await checkClaims({ cwd });

  assert.equal(report.ok, false);
  assert.equal(report.failures[0]?.code, "missing_claim_coverage");
});

test("PROMISE: repair context excludes coverage and test information", async () => {
  const cwd = await project({
    readme: "Cache behavior now uses declared inputs.\n",
    tests: `import test from "node:test";\n\ntest("PROMISE: cache inputs isolate invalidation", () => {});\n`,
    claims: [
      claim({
        id: "readme.cache-inputs",
        anchor: "Cache behavior is explicit through declared inputs."
      })
    ],
    coverage: [
      coverage({
        claimId: "readme.cache-inputs",
        tests: ["PROMISE: cache inputs isolate invalidation"]
      })
    ]
  });

  const context = await createRepairContext({ cwd });
  const rendered = JSON.stringify(context);

  assert.equal(context.format, "async-claims.repair-context.v1");
  assert.equal(context.failures[0]?.code, "stale_anchor");
  assert.equal(rendered.includes("PROMISE: cache inputs isolate invalidation"), false);
  assert.equal(rendered.includes("claims.coverage.json"), false);
});

test("PROMISE: anchor suggestions produce registry patch and reject needsReview", async () => {
  const cwd = await project({
    readme: "Cache behavior now uses declared inputs.\n",
    tests: `import test from "node:test";\n\ntest("PROMISE: cache inputs isolate invalidation", () => {});\n`,
    claims: [
      claim({
        id: "readme.cache-inputs",
        anchor: "Cache behavior is explicit through declared inputs."
      })
    ],
    coverage: [
      coverage({
        claimId: "readme.cache-inputs",
        tests: ["PROMISE: cache inputs isolate invalidation"]
      })
    ]
  });
  await writeFile(join(cwd, "claims-anchor-updates.json"), `${JSON.stringify({
    updates: [
      {
        claimId: "readme.cache-inputs",
        anchor: "Cache behavior now uses declared inputs.",
        reason: "README wording changed."
      }
    ],
    needsReview: []
  }, null, 2)}\n`, "utf8");

  const result = await createAnchorPatch({ cwd });

  assert.equal(result.updated, 1);
  assert.match(result.patch, /diff --git a\/tests\/claims\.json b\/tests\/claims\.json/);
  assert.match(result.patch, /Cache behavior now uses declared inputs\./);

  await writeFile(join(cwd, "claims-anchor-updates.json"), `${JSON.stringify({
    updates: [],
    needsReview: [{ claimId: "readme.cache-inputs", reason: "Claim was rewritten too broadly." }]
  }, null, 2)}\n`, "utf8");
  await assert.rejects(() => createAnchorPatch({ cwd }), /needs review before patching/);
});

async function project(options) {
  const cwd = await mkdtemp(join(tmpdir(), "async-claims-test-"));
  const folder = options.folder ?? "tests";
  const testPath = options.testPath ?? `${folder}/example.test.js`;
  await mkdir(join(cwd, folder), { recursive: true });
  await mkdir(join(cwd, testPath.split("/").slice(0, -1).join("/")), { recursive: true });
  await writeFile(join(cwd, "README.md"), options.readme, "utf8");
  await writeFile(join(cwd, testPath), options.tests, "utf8");
  await writeFile(join(cwd, folder, "claims.json"), `${JSON.stringify({ claims: options.claims }, null, 2)}\n`, "utf8");
  await writeFile(join(cwd, folder, "claims.coverage.json"), `${JSON.stringify({ coverage: options.coverage }, null, 2)}\n`, "utf8");
  if (options.config) {
    await writeFile(join(cwd, "claims.config.json"), `${JSON.stringify(options.config, null, 2)}\n`, "utf8");
  }
  return cwd;
}

function claim(overrides) {
  return {
    id: "readme.claim",
    source: "README.md",
    anchor: "Cache behavior is explicit through declared inputs.",
    ...overrides
  };
}

function coverage(overrides) {
  return {
    claimId: "readme.claim",
    tests: ["PROMISE: cache inputs isolate invalidation"],
    ...overrides
  };
}
