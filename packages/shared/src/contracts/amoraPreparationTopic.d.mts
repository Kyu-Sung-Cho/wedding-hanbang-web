import type { AmoraPreparationGuideModule } from "./amoraPreparationGuide.mjs";

export declare const AMORA_PREPARATION_TOPIC_CONTRACT_VERSION: 1;

export type AmoraPreparationTopicDetail = Readonly<{
  version: 1;
  topicKey: string;
  label: string;
  applicability: "unknown" | "applicable" | "not_applicable";
  status: "not_started" | "exploring" | "decision_needed" | "in_progress" | "completed";
  progress: Readonly<{
    completed: number;
    total: number;
    percent: number;
  }>;
  facts: readonly Readonly<{
    key: string;
    label: string;
    source: string;
  }>[];
  unknowns: readonly Readonly<{
    key: string;
    label: string;
    source: string;
  }>[];
  nextAction: Readonly<{
    title: string;
    reason: string;
    completionCriterion: string;
    source: string;
    sourceRef?: Readonly<{
      kind: "amora_action";
      id: string;
      revision: number | null;
    }>;
  }> | null;
  guideModules: readonly AmoraPreparationGuideModule[];
  relatedMessageRefs: readonly string[];
  linkedScheduleIds: readonly string[];
  linkedBudgetCategoryKeys: readonly string[];
  linkedActionIds: readonly string[];
  confirmedScheduleDecisions: readonly Readonly<{
    id: string;
    eventId: string;
    title: string;
    date: string;
    confirmedAt: string;
    scope: "couple_shared";
  }>[];
  confirmedBudgetDecisions: readonly Readonly<{
    id: string;
    title: string;
    confirmedAt: string;
    confirmationScope: "current_member" | "couple";
    appliedRevision: number;
    scope: "couple_shared";
  }>[];
  userReportedCatchUpRecords: readonly Readonly<{
    decisionId: string;
    receiptId: string;
    state: "completed" | "in_progress" | "unknown" | "not_applicable";
    scope: "owner_private" | "couple_shared";
    confirmedAt: string;
    evidence: "user_reported";
    checklistCompletionChanged: false;
    vendorConfirmationStatus: "unconfirmed";
    paymentEvidence: false;
  }>[];
  linkedDecisionIds: readonly string[];
  decisionReadState: "loaded" | "partial" | "unavailable";
  budgetDecisionReadState: "loaded" | "partial" | "unavailable";
  catchUpReadState: "loaded" | "partial" | "unavailable";
  currentVendorBookingRecords: readonly Readonly<{
    bookingId: string;
    decisionId: string;
    vendorId: string;
    productId: string | null;
    vendorName: string;
    productName: string | null;
    bookingDate: string;
    bookingTime: string;
    quotedAmountWon: number;
    initiatedByProfileId: string;
    initiatedAt: string;
    recordScope: "amora_internal_request";
    evidence: "actor_bound_atomic_intent";
    vendorDeliveryStatus: "not_sent";
    vendorConfirmationStatus: "unconfirmed";
  }>[];
  linkedVendorBookingIds: readonly string[];
  vendorBookingReadState: "loaded" | "partial" | "unavailable";
  currentCompletedVendorBookingRecords: readonly Readonly<{
    bookingId: string;
    decisionId: string;
    vendorId: string;
    productId: string | null;
    vendorName: string;
    productName: string | null;
    bookingDate: string;
    bookingTime: string;
    quotedAmountWon: number;
    contractedAmountWon: number | null;
    actualAmountWon: number;
    userConfirmedAt: string;
    decidedAt: string;
    recordScope: "amora_internal_completed_outcome";
    evidence: "actor_bound_atomic_user_report";
    completionEvidence: "user_reported";
    vendorDeliveryStatus: "not_sent";
    vendorConfirmationStatus: "unconfirmed";
    isPaid: false;
  }>[];
  linkedCompletedVendorBookingIds: readonly string[];
  completedVendorBookingReadState: "loaded" | "partial" | "unavailable";
  budgetSummary:
    | Readonly<{
        state: "empty" | "ready";
        categoryKey: string;
        budgetWon: number | null;
        spentWon: number | null;
        payer: "couple" | "bride_parents" | "groom_parents" | "both_parents" | null;
      }>
    | Readonly<{
        state: "invalid";
        categoryKey: string;
      }>
    | null;
  actionReadState: "loaded" | "unavailable";
  conflicts: readonly Readonly<{
    key: string;
    label: string;
  }>[];
}>;

export declare function buildAmoraPreparationTopicView(input: Readonly<{
  topicKey: string;
  topics: readonly unknown[];
  progress: Readonly<Record<string, unknown>>;
  scheduleEvents?: readonly unknown[];
  budgetCategoryKeys?: readonly string[];
  openActions?: readonly unknown[];
  preferredActionRef?: Readonly<{
    id: string;
    revision: number | null;
  }>;
  actionReadState?: "loaded" | "unavailable";
  expectedCoupleId?: string;
  currentJourneyRevision?: number;
  scheduleDecisionReceipts?: readonly unknown[];
  decisionReadState?: "loaded" | "partial" | "unavailable";
  catchUpDecisionReceipts?: readonly unknown[];
  catchUpReadState?: "loaded" | "partial" | "unavailable";
  budgetDecisionReceipts?: readonly unknown[];
  budgetDecisionVerifications?: readonly Readonly<{
    requestId: string;
    status: "applied";
    requiredCount: 1 | 2;
    acceptedCount: 1 | 2;
    summary: string;
    surface: "/budget";
    journey: Readonly<{
      coupleId: string;
      stateRevision: number;
      topicKey: string;
      topicSnapshot: unknown;
    }>;
  }>[];
  budgetDecisionReadState?: "loaded" | "partial" | "unavailable";
  currentCoupleMemberIds?: readonly string[];
  vendorBookings?: readonly unknown[];
  vendorBookingDecisionReceipts?: readonly unknown[];
  vendorBookingReadState?: "loaded" | "partial" | "unavailable";
  completedVendorBookings?: readonly unknown[];
  completedVendorBookingDecisionReceipts?: readonly unknown[];
  completedVendorBookingReadState?: "loaded" | "partial" | "unavailable";
  nowIso?: string;
}>): AmoraPreparationTopicDetail | null;
