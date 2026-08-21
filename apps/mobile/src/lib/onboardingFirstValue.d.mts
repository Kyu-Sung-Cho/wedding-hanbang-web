export type WeddingDateInputStatus = "empty" | "incomplete" | "invalid" | "valid";

export interface WeddingDateInputEvaluation {
  status: WeddingDateInputStatus;
  /** 서버로 보낼 `YYYY-MM-DD`. `valid`가 아니면 항상 null이다. */
  requestDate: string | null;
  /** 어떤 상태에서도 비어 있지 않은, 화면에 그대로 붙이는 한 줄. */
  message: string;
}

export type PreparationCategoryStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "not_applicable";

export interface OnboardingPreferencesPayload {
  weddingStyle: string | null;
  priorities: string[];
  budgetTendency: string | null;
  guestCount: string | null;
}

export interface BuildOnboardingProgressInput {
  /** 준비 단계. 고르지 않았으면 null이고, null이면 `__stage`를 보내지 않는다. */
  stage?: string | null;
  preferences: OnboardingPreferencesPayload;
  /**
   * 19항목 상태. **사용자가 그 화면을 확인하고 저장을 눌렀을 때만** 넘긴다.
   * null이면 준비 단계만 저장된다.
   */
  categoryStatuses?: Readonly<Record<string, PreparationCategoryStatus>> | null;
}

export function formatWeddingDateInput(raw: string): string;

export function evaluateWeddingDateInput(
  value: string,
): WeddingDateInputEvaluation;

export function buildOnboardingProgress(
  input: BuildOnboardingProgressInput,
): Record<string, unknown>;
