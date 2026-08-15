import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import { fetchMobileWebApiWithSession } from "../lib/mobileWebApiBridge.mjs";

const budgetPath = fileURLToPath(new URL("../../app/budget/index.tsx", import.meta.url));
const apiPath = fileURLToPath(new URL("../lib/api.ts", import.meta.url));
const budgetSource = readFileSync(budgetPath, "utf8");
const apiSource = readFileSync(apiPath, "utf8");

test("budget loads one couple/revision identity and invalidates it on auth change", () => {
  assert.match(
    budgetSource,
    /select\("couple_id, total_budget, progress, state_revision"\)/,
  );
  assert.match(budgetSource, /onAuthStateChange/);
  assert.match(budgetSource, /beginLoad\(user\.id\)/);
  assert.match(budgetSource, /commitJourney\([\s\S]*profile\.couple_id/);
});

test("a category deep link opens only after the current owner and journey are verified", () => {
  assert.match(budgetSource, /useLocalSearchParams<\{ category\?: string \| string\[\] \}>\(\)/);
  assert.match(budgetSource, /buildVerifiedBudgetCategoryEditor/);
  assert.match(budgetSource, /handledCategoryDeepLinkRef/);
  assert.match(
    budgetSource,
    /const clearIdentityBoundState = useCallback\(\(\) => \{[\s\S]*handledCategoryDeepLinkRef\.current = null/,
  );
  assert.match(
    budgetSource,
    /revisionCoordinator\.isCurrent\(latestSnapshot\)[\s\S]*const deepLinkEditor = buildVerifiedBudgetCategoryEditor\(\{[\s\S]*verifiedIdentity: latestSnapshot/,
  );
  assert.match(
    budgetSource,
    /categoryEditBaseRef\.current = deepLinkEditor\.editBase[\s\S]*setBudgetInput\(deepLinkEditor\.budgetInput\)[\s\S]*setSpentInput\(deepLinkEditor\.spentInput\)[\s\S]*setPayerInput\(deepLinkEditor\.payerInput\)[\s\S]*setEditingKey\(deepLinkEditor\.categoryKey\)/,
  );

  const verifiedCommit = budgetSource.indexOf(
    "const snapshot = revisionCoordinator.commitJourney",
  );
  const editorOpen = budgetSource.indexOf(
    "const deepLinkEditor = buildVerifiedBudgetCategoryEditor",
  );
  assert.ok(verifiedCommit >= 0 && editorOpen > verifiedCommit);
});

test("budget writes use owner-bound requests, revision helpers, and atomic per-kind locks", () => {
  assert.match(budgetSource, /apiFetchForExpectedUser\(/);
  assert.doesNotMatch(budgetSource, /\bapiFetch\(/);
  assert.match(budgetSource, /beginMutation\("total"\)/);
  assert.match(budgetSource, /beginMutation\("category"\)/);
  assert.match(budgetSource, /buildTotalBudgetMutation\(/);
  assert.match(budgetSource, /buildCategoryBudgetMutation\(/);
  assert.match(budgetSource, /isBudgetEditBaseCurrent\(totalEditBaseRef\.current, token\)/);
  assert.match(budgetSource, /isBudgetEditBaseCurrent\(categoryEditBaseRef\.current, token\)/);
  assert.doesNotMatch(budgetSource, /select\("progress"\)/);
  assert.doesNotMatch(budgetSource, /parseInt\(/);

  assert.match(apiSource, /initialSession\?\.userId\.toLowerCase\(\) !== expectedUserId\.toLowerCase\(\)/);
});

test("budget UI distinguishes partner approval from an applied save", () => {
  assert.match(budgetSource, /parseBudgetMutationResponse\(/);
  assert.match(budgetSource, /pending_partner/);
  assert.match(budgetSource, /파트너 확인 대기/);
  assert.match(budgetSource, /requestId/);
  assert.match(budgetSource, /\/api\/couple-plan-changes\/\$\{pending\.requestId\}/);
  assert.match(budgetSource, /verification: "unverified"/);
});

test("a cold budget screen recovers only an owner-bound requester after exact status verification", () => {
  assert.match(budgetSource, /fetchActiveBudgetApprovalStatus/);
  assert.match(
    budgetSource,
    /pendingApprovalRef\.current === null[\s\S]*fetchActiveBudgetApprovalStatus\(/,
  );
  assert.match(
    budgetSource,
    /apiFetchForExpectedUser\(snapshot\.ownerId, path, options\)/,
  );
});

test("snapshot revision changes retain a bound pending request until its exact status is terminal", () => {
  assert.match(budgetSource, /isPendingBudgetApprovalBoundToIdentity/);
  assert.doesNotMatch(
    budgetSource,
    /snapshot\.stateRevision > pending\.expectedRevision/,
  );
  assert.doesNotMatch(
    budgetSource,
    /pending\.expectedRevision === snapshot\.stateRevision/,
  );
  assert.match(
    budgetSource,
    /pendingOutcome\.status === "applied"[\s\S]*pendingApprovalRef\.current = null/,
  );
  assert.match(
    budgetSource,
    /pendingOutcome\.status === "stale"\s*\|\|\s*pendingOutcome\.status === "rejected"/,
  );
});

test("a budget request sends zero network calls when its captured owner is no longer current", async () => {
  let networkCalls = 0;
  await assert.rejects(
    fetchMobileWebApiWithSession({
      expectedUserId: "user-a",
      initialSession: { userId: "user-b", accessToken: "token-b" },
      fetchWithAccessToken: async () => {
        networkCalls += 1;
        return { status: 200 };
      },
      refreshSession: async () => null,
    }),
    /MOBILE_WEB_API_SESSION_OWNER_MISMATCH/,
  );
  assert.equal(networkCalls, 0);
});
