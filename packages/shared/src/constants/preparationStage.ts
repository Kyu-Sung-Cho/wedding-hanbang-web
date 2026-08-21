/**
 * 준비 단계 — 온보딩에서 "지금 어디까지 왔는지"를 한 줄로 받는 자리.
 *
 * ## 왜 한 줄인가
 *
 * 준비 현황은 원래 19개 항목 × 4상태로 받았다(apps/web ProgressChecklist). 정보는
 * 가장 풍부하지만, 아직 아무것도 안 정한 사람에게 19줄을 먼저 내미는 건 "시작이
 * 쉬운 앱"과 정확히 반대다. 반대로 19개를 없애면 이미 절반쯤 준비한 사람이 아는
 * 것을 말할 자리를 잃는다.
 *
 * 그래서 순서를 바꿨다. 한 줄로 단계를 먼저 받고, 19개는 **건너뛸 수 있는** 다음
 * 화면으로 미룬다. 단계는 필수, 상세는 선택이다.
 *
 * ## suggested는 저장되지 않는다
 *
 * 각 단계에는 "보통 이 단계면 여기까지는 됐더라"는 제안값이 붙어 있다. 이건 다음
 * 화면의 **입력칸 초깃값**일 뿐이고, 사용자가 그 화면을 지나가지 않으면 아무것도
 * 저장되지 않는다. 웨딩한방은 사용자가 직접 말하지 않은 것을 준비 완료 사실로
 * 기록하지 않는다 — 체크리스트 완료율과 예산은 사람이 확인한 것만 올라가야 한다.
 *
 * 즉 제안값은 타이핑을 줄이는 장치이지, 데이터를 지어내는 장치가 아니다.
 *
 * ## 웹과 앱이 같은 배열을 쓴다
 *
 * 두 화면이 각자 목록을 들고 있으면 한쪽만 고쳐진다. 커플 초대 코드가 정확히 그렇게
 * 깨졌다(contracts/coupleInviteCode.ts 참고). 그래서 목록도, 저장 키도 여기 한 벌만 둔다.
 */

import type { PlanningCategoryKey } from "./weddingPlanning";

/** `couples.progress` JSONB 안에서 단계가 사는 예약 키. 19개 카테고리 키와 겹치지 않게 `__` 접두사를 쓴다. */
export const PREPARATION_STAGE_PROGRESS_KEY = "__stage" as const;

export const PREPARATION_STAGE_VALUES = [
  "just_started",
  "venue_hunting",
  "venue_booked",
  "sdm_in_progress",
  "wrapping_up",
] as const;

export type PreparationStageValue = (typeof PREPARATION_STAGE_VALUES)[number];

/** 제안값이 가질 수 있는 상태. `couples.progress`의 항목 상태와 같은 어휘를 쓴다. */
type SuggestedStatus = "in_progress" | "completed";

export interface PreparationStageOption {
  value: PreparationStageValue;
  /** 선택지에 보이는 한 줄. */
  label: string;
  /** 고르기 전에 헷갈리지 않도록 붙이는 한 마디. */
  hint: string;
  /**
   * 다음 화면(19항목)의 입력칸 초깃값 제안. **저장값이 아니다.**
   * 사용자가 그 화면에서 확인하고 넘겨야만 서버로 간다.
   */
  suggested: Partial<Record<PlanningCategoryKey, SuggestedStatus>>;
}

export const PREPARATION_STAGE_OPTIONS: readonly PreparationStageOption[] = [
  {
    value: "just_started",
    label: "이제 막 시작했어요",
    hint: "아직 정한 게 없어도 괜찮아요",
    suggested: {},
  },
  {
    value: "venue_hunting",
    label: "결혼식장을 알아보는 중이에요",
    hint: "몇 군데 보고 있거나, 상담을 다녀왔어요",
    suggested: { venue: "in_progress" },
  },
  {
    value: "venue_booked",
    label: "결혼식장을 계약했어요",
    hint: "날짜와 장소가 정해졌어요",
    suggested: { venue: "completed", meeting: "completed" },
  },
  {
    value: "sdm_in_progress",
    label: "촬영·드레스·메이크업을 진행 중이에요",
    hint: "식장은 끝났고 그다음을 정하고 있어요",
    suggested: {
      venue: "completed",
      meeting: "completed",
      studio: "in_progress",
      dress: "in_progress",
      makeup: "in_progress",
    },
  },
  {
    value: "wrapping_up",
    label: "거의 마무리 단계예요",
    hint: "큰 건 정해졌고 남은 걸 챙기는 중이에요",
    suggested: {
      venue: "completed",
      meeting: "completed",
      studio: "completed",
      dress: "completed",
      makeup: "completed",
      invitation: "in_progress",
      snap: "in_progress",
    },
  },
] as const;

const PREPARATION_STAGE_VALUE_SET: ReadonlySet<string> = new Set(
  PREPARATION_STAGE_VALUES,
);

export function isPreparationStageValue(
  value: unknown,
): value is PreparationStageValue {
  return typeof value === "string" && PREPARATION_STAGE_VALUE_SET.has(value);
}

export function findPreparationStageOption(
  value: unknown,
): PreparationStageOption | null {
  if (!isPreparationStageValue(value)) return null;
  return (
    PREPARATION_STAGE_OPTIONS.find((option) => option.value === value) ?? null
  );
}

/**
 * 저장된 `couples.progress`에서 단계를 읽는다. 없거나 모양이 다르면 null —
 * 예전에 온보딩을 마친 커플에게는 단계가 없고, 그건 오류가 아니라 정상이다.
 */
export function readPreparationStage(
  progress: unknown,
): PreparationStageValue | null {
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) {
    return null;
  }
  const raw = (progress as Record<string, unknown>)[
    PREPARATION_STAGE_PROGRESS_KEY
  ];
  return isPreparationStageValue(raw) ? raw : null;
}

/**
 * 화면에 그대로 쓸 수 있는 한 줄. 단계가 없으면 null을 돌려주고, 부르는 쪽은
 * 그 줄을 아예 그리지 않는다 — 모르는 것을 "아직 시작 전"으로 단정하지 않는다.
 */
export function describePreparationStage(value: unknown): string | null {
  return findPreparationStageOption(value)?.label ?? null;
}
