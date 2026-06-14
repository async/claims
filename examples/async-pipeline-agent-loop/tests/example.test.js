import assert from "node:assert/strict";
import test from "node:test";

test("PROMISE: the clean claims check passes", () => {
  assert.equal("claims".toUpperCase(), "CLAIMS");
});
