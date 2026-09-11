// @vitest-environment node

import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { validateSuccessorReleaseContract } from "../../../../../scripts/lib/supabase-successor-release-contract.mjs";
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
  fixtureRoot = await mkdtemp(join(tmpdir(), "budget-production-build-"));
  for (const folder of ["supabase/migrations", "supabase/release-contracts", "supabase/release-manifests", "supabase/release-checks"]) {
    await cp(join(repoRoot, folder), join(fixtureRoot, folder), { recursive: true });
  }
  const base = z.object({ implementation: z.record(z.string(), z.object({ file: z.string() })) }).parse(
    JSON.parse(await readFile(join(repoRoot, "supabase/release-contracts/current-baseline-rollout-v1.json"), "utf8")),
  );
  for (const pin of Object.values(base.implementation)) {
    const target = join(fixtureRoot, pin.file);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(repoRoot, pin.file), target);
  }
});

afterAll(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true });
});

describe("production build explicitly registers the pinned budget followup", () => {
  it("accepts the actual checkout in production only with the exact owner authorization", () => {
    expect(() => production(repoRoot)).not.toThrow();
  });

  it("retains default drift rejection while the explicit static followup succeeds", () => {
    expect(() => validateSuccessorReleaseContract({ repoRoot }))
      .toThrowError(expect.objectContaining({ code: "MIGRATION_SET_DRIFT" }));
    const result = validateSuccessorReleaseContract({ repoRoot, followup });
    expect(result.migrationCount).toBe(111);
    expect(result.deploymentBlocked).toBe(true);
    expect(result.controllerReady).toBe(false);
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
