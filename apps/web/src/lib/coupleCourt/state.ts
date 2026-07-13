import type {
  CourtMode,
  CourtParticipantRole,
  CourtPublicStatus,
  CourtSafetyLevel,
  CourtSafetyReviewStatus,
  CourtWorkflowStatus,
} from "@/lib/coupleCourt/types";
import { COURT_WORKFLOW_STATUSES } from "@/lib/coupleCourt/types";

const WORKFLOW_TRANSITIONS: Readonly<Record<CourtWorkflowStatus, readonly CourtWorkflowStatus[]>> = {
  draft: ["awaiting_applicant_statement", "archived"],
  awaiting_applicant_statement: ["awaiting_partner", "statements_complete", "archived"],
  awaiting_partner: ["awaiting_partner_statement", "statements_complete", "archived"],
  awaiting_partner_statement: ["statements_complete", "archived"],
  statements_complete: ["judging", "archived"],
  judging: ["verdict_ready", "statements_complete", "archived"],
  // A ready solo verdict may be promoted to a blinded bilateral flow, and an
  // explicit revision/appeal creates a new immutable statement version.
  verdict_ready: ["mission_active", "resolved", "awaiting_partner", "statements_complete", "archived"],
  mission_active: ["resolved", "awaiting_partner", "statements_complete", "archived"],
  resolved: ["awaiting_partner", "statements_complete", "archived"],
  archived: [],
};

export function isCourtWorkflowStatus(value: unknown): value is CourtWorkflowStatus {
  return typeof value === "string"
    && COURT_WORKFLOW_STATUSES.some((status) => status === value);
}

export function canTransitionCourtWorkflow(
  from: CourtWorkflowStatus,
  to: CourtWorkflowStatus,
): boolean {
  return WORKFLOW_TRANSITIONS[from].includes(to);
}

export interface CourtStateProjectionInput {
  mode: CourtMode;
  status: CourtWorkflowStatus;
  viewerRole: CourtParticipantRole;
  applicantStatementSubmitted: boolean;
  partnerStatementSubmitted: boolean;
  safetyLevel: CourtSafetyLevel;
  publicStatus: CourtPublicStatus | null;
  safetyReviewStatus: CourtSafetyReviewStatus;
  publicModerationApproved?: boolean;
}

/**
 * Projects capabilities only. It deliberately contains no statement text, invite
 * token, participant id, or private model output, so routes can safely return it.
 */
export interface CourtStateProjection {
  status: CourtWorkflowStatus;
  canEditOwnStatement: boolean;
  canViewOtherStatement: boolean;
  canInvitePartner: boolean;
  canRequestVerdict: boolean;
  canPublish: boolean;
  verdictReady: boolean;
  terminal: boolean;
}

export function projectCourtState(input: CourtStateProjectionInput): CourtStateProjection {
  const isApplicant = input.viewerRole === "applicant";
  const ownSubmitted = isApplicant
    ? input.applicantStatementSubmitted
    : input.partnerStatementSubmitted;
  const statementCollectionOpen = [
    "draft",
    "awaiting_applicant_statement",
    "awaiting_partner",
    "awaiting_partner_statement",
  ].includes(input.status);
  const verdictReady = [
    "verdict_ready",
    "mission_active",
    "resolved",
  ].includes(input.status);

  return {
    status: input.status,
    canEditOwnStatement: statementCollectionOpen && !ownSubmitted,
    // Raw statements remain private to their author at every stage. The
    // verdict contains only the mediated summary and differing viewpoints.
    canViewOtherStatement: false,
    canInvitePartner: isApplicant
      && input.safetyLevel !== "high_risk"
      && (
        (input.mode === "couple"
          && input.applicantStatementSubmitted
          && input.status === "awaiting_partner")
        || (input.mode === "solo" && verdictReady)
      ),
    canRequestVerdict: input.status === "statements_complete"
      && input.safetyLevel !== "high_risk"
      && input.applicantStatementSubmitted
      && (input.mode === "solo" || input.partnerStatementSubmitted),
    canPublish: verdictReady
      && input.safetyLevel === "normal"
      && input.safetyReviewStatus !== "pending"
      && input.safetyReviewStatus !== "rejected"
      && input.publicModerationApproved === true
      // This flag is deliberately conservative: awaiting_consents is never
      // sufficient. The publishing RPC must still verify both snapshot-bound
      // consents atomically.
      && input.publicStatus === "pending_review",
    verdictReady,
    terminal: input.status === "archived",
  };
}
