import { requireRealLocalStorage } from "./browserStorageHandle";
import { isPairSessionRecord, isPairSessionRoomId, isPairSessionToken } from "./pairSessionContract";

export const PAIR_SESSION_LOCAL_KEY = "hanbang:wedding-code:comparison:v1";
const RECOVERY_KEY = "hanbang:wedding-code:comparison-recovery:v1";
const SAVE_PREFERENCE_KEY = "hanbang.wedding-code.v31.autosave";
export type PairSessionLink = { roomId: string; token: string; mode: "invite" | "member"; invitation?: string };
export type SavedPairSession = PairSessionLink & { expiresAt: string };

export function parsePairSessionHash(hash: string): PairSessionLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const keys = [...params.keys()];
  if (keys.some(key => !["room", "access", "invite", "invitation"].includes(key) || params.getAll(key).length !== 1)) return null;
  const roomId = params.get("room");
  if (!isPairSessionRoomId(roomId)) return null;
  if (params.has("access")) {
    const token = params.get("access"); const invitation = params.get("invitation");
    return !params.has("invite") && isPairSessionToken(token) && (invitation === null || isPairSessionToken(invitation))
      ? { roomId, token, mode: "member", ...(invitation ? { invitation } : {}) } : null;
  }
  const token = params.get("invite");
  return keys.length === 2 && isPairSessionToken(token) ? { roomId, token, mode: "invite" } : null;
}

export function pairSessionUrl(origin: string, link: PairSessionLink): string {
  const url = new URL("/wedding-code/together", origin);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("잘못된 비교 주소예요.");
  const params = new URLSearchParams({ room: link.roomId, [link.mode === "invite" ? "invite" : "access"]: link.token });
  if (link.mode === "member" && link.invitation) params.set("invitation", link.invitation);
  if (!parsePairSessionHash(params.toString())) throw new Error("잘못된 비교 링크예요.");
  url.hash = params.toString(); return url.toString();
}

function readSaved(storage: Storage, key: string): SavedPairSession | null {
  try {
    const raw = storage.getItem(key); if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isPairSessionRecord(value) || typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt))
      || Date.parse(value.expiresAt) <= Date.now() || value.mode !== "member"
      || !isPairSessionRoomId(value.roomId) || !isPairSessionToken(value.token)
      || (value.invitation !== undefined && !isPairSessionToken(value.invitation))
      || Object.keys(value).some(item => !["roomId", "token", "mode", "invitation", "expiresAt"].includes(item))) {
      storage.removeItem(key); return null;
    }
    return { roomId: value.roomId, token: value.token, mode: "member", expiresAt: value.expiresAt,
      ...(typeof value.invitation === "string" ? { invitation: value.invitation } : {}) };
  } catch { return null; }
}

/**
 * 이 브라우저(localStorage)에 남긴 확인 주소만 읽는다. 저장소가 막혀 메모리 객체로 갈아 끼워진 브라우저에서는
 * 쓰고 읽어도 새로고침에 사라지는 저장소를 믿고 「저장했어요」라고 말하지 않도록, 진짜 저장소가 아니면 없다고 답한다.
 */
export function readSavedPairSession(): SavedPairSession | null {
  try { const storage = requireRealLocalStorage(); return storage.getItem(SAVE_PREFERENCE_KEY) === "off" ? null : readSaved(storage, PAIR_SESSION_LOCAL_KEY); }
  catch { return null; }
}
export function readPairSessionRecovery(roomId?: string): SavedPairSession | null {
  try { const saved = readSaved(window.sessionStorage, RECOVERY_KEY); return roomId === undefined || saved?.roomId === roomId ? saved : null; }
  catch { return null; }
}
function writePairSessionRecovery(value: SavedPairSession): boolean {
  try { window.sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(value)); return true; }
  catch { return false; }
}
export function savePairSessionRecovery(value: SavedPairSession): void {
  if (writePairSessionRecovery(value)) window.dispatchEvent(new Event("wedding-code-comparison-change"));
}
export function savePairSessionLink(value: SavedPairSession): boolean {
  let changed = writePairSessionRecovery(value);
  try {
    // 메모리로 갈아 끼워진 저장소는 쓰기가 늘 성공해 보이므로 진짜 저장소일 때만 이 브라우저에 남겼다고 말한다(아니면 던져서 false).
    const storage = requireRealLocalStorage();
    if (storage.getItem(SAVE_PREFERENCE_KEY) === "off") return false;
    storage.setItem(PAIR_SESSION_LOCAL_KEY, JSON.stringify(value)); changed = true; return true;
  } catch { return false; }
  finally { if (changed) window.dispatchEvent(new Event("wedding-code-comparison-change")); }
}
export function clearSavedPairSessionLink(): boolean {
  try {
    requireRealLocalStorage().removeItem(PAIR_SESSION_LOCAL_KEY);
    window.dispatchEvent(new Event("wedding-code-comparison-change"));
    return true;
  } catch { return false; }
}
export function forgetPairSession(roomId: string): void {
  for (const [getStorage, key] of [[requireRealLocalStorage, PAIR_SESSION_LOCAL_KEY], [() => window.sessionStorage, RECOVERY_KEY]] as const) {
    try { const storage = getStorage(); if (readSaved(storage, key)?.roomId === roomId) storage.removeItem(key); } catch { /* 저장소 차단이 서버 연결 종료를 되돌리지 않는다. */ }
  }
  window.dispatchEvent(new Event("wedding-code-comparison-change"));
}

export function subscribePairSession(listener: () => void): () => void {
  window.addEventListener("storage", listener); window.addEventListener("wedding-code-comparison-change", listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener("wedding-code-comparison-change", listener); };
}
