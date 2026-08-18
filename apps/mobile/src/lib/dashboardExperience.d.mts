export type DashboardUrgency = "overdue" | "soon" | "ontrack";

import type { AmoraPersonalizationPreferences } from "./amoraPersonalization.mjs";
import type { AmoraSourceDisclosure } from "@hanbang/shared/amora-source-disclosure";

export interface DashboardUrgentTask {
  categoryKey: string;
  categoryLabel: string;
  remainingDays: number;
  urgency: DashboardUrgency;
}

export interface DashboardTodayTask {
  title: string;
  categoryKey: string;
}

export interface DashboardBookingOutcomeTask {
  id: string;
  vendorName: string;
  categoryLabel: string;
  bookingDate: string;
  isPast: boolean;
}

export interface DashboardOpenAction {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: "high" | "medium" | "low";
  source: "chat" | "quote" | "schedule" | "budget" | "guardrail" | "manual";
  categoryKey: string | null;
  sourceRevision: number | null;
  createdAt: string;
}

export interface DashboardActionOutcomeFeedback {
  outcomeId: string;
  actionId: string;
  actionTitle: string;
  sourceRevision: number;
  actionRevision: number;
  actionStatus: "open" | "done";
  outcome: "completed" | "blocked" | "changed" | "not_sure";
  blockerCode?: "time" | "partner_check" | "missing_info" | "other";
  recordedAt: string;
  validUntil: string;
}

export const DASHBOARD_OPEN_ACTION_CANDIDATE_LIMIT: 80;
export const DASHBOARD_ACTION_DUE_SOON_DAYS: 7;

export type DashboardFocusKind =
  | "setup"
  | "urgent"
  | "today"
  | "booking"
  | "action"
  | "next"
  | "calm";

export interface DashboardFocus {
  kind: DashboardFocusKind;
  eyebrow: string;
  title: string;
  description: string;
  ctaLabel: string;
  route:
    | "/onboarding"
    | "/settings"
    | "/checklist"
    | "/schedule"
    | "/budget"
    | "/bookings"
    | "/(tabs)/chat";
  categoryKey?: string;
  actionId?: string;
  actionRevision?: number | null;
  selectionReason?: string | null;
  claimBeforeCare?: boolean;
  suppressActionFollowUpClaim?: boolean;
  feedbackApplied?: true;
  feedbackOutcome?: DashboardActionOutcomeFeedback["outcome"];
  feedbackNotice?: string;
  settingsFocus?: "weddingDate";
  bookingId?: string;
  alternateAction?: {
    label: "날짜만 바로 설정";
    route: "/settings";
    settingsFocus: "weddingDate";
  };
}

export interface DashboardRecommendationContextRow {
  label: string;
  detail: string;
  scope: "나만 보기" | "커플 공유";
}

export interface DashboardRecommendationDisclosure {
  sourceDisclosure: Readonly<AmoraSourceDisclosure> | null;
  prioritySource: string;
  priorityReason: string;
  contextRows: readonly DashboardRecommendationContextRow[];
  memoryNotice: string;
}

export interface DashboardCompanionBrief {
  identityLabel: "AI 결혼 준비 동반자";
  eyebrow: string;
  priorityTitle: string;
  whyNow: string;
  evidenceLabel: string;
  continuity: string | null;
  personalizationLabel: string | null;
  coupleCriterion: string | null;
  coupleCriterionLabel: string | null;
  coreCriterion: string | null;
  coreCriterionLabel: string | null;
  criterionAction: Readonly<{
    label:
      | "우리 기준 확인하기"
      | "파트너 확인 대기 보기"
      | "우리 기준 함께 정하기"
      | "내 기준 하나 알려주기";
    route: "/settings/amora-style";
  }> | null;
  primaryActionLabel: string;
  chatActionLabel: string;
  chatIntent: "focus" | "intake";
}

export type DashboardHomeServiceKey =
  | "checklist"
  | "schedule"
  | "budget"
  | "prices"
  | "quote"
  | "bookings"
  | "community";

export interface DashboardHomeService {
  key: DashboardHomeServiceKey;
  title: string;
  description: string;
  route:
    | "/checklist"
    | "/schedule"
    | "/budget"
    | "/market-prices"
    | "/quote-check"
    | "/bookings"
    | "/(tabs)/community";
}

export const HOME_SERVICES: readonly DashboardHomeService[];

export function resolveDashboardServiceRoute(
  service: DashboardHomeService,
  hasCouple: boolean,
): DashboardHomeService["route"] | "/onboarding";

export function formatLocalDateKey(date?: Date): string;

export function calculateChecklistProgress(
  progress: Record<string, unknown>,
  categories: readonly {
    key: string;
    items: readonly { id: string }[];
  }[],
): number;

export function buildDashboardFocus(input: {
  hasCouple: boolean;
  weddingDate: string | null;
  todayYmd?: string;
  todayTasks: DashboardTodayTask[];
  urgentTasks: DashboardUrgentTask[];
  bookingOutcomeTasks: DashboardBookingOutcomeTask[];
  openAction?: DashboardOpenAction | null;
  receiptActionId?: string | null;
}): DashboardFocus;

export function parseDashboardOpenAction(
  value: unknown,
  expectedCoupleId: string,
): DashboardOpenAction | null;

export function listDashboardOpenActions(
  values: unknown,
  expectedCoupleId: string,
  todayYmd: string,
): readonly DashboardOpenAction[] | null;

export function selectDashboardOpenAction(
  values: unknown,
  expectedCoupleId: string,
  todayYmd: string,
): DashboardOpenAction | null;

export function selectDashboardReceiptAction(
  values: unknown,
  expectedCoupleId: string,
  actionId: string,
): DashboardOpenAction | null;

export function applyDashboardActionOutcomeFeedback(input: {
  focus: DashboardFocus;
  openAction: DashboardOpenAction | null;
  feedback: DashboardActionOutcomeFeedback | null;
}): DashboardFocus;

export function buildDashboardRecommendationDisclosure(input: {
  focus: DashboardFocus;
  asOfDate?: string;
  personalizationLabel: string | null;
  coreCriterionLabel: string | null;
  coupleCriterionLabel: string | null;
  coreCriterionLoaded: boolean;
  coupleCriterionLoaded: boolean;
}): Readonly<DashboardRecommendationDisclosure>;

export function buildCompanionHomeBrief(input: {
  focus: DashboardFocus;
  partnerActivity: {
    partnerName: string;
    recentCategories: string[];
  } | null;
  personalization?: Readonly<AmoraPersonalizationPreferences> | null;
  ownerUserId?: string | null;
  coupleCriterionLoaded?: boolean;
  coupleCriterion?: unknown;
  coreCriterionLoaded?: boolean;
  coreCriterion?: Readonly<{
    id: string;
    value: string;
    updatedAt: string;
  }> | null;
}): DashboardCompanionBrief;

export function getWeddingMomentMessage(dday: number | null): string;
