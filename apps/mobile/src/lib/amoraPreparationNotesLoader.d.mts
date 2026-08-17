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

export type AmoraPreparationNotesReadState = "loaded" | "unavailable";

export type AmoraPreparationNotesSources = Readonly<{
  messageReferenceCollection: unknown;
  messageReferenceReadState: AmoraPreparationNotesReadState;
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
