import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("PROMISE: Codex getting-started prompts cover initial setup and repair loop guardrails", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const section = readme.slice(readme.indexOf("## Codex Getting-Started Prompts"), readme.indexOf("## Full Loop With Pipeline"));

  assert.match(section, /Initial setup prompt:/);
  assert.match(section, /Pipeline repair-loop prompt:/);
  assert.match(section, /<test-folder>\/claims\.json/);
  assert.match(section, /<test-folder>\/claims\.coverage\.json/);
  assert.match(section, /claimsTasks and claimsSuggestTask/);
  assert.match(section, /claims\.repair\.context/);
  assert.match(section, /claims\.repair\.suggest/);
  assert.match(section, /claims\.repair\.patch/);
  assert.match(section, /default ASYNC_AGENT to codex/);
  assert.match(section, /Do not expose tests, test titles, claims\.coverage\.json, or coverage mappings to the repair agent/);
  assert.match(section, /Do not pass task or sh into claimsTasks/);
});
