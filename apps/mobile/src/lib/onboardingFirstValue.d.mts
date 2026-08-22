import type {
  AmoraPreparationCatchUpDraftSubmission,
  PlanningFoundationSelfReportedStage,
  WeddingBudgetTendencyValue,
  WeddingGuestCountValue,
  WeddingPriorityValue,
  WeddingStyleValue,
} from "@hanbang/shared";

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


export type OnboardingSubmissionMode = "detailed" | "quick_start";

export interface OnboardingCoupleStepActions {
  primary: {
    intent: "quick_start";
    label: string;
    accessibilityHint: string;
  };
  secondary: {
    intent: "continue_details";
    label: string;
  };
}

export function getOnboardingCoupleStepActions(): OnboardingCoupleStepActions;

export interface OnboardingSubmissionInput {
  role: "bride" | "groom" | null;
  coupleAction: "create" | "join";
  inviteCode: string;
  weddingDate: string;
  weddingDateUndecided: boolean;
  venue: string;
  totalBudget: { amount: number; unit: "manwon" } | null;
  weddingStyle: WeddingStyleValue | null;
  priorities: WeddingPriorityValue[];
  budgetTendency: WeddingBudgetTendencyValue | null;
  guestCount: WeddingGuestCountValue | null;
}

export interface OnboardingSubmissionPayload {
  role: OnboardingSubmissionInput["role"];
  coupleAction: OnboardingSubmissionInput["coupleAction"];
  partnerInviteCode?: string;
  weddingDate: string | null;
  venue: string | null;
  totalBudget: OnboardingSubmissionInput["totalBudget"];
  progress: Record<string, unknown>;
}

export function buildOnboardingSubmissionPayload(
  input: OnboardingSubmissionInput,
  mode?: OnboardingSubmissionMode,
): OnboardingSubmissionPayload;

export interface NeutralPreparationSpaceSubmissionInput {
  coupleAction: "create" | "join";
  inviteCode: string;
  preparationCatchUp?: AmoraPreparationCatchUpDraftSubmission;
  /** 공유 구현이 만든 본문. 날짜 검증과 관심사 매핑은 shared 한 곳에만 둔다. */
  base?: {
    weddingDate: string | null;
    progress: Record<string, unknown>;
  };
}

export type NeutralPreparationSpaceSubmissionPayload = Readonly<{
  membershipMode: "neutral_preparation_space";
  coupleAction: NeutralPreparationSpaceSubmissionInput["coupleAction"];
  partnerInviteCode?: string;
  weddingDate: string | null;
  venue: null;
  totalBudget: null;
  progress: Readonly<Record<string, unknown>>;
  preparationCatchUp?: AmoraPreparationCatchUpDraftSubmission;
}>;

export function buildNeutralPreparationSpaceSubmissionPayload(
  input: NeutralPreparationSpaceSubmissionInput,
): NeutralPreparationSpaceSubmissionPayload;

export function resolveNeutralPreparationSpaceCompletion(input: {
  foundationStage: PlanningFoundationSelfReportedStage;
}): {
  kind: "route";
  pathname: "/(tabs)/chat";
  params: {
    entry: "first_use";
    foundationStage: PlanningFoundationSelfReportedStage;
  };
};

export type OnboardingCompletion =
  | {
      kind: "route";
      pathname: "/(tabs)/chat";
      params: { entry: "first_use" };
    }
  | {
      kind: "route";
      pathname: "/(tabs)/lounge";
    }
  | {
      kind: "invite_code";
      inviteCode: string;
    };

export function resolveOnboardingCompletion(input: {
  mode: OnboardingSubmissionMode;
  coupleAction: OnboardingSubmissionInput["coupleAction"];
  inviteCode: string | null | undefined;
}): OnboardingCompletion;
