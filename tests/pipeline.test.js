import assert from "node:assert/strict";
import test from "node:test";

import {
  ASYNC_PIPELINE_DECLARATION,
  claims,
  claimsSuggestPrompt,
  claimsSuggestTask,
  claimsTasks,
  claimsWorkflowTasks,
  readAsyncPipelineDeclaration,
  renderPromptTemplate
} from "../dist/pipeline.js";

test("PROMISE: pipeline helper builds standard tasks without a pipeline dependency", () => {
  const tasks = claims();

  assert.deepEqual(Object.keys(tasks), ["claims", "claims.report", "claims.repair.context", "claims.repair.patch"]);
  assert.deepEqual(readAsyncPipelineDeclaration(tasks), { kind: "section.tasks", version: 1 });
  assert.equal(Object.getOwnPropertyDescriptor(tasks, ASYNC_PIPELINE_DECLARATION)?.enumerable, false);
  assert.equal(JSON.stringify(tasks).includes("@async/pipeline.declaration"), false);
  assert.deepEqual(readAsyncPipelineDeclaration(tasks.claims), { kind: "task", version: 1 });
  assert.deepEqual(readAsyncPipelineDeclaration(tasks.claims.run), { kind: "shell", version: 1 });
  assert.equal(tasks.claims.run.command, "async-claims check");
  assert.equal(tasks["claims.report"].run.command, "async-claims check --format json --no-fail --output claims-report.json");
  assert.equal(tasks["claims.repair.context"].run.command, "async-claims repair-context --output claims-repair-context.json");
  assert.equal(tasks["claims.repair.patch"].run.command, "async-claims patch-anchors --suggestions claims-anchor-updates.json --output claims.patch");
  assert.deepEqual(tasks["claims.repair.patch"].dependsOn, ["claims.repair.context"]);
});

test("pipeline helper can emit deterministic tasks only", () => {
  const tasks = claims(fakePipelinePrimitives(), { repair: false });

  assert.deepEqual(Object.keys(tasks), ["claims", "claims.report"]);
  assert.equal(tasks.claims.run, "async-claims check");
});

test("PROMISE: claimsTasks returns a nested task group without a pipeline dependency", () => {
  const group = claimsTasks();

  assert.deepEqual(Object.keys(group), ["default", "repair", "report"]);
  assert.deepEqual(Object.keys(group.repair), ["context", "patch"]);
  assert.deepEqual(readAsyncPipelineDeclaration(group), { kind: "section.tasks", version: 1 });
  assert.equal(Object.getOwnPropertyDescriptor(group, ASYNC_PIPELINE_DECLARATION)?.enumerable, false);
  assert.equal(JSON.stringify(group).includes("@async/pipeline.declaration"), false);
  assert.deepEqual(readAsyncPipelineDeclaration(group.default), { kind: "task", version: 1 });
  assert.deepEqual(readAsyncPipelineDeclaration(group.default.run), { kind: "shell", version: 1 });
  assert.equal(group.default.run.command, "async-claims check");
  assert.equal(group.report.run.command, "async-claims check --format json --no-fail --output claims-report.json");
  assert.equal(group.repair.context.run.command, "async-claims repair-context --output claims-repair-context.json");
  assert.equal(group.repair.patch.run.command, "async-claims patch-anchors --suggestions claims-anchor-updates.json --output claims.patch");
});

test("PROMISE: claimsWorkflowTasks remains a compatibility alias", () => {
  const group = claimsWorkflowTasks();

  assert.deepEqual(Object.keys(group), ["default", "repair", "report"]);
  assert.equal(group.default.run.command, "async-claims check");
});

test("PROMISE: claimsSuggestTask hides repair files while keeping the repair stage visible", () => {
  const group = claimsTasks({
    namedFiles: {
      "repair.context": ".claims/repair-context.json",
      "repair.suggestions": ".claims/anchor-updates.json",
      "repair.patch": ".claims/repair.patch"
    },
    tasks: {
      "repair.suggest": claimsSuggestTask({
        dependsOn: ["claims.repair.context"],
        use: "codex"
      })
    }
  });

  assert.deepEqual(Object.keys(group.repair), ["context", "patch", "suggest"]);
  assert.deepEqual(group.repair.patch.dependsOn, ["claims.repair.suggest"]);
  assert.deepEqual(group.repair.suggest.dependsOn, ["claims.repair.context"]);
  assert.deepEqual(group.repair.suggest.inputs, [".claims/repair-context.json", "README.md", "AGENTS.md", "CHANGELOG.md", "docs/**/*.md"]);
  assert.deepEqual(group.repair.suggest.outputs, [".claims/anchor-updates.json"]);
  assert.equal(group.repair.suggest.cache, false);
  assert.equal(group.repair.suggest.run.kind, "agent");
  assert.equal(group.repair.suggest.run.use, "codex");
  assert.equal(group.repair.suggest.run.stdoutTo, ".claims/anchor-updates.json");
  assert.match(group.repair.suggest.run.prompt, /Read \.claims\/repair-context\.json first/);
  assert.match(group.repair.suggest.run.prompt, /Do not inspect tests, test titles, claims\.coverage\.json/);
});

test("PROMISE: prompt templates accept strings and newline-joined string arrays only", () => {
  assert.equal(renderPromptTemplate("one"), "one");
  assert.equal(renderPromptTemplate(["one", "", "two"]), "one\n\ntwo");
  assert.throws(() => renderPromptTemplate(() => "nope"), /Function templates are not supported/);
  assert.match(renderPromptTemplate(claimsSuggestPrompt({ intensity: "balanced" })), /Be balanced/);
});

function fakePipelinePrimitives() {
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
    agent(definition) {
      return definition;
    },
    env: {
      var(name, envOptions) {
        return { name, options: envOptions };
      }
    }
  };
}
