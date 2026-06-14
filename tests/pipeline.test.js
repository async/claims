import assert from "node:assert/strict";
import test from "node:test";

import {
  ASYNC_PIPELINE_DECLARATION,
  claims,
  claimsWorkflowTasks,
  readAsyncPipelineDeclaration
} from "../dist/pipeline.js";

test("PROMISE: pipeline helper builds standard tasks without a pipeline dependency", () => {
  const tasks = claims();

  assert.deepEqual(Object.keys(tasks), ["claims", "claims-report", "claims-repair"]);
  assert.deepEqual(readAsyncPipelineDeclaration(tasks), { kind: "section.tasks", version: 1 });
  assert.equal(Object.getOwnPropertyDescriptor(tasks, ASYNC_PIPELINE_DECLARATION)?.enumerable, false);
  assert.equal(JSON.stringify(tasks).includes("@async/pipeline.declaration"), false);
  assert.deepEqual(readAsyncPipelineDeclaration(tasks.claims), { kind: "task", version: 1 });
  assert.deepEqual(readAsyncPipelineDeclaration(tasks.claims.run), { kind: "shell", version: 1 });
  assert.equal(tasks.claims.run.command, "async-claims check");
  assert.equal(tasks["claims-report"].run.command, "async-claims check --format json --no-fail --output claims-report.json");
  assert.deepEqual(tasks["claims-repair"].dependsOn, ["claims-report"]);
  assert.deepEqual(tasks["claims-repair"].outputs, ["claims.patch"]);
  assert.deepEqual(tasks["claims-repair"].run.use, {
    kind: "async-pipeline.env.var",
    name: "ASYNC_AGENT",
    default: "claude"
  });
  assert.deepEqual(readAsyncPipelineDeclaration(tasks["claims-repair"].run), { kind: "agent", version: 1 });
});

test("pipeline helper can emit deterministic tasks only", () => {
  const tasks = claims(fakePipelinePrimitives({ agent: false }));

  assert.deepEqual(Object.keys(tasks), ["claims", "claims-report"]);
  assert.equal(tasks.claims.run, "async-claims check");
});

test("PROMISE: claimsWorkflowTasks returns a nested task group without a pipeline dependency", () => {
  const group = claimsWorkflowTasks();

  assert.deepEqual(Object.keys(group), ["default", "report", "repair"]);
  assert.deepEqual(readAsyncPipelineDeclaration(group), { kind: "section.tasks", version: 1 });
  assert.equal(Object.getOwnPropertyDescriptor(group, ASYNC_PIPELINE_DECLARATION)?.enumerable, false);
  assert.equal(JSON.stringify(group).includes("@async/pipeline.declaration"), false);
  assert.deepEqual(readAsyncPipelineDeclaration(group.default), { kind: "task", version: 1 });
  assert.deepEqual(readAsyncPipelineDeclaration(group.default.run), { kind: "shell", version: 1 });
  assert.equal(group.default.run.command, "async-claims check");
  assert.equal(group.report.run.command, "async-claims check --format json --no-fail --output claims-report.json");
  assert.deepEqual(group.repair.dependsOn, ["report"]);
  assert.deepEqual(group.repair.outputs, ["claims.patch"]);
  assert.deepEqual(readAsyncPipelineDeclaration(group.repair.run), { kind: "agent", version: 1 });
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
