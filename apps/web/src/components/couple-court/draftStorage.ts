const LEGACY_CASE_DRAFT_KEY = "hanbang:couple-court:draft:v1";
const LEGACY_STATEMENT_KEY = /^hanbang:couple-court:statement:[0-9a-f-]{36}:(?:initial|revision)$/i;

interface DraftEnvelope<T> {
  version: 2;
  ownerUserId: string;
  value: T;
}

export function courtCaseDraftKey(ownerUserId: string): string {
  return `hanbang:couple-court:case-draft:v2:${ownerUserId}`;
}

export function courtStatementDraftKey(
  ownerUserId: string,
  caseId: string,
  revisionMode: boolean,
): string {
  return `hanbang:couple-court:statement-draft:v2:${ownerUserId}:${caseId}:${revisionMode ? "revision" : "initial"}`;
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
    if (key && LEGACY_STATEMENT_KEY.test(key)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}
