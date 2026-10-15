import { describe, expect, it } from "vitest";
import { CRITERIA, ITEMS } from "@/constants/weddingCode36";
import { createSubmission, presentComparison } from "@/lib/weddingCode36";
import { parseCouplePayload36 } from "../parseReport36";

function ready(a = 1, b = 5) {
  return { status: "ready", viewer: "a", report: presentComparison(createSubmission(a, { comparison: true, shareAlias: true, shareIds: ITEMS.map(item => item.id) }), createSubmission(b, { comparison: true, shareAlias: true, shareIds: ITEMS.map(item => item.id) })) };
}

describe("커플 비교 응답의 안전한 화면 표시", () => {
  it("accepts unpaired and waiting responses without leaking extra fields", () => {
    expect(parseCouplePayload36({ status: "unpaired", private: "hidden" })).toEqual({ status: "unpaired" });
    expect(parseCouplePayload36({ status: "waiting", coupleToken: "invite" })).toEqual({ status: "waiting" });
  });
  it("accepts all 25 actual uniform result combinations without changing content", () => {
    for (let a = 1; a <= 5; a++) for (let b = 1; b <= 5; b++) {
      const actual = ready(a, b);
      expect(parseCouplePayload36(actual)).toEqual({ status: "ready", report: actual.report });
    }
  });
  it("accepts all 400 combinations of actual supported names", () => {
    const submissions = [];
    for (const adjective of ["B", "M", "V", "G", "F"]) for (const animal of ["P", "J", "D", "S"]) {
      const submission = createSubmission(3, { comparison: true, shareAlias: true });
      for (const criterion of CRITERIA) if ([adjective, animal].includes(criterion.id)) for (const id of criterion.item_ids) submission.answers[id] = 5;
      submissions.push(submission);
    }
    for (const a of submissions) for (const b of submissions) {
      const report = presentComparison(a, b);
      expect(parseCouplePayload36({ status: "ready", report })).toEqual({ status: "ready", report });
    }
  });
  it("accepts no consent, no shared scope, no name permission, missing and mixed scenes", () => {
    const a = createSubmission(3, { comparison: true, shareAlias: true });
    const b = createSubmission(3, { comparison: true, shareAlias: true });
    const check = () => {
      const report = presentComparison(a, b);
      expect(parseCouplePayload36({ status: "ready", report })).toEqual({ status: "ready", report });
    };
    a.allow_couple_comparison = false; check();
    a.allow_couple_comparison = true; a.share_alias = false; check();
    a.answers.B1 = null; a.missing_reasons.B1 = "prefer_not_to_answer"; check();
    a.answers.B1 = 1; a.answers.B2 = 5; delete a.missing_reasons.B1; check();
    a.share_item_ids = ["B1", "N8"]; b.share_item_ids = ["B1", "N8", "N9"]; check();
    a.answers.N8 = null; check();
    a.share_item_ids = []; b.share_item_ids = []; check();
    a.share_alias = true; b.share_alias = true; check();
  });
  it.each([undefined, null, false, 1, "ready", [], {}, { status: "unknown" }, { status: "ready" }, { status: "ready", report: null }])("rejects missing or non-object data %j", input => {
    expect(parseCouplePayload36(input)).toBeNull();
  });
  it("rejects reports that passed the former shallow check and then crashed rendering", () => {
    expect(parseCouplePayload36({ status: "ready", report: { summary: "x", body: { core_cards: [{}], single_note_cards: [] } } })).toBeNull();
    const nullNames = ready();
    Object.assign(nullNames.report, { names: { a: null, b: null } });
    expect(parseCouplePayload36(nullNames)).toBeNull();
    const badCopy = ready();
    Object.assign(badCopy.report.body.core_cards[0], { copy: null });
    expect(parseCouplePayload36(badCopy)).toBeNull();
  });
  it("rejects invalid types, versions, nested values and fabricated numbers", () => {
    const mutations: ((value: ReturnType<typeof ready>) => void)[] = [
      value => { value.viewer = "b"; },
      value => { Object.assign(value.report, { summary: " " }); },
      value => { Object.assign(value.report, { human_validation_completed: true }); },
      value => { Object.assign(value.report, { display_order: [] }); },
      value => { Object.assign(value.report, { display_order: ["summary", null] }); },
      value => { Object.assign(value.report, { names: {} }); },
      value => { Object.assign(value.report, { names: { a: { name: "invented", name_kind: "supported_preferences" }, b: value.report.names!.b } }); },
      value => { Object.assign(value.report.body, { questionnaire_version: "old", scoring_version: "old" }); },
      value => { Object.assign(value.report.body, { core_cards: [undefined] }); },
      value => { Object.assign(value.report.body, { single_note_cards: [null] }); },
      value => { Object.assign(value.report.body, { compatibility_score: 100 }); },
      value => { Object.assign(value.report.body, { joint_decision_confirmed: true }); },
      value => { Object.assign(value.report.body, { shared_item_ids: ["unknown"] }); },
      value => { Object.assign(value.report.body, { shared_item_ids: ["B1", "B1"] }); },
      value => { Object.assign(value.report.body.core_cards[0], { label: "wrong" }); },
      value => { Object.assign(value.report.body.core_cards[0], { criterion: "unknown" }); },
      value => { Object.assign(value.report.body.core_cards[0], { copy: { summary: "valid", good_point: {} } }); },
      value => { Object.assign(value.report.body.core_cards[0], { copy: { summary: "valid", caution: undefined } }); },
      value => { Object.assign(value.report.body.core_cards[0], { evidence: [] }); },
      value => { Object.assign(value.report.body.core_cards[0], { status: "unknown" }); },
      value => { Object.assign(value.report.body.core_cards[0], { a_mean: NaN }); },
      value => { Object.assign(value.report.body.core_cards[0], { a_mean: 3 }); },
      value => { Object.assign(value.report.body.core_cards[0], { a_state: "X" }); },
      value => { Object.assign(value.report.body.core_cards[0], { discussion_item_ids: [] }); },
      value => { Object.assign(value.report.body.core_cards[0], { equal_answer_item_ids: ["B1"] }); },
      value => { Object.assign(value.report.body.core_cards[0].evidence[0], { context: "wrong context" }); },
      value => { Object.assign(value.report.body.core_cards[0].evidence[0], { item_id: "N8" }); },
      value => { Object.assign(value.report.body.core_cards[0].evidence[0], { a: "1" }); },
      value => { Object.assign(value.report.body.core_cards[0].evidence[0], { b: false }); },
      value => { Object.assign(value.report.body.core_cards[0].evidence[0], { a_band: "H" }); },
      value => { Object.assign(value.report.body.core_cards[0].evidence[0], { gap: 0 }); },
      value => { Object.assign(value.report.body.core_cards[0].evidence[0], { discussion_candidate: false }); },
      value => { Object.assign(value.report.body.single_note_cards[0], { id: "B1" }); },
      value => { Object.assign(value.report.body.single_note_cards[0], { evidence: undefined }); },
      value => { Object.assign(value.report.body.single_note_cards[0], { gap: 0 }); },
      value => { Object.assign(value.report.body.single_note_cards[0], { status: "missing" }); },
    ];
    for (const mutate of mutations) {
      const input = ready(); mutate(input);
      expect(parseCouplePayload36(input), mutate.toString()).toBeNull();
    }
  });
  it("does not pass unknown private fields through to the UI model", () => {
    const input = ready();
    Object.assign(input, { access_token: "private" });
    Object.assign(input.report, { private_answers: { N9: 1 } });
    Object.assign(input.report.body.core_cards[0].evidence[0], { private_missing_reason: "private" });
    const parsed = parseCouplePayload36(input);
    expect(parsed).not.toBeNull();
    expect(JSON.stringify(parsed)).not.toContain("private");
  });
});
