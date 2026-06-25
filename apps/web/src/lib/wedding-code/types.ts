export const WEDDING_CODE_CONSTRUCT_KEYS = [
  "costRisk",
  "experienceMeaning",
  "coPreparation",
  "roleOwnership",
  "evidenceDecision",
  "aestheticMood",
  "familyIntegration",
  "coupleAutonomy",
  "emotionalSupport",
  "executionSupport",
  "decisionPaceRisk",
  "guidanceNeed",
] as const;

export type WeddingCodeConstructKey = (typeof WEDDING_CODE_CONSTRUCT_KEYS)[number];

export type WeddingCodeEvidenceTag =
  | "TESTING_STANDARDS"
  | "SCALE_DEVELOPMENT"
  | "COUPLE_ASSESSMENT"
  | "DECISION_STYLE"
  | "DYADIC_COPING"
  | "DEMAND_WITHDRAW"
  | "FINANCIAL_CONFLICT"
  | "KOREAN_WEDDING_RISK"
  | "WEDDING_PLATFORM_SEGMENTATION"
  | "HANBANG_ASSET"
  | "PRODUCT_DATA"
  | "UI_IDENTITY";

export type WeddingCodeProductSurface =
  | "amora"
  | "quote_check"
  | "etiquette_guide"
  | "checklist"
  | "community"
  | "couple_report"
  | "wedding_lounge"
  | "onboarding";

export type WeddingCodeConstructScoreSource =
  | "short_assessment"
  | "deep_assessment"
  | "inferred_behavior"
  | "manual";

export type WeddingCodeConstructScore = {
  key: WeddingCodeConstructKey;
  score: number; // 0-100
  confidence?: number; // 0-1
  source: WeddingCodeConstructScoreSource;
};

export type WeddingCodeContext = {
  relationshipStage:
    | "dating_or_meeting"
    | "marriage_discussion"
    | "preparing_without_date"
    | "venue_search"
    | "sdm_search"
    | "contract_pending"
    | "contracted"
    | "wedding_week"
    | "post_wedding";
  region?: string;
  budgetRange?: string;
  guestCountRange?: string;
  parentInvolvement?: "low" | "medium" | "high";
  quoteStatus?: "none" | "consulted" | "received" | "contracted";
};

export type WeddingCodePublicCodeCandidate = {
  // Derived presentation label only. Not the source of truth.
  slots: [string, string, string, string];
  labelKo: string;
  characterNameKo?: string;
  confidence: number;
  generatedFrom: WeddingCodeConstructKey[];
  isProvisional: true;
};

export type WeddingCodeProfile = {
  version: "genesis-v0.1";
  userId?: string;
  coupleId?: string;
  constructScores: WeddingCodeConstructScore[];
  context: WeddingCodeContext;
  publicCodeCandidate?: WeddingCodePublicCodeCandidate;
  createdAt: string;
  updatedAt: string;
};

export type WeddingCodeConstructDefinition = {
  key: WeddingCodeConstructKey;
  labelKo: string;
  labelEn: string;
  shortDefinitionKo: string;
  whatItMeasuresKo: string;
  whatItDoesNotMeasureKo: string;
  productSurfaces: WeddingCodeProductSurface[];
  provisionalPublicLetterCandidates: string[];
  evidenceTags: WeddingCodeEvidenceTag[];
  validationHypotheses: string[];
};

export type WeddingCodeValidationStatus =
  | "draft"
  | "expert_review"
  | "cognitive_interview"
  | "smoke_test"
  | "pilot"
  | "validated"
  | "retired";

export type WeddingCodeQuestionDraft = {
  id: string;
  version: string;
  textKo: string;
  targetConstruct: WeddingCodeConstructKey;
  secondaryConstructs?: WeddingCodeConstructKey[];
  evidenceTags: WeddingCodeEvidenceTag[];
  scenarioKo: string;
  responseFormat: "forced_choice" | "likert" | "ranking" | "free_text";
  optionsKo?: string[];
  highScoreMeaningKo: string;
  lowScoreMeaningKo: string;
  biasRiskKo?: string;
  reportMappingKo?: string;
  amoraMappingKo?: string;
  quoteCheckMappingKo?: string;
  etiquetteChecklistMappingKo?: string;
  validationStatus: WeddingCodeValidationStatus;
};

export type WeddingCodeReportAction = {
  id: string;
  titleKo: string;
  descriptionKo: string;
  surface: WeddingCodeProductSurface;
  constructTriggers: WeddingCodeConstructKey[];
};
