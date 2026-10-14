// @vitest-environment node
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDeletionAuditHistoricalRepository } from "../../../../../scripts/tests/fixtures/account-deletion-audit-historical-repository.mjs";
import { createAmoraActionViewV2HistoricalRepository } from "../../../../../scripts/tests/fixtures/amora-action-view-v2-history-repository.mjs";
import { AMORA_VIEW_V2_CONTRACT_FILE, loadAmoraActionViewV2Plan } from "../../../../../scripts/lib/amora-action-view-v2-release-contract.mjs";
import { validateAmoraWriterRetirementBuildContract } from "../../../../../scripts/lib/amora-action-writer-retirement-build-contract.mjs";
import { AMORA_WRITER_RETIREMENT_FILE } from "../../../../../scripts/lib/amora-action-writer-retirement-bundle.mjs";
import { STATIC_PREDECESSOR_PIN } from "../../../../../scripts/lib/amora-action-writer-retirement-release-contract.mjs";
import { createAmoraWriterRetirementSourceRepository } from "../../../../../scripts/tests/fixtures/amora-action-writer-retirement-source-repository.mjs";
import { loadDeletionAuditNullabilityReleasePlan } from "../../../../../scripts/lib/account-deletion-audit-nullability-release-contract.mjs";
import { validateSuccessorReleaseContract } from "../../../../../scripts/lib/supabase-successor-release-contract.mjs";
import { assertVendorDisclosureProductionBuild, expectedProductionAuthorizationSha256,
  VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID, VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED,
  VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID } from "../../../vendorDisclosureProductionBuildFence";

const sourceRoot = resolve(import.meta.dirname, "../../../../..");
let fixture: ReturnType<typeof createDeletionAuditHistoricalRepository>;
let source241Fixture: ReturnType<typeof createAmoraActionViewV2HistoricalRepository>;
let source242Fixture: ReturnType<typeof createAmoraWriterRetirementSourceRepository>;
const pins = [AMORA_VIEW_V2_CONTRACT_FILE,
  "supabase/migrations/20261012002000_amora_action_view_v2.sql",
  "supabase/release-candidates/amora-action-view-v2/patch_own_amora_action_view_v2.sql",
  "supabase/release-contracts/amora-action-view-v2-pg17-catalog-v1.json",
  "scripts/lib/account-deletion-audit-nullability-release-contract.mjs"];
const production = (root: string, authorization = expectedProductionAuthorizationSha256(root)) =>
  assertVendorDisclosureProductionBuild({ repoRoot: root,
    environment: { VERCEL_ENV: "production", VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION: authorization } });

beforeAll(() => {
  // 고정 dfdd 241의 원문 fixture다. 현재 242에서 SQL을 제외해 운영 검증을 우회하지 않는다.
  source241Fixture = createAmoraActionViewV2HistoricalRepository(sourceRoot);
  source242Fixture = createAmoraWriterRetirementSourceRepository();
  for (const file of ["vendor-disclosure-v2-20260718.json", "amora-engine-v2-20260716.json", "amora-openai-20260714.json"]) {
    const relativePath = `supabase/release-manifests/${file}`;
    mkdirSync(dirname(join(source242Fixture.root, relativePath)), { recursive: true });
    copyFileSync(join(sourceRoot, relativePath), join(source242Fixture.root, relativePath));
  }
  fixture = createDeletionAuditHistoricalRepository(sourceRoot);
  for (const file of pins) {
    mkdirSync(dirname(join(fixture.root, file)), { recursive: true });
    copyFileSync(join(sourceRoot, file), join(fixture.root, file));
  }
}, 60_000);
afterAll(() => { fixture?.cleanup(); source241Fixture?.cleanup(); source242Fixture?.close(); });

describe("exact 241 additive v2 production-build registration, not DB release authorization", () => {
  it("validates fixed dfdd source241 via the unique shared followup and preserves independent runtime gates", () => {
    const repoRoot = source241Fixture.root;
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
    expect(() => assertVendorDisclosureProductionBuild({ repoRoot: source241Fixture.root,
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

  it("does not authorize current242 through the old loader and uses the independent strict build contract", () => {
    expect(() => loadAmoraActionViewV2Plan(sourceRoot))
      .toThrowError(expect.objectContaining({ code: "AMORA_VIEW_V2_NEW_MIGRATION_NOT_REVIEWED" }));
    const current = validateAmoraWriterRetirementBuildContract({ repoRoot: sourceRoot });
    expect(current.migrationCount).toBe(242);
    expect(current.controllerReady).toBe(false);
    expect(current.deploymentBlocked).toBe(true);
    expect(current.releaseAuthorized).toBe(false);
    expect(() => production(sourceRoot)).not.toThrow();
  }, 120_000);

  it.each([STATIC_PREDECESSOR_PIN.file, `supabase/migrations/${AMORA_WRITER_RETIREMENT_FILE}`])(
    "requires the newest contract when either registration marker remains, without old fallback: %s", file => {
      const repoRoot = source242Fixture.root, path = join(repoRoot, file), bytes = readFileSync(path);
      try {
        rmSync(path);
        // formal SQL이 없으면 구 241은 실제로 유효하다. 그래도 남은 새 계약 표식을 무시해 fallback하면 안 된다.
        if (file.endsWith(".sql")) {
          expect(() => validateSuccessorReleaseContract({ repoRoot, followup: "amora-action-view-v2" })).not.toThrow();
        }
        expect(() => production(repoRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
      } finally { writeFileSync(path, bytes); }
    }, 120_000,
  );
});
