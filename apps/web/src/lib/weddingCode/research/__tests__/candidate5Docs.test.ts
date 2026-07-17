import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../../../..");

describe("WeddingCode document authority fence", () => {
  it("marks every Candidate 4 execution/scoring/item document retired or superseded at the top", () => {
    const names = [
      "21_gamification_roadmap_v1.md",
      "23_v0.5_item_blueprint.md",
      "24_v0.5_item_source_map.md",
      "25_v0.5_scoring_model_draft.md",
      "26_cognitive_interview_protocol_v0.1.md",
      "27_item_review_A1_quote_addons_v0.1.md",
      "28_item_review_A2_memory_option_v0.1.md",
      "29_item_review_A3_venue_budget_gap_v0.1.md",
      "30_item_review_A4_low_review_vendor_v0.1.md",
      "31_fable_mode_adaptation_protocol_v0.1.md",
      "32_item_review_B1_partner_unseen_place_v0.1.md",
      "33_item_review_B2_lopsided_preparation_v0.1.md",
      "34_item_review_B3_different_lenses_v0.1.md",
      "35_item_review_B4_candidate_overload_v0.1.md",
      "36_item_review_C1_parent_guest_criteria_v0.1.md",
      "37_item_review_C2_parent_direction_talk_v0.1.md",
      "38_item_review_C3_simplify_ceremony_v0.1.md",
      "39_item_review_C4_guest_count_guarantee_v0.1.md",
      "40_item_review_D1_solution_first_support_v0.1.md",
      "41_item_review_D2_tired_planning_talk_v0.1.md",
      "42_item_review_D3_different_pace_v0.1.md",
      "43_item_review_D4_same_day_benefit_decision_v0.1.md",
      "44_v0.5_item_set_integrity_audit.md",
      "45_v0.5_result_copy_and_couple_overlap_spec.md",
      "46_v0.5_forced_choice_comparability_audit.md",
      "47_prod_couple_flow_qa_2026-07-08.md",
      "52_copy_clarity_pass_2026-07-08.md",
      "53_candidate3_novice_rewrite_2026-07-08.md",
      "54_candidate4_plain_language_rewrite_2026-07-08.md",
    ];

    for (const name of names) {
      const top = readFileSync(path.join(repoRoot, "docs/wedding-code", name), "utf8")
        .split("\n")
        .slice(0, 16)
        .join("\n");
      expect(top, name).toMatch(/RETIRED|SUPERSEDED/);
      expect(top, name).toMatch(/재사용 금지|사용하지|재사용하거나/);
    }
  });

  it("keeps the index explicit that Candidate 5 and every human gate are unapproved", () => {
    const index = readFileSync(path.join(repoRoot, "docs/wedding-code/README.md"), "utf8");
    expect(index).toContain("Production 수집·결과·커플 비교 차단 유지");
    expect(index).toContain("UNVALIDATED");
    expect(index).toContain("현재 모두 **미통과**");
    expect(index).toContain("별도 Production 재개 PR과 운영 승인");
  });
});
