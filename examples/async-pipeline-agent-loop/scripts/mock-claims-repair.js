#!/usr/bin/env node
const newAnchor = "The stale example command returns a reviewed result.";

process.stdout.write(`${JSON.stringify({
  updates: [
    {
      claimId: "fixture.stale-command",
      anchor: newAnchor,
      reason: "The stale fixture README uses the reviewed-result wording."
    }
  ],
  needsReview: []
}, null, 2)}\n`);
