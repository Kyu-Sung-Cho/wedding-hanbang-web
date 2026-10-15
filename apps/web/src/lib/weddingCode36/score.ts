import {
  CRITERIA, DEFAULT_SHARE_IDS, FINGERPRINT, ITEM_BY_ID, ITEMS,
  MISSING_REASONS, NOTES, QUESTIONNAIRE_VERSION, SCORING_VERSION,
} from "@/constants/weddingCode36";
import contract from "./data/design-contract.json";
import type { AliasComponent, Assessment, CriterionStats, Rating, ResponseState, Submission } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateSubmission(input: unknown): Submission {
  if (!isRecord(input)) throw new Error("invalid_submission");
  if (input.questionnaire_version !== QUESTIONNAIRE_VERSION) throw new Error("questionnaire_version_mismatch");
  if (input.questionnaire_fingerprint !== FINGERPRINT) throw new Error("questionnaire_fingerprint_mismatch");
  const answers = input.answers;
  if (!isRecord(answers) || Object.keys(answers).length !== ITEMS.length || ITEMS.some(item => !Object.hasOwn(answers, item.id))) {
    throw new Error("answer_item_ids_mismatch");
  }
  for (const value of Object.values(answers)) {
    if (value !== null && (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5)) throw new Error("invalid_response");
  }
  const reasons = input.missing_reasons === undefined ? {} : input.missing_reasons;
  if (!isRecord(reasons)) throw new Error("invalid_missing_reasons");
  for (const [id, reason] of Object.entries(reasons)) {
    if (!Object.hasOwn(ITEM_BY_ID, id) || answers[id] !== null || typeof reason !== "string" || !MISSING_REASONS.includes(reason)) throw new Error("invalid_missing_reason");
  }
  const shareIds = input.share_item_ids === undefined ? [] : input.share_item_ids;
  if (!Array.isArray(shareIds) || shareIds.some(id => typeof id !== "string" || !Object.hasOwn(ITEM_BY_ID, id)) || new Set(shareIds).size !== shareIds.length) throw new Error("invalid_share_scope");
  const shareAlias = input.share_alias === undefined ? false : input.share_alias;
  const comparison = input.allow_couple_comparison === undefined ? false : input.allow_couple_comparison;
  if (typeof shareAlias !== "boolean") throw new Error("invalid_alias_consent");
  if (typeof comparison !== "boolean") throw new Error("invalid_comparison_consent");
  // 알 수 없는 외부 필드는 저장 모델로 옮기지 않는다.
  return {
    questionnaire_version: QUESTIONNAIRE_VERSION,
    questionnaire_fingerprint: FINGERPRINT,
    answers: Object.fromEntries(ITEMS.map(item => [item.id, answers[item.id] as Rating])),
    missing_reasons: Object.fromEntries(Object.entries(reasons).map(([id, reason]) => [id, reason as string])),
    allow_couple_comparison: comparison,
    share_item_ids: [...shareIds] as string[],
    share_alias: shareAlias,
  };
}

export function createSubmission(
  values: Rating | Partial<Record<string, Rating>> = null,
  options: { comparison?: boolean; shareIds?: string[]; shareAlias?: boolean } = {},
): Submission {
  return validateSubmission({
    questionnaire_version: QUESTIONNAIRE_VERSION,
    questionnaire_fingerprint: FINGERPRINT,
    answers: Object.fromEntries(ITEMS.map(item => [item.id, typeof values === "object" && values !== null ? values[item.id] ?? null : values])),
    missing_reasons: {},
    allow_couple_comparison: options.comparison ?? false,
    share_item_ids: options.shareIds ?? (options.comparison ? [...DEFAULT_SHARE_IDS] : []),
    share_alias: options.shareAlias ?? false,
  });
}

export function itemBand(value: Rating): ResponseState {
  return value === null ? "M" : value >= 4 ? "H" : value <= 2 ? "L" : "U";
}

export function criterionStats(values: Rating[]): CriterionStats {
  if (values.length !== 3) throw new Error("invalid_criterion_item_count");
  const completed = values.filter(value => value !== null).length;
  if (completed !== 3) return { ratings: [...values], answered: completed, sum: null, mean: null, display_mean: null, state: "M" };
  const numeric = values as number[];
  const bands = new Set(values.map(itemBand));
  const state: ResponseState = bands.size === 1 && bands.has("H") ? "H" : bands.size === 1 && bands.has("L") ? "L" : bands.has("H") && bands.has("L") ? "X" : "U";
  const sum = numeric.reduce((total, value) => total + value, 0);
  return { ratings: [...values], answered: 3, sum, mean: sum / 3, display_mean: Math.round(sum / 3 * 10) / 10, state };
}

function selectAliasComponent(profile: Record<string, CriterionStats>, block: string[], labels: Record<string, string>): AliasComponent {
  const tags = block.filter(id => profile[id].state === "H").map(id => ({ criterion: id, label: labels[id] }));
  const output: AliasComponent = { criterion: null, label: null, reason: "", supported_tags: tags };
  const states = block.map(id => profile[id].state);
  if (states.includes("M")) return { ...output, reason: "missing_in_block" };
  if (states.includes("X")) return { ...output, reason: "scene_variation_in_block" };
  if (states.every(state => state === "H")) return { ...output, reason: "all_supported" };
  if (!tags.length) return { ...output, reason: "no_repeated_support" };
  const sums = block.map(id => profile[id].sum as number);
  const top = Math.max(...sums);
  const winners = block.filter(id => profile[id].sum === top);
  if (winners.length !== 1) return { ...output, reason: "top_tie" };
  const winner = winners[0];
  if (profile[winner].state !== "H") return { ...output, reason: "top_not_repeated_support" };
  const runnerUp = Math.max(...block.filter(id => id !== winner).map(id => profile[id].sum as number));
  if (top - runnerUp < contract.alias_rules.minimum_sum_gap_to_runner_up) return { ...output, reason: "small_gap" };
  return { ...output, criterion: winner, label: labels[winner], reason: "assigned" };
}

export function evaluate(input: Submission): Assessment {
  const { answers } = validateSubmission(input);
  const profile = Object.fromEntries(CRITERIA.map(criterion => [criterion.id, criterionStats(criterion.item_ids.map(id => answers[id]))]));
  const adjective = selectAliasComponent(profile, contract.adjective_block, contract.adjective_candidates);
  const animal = selectAliasComponent(profile, contract.animal_block, contract.animal_candidates);
  const full = adjective.label !== null && animal.label !== null;
  return {
    questionnaire_version: QUESTIONNAIRE_VERSION, scoring_version: SCORING_VERSION, questionnaire_fingerprint: FINGERPRINT,
    profile,
    single_notes: Object.fromEntries(NOTES.map(note => [note.id, { value: answers[note.id], band: itemBand(answers[note.id]), default_public: false as const }])),
    alias: { name: full ? `${adjective.label} ${animal.label}` : null, id: full ? `${adjective.criterion}_${animal.criterion}` : null, adjective, animal, status: full ? "full" : adjective.label || animal.label ? "partial" : "profile_only" },
    human_validation_completed: false,
  };
}
