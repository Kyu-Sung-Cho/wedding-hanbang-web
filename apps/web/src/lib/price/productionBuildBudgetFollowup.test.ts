// @vitest-environment node

import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { validateSuccessorReleaseContract } from "../../../../../scripts/lib/supabase-successor-release-contract.mjs";
import { createBudgetDecisionHistoricalRepository } from "../../../../../scripts/tests/fixtures/budget-decision-historical-repository.mjs";
import {
  assertVendorDisclosureProductionBuild,
  expectedProductionAuthorizationSha256,
  VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID,
  VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED,
  VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID,
} from "../../../vendorDisclosureProductionBuildFence";

const repoRoot = resolve(import.meta.dirname, "../../../../..");
const followup = "amora-budget-decision-hotfix";
const budgetContract = "supabase/release-contracts/amora-budget-decision-hotfix-v1.json";
const budgetSql = "supabase/migrations/20260910160514_amora_shared_budget_decision_receipts.sql";
const vendorManifest = "supabase/release-manifests/vendor-disclosure-v2-20260718.json";
let fixtureRoot: string;
let cleanupFixture: (() => void) | undefined;

function production(root: string, authorization = expectedProductionAuthorizationSha256(root)) {
  return assertVendorDisclosureProductionBuild({
    repoRoot: root,
    environment: {
      VERCEL_ENV: "production",
      VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION: authorization,
    },
  });
}

beforeAll(async () => {
  // 과거 M3 허용 범위는 고정 M4 원문으로 검증한다. 새 SQL을 빼서 과거
  // checkout처럼 꾸미거나 구 loader의 허용 범위를 넓히지 않는다.
  const historical = createBudgetDecisionHistoricalRepository(repoRoot);
  fixtureRoot = historical.root;
  cleanupFixture = historical.cleanup;
});

afterAll(async () => {
  cleanupFixture?.();
});

describe("production build explicitly registers the pinned budget followup", () => {
  it("accepts the actual checkout in production only with the exact owner authorization", () => {
    expect(() => production(repoRoot)).not.toThrow();
  });

  it("retains default drift rejection while the explicit static followup succeeds", () => {
    expect(() => validateSuccessorReleaseContract({ repoRoot }))
      .toThrowError(expect.objectContaining({ code: "MIGRATION_SET_DRIFT" }));
    const result = validateSuccessorReleaseContract({ repoRoot: fixtureRoot, followup });
    expect(result.migrationCount).toBe(111);
    expect(result.deploymentBlocked).toBe(true);
    expect(result.controllerReady).toBe(false);
  });

  it("does not admit the new explicit-budget SQL through the previous followup", () => {
    expect(() => validateSuccessorReleaseContract({ repoRoot, followup }))
      .toThrowError(expect.objectContaining({ code: "FOLLOWUP_RELEASE_INVALID" }));
    expect(() => production(fixtureRoot)).not.toThrow();
  });

  it.each([
    [undefined, VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED],
    ["0".repeat(64), VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID],
  ])("still rejects absent or wrong owner authorization (%s)", (authorization, code) => {
    expect(() => assertVendorDisclosureProductionBuild({
      repoRoot,
      environment: { VERCEL_ENV: "production", VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION: authorization },
    })).toThrow(code);
  });

  it("rejects unknown followup modes instead of treating them as a generic allowlist", () => {
    expect(() => validateSuccessorReleaseContract({ repoRoot, followup: "unreviewed" }))
      .toThrowError(expect.objectContaining({ code: "FOLLOWUP_RELEASE_INVALID" }));
  });

  it.each([
    budgetSql,
    budgetContract,
    "supabase/migrations/20260907085111_amora_budget_plan_named_allocations.sql",
    "supabase/release-contracts/amora-named-budget-hotfix-v1.json",
    "supabase/release-manifests/amora-engine-v2-20260716.json",
    "scripts/lib/current-baseline-release-contract.mjs",
  ])("rejects source or predecessor byte changes: %s", async (file) => {
    const target = join(fixtureRoot, file);
    const original = await readFile(target);
    try {
      await writeFile(target, Buffer.concat([original, Buffer.from("\n")]));
      expect(() => production(fixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
    } finally {
      await writeFile(target, original);
    }
  });

  it.each(["20260911120000_unreviewed.sql", "20260101000000_unreviewed.sql", "unexpected.sql"])(
    "rejects additional SQL anywhere in the directory: %s", async (name) => {
      const target = join(fixtureRoot, "supabase/migrations", name);
      try {
        await writeFile(target, "SELECT 1;\n", { flag: "wx" });
        expect(() => production(fixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
      } finally {
        await rm(target);
      }
    },
  );

  it("cannot fall back to acceptance by removing the budget contract", async () => {
    const target = join(fixtureRoot, budgetContract);
    const original = await readFile(target);
    try {
      await rm(target);
      expect(() => production(fixtureRoot)).toThrow(/MIGRATION_SET_DRIFT/);
    } finally {
      await writeFile(target, original);
    }
  });

  it("preserves vendor migration order and manifest authorization even after a valid followup", async () => {
    const target = join(fixtureRoot, vendorManifest);
    const original = await readFile(target, "utf8");
    const manifest = z.object({ expandMigrations: z.array(z.unknown()) }).passthrough().parse(JSON.parse(original));
    try {
      await writeFile(target, JSON.stringify({ ...manifest, expandMigrations: [...manifest.expandMigrations].reverse() }));
      expect(() => production(fixtureRoot)).toThrow(/MIGRATION_ORDER_INVALID/);
      await writeFile(target, `${original}\n`);
      expect(() => production(fixtureRoot, expectedProductionAuthorizationSha256(repoRoot)))
        .toThrow(VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID);
    } finally {
      await writeFile(target, original);
    }
  });
});
