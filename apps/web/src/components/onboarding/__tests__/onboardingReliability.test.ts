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
    const onboardingPage = source("src/app/(auth)/onboarding/page.tsx");

    expect(onboardingPage).toContain("spent: costInWon");
    expect(onboardingPage).not.toContain("budget: costInWon");
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
});
