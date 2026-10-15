import bank from "@/lib/weddingCode36/data/bank.json";
import contract from "@/lib/weddingCode36/data/design-contract.json";

export interface WeddingCodeItem {
  id: string;
  display_number: number;
  context: string;
  statement: string;
  couple_prompt: string;
  kind: string;
  criterion: string | null;
  criterion_label: string;
}
export interface WeddingCodeCriterion {
  id: string;
  label: string;
  definition: string;
  item_ids: string[];
}
export interface WeddingCodeNote {
  id: string;
  label: string;
  definition: string;
}

export const QUESTIONNAIRE_VERSION = bank.version;
export const SCORING_VERSION = contract.version;
export const FINGERPRINT = contract.source_questionnaire_fingerprint;
export const ITEMS: readonly WeddingCodeItem[] = bank.items;
export const ITEM_BY_ID: Readonly<Record<string, WeddingCodeItem>> = Object.fromEntries(ITEMS.map(item => [item.id, item]));
export const CRITERIA: readonly WeddingCodeCriterion[] = bank.criteria;
export const NOTES: readonly WeddingCodeNote[] = bank.single_notes;
export const SCALE = bank.response_scale;
export const INSTRUCTIONS = bank.instructions;
export const MISSING_REASONS = [...bank.missing_responses.reasons, "not_answered"];
export const DEFAULT_SHARE_IDS = CRITERIA.flatMap(criterion => criterion.item_ids);
export const FALLBACK_NAME = contract.presentation_rules.fallback_name;
export const ALIAS_SHARING_NOTICE = contract.alias_sharing_notice;
