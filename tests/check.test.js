import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { checkClaims } from "../dist/index.js";

test("PROMISE: clean registry passes", async () => {
  const cwd = await project({
    readme: "Cache behavior is explicit through declared inputs.\n",
    tests: `import test from "node:test";\n\ntest("PROMISE: cache inputs isolate invalidation", () => {});\n`,
    claims: [
      claim({
        id: "readme.cache-inputs",
        anchor: "Cache behavior is explicit through declared inputs.",
        tests: ["PROMISE: cache inputs isolate invalidation"]
      })
    ]
  });

  const report = await checkClaims({ cwd });

  assert.equal(report.ok, true);
  assert.equal(report.counts.claims, 1);
  assert.deepEqual(report.failures, []);
});

test("PROMISE: stale anchor fails", async () => {
  const cwd = await project({
    readme: "Cache behavior now uses declared inputs.\n",
    tests: `import test from "node:test";\n\ntest("PROMISE: cache inputs isolate invalidation", () => {});\n`,
    claims: [
      claim({
        id: "readme.cache-inputs",
        anchor: "Cache behavior is explicit through declared inputs.",
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
        anchor: "Cache behavior is explicit through declared inputs.",
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
        anchor: "Cache behavior is explicit through declared inputs.",
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
        anchor: "Cache behavior is explicit through declared inputs.",
        tests: ["PROMISE: cache inputs isolate invalidation"]
      }),
      claim({
        id: "readme.duplicate",
        anchor: "Reports are written as JSON.",
        tests: ["PROMISE: reports are machine-readable"]
      })
    ]
  });

  const report = await checkClaims({ cwd });

  assert.equal(report.ok, false);
  assert.deepEqual(report.failures.map((failure) => failure.code), ["duplicate_id"]);
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
        anchor: "Reports are written as JSON.",
        tests: ["reports are machine-readable"]
      })
    ],
    config: {
      registry: "tests/claims.json",
      testFiles: ["checks/*.case"],
      testTitlePattern: "^case: (.+)$",
      promisePrefix: "PROMISE: "
    }
  });

  const report = await checkClaims({ cwd });

  assert.equal(report.ok, true);
  assert.deepEqual(report.testTitles, ["reports are machine-readable"]);
});

async function project(options) {
  const cwd = await mkdtemp(join(tmpdir(), "async-claims-test-"));
  const testPath = options.testPath ?? "tests/example.test.js";
  await mkdir(join(cwd, "tests"), { recursive: true });
  await mkdir(join(cwd, testPath.split("/").slice(0, -1).join("/")), { recursive: true });
  await writeFile(join(cwd, "README.md"), options.readme, "utf8");
  await writeFile(join(cwd, testPath), options.tests, "utf8");
  await writeFile(join(cwd, "tests", "claims.json"), `${JSON.stringify({ claims: options.claims }, null, 2)}\n`, "utf8");
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
    tests: ["PROMISE: cache inputs isolate invalidation"],
    ...overrides
  };
}
