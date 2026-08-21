import { describe, expect, it } from "vitest";

import { PREPARATION_STAGE_PROGRESS_KEY } from "@hanbang/shared";
import { buildOnboardingProgress } from "@/lib/onboarding/buildOnboardingProgress";
import {
  PROGRESS_CHECKLIST_ITEMS,
  type ProgressChecklistItem,
  type WeddingPreferences,
} from "@/types/onboarding.types";

const preferences: WeddingPreferences = {
  weddingStyle: "classic",
  priorities: ["sdm"],
  budgetTendency: "balanced",
  guestCount: "100to200",
};

function checklist(
  overrides: Record<string, Partial<ProgressChecklistItem>> = {},
): ProgressChecklistItem[] {
  return PROGRESS_CHECKLIST_ITEMS.map((item) => ({
    ...item,
    ...(overrides[item.key] ?? {}),
  }));
}

describe("buildOnboardingProgress", () => {
  it("건너뛰면 사용자가 고른 단계만 남기고 19항목은 한 줄도 보내지 않는다", () => {
    const progress = buildOnboardingProgress({
      preferences,
      preparationStage: "venue_booked",
      checklist: checklist({ venue: { status: "completed" } }),
      includeChecklist: false,
    });

    expect(Object.keys(progress).sort()).toEqual([
      PREPARATION_STAGE_PROGRESS_KEY,
      "__preferences",
    ].sort());
    expect(progress[PREPARATION_STAGE_PROGRESS_KEY]).toBe("venue_booked");
  });

  it("저장하면 단계와 함께 사용자가 표시한 항목만 보낸다", () => {
    const progress = buildOnboardingProgress({
      preferences,
      preparationStage: "venue_booked",
      checklist: checklist({
        venue: { status: "completed", cost: 300 },
        meeting: { status: "in_progress" },
        dress: { status: "not_applicable" },
      }),
      includeChecklist: true,
    });

    expect(progress[PREPARATION_STAGE_PROGRESS_KEY]).toBe("venue_booked");
    expect(progress.venue).toEqual({ status: "completed", spent: 3_000_000 });
    expect(progress.meeting).toEqual({ status: "in_progress" });
    expect(progress.dress).toEqual({ status: "not_applicable" });
  });

  // 모바일 buildOnboardingProgress와 같은 규칙이다. 기본 상태를 보내면 파트너가
  // 이미 적어둔 항목이 나중에 온 사람의 기본값으로 덮인다.
  it("아직 시작하지 않은 항목은 저장을 눌러도 보내지 않는다", () => {
    const progress = buildOnboardingProgress({
      preferences,
      preparationStage: "just_started",
      checklist: checklist({ venue: { status: "completed" } }),
      includeChecklist: true,
    });

    expect(Object.hasOwn(progress, "studio")).toBe(false);
    expect(Object.hasOwn(progress, "venue")).toBe(true);
    expect(
      Object.keys(progress).filter((key) => !key.startsWith("__")),
    ).toEqual(["venue"]);
  });

  it("합류한 사람의 제출에는 단계도 19항목도 들어가지 않는다", () => {
    // 페이지가 join일 때 넘기는 값 그대로다 — 세션에 복원된 체크리스트가 있어도
    // 단계는 null, includeChecklist는 false로 내려온다.
    const progress = buildOnboardingProgress({
      preferences,
      preparationStage: null,
      checklist: checklist({
        venue: { status: "completed" },
        meeting: { status: "in_progress" },
      }),
      includeChecklist: false,
    });

    expect(Object.keys(progress)).toEqual(["__preferences"]);
    expect(Object.hasOwn(progress, PREPARATION_STAGE_PROGRESS_KEY)).toBe(false);
  });

  it("완료가 아닌 항목의 비용은 지출로 저장하지 않는다", () => {
    const progress = buildOnboardingProgress({
      preferences,
      preparationStage: null,
      checklist: checklist({ studio: { status: "in_progress", cost: 200 } }),
      includeChecklist: true,
    });

    expect(progress.studio).toEqual({ status: "in_progress" });
  });
});
