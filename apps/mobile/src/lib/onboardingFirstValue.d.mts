import type {
  AmoraPreparationCatchUpDraftSubmission,
  PlanningFoundationSelfReportedStage,
  WeddingBudgetTendencyValue,
  WeddingGuestCountValue,
  WeddingPriorityValue,
  WeddingStyleValue,
} from "@hanbang/shared";

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
}

export type NeutralPreparationSpaceSubmissionPayload = Readonly<{
  membershipMode: "neutral_preparation_space";
  coupleAction: NeutralPreparationSpaceSubmissionInput["coupleAction"];
  partnerInviteCode?: string;
  weddingDate: null;
  venue: null;
  totalBudget: null;
  progress: Readonly<Record<string, never>>;
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
      pathname: "/(tabs)/dashboard";
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
