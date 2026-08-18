export const AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONTRACT_VERSION: 1;
export const AMORA_PREPARATION_TOPIC_MESSAGE_REF_LIST_LIMIT: 80;
export const AMORA_PREPARATION_NOTES_PAGE_LIMIT: 24;
export const AMORA_PREPARATION_ACTION_RECEIPT_PAGE_LIMIT: 24;

export type AmoraPreparationTopicMessageRefAudience =
  | "couple_shared"
  | "owner_private";

export interface AmoraPreparationTopicMessageRefCollectionItem {
  refId: string;
  topicKey: string;
  messageId: string;
  audience: AmoraPreparationTopicMessageRefAudience;
  revision: number;
  savedAt: string;
  sourceCreatedAt: string;
  excerpt: string;
  canRemove: true;
  canOpenOriginal: true;
}

export interface AmoraPreparationTopicMessageRefCollectionResponse {
  version: 1;
  state: "ready";
  recipientUserId: string;
  coupleId: string;
  references: AmoraPreparationTopicMessageRefCollectionItem[];
  partial: boolean;
}

export interface AmoraPreparationNotesPageEntry {
  refId: string;
  topicKey: string;
  messageId: string;
  audience: AmoraPreparationTopicMessageRefAudience;
  revision: number;
  savedAt: string;
  sourceCreatedAt: string;
  questionExcerpt: string;
  answerExcerpt: string;
  canRemove: true;
  canOpenOriginal: true;
}

export interface AmoraPreparationNotesPageResponse {
  version: 1;
  state: "ready";
  recipientUserId: string;
  coupleId: string;
  snapshotAt: string;
  entries: AmoraPreparationNotesPageEntry[];
  nextCursor: string | null;
  partial: boolean;
}

export interface AmoraPreparationActionReceiptPageEntry {
  receiptMessageId: string;
  actionId: string;
  topicKey: string | null;
  title: string;
  displayMessage: string;
  appliedAt: string;
  scope: "couple_shared";
  canOpenAction: true;
}

export interface AmoraPreparationActionReceiptPageResponse {
  version: 1;
  state: "ready";
  recipientUserId: string;
  coupleId: string;
  snapshotAt: string;
  entries: AmoraPreparationActionReceiptPageEntry[];
  nextCursor: string | null;
  partial: boolean;
}

export interface AmoraPreparationTopicMessageRefMutationRequest {
  topicKey: string;
  messageId: string;
  desiredState: "saved" | "removed";
  expectedRevision: number;
  requestId: string;
}

export interface AmoraPreparationTopicMessageRefStateReference {
  topicKey: string;
  messageId: string;
  refId: string | null;
  audience: AmoraPreparationTopicMessageRefAudience;
  savedState: "saved" | "removed";
  revision: number;
}

export interface AmoraPreparationTopicMessageRefStateResponse {
  version: 1;
  state: "ready";
  recipientUserId: string;
  coupleId: string;
  reference: AmoraPreparationTopicMessageRefStateReference;
}

export interface AmoraPreparationTopicMessageRefMutationResponse
  extends AmoraPreparationTopicMessageRefStateResponse {
  reused: boolean;
}

export interface AmoraPreparationTopicMessageRefResolvedMessage {
  messageId: string;
  lane: "shared" | "private";
  content: string;
  createdAt: string;
}

export interface AmoraPreparationTopicMessageRefResolvedQuestion
  extends AmoraPreparationTopicMessageRefResolvedMessage {
  senderType: "bride" | "groom";
}

export interface AmoraPreparationTopicMessageRefResolveResponse {
  version: 1;
  state: "ready";
  recipientUserId: string;
  coupleId: string;
  reference: {
    refId: string;
    topicKey: string;
    messageId: string;
    audience: AmoraPreparationTopicMessageRefAudience;
    revision: number;
    savedAt: string;
  };
  target: AmoraPreparationTopicMessageRefResolvedMessage;
  question: AmoraPreparationTopicMessageRefResolvedQuestion | null;
}

export type AmoraPreparationTopicMessageRefValidation<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason:
        | "invalid"
        | "version"
        | "recipient"
        | "couple"
        | "collection"
        | "reference";
    };

export function isAmoraPreparationTopicMessageRefTopicKey(
  value: unknown,
): value is string;

export function parseAmoraPreparationTopicMessageRefMutationRequest(
  value: unknown,
): AmoraPreparationTopicMessageRefMutationRequest | null;

export function validateAmoraPreparationTopicMessageRefCollectionResponse(
  value: unknown,
  expectedRecipientUserId: string,
  expectedCoupleId: string,
): AmoraPreparationTopicMessageRefValidation<
  AmoraPreparationTopicMessageRefCollectionResponse
>;

export function validateAmoraPreparationNotesPageResponse(
  value: unknown,
  expectedRecipientUserId: string,
  expectedCoupleId: string,
): AmoraPreparationTopicMessageRefValidation<AmoraPreparationNotesPageResponse>;

export function validateAmoraPreparationActionReceiptPageResponse(
  value: unknown,
  expectedRecipientUserId: string,
  expectedCoupleId: string,
): AmoraPreparationTopicMessageRefValidation<AmoraPreparationActionReceiptPageResponse>;

export function validateAmoraPreparationTopicMessageRefStateResponse(
  value: unknown,
  expectedRecipientUserId: string,
  expectedCoupleId: string,
  expectedTopicKey: string,
  expectedMessageId: string,
): AmoraPreparationTopicMessageRefValidation<
  AmoraPreparationTopicMessageRefStateResponse
>;

export function validateAmoraPreparationTopicMessageRefMutationResponse(
  value: unknown,
  expectedRecipientUserId: string,
  expectedCoupleId: string,
  expectedTopicKey: string,
  expectedMessageId: string,
  expectedDesiredState: "saved" | "removed",
): AmoraPreparationTopicMessageRefValidation<
  AmoraPreparationTopicMessageRefMutationResponse
>;

export function validateAmoraPreparationTopicMessageRefResolveResponse(
  value: unknown,
  expectedRecipientUserId: string,
  expectedCoupleId: string,
  expectedRefId: string,
): AmoraPreparationTopicMessageRefValidation<
  AmoraPreparationTopicMessageRefResolveResponse
>;
