// @vitest-environment node
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProfileAvatarHistoricalRepository } from "../../../../../scripts/tests/fixtures/profile-avatar-historical-repository.mjs";
import { CUSTOMER_DATA_CONTRACT_FILE, loadCustomerDataReleasePlan } from "../../../../../scripts/lib/account-deletion-customer-data-release-contract.mjs";
import { validateSuccessorReleaseContract } from "../../../../../scripts/lib/supabase-successor-release-contract.mjs";
import { assertVendorDisclosureProductionBuild, expectedProductionAuthorizationSha256,
  VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID, VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID,
  VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED } from "../../../vendorDisclosureProductionBuildFence";

const repoRoot = resolve(import.meta.dirname, "../../../../..");
let fixture: ReturnType<typeof createProfileAvatarHistoricalRepository>;
const pins = [CUSTOMER_DATA_CONTRACT_FILE, "scripts/lib/account-deletion-customer-data-release.mjs",
  "scripts/lib/account-deletion-customer-data-catalog.mjs", "supabase/release-contracts/account-deletion-customer-data-pg17-catalog-v1.json",
  "supabase/migrations/20260913103407_account_deletion_customer_data_boundary.sql"];
const production = (root: string, authorization = expectedProductionAuthorizationSha256(root)) => assertVendorDisclosureProductionBuild({
  repoRoot: root, environment: { VERCEL_ENV: "production", VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION: authorization },
});

beforeAll(() => {
  fixture = createProfileAvatarHistoricalRepository(repoRoot);
  for (const file of pins) { mkdirSync(dirname(join(fixture.root, file)), { recursive: true }); copyFileSync(join(repoRoot, file), join(fixture.root, file)); }
});
afterAll(() => fixture?.cleanup());

describe("production accepts only the explicit 232 expand successor", () => {
  // 실제 checkout 에는 이후 검토된 233번째 SQL(20260915101500)이 있어 232 공개 모드가 거절하는 것이
  // 맞다. checkout 의 production 허용은 productionBuildBudgetFollowup.test.ts 의 233 후속 계약이 잰다.
  // 여기서는 232 역사 checkout 이 여전히 자기 후속 계약으로만 통과하는지를 본다.
  it("validates the historical 232 fixture without treating static success as runtime or full-restore proof", () => {
    expect(() => loadCustomerDataReleasePlan(repoRoot)).toThrowError(expect.objectContaining({ code: "NEW_MIGRATION_NOT_REVIEWED" }));
    const root = fixture.root;
    const plan = loadCustomerDataReleasePlan(root);
    expect(plan.migrationCount).toBe(232); expect(plan.runtimeEvidenceVerified).toBe(false); expect(plan.releaseAuthorized).toBe(false);
    expect(() => production(root)).not.toThrow();
    expect(() => validateSuccessorReleaseContract({ repoRoot: root, followup: "profile-avatar" })).toThrowError(expect.objectContaining({ code: "FOLLOWUP_RELEASE_INVALID" }));
  });
  it.each(pins)("cannot fall back when a registered artifact is missing or changed: %s", file => {
    const path = join(fixture.root, file), bytes = readFileSync(path);
    try {
      writeFileSync(path, Buffer.concat([bytes, Buffer.from("\n")]));
      expect(() => production(fixture.root)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
      rmSync(path); expect(() => production(fixture.root)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
    } finally { writeFileSync(path, bytes); }
  });
  it.each([undefined, "0".repeat(64)])("still requires the exact owner's production authorization: %s", authorization => {
    expect(() => assertVendorDisclosureProductionBuild({ repoRoot, environment: { VERCEL_ENV: "production", VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION: authorization } }))
      .toThrow(authorization === undefined ? VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED : VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID);
  });
});
