import { CRITERIA, ITEM_BY_ID, ITEMS, NOTES, QUESTIONNAIRE_VERSION, SCORING_VERSION } from "@/constants/weddingCode36";
import catalog from "./data/couple-catalog.json";
import contract from "./data/design-contract.json";
import { criterionStats, evaluate, itemBand, validateSubmission } from "./score";
import { presentIndividual } from "./presentation";
import type { ComparisonBody, ComparisonCopy, CoreComparisonCard, CouplePresentation, NoteComparisonCard, ResponseState, Submission } from "./types";

function publicCase(copy: ComparisonCopy): ComparisonCopy {
  const output: ComparisonCopy = { summary: copy.summary };
  for (const key of ["good_point", "caution", "conversation", "action"] as const) {
    if (Object.hasOwn(copy, key)) output[key] = copy[key];
  }
  return output;
}
function selectCase(cases: (ComparisonCopy & { a_state: string; b_state: string })[], a: ResponseState, b: ResponseState): ComparisonCopy {
  const matches = cases.filter(copy => copy.a_state === a && copy.b_state === b);
  if (matches.length !== 1) throw new Error("copy_case_not_unique");
  return publicCase(matches[0]);
}

export function compare(inputA: Submission, inputB: Submission): ComparisonBody {
  const a = validateSubmission(inputA);
  const b = validateSubmission(inputB);
  const shared = new Set(a.share_item_ids.filter(id => b.share_item_ids.includes(id)));
  if (!a.allow_couple_comparison || !b.allow_couple_comparison) {
    return { questionnaire_version: QUESTIONNAIRE_VERSION, scoring_version: SCORING_VERSION, status: "no_comparison_consent", copy: publicCase(catalog.overrides.no_comparison_consent), aliases: null, core_cards: [], single_note_cards: [], compatibility_score: null, shared_item_ids: [], joint_decision_confirmed: false };
  }
  const threshold = contract.couple_rules.minimum_item_gap_for_discussion;
  const coreCards: CoreComparisonCard[] = [];
  const noteCards: NoteComparisonCard[] = [];
  for (const criterion of CRITERIA) {
    const sharedIds = criterion.item_ids.filter(id => shared.has(id));
    if (!sharedIds.length) continue;
    const pairs = sharedIds.map(id => {
      const av = a.answers[id]; const bv = b.answers[id];
      const gap = av === null || bv === null ? null : Math.abs(av - bv);
      return { item_id: id, display_number: ITEM_BY_ID[id].display_number, context: ITEM_BY_ID[id].context, statement: ITEM_BY_ID[id].statement, a: av, b: bv, a_band: itemBand(av), b_band: itemBand(bv), gap, discussion_candidate: gap !== null && gap >= threshold };
    });
    const card: CoreComparisonCard = { criterion: criterion.id, label: criterion.label, evidence: pairs, a_mean: null, b_mean: null, a_state: null, b_state: null, status: "partial_shared_scope", copy: publicCase(catalog.overrides.unshared), discussion_item_ids: pairs.filter(pair => pair.discussion_candidate).map(pair => pair.item_id), equal_answer_item_ids: pairs.filter(pair => pair.a !== null && pair.a === pair.b).map(pair => pair.item_id) };
    if (sharedIds.length === 3) {
      const as = criterionStats(criterion.item_ids.map(id => a.answers[id]));
      const bs = criterionStats(criterion.item_ids.map(id => b.answers[id]));
      if (as.state === "M" || bs.state === "M") { card.status = "missing"; card.copy = publicCase(catalog.overrides.M); }
      else {
        card.a_mean = as.display_mean; card.b_mean = bs.display_mean; card.a_state = as.state; card.b_state = bs.state;
        if (as.state === "X" || bs.state === "X") { card.status = "scene_variation"; card.copy = publicCase(catalog.overrides.X); }
        else { card.status = "complete"; card.copy = selectCase(catalog.criteria.find(copy => copy.id === criterion.id)!.cases, as.state, bs.state); }
      }
    }
    coreCards.push(card);
  }
  for (const note of NOTES) {
    const id = note.id;
    if (!shared.has(id)) continue;
    const av = a.answers[id]; const bv = b.answers[id];
    const ab = itemBand(av); const bb = itemBand(bv);
    const gap = av === null || bv === null ? null : Math.abs(av - bv);
    const missing = ab === "M" || bb === "M";
    noteCards.push({ id, label: note.label, evidence: { item_id: id, display_number: ITEM_BY_ID[id].display_number, context: ITEM_BY_ID[id].context, statement: ITEM_BY_ID[id].statement, a: av, b: bv }, gap, discussion_candidate: gap !== null && gap >= threshold, status: missing ? "missing" : "complete", copy: missing ? publicCase(catalog.overrides.M) : selectCase(catalog.single_notes.find(copy => copy.id === id)!.cases, ab, bb) });
  }
  let aliases: ComparisonBody["aliases"] = null;
  if (a.share_alias && b.share_alias) {
    const ea = evaluate(a).alias; const eb = evaluate(b).alias;
    aliases = { a: { name: ea.name, id: ea.id, status: ea.status }, b: { name: eb.name, id: eb.id, status: eb.status } };
  }
  return { questionnaire_version: QUESTIONNAIRE_VERSION, scoring_version: SCORING_VERSION, aliases, core_cards: coreCards, single_note_cards: noteCards, compatibility_score: null, shared_item_ids: ITEMS.filter(item => shared.has(item.id)).map(item => item.id), joint_decision_confirmed: false };
}

export function presentComparison(a: Submission, b: Submission): CouplePresentation {
  const result = compare(a, b);
  if (result.status === "no_comparison_consent") return { names: null, summary: result.copy!.summary, body: result, display_order: ["summary"], human_validation_completed: false };
  let names: CouplePresentation["names"] = null;
  if (a.share_alias && b.share_alias) {
    const pa = presentIndividual(a); const pb = presentIndividual(b);
    names = { a: { name: pa.name, name_kind: pa.name_kind }, b: { name: pb.name, name_kind: pb.name_kind } };
  }
  const { aliases: _aliases, ...body } = result;
  void _aliases;
  const pairs: { a: number | null; b: number | null }[] = [
    ...result.core_cards.flatMap(card => card.evidence),
    ...result.single_note_cards.map(card => ({ a: card.evidence.a, b: card.evidence.b })),
  ];
  const complete = pairs.filter(pair => pair.a !== null && pair.b !== null);
  let summary: string;
  if (!pairs.length) summary = "아직 두 사람이 함께 공유한 문항이 없어요. 서로 보여줄 장면을 고르면 그 답끼리만 비교할 수 있어요.";
  else if (complete.length && complete.every(pair => pair.a === 3 && pair.b === 3) && complete.length === pairs.length) summary = "함께 공유한 문항에서 두 사람 모두 ‘동의도 반대도 하지 않는다’를 골랐어요. 답을 고른 이유까지 같다는 뜻은 아니에요.";
  else if (complete.length && complete.every(pair => pair.a === pair.b) && complete.length === pairs.length) summary = "함께 공유한 문항에 같은 답을 골랐어요. 실제로 원하는 선택과 답을 고른 이유도 같은지는 대화로 확인해 주세요.";
  else if (complete.length && complete.every(pair => pair.a === pair.b)) summary = "두 답이 모두 있는 문항에서는 같은 답을 골랐어요. 답이 비어 있는 문항은 비교하지 않았어요. 같은 답도 이유가 같다는 뜻은 아니에요.";
  else if (!complete.length) summary = "함께 공유한 문항에 비교할 두 답이 아직 갖춰지지 않았어요. 비어 있는 답은 점수로 채우지 않아요.";
  else summary = "서로 공유하고 두 답이 모두 있는 장면을 비교했어요. 차이가 있는 장면에서 각자의 이유를 먼저 이야기해 봐요.";
  return { names, summary, body, display_order: names ? ["names", "summary", "body"] : ["summary", "body"], human_validation_completed: false };
}
