import { CRITERIA, FALLBACK_NAME, ITEM_BY_ID, ITEMS, NOTES, QUESTIONNAIRE_VERSION, SCORING_VERSION } from "@/constants/weddingCode36";
import { criterionStats, itemBand, type ComparisonBody, type ComparisonCopy, type CoreComparisonCard, type CouplePresentation, type NameKind, type NoteComparisonCard, type PairEvidence, type Rating, type ResponseState } from "@/lib/weddingCode36";
import typeCards from "@/lib/weddingCode36/data/type-cards.json";
import { isRecord } from "@/utils/requestValidation";

export type CouplePayload36 = { status: "unpaired" | "waiting" } | { status: "ready"; report: CouplePresentation };
const knownNames = new Set(typeCards.cards.map(card => card.name));
const states: readonly unknown[] = ["H", "L", "X", "U", "M"];
const isRating = (value: unknown): value is Rating => value === null || typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
const isState = (value: unknown): value is ResponseState => states.includes(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((value, index) => value === b[index]);

function ids(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some(id => typeof id !== "string" || !Object.hasOwn(ITEM_BY_ID, id)) || new Set(value).size !== value.length) return null;
  return value;
}
function copy(value: unknown): ComparisonCopy | null {
  if (!isRecord(value) || !isText(value.summary)) return null;
  const result: ComparisonCopy = { summary: value.summary };
  for (const key of ["good_point", "caution", "conversation", "action"] as const) {
    if (Object.hasOwn(value, key)) {
      if (!isText(value[key])) return null;
      result[key] = value[key];
    }
  }
  return result;
}
function pair(value: unknown): PairEvidence | null {
  if (!isRecord(value) || typeof value.item_id !== "string" || !Object.hasOwn(ITEM_BY_ID, value.item_id)) return null;
  const item = ITEM_BY_ID[value.item_id];
  if (value.display_number !== item.display_number || value.context !== item.context || value.statement !== item.statement || !isRating(value.a) || !isRating(value.b)) return null;
  const gap = value.a === null || value.b === null ? null : Math.abs(value.a - value.b);
  if (value.a_band !== itemBand(value.a) || value.b_band !== itemBand(value.b) || value.gap !== gap || value.discussion_candidate !== (gap !== null && gap >= 2)) return null;
  return { item_id: item.id, display_number: item.display_number, context: item.context, statement: item.statement, a: value.a, b: value.b, a_band: itemBand(value.a), b_band: itemBand(value.b), gap, discussion_candidate: gap !== null && gap >= 2 };
}
function coreCard(value: unknown, shared: Set<string>): CoreComparisonCard | null {
  if (!isRecord(value) || typeof value.criterion !== "string" || !Array.isArray(value.evidence)) return null;
  const criterion = CRITERIA.find(entry => entry.id === value.criterion);
  const text = copy(value.copy);
  if (!criterion || value.label !== criterion.label || !text) return null;
  const evidence: PairEvidence[] = [];
  for (const input of value.evidence) {
    const parsed = pair(input);
    if (!parsed) return null;
    evidence.push(parsed);
  }
  const expectedIds = criterion.item_ids.filter(id => shared.has(id));
  if (!expectedIds.length || !same(evidence.map(entry => entry.item_id), expectedIds)) return null;
  const discussion = ids(value.discussion_item_ids); const equal = ids(value.equal_answer_item_ids);
  if (!discussion || !equal || !same(discussion, evidence.filter(entry => entry.discussion_candidate).map(entry => entry.item_id)) || !same(equal, evidence.filter(entry => entry.a !== null && entry.a === entry.b).map(entry => entry.item_id))) return null;
  let status: CoreComparisonCard["status"];
  let aMean: number | null = null; let bMean: number | null = null;
  let aState: ResponseState | null = null; let bState: ResponseState | null = null;
  if (evidence.length !== 3) status = "partial_shared_scope";
  else {
    const a = criterionStats(evidence.map(entry => entry.a)); const b = criterionStats(evidence.map(entry => entry.b));
    if (a.state === "M" || b.state === "M") status = "missing";
    else {
      aMean = a.display_mean; bMean = b.display_mean; aState = a.state; bState = b.state;
      status = a.state === "X" || b.state === "X" ? "scene_variation" : "complete";
    }
  }
  if (value.status !== status || value.a_mean !== aMean || value.b_mean !== bMean || value.a_state !== aState || value.b_state !== bState) return null;
  if (value.a_state !== null && !isState(value.a_state) || value.b_state !== null && !isState(value.b_state)) return null;
  return { criterion: criterion.id, label: criterion.label, evidence, a_mean: aMean, b_mean: bMean, a_state: aState, b_state: bState, status, copy: text, discussion_item_ids: discussion, equal_answer_item_ids: equal };
}
function noteCard(value: unknown, shared: Set<string>): NoteComparisonCard | null {
  if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.evidence)) return null;
  const note = NOTES.find(entry => entry.id === value.id);
  const text = copy(value.copy); const evidence = value.evidence;
  if (!note || !shared.has(note.id) || value.label !== note.label || !text) return null;
  const item = ITEM_BY_ID[note.id];
  if (evidence.item_id !== item.id || evidence.display_number !== item.display_number || evidence.context !== item.context || evidence.statement !== item.statement || !isRating(evidence.a) || !isRating(evidence.b)) return null;
  const gap = evidence.a === null || evidence.b === null ? null : Math.abs(evidence.a - evidence.b);
  const missing = evidence.a === null || evidence.b === null;
  if (value.gap !== gap || value.discussion_candidate !== (gap !== null && gap >= 2) || value.status !== (missing ? "missing" : "complete")) return null;
  return { id: note.id, label: note.label, evidence: { item_id: item.id, display_number: item.display_number, context: item.context, statement: item.statement, a: evidence.a, b: evidence.b }, gap, discussion_candidate: gap !== null && gap >= 2, status: missing ? "missing" : "complete", copy: text };
}
function names(value: unknown): CouplePresentation["names"] | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isRecord(value.a) || !isRecord(value.b)) return undefined;
  const read = (input: Record<string, unknown>): { name: string; name_kind: NameKind } | null => {
    if (!isText(input.name)) return null;
    if (input.name_kind === "response_state_character" && input.name === FALLBACK_NAME) return { name: input.name, name_kind: input.name_kind };
    if (input.name_kind === "supported_preferences" && knownNames.has(input.name)) return { name: input.name, name_kind: input.name_kind };
    return null;
  };
  const a = read(value.a); const b = read(value.b);
  return a && b ? { a, b } : undefined;
}

export function parseCouplePayload36(raw: unknown): CouplePayload36 | null {
  if (!isRecord(raw)) return null;
  if (raw.status === "waiting" || raw.status === "unpaired") return { status: raw.status };
  if (raw.status !== "ready" || Object.hasOwn(raw, "viewer") && raw.viewer !== "a" || !isRecord(raw.report)) return null;
  const report = raw.report;
  const namePair = names(report.names);
  if (namePair === undefined || !isText(report.summary) || report.human_validation_completed !== false || !Array.isArray(report.display_order) || !isRecord(report.body)) return null;
  const body = report.body;
  if (body.questionnaire_version !== QUESTIONNAIRE_VERSION || body.scoring_version !== SCORING_VERSION || body.compatibility_score !== null || body.joint_decision_confirmed !== false || !Array.isArray(body.core_cards) || !Array.isArray(body.single_note_cards)) return null;
  const sharedIds = ids(body.shared_item_ids);
  if (!sharedIds || !same(sharedIds, ITEMS.filter(item => sharedIds.includes(item.id)).map(item => item.id))) return null;
  const shared = new Set(sharedIds);
  const core: CoreComparisonCard[] = []; const notes: NoteComparisonCard[] = [];
  for (const input of body.core_cards) { const parsed = coreCard(input, shared); if (!parsed) return null; core.push(parsed); }
  for (const input of body.single_note_cards) { const parsed = noteCard(input, shared); if (!parsed) return null; notes.push(parsed); }
  if (!same(core.map(card => card.criterion), CRITERIA.filter(entry => entry.item_ids.some(id => shared.has(id))).map(entry => entry.id)) || !same(notes.map(card => card.id), NOTES.filter(note => shared.has(note.id)).map(note => note.id))) return null;
  let resultBody: ComparisonBody = { questionnaire_version: QUESTIONNAIRE_VERSION, scoring_version: SCORING_VERSION, core_cards: core, single_note_cards: notes, compatibility_score: null, shared_item_ids: sharedIds, joint_decision_confirmed: false };
  if (Object.hasOwn(body, "status")) {
    const text = copy(body.copy);
    if (body.status !== "no_comparison_consent" || body.aliases !== null || sharedIds.length || namePair !== null || !text || !same(report.display_order, ["summary"])) return null;
    resultBody = { ...resultBody, status: "no_comparison_consent", copy: text, aliases: null };
  } else if (!same(report.display_order, namePair ? ["names", "summary", "body"] : ["summary", "body"]) || Object.hasOwn(body, "aliases") || Object.hasOwn(body, "copy")) return null;
  return { status: "ready", report: { names: namePair, summary: report.summary, body: resultBody, display_order: [...report.display_order], human_validation_completed: false } };
}
