import { describe, expect, it } from "vitest";
import {
  canTransitionCourtWorkflow,
  projectCourtState,
} from "@/lib/coupleCourt/state";

describe("couple-court state projection", () => {
  it("keeps private, public, and safety review axes separate", () => {
    const projected = projectCourtState({
      mode: "couple",
      status: "verdict_ready",
      viewerRole: "applicant",
      applicantStatementSubmitted: true,
      partnerStatementSubmitted: true,
      safetyLevel: "normal",
      publicStatus: "pending_review",
      safetyReviewStatus: "none",
      publicModerationApproved: true,
    });
    expect(projected.verdictReady).toBe(true);
    expect(projected.canPublish).toBe(true);
    expect(projected).not.toHaveProperty("statement");
    expect(projected).not.toHaveProperty("inviteToken");
  });

  it("does not reveal the applicant statement before the partner submits", () => {
    expect(projectCourtState({
      mode: "couple",
      status: "awaiting_partner_statement",
      viewerRole: "partner",
      applicantStatementSubmitted: true,
      partnerStatementSubmitted: false,
      safetyLevel: "normal",
      publicStatus: null,
      safetyReviewStatus: "none",
    }).canViewOtherStatement).toBe(false);
  });

  it("never exposes the other participant's raw statement after both submit", () => {
    expect(projectCourtState({
      mode: "couple",
      status: "verdict_ready",
      viewerRole: "partner",
      applicantStatementSubmitted: true,
      partnerStatementSubmitted: true,
      safetyLevel: "normal",
      publicStatus: null,
      safetyReviewStatus: "none",
    }).canViewOtherStatement).toBe(false);
  });

  it("allows a safe solo verdict to start the blinded partner upgrade", () => {
    expect(projectCourtState({
      mode: "solo",
      status: "verdict_ready",
      viewerRole: "applicant",
      applicantStatementSubmitted: true,
      partnerStatementSubmitted: false,
      safetyLevel: "normal",
      publicStatus: null,
      safetyReviewStatus: "none",
    }).canInvitePartner).toBe(true);
  });

  it("does not treat an awaiting-consents snapshot as publishable", () => {
    expect(projectCourtState({
      mode: "couple",
      status: "verdict_ready",
      viewerRole: "applicant",
      applicantStatementSubmitted: true,
      partnerStatementSubmitted: true,
      safetyLevel: "normal",
      publicStatus: "awaiting_consents",
      safetyReviewStatus: "approved",
    }).canPublish).toBe(false);
  });

  it("blocks judgment and publication for high-risk or restricted cases", () => {
    const projected = projectCourtState({
      mode: "solo",
      status: "statements_complete",
      viewerRole: "applicant",
      applicantStatementSubmitted: true,
      partnerStatementSubmitted: false,
      safetyLevel: "high_risk",
      publicStatus: "awaiting_consents",
      safetyReviewStatus: "rejected",
    });
    expect(projected.canRequestVerdict).toBe(false);
    expect(projected.canPublish).toBe(false);
  });

  it("permits only explicit private workflow transitions", () => {
    expect(canTransitionCourtWorkflow("statements_complete", "judging")).toBe(true);
    expect(canTransitionCourtWorkflow("verdict_ready", "awaiting_partner")).toBe(true);
    expect(canTransitionCourtWorkflow("resolved", "statements_complete")).toBe(true);
    expect(canTransitionCourtWorkflow("draft", "verdict_ready")).toBe(false);
    expect(canTransitionCourtWorkflow("archived", "draft")).toBe(false);
  });
});
