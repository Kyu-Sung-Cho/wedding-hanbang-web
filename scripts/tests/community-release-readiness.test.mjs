import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditCommunityRelease } from "../audit/community-release-readiness.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

test("the repository satisfies the local community release contract", () => {
  const result = auditCommunityRelease(repoRoot);
  const failed = result.checks.filter((item) => !item.pass);

  assert.deepEqual(failed, []);
  assert.equal(result.localContractReady, true);
  assert.equal(result.productionGo, false);
  assert.ok(result.blockers.length >= 6);
});

test("missing repository evidence fails closed", () => {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "community-release-"));
  try {
    const result = auditCommunityRelease(fixtureRoot);
    assert.equal(result.localContractReady, false);
    assert.equal(result.productionGo, false);
    assert.ok(result.checks.some((item) => !item.pass));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
