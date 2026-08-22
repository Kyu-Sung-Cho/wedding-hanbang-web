import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  WEDDING_BUDGET_TENDENCY_OPTIONS,
  WEDDING_GUEST_COUNT_OPTIONS,
  WEDDING_PRIORITY_OPTIONS,
  WEDDING_STYLE_OPTIONS,
} from "@hanbang/shared";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import { PROGRESS_CHECKLIST_ITEMS } from "@/types/onboarding.types";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("onboarding reliability", () => {
  it("does not turn an entered expense into an invented category budget", () => {
    // 조립 코드는 화면 밖(순수 함수)으로 옮겼다. 규칙이 사는 파일을 따라간다.
    const progressBuilder = source("src/lib/onboarding/buildOnboardingProgress.ts");
    const onboardingPage = source("src/app/(auth)/onboarding/page.tsx");

    expect(progressBuilder).toContain("spent: costInWon");
    expect(progressBuilder).not.toContain("budget: costInWon");
    expect(onboardingPage).toContain("buildOnboardingProgress({");
    expect(onboardingPage).not.toContain("budget: costInWon");
  });

  it("keeps the joining partner out of the shared preparation progress", () => {
    const onboardingPage = source("src/app/(auth)/onboarding/page.tsx");

    // 합류 제출은 단계도 19항목도 싣지 않는다 — 먼저 시작한 파트너의 기록을
    // 나중에 온 사람의 세션 값으로 덮지 않기 위해서다.
    expect(onboardingPage).toContain(
      'const isJoiningPartner = store.coupleAction === "join";',
    );
    expect(onboardingPage).toContain(
      "preparationStage: isJoiningPartner ? null : store.preparationStage,",
    );
    expect(onboardingPage).toContain(
      "includeChecklist: includeChecklist && !isJoiningPartner,",
    );
  });

  it("tags the web onboarding budget as canonical won and keeps an undecided value null", () => {
    const onboardingPage = source("src/app/(auth)/onboarding/page.tsx");

    expect(onboardingPage).toMatch(
      /totalBudget:\s*store\.approximateBudget > 0\s*\? \{ amount: store\.approximateBudget, unit: "won" \}\s*: null/,
    );
  });

  it("states that a partner-gated onboarding plan is not applied yet", () => {
    const onboardingPage = source("src/app/(auth)/onboarding/page.tsx");

    expect(onboardingPage).toContain('data.planChange?.status === "pending_partner"');
    expect(onboardingPage).toContain("아직 계획에는 반영되지 않았어요");
    expect(onboardingPage).toContain("두 사람이 모두 확인하면 자동으로 반영됩니다");
    expect(onboardingPage).toContain('data.routineProgress?.status === "deferred"');
    expect(onboardingPage).toContain("저장되지 않은 입력이 있어요");
    expect(onboardingPage).toContain("deferredProgressNotice");
  });

  it("binds the web onboarding form and its response to the initiating account", () => {
    const onboardingPage = source("src/app/(auth)/onboarding/page.tsx");

    expect(onboardingPage).toContain("formOwnerUserIdRef");
    expect(onboardingPage).toContain(
      "useOnboardingStore.getState().bindOwner(ownerUserId)",
    );
    expect(onboardingPage).toContain(
      "[HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION",
    );
    expect(onboardingPage).toContain(
      "[HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: expectedActorUserId",
    );
    expect(onboardingPage).toContain(
      "ownerData?.user?.id !== expectedActorUserId",
    );

    const submitStart = onboardingPage.indexOf("const handleSubmit = async (");
    const responseOwnerFence = onboardingPage.indexOf(
      'const ownerResponse = await fetch("/api/auth/me"',
      submitStart,
    );
    const responseRead = onboardingPage.indexOf(
      "const data = await res.json()",
      submitStart,
    );
    expect(responseOwnerFence).toBeGreaterThan(submitStart);
    expect(responseRead).toBeGreaterThan(responseOwnerFence);
    expect(onboardingPage.slice(submitStart)).toContain(
      "formOwnerUserIdRef.current !== expectedActorUserId",
    );
  });

  it("hides and purges the web onboarding draft across auth, focus, and visibility owner changes", () => {
    const onboardingPage = source("src/app/(auth)/onboarding/page.tsx");

    expect(onboardingPage).toContain("clearAccountOwnedOnboardingState");
    for (const accountOwnedSetter of [
      "clearOwner()",
      "clearOwnerBoundInviteResult()",
      "setShowInviteModal(false)",
      "setCodeCopied(false)",
      'setPendingPlanNotice("")',
      'setDeferredProgressNotice("")',
    ]) {
      expect(onboardingPage).toContain(accountOwnedSetter);
    }
    expect(onboardingPage).toContain("supabase.auth.onAuthStateChange");
    expect(onboardingPage).toContain('window.addEventListener("focus", handleOwnerFocus)');
    expect(onboardingPage).toContain(
      'document.addEventListener("visibilitychange", handleOwnerVisibility)',
    );
    expect(onboardingPage).toContain('ownerVerification === "ready"');
    expect(onboardingPage).toContain("계정을 안전하게 확인하고 있어요");

    const safeGate = onboardingPage.indexOf("if (!formOwnerReady)");
    const form = onboardingPage.indexOf("<StepIndicator");
    expect(safeGate).toBeGreaterThan(0);
    expect(form).toBeGreaterThan(safeGate);
  });

  it("keeps the API progress allowlist tied to shared runtime choices", () => {
    const onboardingRoute = source("src/app/api/onboarding/route.ts");

    for (const constantName of [
      "PROGRESS_CHECKLIST_ITEMS",
      "WEDDING_STYLE_OPTIONS",
      "WEDDING_PRIORITY_OPTIONS",
      "WEDDING_BUDGET_TENDENCY_OPTIONS",
      "WEDDING_GUEST_COUNT_OPTIONS",
    ]) {
      expect(onboardingRoute).toContain(constantName);
    }
    expect(WEDDING_STYLE_OPTIONS.map(({ value }) => value)).toEqual([
      "minimal",
      "classic",
      "fancy",
      "natural",
    ]);
    expect(onboardingRoute).toContain('if (key === "__events") return null');
  });

  it("uses the same plain category names as schedule, budget, and Amora", () => {
    for (const item of PROGRESS_CHECKLIST_ITEMS) {
      expect(item.label).toBe(
        PLANNING_CATEGORY_LABELS[
          item.key as keyof typeof PLANNING_CATEGORY_LABELS
        ],
      );
    }
  });

  it("keeps preference choices concrete and guest ranges non-overlapping", () => {
    const preferences = source(
      "src/components/onboarding/WeddingStylePreferences.tsx",
    );
    const guestLabels = WEDDING_GUEST_COUNT_OPTIONS.map(({ label }) => label);
    const preferenceCopy = [
      ...WEDDING_BUDGET_TENDENCY_OPTIONS.map(({ label, description }) =>
        `${label} ${description}`),
      ...WEDDING_PRIORITY_OPTIONS.map(({ label }) => label),
    ].join(" ");

    expect(preferences).toContain("WEDDING_GUEST_COUNT_OPTIONS");
    expect(guestLabels).toEqual([
      "50명 미만",
      "50~99명",
      "100~199명",
      "200~299명",
      "300명 이상",
    ]);
    expect(preferenceCopy).not.toContain("50명 이하");
    expect(preferenceCopy).not.toContain("스드메");
    expect(preferenceCopy).not.toContain("최고의 퀄리티");
  });

  it("uses the authenticated server capability for a roleless web quick start", () => {
    const onboardingPage = source("src/app/(auth)/onboarding/page.tsx");
    const authMeRoute = source("src/app/api/auth/me/route.ts");

    expect(authMeRoute).toContain("neutralPreparationSpace");
    expect(authMeRoute).toContain(
      'process.env.AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED === "true"',
    );
    expect(onboardingPage).toContain("parseNeutralPreparationSpaceCapability");
    expect(onboardingPage).toContain("buildNeutralPreparationSpaceSubmission");
    expect(onboardingPage).toContain("<NeutralPreparationStart");
    expect(onboardingPage).toContain("neutralPreparationSpaceEnabled");
  });
});
