import type {
  AmoraPreparationActionReceiptPageResponse,
  AmoraPreparationNotesPageResponse,
  AmoraPreparationScheduleDecisionPageResponse,
} from "@hanbang/shared/amora-preparation-topic-message-ref";

export type AmoraPreparationNotesLoadErrorCode =
  | "invalid_request"
  | "read_failed"
  | "stale_context"
  | "timeout"
  | "cancelled";

export declare class AmoraPreparationNotesLoadError extends Error {
  readonly code: AmoraPreparationNotesLoadErrorCode;
  constructor(code: AmoraPreparationNotesLoadErrorCode);
}

export declare function normalizeAmoraPreparationNotesQuery(
  value: unknown,
): string | null;

export declare function loadAmoraPreparationNotesMessagePage(options: Readonly<{
  ownerId: string;
  coupleId: string;
  query: string;
  cursor?: string | null;
  apiFetch: (
    path: string,
    options: Readonly<{
      method: "GET";
      headers: Readonly<{ Accept: "application/json" }>;
      signal: AbortSignal;
    }>,
  ) => Promise<Readonly<{ ok: boolean; json(): Promise<unknown> }>>;
  isCurrent: () => boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}>): Promise<AmoraPreparationNotesPageResponse>;

export declare function loadAmoraPreparationActionReceiptPage(options: Readonly<{
  ownerId: string;
  coupleId: string;
  query: string;
  cursor?: string | null;
  apiFetch: (
    path: string,
    options: Readonly<{
      method: "GET";
      headers: Readonly<{ Accept: "application/json" }>;
      signal: AbortSignal;
    }>,
  ) => Promise<Readonly<{ ok: boolean; json(): Promise<unknown> }>>;
  isCurrent: () => boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}>): Promise<AmoraPreparationActionReceiptPageResponse>;

export declare function loadAmoraPreparationScheduleDecisionPage(options: Readonly<{
  ownerId: string;
  coupleId: string;
  query: string;
  cursor?: string | null;
  apiFetch: (
    path: string,
    options: Readonly<{
      method: "GET";
      headers: Readonly<{ Accept: "application/json" }>;
      signal: AbortSignal;
    }>,
  ) => Promise<Readonly<{ ok: boolean; json(): Promise<unknown> }>>;
  isCurrent: () => boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}>): Promise<AmoraPreparationScheduleDecisionPageResponse>;

export type AmoraPreparationNotesReadState = "loaded" | "unavailable";

export type AmoraPreparationNotesSources = Readonly<{
  messageReferenceCollection: unknown;
  messageReferenceReadState: AmoraPreparationNotesReadState;
  actionReceiptCollection: unknown;
  actionReceiptReadState: AmoraPreparationNotesReadState;
  scheduleDecisionCollection: unknown;
  scheduleDecisionReadState: AmoraPreparationNotesReadState;
  ownerCriterionResponse: unknown;
  ownerCriterionReadState: AmoraPreparationNotesReadState;
  coupleCriterionResponse: unknown;
  coupleCriterionReadState: AmoraPreparationNotesReadState;
  openActions: readonly unknown[] | null;
  actionReadState: AmoraPreparationNotesReadState;
}>;

export declare function loadAmoraPreparationNotesSources(options: Readonly<{
  ownerId: string;
  coupleId: string;
  apiFetch: (
    path: string,
    options: Readonly<{
      method: "GET";
      headers: Readonly<{ Accept: "application/json" }>;
      signal: AbortSignal;
    }>,
  ) => Promise<Readonly<{ ok: boolean; json(): Promise<unknown> }>>;
  readOpenActions: (context: Readonly<{
    ownerId: string;
    coupleId: string;
    signal: AbortSignal;
  }>) => Promise<readonly unknown[]>;
  isCurrent: () => boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}>): Promise<AmoraPreparationNotesSources>;
import type {
  AmoraPreparationActionReceiptPageResponse,
  AmoraPreparationNotesPageResponse,
} from "@hanbang/shared/amora-preparation-topic-message-ref";
