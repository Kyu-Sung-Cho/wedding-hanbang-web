import type { AmoraPersonalizationPreferences } from "./amoraPersonalization.mjs";

export type PreparationTopicContextReadState =
  | "loading"
  | "loaded"
  | "partial"
  | "unavailable";

export interface PreparationTopicOwnerContext {
  readonly readState: PreparationTopicContextReadState;
  readonly preferences: Readonly<AmoraPersonalizationPreferences> | null;
  readonly coreCriterion: string | null;
}

export interface PreparationTopicCoupleContext {
  readonly readState: Exclude<PreparationTopicContextReadState, "partial">;
  readonly confirmedCriterion: string | null;
}

export type PreparationTopicPersonalizationSection = Readonly<{
  title: "우리 상황";
  items: readonly Readonly<{
    key: "owner-criterion" | "couple-criterion";
    title: "내 기준" | "우리 기준";
    detail: string;
    scopeLabel: "나만 보기" | "둘이 확인";
    accessibilityLabel: string;
  }>[];
  notices: readonly string[];
  note: string | null;
}>;

export type PreparationTopicAppliedCriterionEffect = Readonly<{
  topicKey: string;
  criterion: string;
  affects: "question" | "candidate" | "constraint" | "action";
}>;

export function buildPreparationTopicPersonalization(input: Readonly<{
  topicKey: string;
  ownerContext: PreparationTopicOwnerContext;
  coupleContext: PreparationTopicCoupleContext;
  appliedEffects: Readonly<{
    ownerCriterion: PreparationTopicAppliedCriterionEffect | null;
    coupleCriterion: PreparationTopicAppliedCriterionEffect | null;
  }> | null;
}>): PreparationTopicPersonalizationSection | null;

export type PreparationTopicPersonalizationErrorCode =
  | "invalid_request"
  | "read_failed"
  | "stale_context"
  | "timeout";

export class PreparationTopicPersonalizationError extends Error {
  readonly code: PreparationTopicPersonalizationErrorCode;
}

type PreparationTopicApiFetch = (
  path: string,
  options: {
    method: "GET";
    headers: { Accept: "application/json" };
    signal: AbortSignal;
  },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export function loadPreparationTopicOwnerContext(input: Readonly<{
  ownerId: string;
  apiFetch: PreparationTopicApiFetch;
  isCurrent: () => boolean;
  timeoutMs?: number;
}>): Promise<Readonly<{
  readState: "loaded" | "partial";
  preferences: Readonly<AmoraPersonalizationPreferences> | null;
  coreCriterion: string | null;
}>>;

export function loadPreparationTopicCoupleContext(input: Readonly<{
  ownerId: string;
  coupleId: string;
  apiFetch: PreparationTopicApiFetch;
  isCurrent: () => boolean;
  timeoutMs?: number;
}>): Promise<Readonly<{
  readState: "loaded";
  confirmedCriterion: string | null;
}>>;

export type PreparationTopicAmoraHandoff = Readonly<{
  title: "아모라와 이 준비 이어보기";
  description: "현재 상태와 기준을 가져가서 질문 한 가지부터 시작해요.";
  prompt: string;
  preparationTopic: import("./preparationTopicChatRoundTrip.mjs").PreparationTopicChatHandoffBinding;
}>;

export function buildPreparationTopicAmoraHandoff(input: Readonly<{
  topicKey: string;
  topicLabel: string;
  journeyRevision: number;
  actionRef: Readonly<{
    id: string;
    revision: number | null;
  }> | null;
  statusLabel: string;
  progressLabel: string;
  nextAction: Readonly<{
    title: string;
    reason: string;
    completionCriterion: string;
  }>;
  privateCriterion: string | null;
  useCoupleCriterion: boolean;
}>): PreparationTopicAmoraHandoff | null;
