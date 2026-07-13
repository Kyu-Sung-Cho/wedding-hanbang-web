export const COURT_MODES = ["solo", "couple"] as const;
export type CourtMode = (typeof COURT_MODES)[number];

export const COURT_TONES = ["gentle", "practical", "spicy"] as const;
export type CourtTone = (typeof COURT_TONES)[number];

export const COURT_CATEGORIES = [
  "budget",
  "planning_roles",
  "venue",
  "studio_dress_makeup",
  "family",
  "guests_invitations",
  "honeymoon",
  "home_setup",
  "communication",
  "formalwear_shooting",
  "ceremony_events",
  "other",
] as const;
export type CourtCategory = (typeof COURT_CATEGORIES)[number];

export const COURT_WORKFLOW_STATUSES = [
  "draft",
  "awaiting_applicant_statement",
  "awaiting_partner",
  "awaiting_partner_statement",
  "statements_complete",
  "judging",
  "verdict_ready",
  "mission_active",
  "resolved",
  "archived",
] as const;
export type CourtWorkflowStatus = (typeof COURT_WORKFLOW_STATUSES)[number];

export const COURT_PUBLIC_STATUSES = [
  "awaiting_consents",
  "pending_review",
  "published",
  "hidden",
  "rejected",
] as const;
export type CourtPublicStatus = (typeof COURT_PUBLIC_STATUSES)[number];

export const COURT_SAFETY_REVIEW_STATUSES = [
  "none",
  "pending",
  "approved",
  "rejected",
] as const;
export type CourtSafetyReviewStatus = (typeof COURT_SAFETY_REVIEW_STATUSES)[number];

export type CourtParticipantRole = "applicant" | "partner";

export interface CourtStatementInput {
  role: CourtParticipantRole;
  facts: string;
  feelings?: string;
  expectations?: string;
  priorAgreement?: string;
  attempts?: string;
  desiredOutcome?: string;
  changeCommitment?: string;
  evidenceSummaries?: readonly string[];
}

export const COURT_SAFETY_RISK_TYPES = [
  "self_harm",
  "violence",
  "threat",
  "confinement",
  "stalking",
  "coercive_control",
  "sexual_coercion",
  "financial_control",
  "harm_to_others",
] as const;
export type CourtSafetyRiskType = (typeof COURT_SAFETY_RISK_TYPES)[number];
export type CourtSafetyLevel = "normal" | "sensitive" | "high_risk";

export interface CourtSafetyAssessment {
  level: CourtSafetyLevel;
  categories: CourtSafetyRiskType[];
  resourceMessage?: string;
}

export const COURT_VERDICT_STATUSES = [
  "applicant_partially_upheld",
  "respondent_partially_upheld",
  "shared_responsibility",
  "settlement_recommended",
  "insufficient_information",
  "safety_redirect",
] as const;
export type CourtVerdictStatus = (typeof COURT_VERDICT_STATUSES)[number];

export interface CourtMission {
  title: string;
  description: string;
  owner: CourtParticipantRole | "both";
  /** 10 minutes through 72 hours. A DB row may add its own server-generated id. */
  dueInMinutes: number;
  completionCheck: string;
  funTag: string | null;
  /** P0 has one verified persistence adapter: the couple-scoped Amora task. */
  relatedFeature: "task";
}

export interface CourtVerdict {
  schemaVersion: "1.0";
  safety: {
    level: CourtSafetyLevel;
    riskTypes: CourtSafetyRiskType[];
    disablePlayfulVerdict: boolean;
    publicEligible: boolean;
    supportMessage: string | null;
  };
  caseMeta: {
    generatedTitle: string;
    category: CourtCategory;
    provisional: boolean;
  };
  caseSummary: string;
  sharedFacts: string[];
  differentViews: Array<{
    applicant: string;
    respondent: string | null;
  }>;
  applicantNeeds: string;
  partnerNeeds: string | null;
  coreConflict: string;
  responsibility: {
    displayMode: "percentage" | "qualitative";
    applicant: number | null;
    respondent: number | null;
    shared: number | null;
    explanation: string;
  } | null;
  verdict: {
    status: CourtVerdictStatus;
    headline: string;
    reasons: string[];
    judgeOneLiner: string | null;
  };
  conversationScript: {
    opening: string;
    applicantLine: string;
    respondentLine: string | null;
  };
  missions: CourtMission[];
  checkIn: {
    dueInDays: number;
    question: string;
  };
  confidence: "low" | "medium" | "high";
  limitations: string[];
  publicCard: {
    safeTitle: string;
    oneLine: string;
    resultLabel: string;
    hashtags: string[];
  } | null;
}

export interface PublicCourtSnapshot {
  snapshotVersion: "1.0";
  category: CourtCategory;
  mode: CourtMode;
  tone: CourtTone;
  provisional: boolean;
  safeTitle: string;
  oneLine: string;
  resultLabel: string;
  hashtags: string[];
}

export const COUPLE_COURT_EVENT_NAMES = [
  "couple_court_home_view",
  "couple_court_case_start",
  "couple_court_mode_select",
  "couple_court_category_select",
  "couple_court_statement_submit",
  "couple_court_invite_create",
  "couple_court_invite_copy",
  "couple_court_partner_join",
  "couple_court_partner_statement_submit",
  "couple_court_verdict_request",
  "couple_court_verdict_view",
  "couple_court_appeal_submit",
  "couple_court_mission_accept",
  "couple_court_mission_complete",
  "couple_court_task_create",
  "couple_court_budget_link",
  "couple_court_public_preview",
  "couple_court_public_publish",
  "couple_court_share_export",
  "couple_court_vote",
  "couple_court_comment",
  "couple_court_followup_submit",
  "couple_court_safety_redirect",
] as const;
export type CoupleCourtEventName = (typeof COUPLE_COURT_EVENT_NAMES)[number];

export function isCourtMode(value: unknown): value is CourtMode {
  return typeof value === "string" && COURT_MODES.some((item) => item === value);
}

export function isCourtCategory(value: unknown): value is CourtCategory {
  return typeof value === "string" && COURT_CATEGORIES.some((item) => item === value);
}

export function isCourtTone(value: unknown): value is CourtTone {
  return typeof value === "string" && COURT_TONES.some((item) => item === value);
}

export function isCourtVerdictStatus(value: unknown): value is CourtVerdictStatus {
  return typeof value === "string"
    && COURT_VERDICT_STATUSES.some((item) => item === value);
}
