export type CourtMode = "solo" | "couple";
export type CourtTone = "gentle" | "practical" | "spicy";

export type CourtCaseStatus =
  | "draft"
  | "awaiting_applicant_statement"
  | "awaiting_partner"
  | "awaiting_partner_statement"
  | "statements_complete"
  | "judging"
  | "verdict_ready"
  | "mission_active"
  | "resolved"
  | "archived";

export interface CourtCase {
  id: string;
  caseNumber?: string;
  title: string;
  category: string;
  mode: CourtMode;
  tone: CourtTone;
  status: CourtCaseStatus;
  neutralSummary?: string;
  createdAt?: string;
  updatedAt?: string;
  viewerRole?: "applicant" | "partner";
  applicantStatementSubmitted: boolean;
  partnerJoined: boolean;
  partnerStatementSubmitted: boolean;
  canJudge: boolean;
  verdictReady: boolean;
  safetyLevel?: "normal" | "sensitive" | "high_risk";
  inviteExpiresAt?: string;
  inviteRejectedAt?: string;
  followupSubmitted?: boolean;
  publicPostId?: string;
  publicStatus?: string;
  publicSnapshotVersion?: number;
  publicPreview?: PublicSnapshotPreview;
  /** The authenticated viewer's latest statement only. Never the other participant's. */
  ownStatement?: StatementInput;
}

export interface CreateCaseInput {
  creationRequestId: string;
  mode: CourtMode;
  category: string;
  tone: CourtTone;
  title: string;
}

export interface StatementInput {
  /** Stable across retries of one submit click, omitted on read-only ownStatement projections. */
  submissionRequestId?: string;
  facts: string;
  feelings: string;
  expectations: string;
  attempts: string;
  desiredAgreement: string;
  safetyLevel?: "normal" | "sensitive" | "high_risk";
  safetyCategories?: string[];
}

export interface CourtInvite {
  inviteUrl: string;
  expiresAt?: string;
}

export type FactStatus = "agreed" | "applicant_claim" | "respondent_claim" | "disputed";

export interface VerdictFact {
  fact: string;
  status: FactStatus;
}

export interface VerdictMission {
  id: string;
  title: string;
  description: string;
  ownerRole?: string;
  dueAt?: string;
  dueInMinutes?: number;
  completionCheck?: string;
  saved?: boolean;
  viewerStatus?: "accepted" | "completed";
}

export interface CourtVerdict {
  id?: string;
  caseId?: string;
  provisional: boolean;
  safetyLevel: "normal" | "sensitive" | "high_risk";
  confidence?: "low" | "medium" | "high";
  verdictOneLine: string;
  summary: string;
  facts: VerdictFact[];
  applicantPerspective: string;
  respondentPerspective?: string;
  coreIssues: string[];
  responsibility?: {
    applicant: number;
    respondent: number;
    shared?: number;
    explanation?: string;
  };
  judgeOneLiner?: string;
  recommendedConversation?: string;
  repairScripts: string[];
  missions: VerdictMission[];
  followupQuestion?: string;
  limitations?: string;
  createdAt?: string;
  publicCard?: {
    safeTitle: string;
    oneLine: string;
    resultLabel: string;
    hashtags: string[];
  };
}

export interface CourtVerdictHistoryItem {
  generationVersion: number;
  status: "ready" | "superseded";
  completedAt?: string;
  supersededAt?: string;
}

export interface PublicCourtCase {
  id: string;
  title: string;
  summary: string;
  category: string;
  mode: CourtMode;
  nickname?: string;
  verdictOneLine?: string;
  createdAt?: string;
  votes?: {
    total: number;
    viewerChoice?: PublicVoteChoice;
    counts?: Partial<Record<PublicVoteChoice, number>>;
  };
  commentsCount?: number;
  commentsEnabled: boolean;
  safetyLevel: "normal" | "sensitive" | "high_risk";
  facts?: VerdictFact[];
  coreIssues?: string[];
  repairScripts?: string[];
  missions?: VerdictMission[];
}

export interface PublicCourtComment {
  id: string;
  commentType: "empathy" | "experience" | "practical_advice" | "question";
  body: string;
  createdAt?: string;
}

export interface PublicSnapshotPreview {
  publicPostId: string;
  snapshotHash: string;
  snapshotVersion: number;
  snapshot: {
    safeTitle: string;
    oneLine: string;
    resultLabel: string;
    hashtags: string[];
    provisional: boolean;
  };
}

export type PublicVoteChoice =
  | "applicant_more_at_fault"
  | "partner_more_at_fault"
  | "both_need_change"
  | "need_more_info";

export type PublicReportReason =
  | "harassment"
  | "pii"
  | "threat"
  | "hate"
  | "spam"
  | "minor_safety"
  | "other";

export interface InviteAcceptResult {
  caseId?: string;
  requiresAuth?: boolean;
  actionUrl?: string;
  message?: string;
}
