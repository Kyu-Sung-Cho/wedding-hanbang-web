// @vitest-environment node

import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { validateSuccessorReleaseContract } from "../../../../../scripts/lib/supabase-successor-release-contract.mjs";
import { createBudgetDecisionHistoricalRepository } from "../../../../../scripts/tests/fixtures/budget-decision-historical-repository.mjs";
import { createExplicitBudgetHistoricalRepository } from "../../../../../scripts/tests/fixtures/explicit-budget-historical-repository.mjs";
import { CHAT_FEEDBACK_CONTRACT_FILE, loadChatFeedbackNullabilityReleasePlan } from "../../../../../scripts/lib/chat-feedback-nullability-release-contract.mjs";
import { PROFILE_WEDDING_ROLES_CONTRACT_FILE, loadProfileWeddingRolesReleasePlan } from "../../../../../scripts/lib/profile-wedding-roles-release-contract.mjs";
import { createChatFeedbackHistoricalRepository } from "../../../../../scripts/tests/fixtures/chat-feedback-historical-repository.mjs";
import { createProfileRoleHistoricalRepository } from "../../../../../scripts/tests/fixtures/profile-role-historical-repository.mjs";
import { PROFILE_AVATAR_CONTRACT_FILE, loadProfileAvatarReleasePlan } from "../../../../../scripts/lib/profile-avatar-release-contract.mjs";
import { loadCustomerDataReleasePlan } from "../../../../../scripts/lib/account-deletion-customer-data-release-contract.mjs";
import { NOT_APPLICABLE_STATUS_CONTRACT_FILE, loadNotApplicableStatusReleasePlan } from "../../../../../scripts/lib/amora-not-applicable-status-release-contract.mjs";
import { createCustomerDataHistoricalRepository } from "../../../../../scripts/tests/fixtures/account-deletion-customer-data-historical-repository.mjs";
import { WEDDING_CODE_RESEARCH_CONTRACT_FILE, loadWeddingCodeResearchReleasePlan } from "../../../../../scripts/lib/wedding-code-research-contributions-release-contract.mjs";
import { createNotApplicableStatusHistoricalRepository } from "../../../../../scripts/tests/fixtures/amora-not-applicable-status-historical-repository.mjs";
import { WEDDING_CODE_SCENE_VERSION_CONTRACT_FILE, loadWeddingCodeSceneVersionReleasePlan } from "../../../../../scripts/lib/wedding-code-research-scene-v09-release-contract.mjs";
import { createWeddingCodeResearchHistoricalRepository } from "../../../../../scripts/tests/fixtures/wedding-code-research-contributions-historical-repository.mjs";
import { WEDDING_CODE_SCENE_V10_CONTRACT_FILE, loadWeddingCodeSceneV10ReleasePlan } from "../../../../../scripts/lib/wedding-code-research-scene-v10-release-contract.mjs";
import { createWeddingCodeSceneVersionHistoricalRepository } from "../../../../../scripts/tests/fixtures/wedding-code-research-scene-v09-historical-repository.mjs";
import { PREPARATION_STYLE_CONTRACT_FILE, loadPreparationStyleReleasePlan } from "../../../../../scripts/lib/preparation-style-release-contract.mjs";
import { createWeddingCodeSceneV10HistoricalRepository } from "../../../../../scripts/tests/fixtures/wedding-code-research-scene-v10-historical-repository.mjs";
import { WEDDING_CODE_PAIR_SESSION_CONTRACT_FILE, loadWeddingCodePairSessionReleasePlan } from "../../../../../scripts/lib/wedding-code-pair-session-release-contract.mjs";
import { WEDDING_CODE_PAIR_SESSION_CONFLICT_CONTRACT_FILE, loadWeddingCodePairSessionConflictReleasePlan } from "../../../../../scripts/lib/wedding-code-pair-session-conflict-release-contract.mjs";
import { createWeddingCodePairSessionHistoricalRepository } from "../../../../../scripts/tests/fixtures/wedding-code-pair-session-historical-repository.mjs";
import { createPreparationStyleHistoricalRepository } from "../../../../../scripts/tests/fixtures/preparation-style-historical-repository.mjs";
import {
  assertVendorDisclosureProductionBuild,
  expectedProductionAuthorizationSha256,
  VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID,
  VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED,
  VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID,
  PROVIDER_RELEASE_OPERATIONS_NOT_READY,
} from "../../../vendorDisclosureProductionBuildFence";

import { DELETION_AUDIT_CONTRACT_FILE, loadDeletionAuditNullabilityReleasePlan } from "../../../../../scripts/lib/account-deletion-audit-nullability-release-contract.mjs";
import { createWeddingCodePairSessionConflictHistoricalRepository } from "../../../../../scripts/tests/fixtures/wedding-code-pair-session-conflict-historical-repository.mjs";

const repoRoot = resolve(import.meta.dirname, "../../../../..");
const followup = "amora-budget-decision-hotfix";
const budgetContract = "supabase/release-contracts/amora-budget-decision-hotfix-v1.json";
const budgetSql = "supabase/migrations/20260910160514_amora_shared_budget_decision_receipts.sql";
const vendorManifest = "supabase/release-manifests/vendor-disclosure-v2-20260718.json";
let fixtureRoot: string;
let cleanupFixture: (() => void) | undefined;
let feedbackFixtureRoot: string;
let cleanupFeedbackFixture: (() => void) | undefined;
const feedbackPins = [CHAT_FEEDBACK_CONTRACT_FILE, "scripts/lib/chat-feedback-nullability-release.mjs",
  "supabase/migrations/20260913043211_chat_feedback_automatic_signal_nullable.sql"];
let roleFixtureRoot: string;
let cleanupRoleFixture: (() => void) | undefined;
const rolePins = [PROFILE_WEDDING_ROLES_CONTRACT_FILE, "scripts/lib/profile-wedding-roles-release.mjs",
  "scripts/lib/profile-wedding-roles-catalog.mjs", "supabase/migrations/20260913075045_profile_wedding_roles.sql"];
let avatarFixtureRoot: string;
let cleanupAvatarFixture: (() => void) | undefined;
const avatarPins = [PROFILE_AVATAR_CONTRACT_FILE, "scripts/lib/profile-avatar-release.mjs", "scripts/lib/profile-avatar-catalog.mjs",
  "supabase/release-contracts/profile-avatar-pg17-catalog-v1.json", "supabase/platform-operations/storage/profile-avatar-delivery-service-only.sql",
  "supabase/platform-operations/storage/profile-avatar-service-only.sql",
  "supabase/migrations/20260913082314_private_profile_avatars_delivery.sql"];
let customerDataFixtureRoot: string;
let cleanupCustomerDataFixture: (() => void) | undefined;
let notApplicableFixtureRoot: string;
let cleanupNotApplicableFixture: (() => void) | undefined;
const notApplicablePins = [NOT_APPLICABLE_STATUS_CONTRACT_FILE, "scripts/lib/amora-not-applicable-status-release.mjs",
  "supabase/migrations/20260915101500_amora_atomic_not_applicable_status.sql"];
let researchFixtureRoot: string;
let cleanupResearchFixture: (() => void) | undefined;
const researchPins = [WEDDING_CODE_RESEARCH_CONTRACT_FILE, "scripts/lib/wedding-code-research-contributions-release.mjs",
  "supabase/migrations/20260915130000_wedding_code_research_contributions.sql"];
let sceneFixtureRoot: string;
let cleanupSceneFixture: (() => void) | undefined;
const scenePins = [WEDDING_CODE_SCENE_VERSION_CONTRACT_FILE, "scripts/lib/wedding-code-research-scene-v09-release.mjs",
  "supabase/migrations/20260917090000_wedding_code_research_scene_v09.sql"];
let sceneV10FixtureRoot: string;
let cleanupSceneV10Fixture: (() => void) | undefined;
const sceneV10Pins = [WEDDING_CODE_SCENE_V10_CONTRACT_FILE, "scripts/lib/wedding-code-research-scene-v10-release.mjs",
  "supabase/migrations/20260918090000_wedding_code_research_scene_v10.sql"];

let preparationFixtureRoot: string;
let cleanupPreparationFixture: (() => void) | undefined;
const preparationPins = [PREPARATION_STYLE_CONTRACT_FILE, "scripts/lib/preparation-style-release.mjs",
  "scripts/lib/preparation-style-catalog.mjs", "supabase/release-contracts/preparation-style-pg17-catalog-v1.json",
  "supabase/migrations/20260920120000_wedding_preparation_style.sql"];
let pairSessionFixtureRoot: string;
let cleanupPairSessionFixture: (() => void) | undefined;
const pairSessionPins = [WEDDING_CODE_PAIR_SESSION_CONTRACT_FILE, "scripts/lib/wedding-code-pair-session-release.mjs",
  "scripts/lib/wedding-code-pair-session-catalog.mjs", "supabase/release-contracts/wedding-code-pair-session-pg17-catalog-v1.json",
  "supabase/migrations/20260923104336_wedding_code_pair_sessions.sql"];

let pairConflictFixtureRoot: string;
let cleanupPairConflictFixture: (() => void) | undefined;
const pairConflictPins = [WEDDING_CODE_PAIR_SESSION_CONFLICT_CONTRACT_FILE, "scripts/lib/wedding-code-pair-session-conflict-release.mjs",
  "scripts/lib/wedding-code-pair-session-conflict-catalog.mjs", "supabase/release-contracts/wedding-code-pair-session-conflict-pg17-catalog-v1.json",
  "supabase/migrations/20260923132503_wedding_code_pair_session_conflict_response.sql"];

let auditFixtureRoot: string;
let cleanupAuditFixture: (() => void) | undefined;
const auditPins = [DELETION_AUDIT_CONTRACT_FILE, "scripts/lib/account-deletion-audit-nullability-release.mjs",
  "scripts/lib/wedding-code-pair-session-conflict-release-contract.mjs",
  "supabase/migrations/20260928073546_account_deletion_anonymous_audit.sql"];

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
  const feedbackHistory = createExplicitBudgetHistoricalRepository(repoRoot);
  feedbackFixtureRoot = feedbackHistory.root;
  cleanupFeedbackFixture = feedbackHistory.cleanup;
  for (const file of feedbackPins) {
    await copyFile(join(repoRoot, file), join(feedbackFixtureRoot, file));
  }
  const roleHistory = createChatFeedbackHistoricalRepository(repoRoot);
  roleFixtureRoot = roleHistory.root;
  cleanupRoleFixture = roleHistory.cleanup;
  for (const file of rolePins) await copyFile(join(repoRoot, file), join(roleFixtureRoot, file));
  const avatarHistory = createProfileRoleHistoricalRepository(repoRoot);
  avatarFixtureRoot = avatarHistory.root;
  cleanupAvatarFixture = avatarHistory.cleanup;
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(avatarFixtureRoot, "supabase/platform-operations/storage"), {recursive: true});
  for (const file of avatarPins) await copyFile(join(repoRoot, file), join(avatarFixtureRoot, file));
  const customerDataHistory = createCustomerDataHistoricalRepository(repoRoot);
  customerDataFixtureRoot = customerDataHistory.root;
  cleanupCustomerDataFixture = customerDataHistory.cleanup;
  const notApplicableHistory = createCustomerDataHistoricalRepository(repoRoot);
  notApplicableFixtureRoot = notApplicableHistory.root;
  cleanupNotApplicableFixture = notApplicableHistory.cleanup;
  for (const file of notApplicablePins) await copyFile(join(repoRoot, file), join(notApplicableFixtureRoot, file));
  const researchHistory = createNotApplicableStatusHistoricalRepository(repoRoot);
  researchFixtureRoot = researchHistory.root;
  cleanupResearchFixture = researchHistory.cleanup;
  for (const file of researchPins) await copyFile(join(repoRoot, file), join(researchFixtureRoot, file));
  const sceneHistory = createWeddingCodeResearchHistoricalRepository(repoRoot);
  sceneFixtureRoot = sceneHistory.root;
  cleanupSceneFixture = sceneHistory.cleanup;
  for (const file of scenePins) await copyFile(join(repoRoot, file), join(sceneFixtureRoot, file));
  const sceneV10History = createWeddingCodeSceneVersionHistoricalRepository(repoRoot);
  sceneV10FixtureRoot = sceneV10History.root;
  cleanupSceneV10Fixture = sceneV10History.cleanup;
  for (const file of sceneV10Pins) await copyFile(join(repoRoot, file), join(sceneV10FixtureRoot, file));
  const preparationHistory = createWeddingCodeSceneV10HistoricalRepository(repoRoot);
  preparationFixtureRoot = preparationHistory.root;
  cleanupPreparationFixture = preparationHistory.cleanup;
  for (const file of preparationPins) await copyFile(join(repoRoot, file), join(preparationFixtureRoot, file));
  const pairSessionHistory = createPreparationStyleHistoricalRepository(repoRoot);
  pairSessionFixtureRoot = pairSessionHistory.root;
  cleanupPairSessionFixture = pairSessionHistory.cleanup;
  for (const file of pairSessionPins) await copyFile(join(repoRoot, file), join(pairSessionFixtureRoot, file));
  const pairConflictHistory = createWeddingCodePairSessionHistoricalRepository(repoRoot);
  pairConflictFixtureRoot = pairConflictHistory.root;
  cleanupPairConflictFixture = pairConflictHistory.cleanup;
  for (const file of pairConflictPins) await copyFile(join(repoRoot, file), join(pairConflictFixtureRoot, file));
  const auditHistory = createWeddingCodePairSessionConflictHistoricalRepository(repoRoot);
  auditFixtureRoot = auditHistory.root;
  cleanupAuditFixture = auditHistory.cleanup;
  for (const file of auditPins) await copyFile(join(repoRoot, file), join(auditFixtureRoot, file));
}, 300_000);

afterAll(async () => {
  cleanupFixture?.();
  cleanupFeedbackFixture?.();
  cleanupRoleFixture?.();
  cleanupAvatarFixture?.();
  cleanupCustomerDataFixture?.();
  cleanupNotApplicableFixture?.();
  cleanupResearchFixture?.();
  cleanupSceneFixture?.();
  cleanupSceneV10Fixture?.();
  cleanupPreparationFixture?.();
  cleanupPairSessionFixture?.();
  cleanupPairConflictFixture?.();
  cleanupAuditFixture?.();
});

describe("production build registers only the exact 240 deletion audit nullable successor", () => {
  describe("reviewed 240 acceptance and authorization", () => {
    const repositories = [
      { label: "isolated fixture", resolveRoot: () => auditFixtureRoot },
    ];

    it.each(repositories)("preserves independent hosted evidence for $label", ({ resolveRoot }) => {
      const plan = loadDeletionAuditNullabilityReleasePlan(resolveRoot());
      expect(plan.migrationCount).toBe(240);
      expect(plan.runtimeEvidenceVerified).toBe(false);
      expect(plan.releaseAuthorized).toBe(false);
    }, 120_000);

    it.each(repositories)("allows an owner-authorized production build for $label", ({ resolveRoot }) => {
      expect(() => production(resolveRoot())).not.toThrow();
    }, 120_000);

    it.each(repositories)("keeps the public 239 loader closed to 240 SQL for $label", ({ resolveRoot }) => {
      expect(() => loadWeddingCodePairSessionConflictReleasePlan(resolveRoot()))
        .toThrowError(expect.objectContaining({ code: "NEW_MIGRATION_NOT_REVIEWED" }));
    }, 120_000);

    it.each(repositories)("rejects an incorrect owner authorization for $label", ({ resolveRoot }) => {
      expect(() => production(resolveRoot(), "wrong")).toThrow(VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID);
    }, 120_000);

    it.each(repositories)("requires an explicit owner authorization for $label", ({ resolveRoot }) => {
      expect(() => assertVendorDisclosureProductionBuild({ repoRoot: resolveRoot(), environment: { VERCEL_ENV: "production" } }))
        .toThrow(VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED);
    }, 120_000);
  });
  describe("current provider checkout remains outside the reviewed 240 release", () => {
    it("rejects the current migration set in both current and predecessor loaders", () => {
      for (const load of [loadDeletionAuditNullabilityReleasePlan, loadWeddingCodePairSessionConflictReleasePlan]) {
        expect(() => load(repoRoot)).toThrowError(expect.objectContaining({ code: "NEW_MIGRATION_NOT_REVIEWED" }));
      }
    }, 120_000);

    it.each([undefined, "0".repeat(64), "exact-existing-signature"])(
      "requires provider operational evidence before authorization (%s)", (authorization) => {
        // 제공자 SQL은 별도 계약으로 검사하되 기존 서명으로 운영 게이트를 열지 않는다.
        const value = authorization === "exact-existing-signature"
          ? expectedProductionAuthorizationSha256(repoRoot) : authorization;
        expect(() => assertVendorDisclosureProductionBuild({
          repoRoot,
          environment: { VERCEL_ENV: "production", VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION: value },
        })).toThrowError(expect.objectContaining({ code: PROVIDER_RELEASE_OPERATIONS_NOT_READY }));
      }, 120_000,
    );
  });
  it.each([...auditPins, ...pairSessionPins, PREPARATION_STYLE_CONTRACT_FILE])(
    "rejects changed or missing 240 and predecessor pins without falling back: %s", async file => {
      const target = join(auditFixtureRoot, file), bytes = await readFile(target);
      try {
        await writeFile(target, Buffer.concat([bytes, Buffer.from("\n")]));
        expect(() => production(auditFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
        await rm(target);
        expect(() => production(auditFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
      } finally { await writeFile(target, bytes); }
    }, 60_000,
  );
  it("does not admit unreviewed SQL beyond the exact 240 migration set", async () => {
    const target = join(auditFixtureRoot, "supabase/migrations/20990101000000_unreviewed.sql");
    try {
      await writeFile(target, "SELECT 1;\n", { flag: "wx" });
      expect(() => production(auditFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
    } finally { await rm(target); }
  }, 60_000);
});

describe("production build registers only the exact 239 pair-session conflict successor", () => {
  describe("reviewed 239 acceptance and authorization", () => {
    const repositories = [
      { label: "isolated fixture", resolveRoot: () => pairConflictFixtureRoot },
    ];

    it.each(repositories)("preserves independent hosted evidence for $label", ({ resolveRoot }) => {
      const plan = loadWeddingCodePairSessionConflictReleasePlan(resolveRoot());
      expect(plan.migrationCount).toBe(239);
      expect(plan.runtimeEvidenceVerified).toBe(false);
      expect(plan.releaseAuthorized).toBe(false);
    }, 120_000);

    it.each(repositories)("allows an owner-authorized production build for $label", ({ resolveRoot }) => {
      expect(() => production(resolveRoot())).not.toThrow();
    }, 120_000);

    it.each(repositories)("keeps the public 238 loader closed to 239 SQL for $label", ({ resolveRoot }) => {
      expect(() => loadWeddingCodePairSessionReleasePlan(resolveRoot()))
        .toThrowError(expect.objectContaining({ code: "NEW_MIGRATION_NOT_REVIEWED" }));
    }, 120_000);

    it.each(repositories)("rejects an incorrect owner authorization for $label", ({ resolveRoot }) => {
      expect(() => production(resolveRoot(), "wrong")).toThrow(VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID);
    }, 120_000);

    it.each(repositories)("requires an explicit owner authorization for $label", ({ resolveRoot }) => {
      expect(() => assertVendorDisclosureProductionBuild({ repoRoot: resolveRoot(), environment: { VERCEL_ENV: "production" } }))
        .toThrow(VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED);
    }, 120_000);
  });
  it.each([...pairConflictPins, ...pairSessionPins, PREPARATION_STYLE_CONTRACT_FILE])(
    "rejects changed or missing 239 and predecessor pins without falling back: %s", async file => {
      const target = join(pairConflictFixtureRoot, file), bytes = await readFile(target);
      try {
        await writeFile(target, Buffer.concat([bytes, Buffer.from("\n")]));
        expect(() => production(pairConflictFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
        await rm(target);
        expect(() => production(pairConflictFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
      } finally { await writeFile(target, bytes); }
    }, 60_000,
  );
  it("does not admit unreviewed SQL beyond the exact 239 migration set", async () => {
    const target = join(pairConflictFixtureRoot, "supabase/migrations/20990101000000_unreviewed.sql");
    try {
      await writeFile(target, "SELECT 1;\n", { flag: "wx" });
      expect(() => production(pairConflictFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
    } finally { await rm(target); }
  });
});

describe("production build registers only the exact 238 pair-session successor", () => {
  describe("reviewed 238 acceptance and authorization", () => {
    const repositories = [
      { label: "isolated fixture", resolveRoot: () => pairSessionFixtureRoot },
    ];

    it.each(repositories)("preserves independent hosted evidence for $label", ({ resolveRoot }) => {
      const plan = loadWeddingCodePairSessionReleasePlan(resolveRoot());
      expect(plan.migrationCount).toBe(238);
      expect(plan.runtimeEvidenceVerified).toBe(false);
      expect(plan.releaseAuthorized).toBe(false);
    }, 120_000);

    it.each(repositories)("allows an owner-authorized production build for $label", ({ resolveRoot }) => {
      expect(() => production(resolveRoot())).not.toThrow();
    }, 120_000);

    it.each(repositories)("keeps the public 237 loader closed to 238 SQL for $label", ({ resolveRoot }) => {
      expect(() => loadPreparationStyleReleasePlan(resolveRoot()))
        .toThrowError(expect.objectContaining({ code: "NEW_MIGRATION_NOT_REVIEWED" }));
    }, 120_000);

    it.each(repositories)("rejects an incorrect owner authorization for $label", ({ resolveRoot }) => {
      expect(() => production(resolveRoot(), "wrong")).toThrow(VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID);
    }, 120_000);

    it.each(repositories)("requires an explicit owner authorization for $label", ({ resolveRoot }) => {
      expect(() => assertVendorDisclosureProductionBuild({ repoRoot: resolveRoot(), environment: { VERCEL_ENV: "production" } }))
        .toThrow(VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED);
    }, 120_000);
  });
  it.each([...pairSessionPins, PREPARATION_STYLE_CONTRACT_FILE, "supabase/migrations/20260920120000_wedding_preparation_style.sql"])(
    "rejects changed or missing 238 and predecessor pins without falling back: %s", async file => {
      const target = join(pairSessionFixtureRoot, file), bytes = await readFile(target);
      try {
        await writeFile(target, Buffer.concat([bytes, Buffer.from("\n")]));
        expect(() => production(pairSessionFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
        await rm(target);
        expect(() => production(pairSessionFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
      } finally { await writeFile(target, bytes); }
    }, 60_000,
  );
  it("does not admit unreviewed SQL beyond the exact 238 migration set", async () => {
    const target = join(pairSessionFixtureRoot, "supabase/migrations/20990101000000_unreviewed.sql");
    try {
      await writeFile(target, "SELECT 1;\n", { flag: "wx" });
      expect(() => production(pairSessionFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
    } finally { await rm(target); }
  });
});

describe("production build registers only the exact preparation-style successor after the 236 scene release", () => {
  it("accepts 237 reviewed SQL files while keeping hosted evidence and authorization independent", () => {
    for (const root of [preparationFixtureRoot]) {
      const plan = loadPreparationStyleReleasePlan(root);
      expect(plan.migrationCount).toBe(237);
      expect(plan.runtimeEvidenceVerified).toBe(false);
      expect(plan.releaseAuthorized).toBe(false);
      expect(() => production(root)).not.toThrow();
      expect(() => loadWeddingCodeSceneV10ReleasePlan(root)).toThrowError(expect.objectContaining({code: "NEW_MIGRATION_NOT_REVIEWED"}));
      expect(() => production(root, "wrong")).toThrow(VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID);
    }
  }, 120_000);
  it.each(preparationPins)("refuses changed or missing preparation-style artifacts without fallback: %s", async file => {
    const target = join(preparationFixtureRoot, file), bytes = await readFile(target);
    try {
      await writeFile(target, Buffer.concat([bytes, Buffer.from("\n")]));
      expect(() => production(preparationFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
      await rm(target);
      expect(() => production(preparationFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
    } finally {await writeFile(target, bytes);}
  }, 60_000);
});

describe("production build registers the exact WeddingCode scene v1.0 successor after the 235 scene v0.9 release", () => {
  it("accepts 236 exact SQL files only through the new successor, without claiming hosted application", () => {
    for (const root of [sceneV10FixtureRoot]) {
      const plan = loadWeddingCodeSceneV10ReleasePlan(root);
      expect(plan.migrationCount).toBe(236);
      expect(plan.runtimeEvidenceVerified).toBe(false);
      expect(plan.releaseAuthorized).toBe(false);
      expect(() => production(root)).not.toThrow();
      expect(() => validateSuccessorReleaseContract({repoRoot: root, followup: "wedding-code-research-scene-v09"}))
        .toThrowError(expect.objectContaining({code: "FOLLOWUP_RELEASE_INVALID"}));
    }
    expect(() => loadWeddingCodeSceneVersionReleasePlan(repoRoot)).toThrowError(expect.objectContaining({code: "NEW_MIGRATION_NOT_REVIEWED"}));
    expect(() => loadWeddingCodeResearchReleasePlan(repoRoot)).toThrowError(expect.objectContaining({code: "NEW_MIGRATION_NOT_REVIEWED"}));
  }, 120_000);
  it.each(sceneV10Pins)("refuses a changed or missing WeddingCode scene v1.0 artifact without fallback: %s", async file => {
    const target = join(sceneV10FixtureRoot, file), bytes = await readFile(target);
    try {
      await writeFile(target, Buffer.concat([bytes, Buffer.from("\n")]));
      expect(() => production(sceneV10FixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
      await rm(target);
      expect(() => production(sceneV10FixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
    } finally {await writeFile(target, bytes);}
  }, 60_000);
});

describe("production build registers the exact WeddingCode scene v0.9 successor after the 234 research contributions release", () => {
  // 실제 checkout 에는 이후 검토된 236번째 SQL(20260918090000)이 있어 235 공개 모드가 거절하는 것이 맞다.
  // checkout 의 production 허용은 위 236 후속 계약이 잰다. 여기서는 235 역사 checkout 이 자기 후속 계약으로만 통과하는지를 본다.
  it("accepts 235 exact SQL files only through the new successor, without claiming hosted application", () => {
    const root = sceneFixtureRoot;
    const plan = loadWeddingCodeSceneVersionReleasePlan(root);
    expect(plan.migrationCount).toBe(235);
    expect(plan.runtimeEvidenceVerified).toBe(false);
    expect(plan.releaseAuthorized).toBe(false);
    expect(() => production(root)).not.toThrow();
    expect(() => validateSuccessorReleaseContract({repoRoot: root, followup: "wedding-code-research-contributions"}))
      .toThrowError(expect.objectContaining({code: "FOLLOWUP_RELEASE_INVALID"}));
    expect(() => validateSuccessorReleaseContract({repoRoot: root, followup: "wedding-code-research-scene-v10"}))
      .toThrowError(expect.objectContaining({code: "FOLLOWUP_RELEASE_INVALID"}));
    expect(() => loadWeddingCodeResearchReleasePlan(repoRoot)).toThrowError(expect.objectContaining({code: "NEW_MIGRATION_NOT_REVIEWED"}));
    expect(() => loadWeddingCodeSceneVersionReleasePlan(repoRoot)).toThrowError(expect.objectContaining({code: "NEW_MIGRATION_NOT_REVIEWED"}));
  }, 120_000);
  it.each(scenePins)("refuses a changed or missing WeddingCode scene v0.9 artifact without fallback: %s", async file => {
    const target = join(sceneFixtureRoot, file), bytes = await readFile(target);
    try {
      await writeFile(target, Buffer.concat([bytes, Buffer.from("\n")]));
      expect(() => production(sceneFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
      await rm(target);
      expect(() => production(sceneFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
    } finally {await writeFile(target, bytes);}
  }, 60_000);
});

describe("production build registers the exact WeddingCode research contributions successor after the 233 not-applicable release", () => {
  // 실제 checkout 에는 이후 검토된 235번째 SQL(20260917090000)이 있어 234 공개 모드가 거절하는 것이 맞다.
  // checkout 의 production 허용은 위 최신(237) 후속 계약이 잰다. 여기서는 234 역사 checkout 이 자기 후속 계약으로만 통과하는지를 본다.
  it("accepts 234 exact SQL files only through the new successor, without claiming hosted application", () => {
    const root = researchFixtureRoot;
    const plan = loadWeddingCodeResearchReleasePlan(root);
    expect(plan.migrationCount).toBe(234);
    expect(plan.runtimeEvidenceVerified).toBe(false);
    expect(plan.releaseAuthorized).toBe(false);
    expect(() => production(root)).not.toThrow();
    expect(() => validateSuccessorReleaseContract({repoRoot: root, followup: "amora-not-applicable-status"}))
      .toThrowError(expect.objectContaining({code: "FOLLOWUP_RELEASE_INVALID"}));
    expect(() => validateSuccessorReleaseContract({repoRoot: root, followup: "wedding-code-research-scene-v09"}))
      .toThrowError(expect.objectContaining({code: "FOLLOWUP_RELEASE_INVALID"}));
    expect(() => loadNotApplicableStatusReleasePlan(repoRoot)).toThrowError(expect.objectContaining({code: "NEW_MIGRATION_NOT_REVIEWED"}));
    expect(() => loadWeddingCodeResearchReleasePlan(repoRoot)).toThrowError(expect.objectContaining({code: "NEW_MIGRATION_NOT_REVIEWED"}));
  }, 120_000);
  it.each(researchPins)("refuses a changed or missing WeddingCode research artifact without fallback: %s", async file => {
    const target = join(researchFixtureRoot, file), bytes = await readFile(target);
    try {
      await writeFile(target, Buffer.concat([bytes, Buffer.from("\n")]));
      expect(() => production(researchFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
      await rm(target);
      expect(() => production(researchFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
    } finally {await writeFile(target, bytes);}
  }, 60_000);
});

describe("production build registers the exact not-applicable status successor after the 232 customer-data release", () => {
  // 실제 checkout 에는 이후 검토된 234번째 SQL(20260915130000)이 있어 233 공개 모드가 거절하는 것이 맞다.
  // checkout 의 production 허용은 위 최신(237) 후속 계약이 잰다. 여기서는 233 역사 checkout 이 자기 후속 계약으로만 통과하는지를 본다.
  it("accepts 233 exact SQL files only through the new successor, without claiming hosted application", () => {
    const root = notApplicableFixtureRoot;
    const plan = loadNotApplicableStatusReleasePlan(root);
    expect(plan.migrationCount).toBe(233);
    expect(plan.runtimeEvidenceVerified).toBe(false);
    expect(plan.releaseAuthorized).toBe(false);
    expect(() => production(root)).not.toThrow();
    expect(() => validateSuccessorReleaseContract({repoRoot: root, followup: "account-deletion-customer-data"}))
      .toThrowError(expect.objectContaining({code: "FOLLOWUP_RELEASE_INVALID"}));
    expect(() => validateSuccessorReleaseContract({repoRoot: root, followup: "wedding-code-research-contributions"}))
      .toThrowError(expect.objectContaining({code: "FOLLOWUP_RELEASE_INVALID"}));
    expect(() => loadCustomerDataReleasePlan(repoRoot)).toThrowError(expect.objectContaining({code: "NEW_MIGRATION_NOT_REVIEWED"}));
    expect(() => loadNotApplicableStatusReleasePlan(repoRoot)).toThrowError(expect.objectContaining({code: "NEW_MIGRATION_NOT_REVIEWED"}));
  }, 60_000);
  it("keeps the historical 232 customer-data checkout buildable through its own successor", () => {
    expect(loadCustomerDataReleasePlan(customerDataFixtureRoot).migrationCount).toBe(232);
    expect(() => production(customerDataFixtureRoot)).not.toThrow();
    expect(() => validateSuccessorReleaseContract({repoRoot: customerDataFixtureRoot, followup: "amora-not-applicable-status"}))
      .toThrowError(expect.objectContaining({code: "FOLLOWUP_RELEASE_INVALID"}));
  }, 60_000);
  it.each(notApplicablePins)("refuses a changed or missing not-applicable artifact without fallback: %s", async file => {
    const target = join(notApplicableFixtureRoot, file), bytes = await readFile(target);
    try {
      await writeFile(target, Buffer.concat([bytes, Buffer.from("\n")]));
      expect(() => production(notApplicableFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
      await rm(target);
      expect(() => production(notApplicableFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
    } finally {await writeFile(target, bytes);}
  }, 60_000);
});

describe("production build registers the exact private-avatar successor and preserves prior authorization", () => {
  it("validates 231 SQL files and both policy/DDL pins without claiming hosted application", () => {
    const plan = loadProfileAvatarReleasePlan(avatarFixtureRoot);
    expect(plan.migrationCount).toBe(231);
    expect(plan.runtimeEvidenceVerified).toBe(false);
    expect(plan.releaseAuthorized).toBe(false);
    expect(() => production(avatarFixtureRoot)).not.toThrow();
    expect(() => validateSuccessorReleaseContract({repoRoot: avatarFixtureRoot, followup: "profile-wedding-roles"}))
      .toThrowError(expect.objectContaining({code: "FOLLOWUP_RELEASE_INVALID"}));
  });
  it.each(avatarPins)("refuses missing or changed avatar artifact without fallback: %s", async file => {
    const target = join(avatarFixtureRoot, file), bytes = await readFile(target);
    try {
      await writeFile(target, Buffer.concat([bytes, Buffer.from("\n")]));
      expect(() => production(avatarFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
      await rm(target);
      expect(() => production(avatarFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
    } finally {await writeFile(target, bytes);}
  });
});

describe("production build registers exact profile-role successor without changing historical authorization", () => {
  it("accepts all 230 exact SQL files only through the new successor", () => {
    const plan = loadProfileWeddingRolesReleasePlan(roleFixtureRoot);
    expect(plan.migrationCount).toBe(230);
    expect(plan.runtimeEvidenceVerified).toBe(false);
    expect(plan.releaseAuthorized).toBe(false);
    expect(() => production(roleFixtureRoot)).not.toThrow();
    expect(() => validateSuccessorReleaseContract({repoRoot: roleFixtureRoot, followup: "chat-feedback-nullability"}))
      .toThrowError(expect.objectContaining({code: "FOLLOWUP_RELEASE_INVALID"}));
  });
  it.each(rolePins)("refuses modified or missing role pin without falling back: %s", async file => {
    const target = join(roleFixtureRoot, file), bytes = await readFile(target);
    try {
      await writeFile(target, Buffer.concat([bytes, Buffer.from("\n")]));
      expect(() => production(roleFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
      await rm(target);
      expect(() => production(roleFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
    } finally {await writeFile(target, bytes);}
  });
});

describe("production build registers only the exact feedback-nullability successor", () => {
  it("accepts exactly 229 reviewed SQL files without asserting a DB deployment or relaxing owner authorization", () => {
    const plan = loadChatFeedbackNullabilityReleasePlan(feedbackFixtureRoot);
    expect(plan.migrationCount).toBe(229);
    expect(plan.followupMigrations.map((migration) => migration.version))
      .toEqual(["20260910160514", "20260911080244", "20260913043211"]);
    expect(plan.runtimeEvidenceVerified).toBe(false);
    expect(plan.releaseAuthorized).toBe(false);
    const successor = validateSuccessorReleaseContract({ repoRoot: feedbackFixtureRoot, followup: "chat-feedback-nullability" });
    expect(successor.deploymentBlocked).toBe(true);
    expect(successor.controllerReady).toBe(false);
    expect(() => production(feedbackFixtureRoot)).not.toThrow();
    expect(() => validateSuccessorReleaseContract({ repoRoot: feedbackFixtureRoot, followup: "amora-explicit-budget-hotfix" }))
      .toThrowError(expect.objectContaining({ code: "FOLLOWUP_RELEASE_INVALID" }));
    expect(() => validateSuccessorReleaseContract({ repoRoot: feedbackFixtureRoot }))
      .toThrowError(expect.objectContaining({ code: "MIGRATION_SET_DRIFT" }));
  });

  it.each(feedbackPins)("rejects modified registered feedback bytes instead of falling back: %s", async (file) => {
    const target = join(feedbackFixtureRoot, file), original = await readFile(target);
    try {
      await writeFile(target, Buffer.concat([original, Buffer.from("\n")]));
      expect(() => production(feedbackFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
    } finally { await writeFile(target, original); }
  });

  it("cannot bypass the new SQL by removing its registered contract", async () => {
    const target = join(feedbackFixtureRoot, CHAT_FEEDBACK_CONTRACT_FILE), original = await readFile(target);
    try {
      await rm(target);
      expect(() => production(feedbackFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
    } finally { await writeFile(target, original); }
  });

  it.each(["20260914000000_unreviewed.sql", "20260101000000_unreviewed.sql", "unexpected.sql"])(
    "rejects unreviewed SQL in the new successor: %s", async (file) => {
      const target = join(feedbackFixtureRoot, "supabase/migrations", file);
      try {
        await writeFile(target, "SELECT 1;\n", { flag: "wx" });
        expect(() => production(feedbackFixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
      } finally { await rm(target); }
    },
  );
});

describe("production build explicitly registers the pinned budget followup", () => {
  it("accepts the pinned budget fixture in production only with the exact owner authorization", () => {
    expect(() => production(fixtureRoot)).not.toThrow();
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
      repoRoot: fixtureRoot,
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
