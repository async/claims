import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

test("PROMISE: JSON no-fail writes report and exits zero", async () => {
  const cwd = await project({
    readme: "Cache behavior now uses declared inputs.\n",
    tests: `import test from "node:test";\n\ntest("PROMISE: cache inputs isolate invalidation", () => {});\n`,
    claims: [
      {
        id: "readme.cache-inputs",
        source: "README.md",
        anchor: "Cache behavior is explicit through declared inputs.",
        tests: ["PROMISE: cache inputs isolate invalidation"]
      }
    ]
  });

  const result = spawnSync(process.execPath, [
    cliPath,
    "check",
    "--format",
    "json",
    "--output",
    "claims-report.json",
    "--no-fail"
  ], { cwd, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(join(cwd, "claims-report.json"), "utf8"));
  assert.equal(report.ok, false);
  assert.equal(report.failures[0].code, "stale_anchor");
});

test("PROMISE: invalid config exits two", async () => {
  const cwd = await project({
    readme: "Cache behavior is explicit through declared inputs.\n",
    tests: `import test from "node:test";\n\ntest("PROMISE: cache inputs isolate invalidation", () => {});\n`,
    claims: [
      {
        id: "readme.cache-inputs",
        source: "README.md",
        anchor: "Cache behavior is explicit through declared inputs.",
        tests: ["PROMISE: cache inputs isolate invalidation"]
      }
    ],
    config: {
      testTitlePattern: "["
    }
  });

  const result = spawnSync(process.execPath, [cliPath, "check"], { cwd, encoding: "utf8" });

  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /invalid_config/);
});

test("PROMISE: init refuses overwrites unless forced", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "async-claims-init-"));
  await writeFile(join(cwd, "claims.config.json"), "{}\n", "utf8");

  const refused = spawnSync(process.execPath, [cliPath, "init"], { cwd, encoding: "utf8" });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Refusing to overwrite/);

  const forced = spawnSync(process.execPath, [cliPath, "init", "--force"], { cwd, encoding: "utf8" });
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(forced.stdout, /Initialized async-claims/);
  assert.match(await readFile(join(cwd, "claims.config.json"), "utf8"), /tests\/claims\.json/);
  assert.match(await readFile(join(cwd, "tests", "claims.json"), "utf8"), /"claims": \[\]/);
});

async function project(options) {
  const cwd = await mkdtemp(join(tmpdir(), "async-claims-cli-"));
  await mkdir(join(cwd, "tests"), { recursive: true });
  await writeFile(join(cwd, "README.md"), options.readme, "utf8");
  await writeFile(join(cwd, "tests", "example.test.js"), options.tests, "utf8");
  await writeFile(join(cwd, "tests", "claims.json"), `${JSON.stringify({ claims: options.claims }, null, 2)}\n`, "utf8");
  if (options.config) {
    await writeFile(join(cwd, "claims.config.json"), `${JSON.stringify(options.config, null, 2)}\n`, "utf8");
  }
  return cwd;
}
