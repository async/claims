#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const path = "fixtures/stale/tests/claims.json";
const oldAnchor = "The stale example command returns an old result.";
const newAnchor = "The stale example command returns a reviewed result.";
const oldText = await readFile(path, "utf8");
const newText = oldText.replace(oldAnchor, newAnchor);

if (oldText === newText) {
  process.stderr.write("mock repair could not find the stale anchor\n");
  process.exit(1);
}

process.stdout.write(unifiedDiff(path, oldText, newText));

function unifiedDiff(filePath, before, after) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const index = beforeLines.findIndex((line, lineIndex) => line !== afterLines[lineIndex]);
  const start = Math.max(0, index - 2);
  const end = Math.min(beforeLines.length - 1, index + 3);
  const hunk = [];
  for (let lineIndex = start; lineIndex <= end; lineIndex += 1) {
    if (lineIndex === index) {
      hunk.push(`-${beforeLines[lineIndex]}`);
      hunk.push(`+${afterLines[lineIndex]}`);
    } else {
      hunk.push(` ${beforeLines[lineIndex]}`);
    }
  }
  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${start + 1},${end - start + 1} +${start + 1},${end - start + 1} @@`,
    ...hunk,
    ""
  ].join("\n");
}
