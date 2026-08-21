import {
  PREPARATION_STAGE_PROGRESS_KEY,
  type PreparationStageValue,
} from "@hanbang/shared";
import type {
  ProgressChecklistItem,
  WeddingPreferences,
} from "@/types/onboarding.types";

/**
 * 온보딩이 `couples.progress`로 보낼 값을 조립한다.
 *
 * 화면 안에 있던 조립 코드를 여기로 뺐다. 조립 규칙은 "무엇을 저장할 자격이 있는가"에
 * 대한 판정이라 렌더링 없이 테스트되어야 하는데, 컴포넌트 안에 있는 동안에는 어떤
 * 테스트도 이 페이로드를 볼 수 없었다. 모바일도 같은 이유로 같은 이름의 순수 함수를
 * 따로 두고 있다(`apps/mobile/src/lib/onboardingFirstValue.mjs`) — 두 화면이 같은 값을
 * 보내야 하므로 규칙도 같은 모양으로 적는다.
 */
export interface BuildOnboardingProgressInput {
  preferences: WeddingPreferences;
  /** 사용자가 직접 고른 준비 단계. 보낼 자격이 없으면 호출하는 쪽이 `null`을 넘긴다. */
  preparationStage: PreparationStageValue | null;
  checklist: readonly ProgressChecklistItem[];
  /** 19항목 화면을 사용자가 보고 저장을 눌렀을 때만 true. */
  includeChecklist: boolean;
}

export function buildOnboardingProgress({
  preferences,
  preparationStage,
  checklist,
  includeChecklist,
}: BuildOnboardingProgressInput): Record<string, unknown> {
  const progress: Record<string, unknown> = {};

  // 준비 단계는 사용자가 직접 고른 한 줄이라 19항목을 건너뛰어도 남긴다.
  if (preparationStage) {
    progress[PREPARATION_STAGE_PROGRESS_KEY] = preparationStage;
  }

  if (includeChecklist) {
    for (const item of checklist) {
      // `not_started`는 새로 생긴 사실이 아니라 기본 상태다. 이걸 보내면 파트너가
      // 이미 "준비 중"으로 적어둔 항목이 이쪽 기본값으로 덮인다. 모바일도 같은
      // 이유로 이 상태만 빼고 보낸다.
      if (item.status === "not_started") continue;

      // 입력한 실제 지출만 원 단위로 저장한다. 계획 예산은 사용자가 예산 화면에서
      // 별도로 입력하며, 실제 지출을 예산으로 추정하지 않는다.
      const costInWon =
        item.status === "completed" && item.cost ? item.cost * 10000 : null;
      progress[item.key] = costInWon
        ? { status: item.status, spent: costInWon }
        : { status: item.status };
    }
  }

  progress.__preferences = {
    weddingStyle: preferences.weddingStyle,
    priorities: preferences.priorities,
    budgetTendency: preferences.budgetTendency,
    guestCount: preferences.guestCount,
  };

  return progress;
}
