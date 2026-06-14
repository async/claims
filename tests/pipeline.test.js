import assert from "node:assert/strict";
import test from "node:test";

import { claims, claimsTasks } from "../dist/pipeline.js";

test("PROMISE: pipeline helper builds standard tasks without a pipeline dependency", () => {
  const tasks = claims(fakePipelinePrimitives());

  assert.deepEqual(Object.keys(tasks), ["claims", "claims-report", "claims-repair"]);
  assert.equal(tasks.claims.run, "async-claims check");
  assert.equal(tasks["claims-report"].run, "async-claims check --format json --no-fail --output claims-report.json");
  assert.deepEqual(tasks["claims-repair"].dependsOn, ["claims-report"]);
  assert.deepEqual(tasks["claims-repair"].outputs, ["claims.patch"]);
  assert.deepEqual(tasks["claims-repair"].run.use, {
    name: "ASYNC_AGENT",
    options: { default: "claude" }
  });
});

test("pipeline helper can emit deterministic tasks only", () => {
  const tasks = claims(fakePipelinePrimitives({ agent: false }));

  assert.deepEqual(Object.keys(tasks), ["claims", "claims-report"]);
  assert.equal(tasks.claims.run, "async-claims check");
});

test("PROMISE: claimsTasks returns a nested task group without a pipeline dependency", () => {
  const group = claimsTasks(fakePipelinePrimitives());

  assert.deepEqual(Object.keys(group), ["index", "report", "repair"]);
  assert.equal(group.index.run, "async-claims check");
  assert.equal(group.report.run, "async-claims check --format json --no-fail --output claims-report.json");
  assert.deepEqual(group.repair.dependsOn, ["report"]);
  assert.deepEqual(group.repair.outputs, ["claims.patch"]);
});

function fakePipelinePrimitives(options = {}) {
  return {
    task(definition) {
      return definition;
    },
    sh(strings, ...values) {
      let command = "";
      for (let index = 0; index < strings.length; index += 1) {
        command += strings[index] ?? "";
        if (index < values.length) command += String(values[index]);
      }
      return command;
    },
    ...(options.agent === false ? {} : {
      agent(definition) {
        return definition;
      },
      env: {
        var(name, envOptions) {
          return { name, options: envOptions };
        }
      }
    })
  };
}
