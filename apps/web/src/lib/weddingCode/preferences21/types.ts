export type ItemId =
  | "Q01" | "Q02" | "Q03" | "Q04" | "Q05" | "Q06" | "Q07"
  | "Q08" | "Q09" | "Q10" | "Q11" | "Q12" | "Q13" | "Q14"
  | "Q15" | "Q16" | "Q17" | "Q18" | "Q19" | "Q20" | "Q21";

export type TopicId = "A" | "B" | "C" | "D";
export type NumericResponse = 1 | 2 | 3 | 4 | 5;
export type SpecialResponse = "unknown" | "not-applicable" | "skipped";
export type Response = NumericResponse | SpecialResponse | null;
export type Answers = Record<ItemId, Response>;
export type NonFamilyItemId = Exclude<ItemId, "Q13" | "Q14" | "Q15" | "Q16">;
export type NumericReading = "agreement" | "middle" | "disagreement";

export interface Question {
  readonly id: ItemId;
  readonly number: number;
  readonly topicId: TopicId;
  readonly statement: string;
}

export interface Topic {
  readonly id: TopicId;
  readonly title: string;
  readonly context: string;
  readonly itemIds: readonly ItemId[];
}

export interface Versions {
  readonly questionnaireVersion: "preferences21-20261010-r1";
  readonly interpretationVersion: "preferences21-reading-alpha.1";
  readonly displayVersion: "preferences21-report-alpha.1";
}

export interface ResponseEvidence {
  readonly itemId: ItemId;
  readonly number: number;
  readonly statement: string;
  readonly context: string;
  readonly response: Response;
  readonly responseLabel: string;
}

export interface PreferenceInsight {
  readonly itemId: ItemId;
  readonly reading: NumericReading;
  readonly observation: string;
  readonly evidence: ResponseEvidence;
  readonly contextCaveat: string;
  readonly partnerQuestion: string;
  readonly action: string;
}

export interface TopicReport {
  readonly id: TopicId;
  readonly title: string;
  readonly numericCount: number;
  readonly summary: string;
  readonly insights: readonly PreferenceInsight[];
}

export interface ResponseCounts {
  readonly total: 21;
  readonly responded: number;
  readonly numeric: number;
  readonly unknown: number;
  readonly notApplicable: number;
  readonly skipped: number;
  readonly unanswered: number;
}

export interface UnknownNote {
  readonly kind: SpecialResponse | "unanswered" | "middle" | "scope";
  readonly itemIds: readonly ItemId[];
  readonly message: string;
}

export interface CombinationNote {
  readonly itemIds: readonly ItemId[];
  readonly message: string;
  readonly partnerQuestion: string;
  readonly action: string;
}

export interface PreferenceReport {
  readonly versions: Versions;
  readonly validationStatus: "UNVALIDATED";
  readonly counts: ResponseCounts;
  readonly core: {
    readonly headline: string;
    readonly summary: string;
    readonly highlights: readonly { topicId: TopicId; itemId: ItemId; text: string }[];
  };
  readonly topics: readonly TopicReport[];
  readonly evidence: readonly ResponseEvidence[];
  readonly contextCaveats: readonly { itemId: ItemId | null; text: string }[];
  readonly partnerQuestions: readonly { itemId: ItemId | null; text: string }[];
  readonly actions: readonly { itemId: ItemId | null; text: string }[];
  readonly combinations: readonly CombinationNote[];
  readonly unknowns: readonly UnknownNote[];
  readonly character: { readonly status: "pending"; readonly message: string };
}

export interface SafeSummary {
  readonly headline: string;
  readonly summary: string;
  readonly lines: readonly { itemId: NonFamilyItemId; text: string }[];
}
