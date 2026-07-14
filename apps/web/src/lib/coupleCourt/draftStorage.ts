const LEGACY_CASE_DRAFT_KEY = "hanbang:couple-court:draft:v1";
const LEGACY_STATEMENT_KEY = /^hanbang:couple-court:statement:[0-9a-f-]{36}:(?:initial|revision)$/i;
const CASE_DRAFT_PREFIX = "hanbang:couple-court:case-draft:v2:";
const STATEMENT_DRAFT_PREFIX = "hanbang:couple-court:statement-draft:v2:";
export const PUBLIC_COMMENT_DRAFT_PREFIX = "hanbang:couple-court:public-comment-draft:v2:";
const LEGACY_PUBLIC_COMMENT_DRAFT_PREFIX = "hanbang:couple-court:public-comment-draft:v1:";

interface DraftEnvelope<T> {
  version: 2;
  ownerUserId: string;
  value: T;
}

export function courtCaseDraftKey(ownerUserId: string): string {
  return `${CASE_DRAFT_PREFIX}${ownerUserId}`;
}

export function courtStatementDraftKey(
  ownerUserId: string,
  caseId: string,
  revisionMode: boolean,
): string {
  return `${STATEMENT_DRAFT_PREFIX}${ownerUserId}:${caseId}:${revisionMode ? "revision" : "initial"}`;
}

export function publicCommentDraftKey(ownerUserId: string, postId: string): string {
  return `${PUBLIC_COMMENT_DRAFT_PREFIX}${ownerUserId}:${encodeURIComponent(postId)}`;
}

export function readScopedCourtDraft<T>(
  storage: Storage,
  key: string,
  ownerUserId: string,
): T | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const envelope = JSON.parse(raw) as Partial<DraftEnvelope<T>>;
    if (
      envelope.version !== 2
      || envelope.ownerUserId !== ownerUserId
      || envelope.value === null
      || typeof envelope.value !== "object"
    ) {
      storage.removeItem(key);
      return null;
    }
    return envelope.value as T;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function writeScopedCourtDraft<T>(
  storage: Storage,
  key: string,
  ownerUserId: string,
  value: T,
): void {
  const envelope: DraftEnvelope<T> = { version: 2, ownerUserId, value };
  storage.setItem(key, JSON.stringify(envelope));
}

/** Removes only pre-user-scope formats that could cross an account switch. */
export function clearLegacyCourtDrafts(storage: Storage): void {
  storage.removeItem(LEGACY_CASE_DRAFT_KEY);
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (
      key
      && (LEGACY_STATEMENT_KEY.test(key)
        || key.startsWith(LEGACY_PUBLIC_COMMENT_DRAFT_PREFIX))
    ) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

/** Removes private drafts owned by the identity that just left this browser session. */
export function clearCourtDraftsForOwner(storage: Storage, ownerUserId: string): void {
  storage.removeItem(courtCaseDraftKey(ownerUserId));
  const statementPrefix = `${STATEMENT_DRAFT_PREFIX}${ownerUserId}:`;
  const publicCommentPrefix = `${PUBLIC_COMMENT_DRAFT_PREFIX}${ownerUserId}:`;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (
      key?.startsWith(statementPrefix)
      || key?.startsWith(publicCommentPrefix)
    ) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}
