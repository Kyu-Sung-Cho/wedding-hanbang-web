import { describe, expect, it } from "vitest";

import {
  auditAmoraPreparationCoverage,
} from "@hanbang/shared/amora-preparation-coverage";
import {
  AMORA_JOURNEY_TRUTH_AUDIT_CONTRACT_VERSION,
  buildAmoraJourneyTruthAudit,
} from "@hanbang/shared/amora-journey-truth-audit";
import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";

const TOPIC_KEYS = [
  "meeting",
  "venue",
  "studio",
  "dress",
  "makeup",
  "ring",
  "hanbok",
  "yedan",
  "honeymoon",
  "houseware",
  "housing",
  "invitation",
  "snap",
  "shoes",
  "bouquet",
  "gift",
  "mc",
  "ham",
  "pyebaek",
] as const;

function currentCoverage() {
  return auditAmoraPreparationCoverage({ checklistTopics: CATEGORY_CHECKLISTS });
}

describe("Amora full-journey truth audit", () => {
  it("binds every supported topic to one independent problem, state, decision, execution, and completion policy", () => {
    const result = buildAmoraJourneyTruthAudit(currentCoverage());

    expect(AMORA_JOURNEY_TRUTH_AUDIT_CONTRACT_VERSION).toBe(1);
    expect(result?.version).toBe(1);
    expect(result?.scope).toBe("full_wedding_journey_truth");
    expect(result?.topicPolicies.map((policy) => policy.topicKey)).toEqual(TOPIC_KEYS);
    expect(result?.topicPolicies).toHaveLength(19);
    expect(result?.topicPolicies[0]).toEqual({
      topicKey: "meeting",
      truthOwners: {
        problem: "canonical_checklist",
        applicability: "saved_checklist",
        status: "saved_checklist",
        progress: "saved_checklist",
        decision: "validated_receipt_projection",
        execution: "current_schedule_or_shared_action",
        completion: "saved_checklist",
      },
      evidenceEffects: {
        schedule: "supporting_execution_only",
        decisionReceipt: "supporting_decision_only",
        userReport: "supporting_non_proof_only",
        vendorRecord: "supporting_non_proof_only",
        budgetRecord: "supporting_non_payment_only",
        openAction: "prevents_terminal_completion",
        guide: "supporting_guidance_only",
        savedConversation: "supporting_context_only",
      },
      failureUi: {
        unknownApplicability: "review_required",
        conflict: "review_required",
        partial: "partial_visible",
        unavailable: "unavailable_visible",
        empty: "empty_only_when_all_required_reads_loaded",
      },
    });
    expect(result?.topicPolicies.every((policy) => (
      policy.truthOwners.status === "saved_checklist"
      && policy.truthOwners.completion === "saved_checklist"
      && policy.evidenceEffects.schedule === "supporting_execution_only"
      && policy.evidenceEffects.userReport === "supporting_non_proof_only"
      && policy.evidenceEffects.vendorRecord === "supporting_non_proof_only"
    ))).toBe(true);
  });

  it("keeps known and parked gaps visible without giving them progress, completion, or recommendation authority", () => {
    const result = buildAmoraJourneyTruthAudit(currentCoverage());

    expect(result?.gapPolicies.map((gap) => ({
      gapKey: gap.gapKey,
      disposition: gap.disposition,
      consumerState: gap.consumerState,
      allowProgress: gap.allowProgress,
      allowCompletion: gap.allowCompletion,
      allowRecommendation: gap.allowRecommendation,
    }))).toEqual([
      { gapKey: "planning_foundation", disposition: "now", consumerState: "known_gap_priority", allowProgress: false, allowCompletion: false, allowRecommendation: false },
      { gapKey: "guest_operations", disposition: "known_gap", consumerState: "known_gap", allowProgress: false, allowCompletion: false, allowRecommendation: false },
      { gapKey: "contract_record_safety", disposition: "known_gap", consumerState: "known_gap", allowProgress: false, allowCompletion: false, allowRecommendation: false },
      { gapKey: "contract_transaction_execution", disposition: "parked", consumerState: "parked_out_of_scope", allowProgress: false, allowCompletion: false, allowRecommendation: false },
      { gapKey: "marriage_admin", disposition: "known_gap", consumerState: "known_gap", allowProgress: false, allowCompletion: false, allowRecommendation: false },
      { gapKey: "wedding_day_operations", disposition: "known_gap", consumerState: "known_gap", allowProgress: false, allowCompletion: false, allowRecommendation: false },
      { gapKey: "post_wedding_closeout", disposition: "known_gap", consumerState: "known_gap", allowProgress: false, allowCompletion: false, allowRecommendation: false },
    ]);
    expect(result?.isComplete).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/"rank"|"score"|"action"|"writeAuthority"/u);
  });

  it.each([
    ["coverage issue", () => auditAmoraPreparationCoverage({ checklistTopics: [] })],
    ["top-level extra authority", () => ({ ...currentCoverage(), rank: 1 })],
    ["topic extra authority", () => ({
      ...currentCoverage(),
      connectedChecklistTopics: currentCoverage().connectedChecklistTopics.map((topic, index) => (
        index === 0 ? { ...topic, canComplete: true } : topic
      )),
    })],
    ["missing topic", () => ({
      ...currentCoverage(),
      connectedChecklistTopics: currentCoverage().connectedChecklistTopics.slice(1),
    })],
    ["duplicate topic", () => ({
      ...currentCoverage(),
      connectedChecklistTopics: [
        ...currentCoverage().connectedChecklistTopics,
        currentCoverage().connectedChecklistTopics[0],
      ],
    })],
    ["unknown gap", () => ({
      ...currentCoverage(),
      gaps: [
        ...currentCoverage().gaps,
        {
          gapKey: "secret_gap",
          label: "숨은 공백",
          disposition: "known_gap",
          surfaceOwner: "preparation_map",
          axisKeys: ["foundation"],
          reason: "숨은 권한",
          requiredSourceKinds: ["secret"],
        },
      ],
    })],
    ["gap extra authority", () => ({
      ...currentCoverage(),
      gaps: currentCoverage().gaps.map((gap, index) => (
        index === 0 ? { ...gap, allowRecommendation: true } : gap
      )),
    })],
  ])("fails closed for %s", (_label, buildCoverage) => {
    expect(buildAmoraJourneyTruthAudit(buildCoverage())).toBeNull();
  });
});
