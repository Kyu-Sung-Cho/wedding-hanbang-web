// @vitest-environment node
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDeletionAuditHistoricalRepository } from "../../../../../scripts/tests/fixtures/account-deletion-audit-historical-repository.mjs";
import { AMORA_VIEW_V2_CONTRACT_FILE, loadAmoraActionViewV2Plan } from "../../../../../scripts/lib/amora-action-view-v2-release-contract.mjs";
import { loadDeletionAuditNullabilityReleasePlan } from "../../../../../scripts/lib/account-deletion-audit-nullability-release-contract.mjs";
import { validateSuccessorReleaseContract } from "../../../../../scripts/lib/supabase-successor-release-contract.mjs";
import { assertVendorDisclosureProductionBuild, expectedProductionAuthorizationSha256,
  VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID, VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED,
  VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID } from "../../../vendorDisclosureProductionBuildFence";

const repoRoot = resolve(import.meta.dirname, "../../../../..");
let fixture: ReturnType<typeof createDeletionAuditHistoricalRepository>;
const pins = [AMORA_VIEW_V2_CONTRACT_FILE,
  "supabase/migrations/20261012002000_amora_action_view_v2.sql",
  "supabase/release-candidates/amora-action-view-v2/patch_own_amora_action_view_v2.sql",
  "supabase/release-contracts/amora-action-view-v2-pg17-catalog-v1.json",
  "scripts/lib/account-deletion-audit-nullability-release-contract.mjs"];
const production = (root: string, authorization = expectedProductionAuthorizationSha256(root)) =>
  assertVendorDisclosureProductionBuild({ repoRoot: root,
    environment: { VERCEL_ENV: "production", VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION: authorization } });

beforeAll(() => {
  fixture = createDeletionAuditHistoricalRepository(repoRoot);
  for (const file of pins) {
    mkdirSync(dirname(join(fixture.root, file)), { recursive: true });
    copyFileSync(join(repoRoot, file), join(fixture.root, file));
  }
}, 60_000);
afterAll(() => fixture?.cleanup());

describe("exact 241 additive v2 production-build registration, not DB release authorization", () => {
  it("validates the actual source241 via the unique shared followup and preserves independent runtime gates", () => {
    const plan = loadAmoraActionViewV2Plan(repoRoot);
    expect(plan.migrationCount).toBe(241);
    expect(plan.expectedLedger).toHaveLength(229);
    expect(plan.runtimeEvidenceVerified).toBe(false);
    expect(plan.productionApplyImplemented).toBe(false);
    expect(plan.releaseAuthorized).toBe(false);
    const shared = validateSuccessorReleaseContract({ repoRoot, followup: "amora-action-view-v2" });
    expect(shared.controllerReady).toBe(false);
    expect(shared.deploymentBlocked).toBe(true);
    expect(() => production(repoRoot)).not.toThrow();
    expect(() => loadDeletionAuditNullabilityReleasePlan(repoRoot))
      .toThrowError(expect.objectContaining({ code: "NEW_MIGRATION_NOT_REVIEWED" }));
  }, 120_000);

  it.each([undefined, "0".repeat(64)])("keeps exact owner manifest authorization mandatory (%s)", authorization => {
    expect(() => assertVendorDisclosureProductionBuild({ repoRoot,
      environment: { VERCEL_ENV: "production", VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION: authorization } }))
      .toThrow(authorization === undefined ? VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED
        : VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID);
  }, 120_000);

  it.each(pins)("refuses changed/missing newest or predecessor bytes without historical fallback: %s", file => {
    const path = join(fixture.root, file), bytes = readFileSync(path);
    try {
      writeFileSync(path, Buffer.concat([bytes, Buffer.from("\n")]));
      expect(() => production(fixture.root)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
      rmSync(path);
      expect(() => production(fixture.root)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
    } finally { writeFileSync(path, bytes); }
  }, 120_000);

  it.each(["20990101000000_unreviewed.sql", "20260101000000_unreviewed.sql", "unexpected.sql"])(
    "refuses an additional SQL file anywhere: %s", file => {
      const path = join(fixture.root, "supabase/migrations", file);
      try {
        writeFileSync(path, "SELECT 1;\n", { flag: "wx" });
        expect(() => production(fixture.root)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
      } finally { rmSync(path); }
    }, 120_000,
  );
});
