const LEGACY_COMMUNITY_DRAFT_KEY = "community_post_draft";

function ownerSegment(ownerId: string): string {
  const normalized = ownerId.trim();
  if (!normalized) throw new Error("A browser-storage owner is required.");
  return encodeURIComponent(normalized);
}

export function etiquetteChecksStorageKey(ownerId: string, partNumber: number): string {
  return `etiquette_checks:${ownerSegment(ownerId)}:${partNumber}`;
}

export function etiquetteMemosStorageKey(ownerId: string, partNumber: number): string {
  return `etiquette_memos:${ownerSegment(ownerId)}:${partNumber}`;
}

/**
 * The old draft key was shared by every account using the same browser. It is
 * deliberately discarded instead of being assigned to whichever account logs
 * in first, because ownership cannot be proven after the fact.
 */
export function removeLegacyCommunityDraft(storage: Pick<Storage, "removeItem">): boolean {
  try {
    storage.removeItem(LEGACY_COMMUNITY_DRAFT_KEY);
    return true;
  } catch {
    // The retired draft is never read, so blocked storage must not block the
    // server-backed writer. A later visit may retry the best-effort cleanup.
    return false;
  }
}

/** Remove old unscoped etiquette data whose owner cannot be established. */
export function removeLegacyEtiquetteData(
  storage: Pick<Storage, "removeItem">,
  partNumber: number
): void {
  storage.removeItem(`etiquette_checks_${partNumber}`);
  storage.removeItem(`etiquette_memos_${partNumber}`);
}

export interface EtiquetteDeviceSnapshot {
  checkedItemIds: string[];
  itemMemos: Record<string, string>;
}

function parseStoredJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${label} JSON을 읽을 수 없습니다.`);
  }
}

/**
 * Read checks and memos as one validated snapshot. A blocked/corrupt browser
 * store throws so the UI can fail closed instead of presenting saved records
 * as a genuine empty state.
 */
export function readEtiquetteDeviceSnapshot(
  storage: Pick<Storage, "getItem" | "removeItem">,
  ownerId: string,
  partNumber: number,
): EtiquetteDeviceSnapshot {
  removeLegacyEtiquetteData(storage, partNumber);

  const checksRaw = storage.getItem(etiquetteChecksStorageKey(ownerId, partNumber));
  const memosRaw = storage.getItem(etiquetteMemosStorageKey(ownerId, partNumber));
  const parsedChecks = checksRaw ? parseStoredJson(checksRaw, "체크 기록") : [];
  const parsedMemos = memosRaw ? parseStoredJson(memosRaw, "메모 기록") : {};

  if (!Array.isArray(parsedChecks) || parsedChecks.some((value) => typeof value !== "string")) {
    throw new Error("체크 기록 형식을 확인할 수 없습니다.");
  }
  if (!parsedMemos || typeof parsedMemos !== "object" || Array.isArray(parsedMemos)) {
    throw new Error("메모 기록 형식을 확인할 수 없습니다.");
  }
  const memoEntries = Object.entries(parsedMemos);
  if (memoEntries.some(([key, value]) => key.length === 0 || typeof value !== "string")) {
    throw new Error("메모 기록 형식을 확인할 수 없습니다.");
  }

  return {
    checkedItemIds: [...new Set(parsedChecks)],
    itemMemos: Object.fromEntries(memoEntries) as Record<string, string>,
  };
}
