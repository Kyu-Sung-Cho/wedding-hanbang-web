import type {
  OnboardingPreferencesPayload,
  PreparationCategoryStatus,
} from "./onboardingFirstValue.mjs";

export type OnboardingCoupleAction = "create" | "join";

export const ONBOARDING_DONE_STEP: 6;
export const ONBOARDING_PREPARATION_STEP: 5;

export interface OnboardingStepPosition {
  /** 이 사람이 걷는 화면 중 몇 번째인가. 1부터 센다. */
  position: number;
  /** 이 사람이 실제로 보는 화면 수. 건너뛰는 화면은 세지 않는다. */
  total: number;
}

export function shouldAskPreparationProgress(
  coupleAction: OnboardingCoupleAction | null,
): boolean;

export function getOnboardingSteps(
  coupleAction: OnboardingCoupleAction | null,
): readonly number[];

export function getOnboardingStepPosition(
  step: number,
  coupleAction: OnboardingCoupleAction | null,
): OnboardingStepPosition;

/** 더 볼 화면이 없으면 null. 그 자리가 제출 지점이다. */
export function getNextOnboardingStep(
  step: number,
  coupleAction: OnboardingCoupleAction | null,
): number | null;

export function getPreviousOnboardingStep(
  step: number,
  coupleAction: OnboardingCoupleAction | null,
): number | null;

export interface BuildOnboardingProgressPayloadInput {
  coupleAction: OnboardingCoupleAction | null;
  /** 준비 단계. 합류 경로에서는 무시된다. */
  stage?: string | null;
  preferences: OnboardingPreferencesPayload;
  /** 19항목 상태. 합류 경로에서는 무시된다. */
  categoryStatuses?: Readonly<Record<string, PreparationCategoryStatus>> | null;
}

export function buildOnboardingProgressPayload(
  input: BuildOnboardingProgressPayloadInput,
): Record<string, unknown>;

export interface OnboardingSubmitNotice {
  title: string;
  /** 화면에 그대로 붙이는 본문. 여러 사유는 빈 줄로 이어 붙인다. */
  message: string;
}

/** 알릴 것이 없으면 null. null일 때만 다음 화면으로 넘어간다. */
export function describeOnboardingSubmitNotice(
  data: unknown,
): OnboardingSubmitNotice | null;
