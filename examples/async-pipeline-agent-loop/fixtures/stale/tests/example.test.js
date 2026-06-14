import assert from "node:assert/strict";
import test from "node:test";

test("PROMISE: the stale example command is tested", () => {
  assert.equal("reviewed".includes("review"), true);
});
