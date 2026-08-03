import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const auditPath = fileURLToPath(
  new URL("../audit/production-readiness-audit.mjs", import.meta.url),
);
const auditSource = readFileSync(auditPath, "utf8");

test("production audit exits non-zero whenever a required check fails", () => {
  assert.match(
    auditSource,
    /if \(failed\.length\) \{[\s\S]*?process\.exitCode\s*=\s*1;[\s\S]*?\}/,
  );
});
