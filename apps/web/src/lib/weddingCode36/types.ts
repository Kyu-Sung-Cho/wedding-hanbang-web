export type Rating = number | null;
export type ResponseState = "H" | "L" | "X" | "U" | "M";
export interface Submission {
  questionnaire_version: string;
  questionnaire_fingerprint: string;
  answers: Record<string, Rating>;
  missing_reasons: Record<string, string>;
  allow_couple_comparison: boolean;
  share_item_ids: string[];
  share_alias: boolean;
}
export interface CriterionStats {
  ratings: Rating[];
  answered: number;
  sum: number | null;
  mean: number | null;
  display_mean: number | null;
  state: ResponseState;
}
export interface AliasComponent {
  criterion: string | null;
  label: string | null;
  reason: string;
  supported_tags: { criterion: string; label: string }[];
}
export interface Assessment {
  questionnaire_version: string;
  scoring_version: string;
  questionnaire_fingerprint: string;
  profile: Record<string, CriterionStats>;
  single_notes: Record<string, { value: Rating; band: ResponseState; default_public: false }>;
  alias: {
    name: string | null;
    id: string | null;
    adjective: AliasComponent;
    animal: AliasComponent;
    status: "full" | "partial" | "profile_only";
  };
  human_validation_completed: false;
}
export interface IndividualEvidence {
  id: string;
  number: number;
  context: string;
  statement: string;
  value: Rating;
}
export interface ProfileCard {
  id: string;
  label: string;
  summary: string;
  state: ResponseState;
  mean: number | null;
  evidence: IndividualEvidence[];
}
export interface NoteCard extends IndividualEvidence {
  label: string;
  default_share: false;
  type_input: false;
}
export type NameKind = "supported_preferences" | "response_state_character";
export interface IndividualPresentation {
  name: string;
  name_kind: NameKind;
  summary: string;
  why_this_name: string[];
  good_points: string[];
  cautions: string[];
  conversation: string[];
  profile: ProfileCard[];
  notes: NoteCard[];
  display_order: string[];
  answered_count: number;
  technical_code_in_primary_display: false;
  questionnaire_version: string;
  scoring_version: string;
  assessment: Assessment;
  human_validation_completed: false;
}
export interface ComparisonCopy {
  summary: string;
  good_point?: string;
  caution?: string;
  conversation?: string;
  action?: string;
}
export interface PairEvidence {
  item_id: string;
  display_number: number;
  context: string;
  statement: string;
  a: Rating;
  b: Rating;
  a_band: ResponseState;
  b_band: ResponseState;
  gap: number | null;
  discussion_candidate: boolean;
}
export interface CoreComparisonCard {
  criterion: string;
  label: string;
  evidence: PairEvidence[];
  a_mean: number | null;
  b_mean: number | null;
  a_state: ResponseState | null;
  b_state: ResponseState | null;
  status: "partial_shared_scope" | "missing" | "scene_variation" | "complete";
  copy: ComparisonCopy;
  discussion_item_ids: string[];
  equal_answer_item_ids: string[];
}
export interface NoteComparisonCard {
  id: string;
  label: string;
  evidence: Pick<PairEvidence, "item_id" | "display_number" | "context" | "statement" | "a" | "b">;
  gap: number | null;
  discussion_candidate: boolean;
  status: "missing" | "complete";
  copy: ComparisonCopy;
}
export interface ComparisonBody {
  questionnaire_version: string;
  scoring_version: string;
  status?: "no_comparison_consent";
  copy?: ComparisonCopy;
  aliases?: null | {
    a: Pick<Assessment["alias"], "name" | "id" | "status">;
    b: Pick<Assessment["alias"], "name" | "id" | "status">;
  };
  core_cards: CoreComparisonCard[];
  single_note_cards: NoteComparisonCard[];
  compatibility_score: null;
  shared_item_ids: string[];
  joint_decision_confirmed: false;
}
export interface CouplePresentation {
  names: null | {
    a: Pick<IndividualPresentation, "name" | "name_kind">;
    b: Pick<IndividualPresentation, "name" | "name_kind">;
  };
  summary: string;
  body: ComparisonBody;
  display_order: string[];
  human_validation_completed: false;
}
