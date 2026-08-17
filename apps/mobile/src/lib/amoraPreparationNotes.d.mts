export type AmoraPreparationNotesScope = "owner_private" | "couple_shared";
export type AmoraPreparationNotesScopeFilter = "all" | AmoraPreparationNotesScope;
export type AmoraPreparationNotesTopicFilter = "all" | string;
export type AmoraPreparationNotesTypeFilter =
  | "all"
  | "saved_conversation"
  | "owner_criterion"
  | "couple_criterion"
  | "confirmed_decision"
  | "applied_receipt";

export type AmoraPreparationNotesState =
  | "loading"
  | "ready"
  | "empty"
  | "no_results"
  | "partial"
  | "read_error";

export type AmoraPreparationNotesSavedConversationRecord = Readonly<{
  id: string;
  type: "saved_conversation";
  typeLabel: "저장 대화";
  excerpt: string;
  topicKeys: readonly string[];
  topicLabels: readonly string[];
  scope: AmoraPreparationNotesScope;
  scopeLabel: "나만 보기" | "함께 보기";
  savedAt: string;
  sourceCreatedAt: string;
  freshness: "current";
  openOriginal: Readonly<{ refId: string }>;
}>;

export type AmoraPreparationNotesCriterionRecord = Readonly<{
  id: string;
  type: "owner_criterion" | "couple_criterion";
  typeLabel: "내 기준" | "우리 기준";
  excerpt: string;
  topicKeys: readonly [];
  topicLabels: readonly [];
  scope: AmoraPreparationNotesScope;
  scopeLabel: "나만 보기" | "함께 보기";
  savedAt: string;
  sourceCreatedAt: string;
  freshness: "current";
  openSource: Readonly<{
    route: "/settings/amora-style";
    focus: "owner_criterion" | "couple_criterion";
  }>;
}>;

export type AmoraPreparationNotesRecord =
  | AmoraPreparationNotesSavedConversationRecord
  | AmoraPreparationNotesCriterionRecord;

export type AmoraPreparationNotesView = Readonly<{
  state: AmoraPreparationNotesState;
  query: string;
  scopeFilter: AmoraPreparationNotesScopeFilter;
  topicFilter: AmoraPreparationNotesTopicFilter;
  typeFilter: AmoraPreparationNotesTypeFilter;
  continuingStory: Readonly<{
    actionId: string;
    actionRevision: number | null;
    topicKey: string;
    topicLabel: string;
    title: string;
    description: string;
    route: "/checklist";
  }> | null;
  records: readonly AmoraPreparationNotesRecord[];
}>;

export declare function buildAmoraPreparationNotes(input: Readonly<{
  ownerId: string;
  coupleId: string;
  topics: readonly Readonly<{ key: string; label: string }>[];
  messageReferenceCollection: unknown;
  messageReferenceReadState: "loading" | "loaded" | "partial" | "unavailable";
  ownerCriterionResponse?: unknown;
  ownerCriterionReadState?: "loading" | "loaded" | "partial" | "unavailable";
  coupleCriterionResponse?: unknown;
  coupleCriterionReadState?: "loading" | "loaded" | "partial" | "unavailable";
  openActions?: readonly unknown[];
  actionReadState?: "loaded" | "unavailable";
  todayYmd?: string;
  query: string;
  scopeFilter: AmoraPreparationNotesScopeFilter;
  topicFilter?: AmoraPreparationNotesTopicFilter;
  typeFilter: AmoraPreparationNotesTypeFilter;
}>): AmoraPreparationNotesView;
