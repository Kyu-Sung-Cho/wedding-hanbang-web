export type PreparationTopicViewerRole = "bride" | "groom" | null;

export interface PreparationTopicSaveEligibilityContext {
  coupleId: string;
  viewerRole: PreparationTopicViewerRole;
}

export interface PreparationTopicSaveCandidate {
  id?: unknown;
  couple_id?: unknown;
  role?: unknown;
  sender_type?: unknown;
  content?: unknown;
  metadata?: unknown;
  visibility?: unknown;
}

export declare function isPreparationTopicMessageSaveEligible(
  message: PreparationTopicSaveCandidate,
  context: PreparationTopicSaveEligibilityContext,
): boolean;

export type PreparationTopicMessageRefErrorCode =
  | "invalid_request"
  | "stale_context"
  | "read_failed"
  | "write_failed"
  | "stale_revision"
  | "source_inaccessible"
  | "source_unavailable"
  | "timeout"
  | "cancelled"
  | "invalid_response";

export declare class PreparationTopicMessageRefError extends Error {
  readonly code: PreparationTopicMessageRefErrorCode;
  constructor(code: PreparationTopicMessageRefErrorCode);
}

export declare function getPreparationTopicMessageReferenceFocusPresentation(
  error: unknown,
): Readonly<{
  message: string;
  canRetry: boolean;
}>;

export interface PreparationTopicMessageRefApiResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type PreparationTopicMessageRefApiFetch = (
  path: string,
  options?: RequestInit,
) => Promise<PreparationTopicMessageRefApiResponse>;

export declare function loadPreparationTopicMessageReferences(options: {
  apiFetch: PreparationTopicMessageRefApiFetch;
  ownerId: string;
  coupleId: string;
  isCurrent: () => boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<import("@hanbang/shared/amora-preparation-topic-message-ref").AmoraPreparationTopicMessageRefCollectionResponse>;

export declare function loadPreparationTopicMessageReferenceState(options: {
  apiFetch: PreparationTopicMessageRefApiFetch;
  ownerId: string;
  coupleId: string;
  topicKey: string;
  messageId: string;
  isCurrent: () => boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<import("@hanbang/shared/amora-preparation-topic-message-ref").AmoraPreparationTopicMessageRefStateResponse>;

export declare function resolvePreparationTopicMessageReference(options: {
  apiFetch: PreparationTopicMessageRefApiFetch;
  ownerId: string;
  coupleId: string;
  refId: string;
  isCurrent: () => boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<import("@hanbang/shared/amora-preparation-topic-message-ref").AmoraPreparationTopicMessageRefResolveResponse>;

export interface PreparationTopicResolvedChatMessage {
  id: string;
  couple_id: string;
  sender_id: string | null;
  role: "user" | "assistant";
  sender_type: "bride" | "groom" | "ai";
  content: string;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
  visibility: "shared" | "bride_private" | "groom_private";
}

export declare function mergePreparationTopicResolvedConversation(
  currentMessages: readonly PreparationTopicResolvedChatMessage[],
  resolved: import("@hanbang/shared/amora-preparation-topic-message-ref").AmoraPreparationTopicMessageRefResolveResponse,
  viewerRole: PreparationTopicViewerRole,
): PreparationTopicResolvedChatMessage[];

export declare function mutatePreparationTopicMessageReference(options: {
  apiFetch: PreparationTopicMessageRefApiFetch;
  ownerId: string;
  coupleId: string;
  topicKey: string;
  messageId: string;
  desiredState: "saved" | "removed";
  requestId: string;
  isCurrent: () => boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<import("@hanbang/shared/amora-preparation-topic-message-ref").AmoraPreparationTopicMessageRefMutationResponse>;
