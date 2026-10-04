// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PAIR_SESSION_LOCAL_KEY, clearSavedPairSessionLink, forgetPairSession, pairSessionUrl, parsePairSessionHash,
  readPairSessionRecovery, readSavedPairSession, savePairSessionLink, savePairSessionRecovery, subscribePairSession,
  type PairSessionLink, type SavedPairSession,
} from "../pairSessionClient";

const now = Date.parse("2026-09-23T10:00:00Z");
const roomId = "11111111-1111-4111-8111-111111111111";
const otherRoomId = "22222222-2222-4222-8222-222222222222";
const access = "a".repeat(64);
const invitation = "b".repeat(64);
const saved: SavedPairSession = { roomId, token: access, invitation, mode: "member", expiresAt: new Date(now + 86_400_000).toISOString() };
const savePreference = "hanbang.wedding-code.v31.autosave";

beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); vi.spyOn(Date, "now").mockReturnValue(now); });
afterEach(() => { vi.restoreAllMocks(); window.localStorage.clear(); window.sessionStorage.clear(); });

describe("두 사람 비교의 주소와 기기 저장", () => {
  it("초대와 본인 확인 권한을 해시에서 구분한다", () => {
    expect(parsePairSessionHash(`#room=${roomId}&invite=${invitation}`)).toEqual({ roomId, token: invitation, mode: "invite" });
    expect(parsePairSessionHash(`room=${roomId}&access=${access}`)).toEqual({ roomId, token: access, mode: "member" });
    expect(parsePairSessionHash(`#room=${roomId}&access=${access}&invitation=${invitation}`)).toEqual({ roomId, token: access, mode: "member", invitation });
  });

  it("중복·알 수 없는 필드와 서로 섞인 접근 권한을 거절한다", () => {
    const member = `room=${roomId}&access=${access}&invitation=${invitation}`;
    const invite = `room=${roomId}&invite=${invitation}`;
    for (const invalid of [
      `${member}&room=${roomId}`, `${member}&access=${access}`, `${member}&invitation=${invitation}`,
      `${invite}&invite=${invitation}`, `${member}&unknown=1`, `${invite}&a=31_private_answers`,
      `${member}&invite=${invitation}`, `${invite}&invitation=${invitation}`, `room=${roomId}`,
      `room=${roomId}&access=`, `room=${roomId}&access=${access.slice(1)}`, `room=${roomId}&access=${access.toUpperCase()}`,
      `room=not-a-room&access=${access}`, "", "#",
    ]) expect(parsePairSessionHash(invalid), invalid).toBeNull();
  });

  it("권한은 fragment에만 담고 기존 경로·query를 버리며 사용자정보가 든 origin은 거절한다", () => {
    const links: PairSessionLink[] = [saved, { roomId, token: invitation, mode: "invite" }];
    for (const link of links) {
      const url = new URL(pairSessionUrl("https://hanbang.ai/landing?access=old-secret#old", link));
      expect(url.origin).toBe("https://hanbang.ai");
      expect(url.pathname).toBe("/wedding-code/together");
      expect(url.search).toBe("");
      expect(url.username).toBe(""); expect(url.password).toBe("");
      expect(url.href.split("#")[0]).not.toContain(link.token);
      expect(parsePairSessionHash(url.hash)).toEqual({ roomId: link.roomId, token: link.token, mode: link.mode, ...(link.invitation ? { invitation: link.invitation } : {}) });
      expect(new URLSearchParams(url.hash.slice(1)).has("a")).toBe(false);
      expect(new URLSearchParams(url.hash.slice(1)).has("b")).toBe(false);
    }
    for (const origin of ["https://user:password@example.invalid", "ftp://hanbang.ai", "javascript:alert(1)"]) {
      expect(() => pairSessionUrl(origin, saved)).toThrow();
    }
    expect(() => pairSessionUrl("https://hanbang.ai", { ...saved, token: "invalid" })).toThrow();
  });

  it("유효한 본인 주소만 복원하고 정확한 만료 시각부터 읽지 않는다", () => {
    window.localStorage.setItem("unrelated", "keep");
    expect(savePairSessionLink(saved)).toBe(true);
    expect(readSavedPairSession()).toEqual(saved);
    expect(readPairSessionRecovery(roomId)).toEqual(saved);
    vi.mocked(Date.now).mockReturnValue(Date.parse(saved.expiresAt));
    expect(readSavedPairSession()).toBeNull();
    expect(readPairSessionRecovery(roomId)).toBeNull();
    expect(window.localStorage.getItem(PAIR_SESSION_LOCAL_KEY)).toBeNull();
    expect(window.localStorage.getItem("unrelated")).toBe("keep");
  });

  it("손상되거나 초대 권한인 저장 내용과 알려지지 않은 필드를 복원하지 않는다", () => {
    for (const value of [null, [], { ...saved, mode: "invite" }, { ...saved, expiresAt: "invalid" },
      { ...saved, token: "bad" }, { ...saved, invitation: "bad" }, { ...saved, answerCode: "private" }]) {
      window.localStorage.setItem(PAIR_SESSION_LOCAL_KEY, JSON.stringify(value));
      expect(readSavedPairSession()).toBeNull();
    }
    window.localStorage.setItem(PAIR_SESSION_LOCAL_KEY, "{broken");
    expect(() => readSavedPairSession()).not.toThrow();
    expect(readSavedPairSession()).toBeNull();
  });

  it("다른 방을 종료해도 저장 주소를 지우지 않고 각 저장소의 해당 방만 지운다", () => {
    savePairSessionLink(saved);
    forgetPairSession(otherRoomId);
    expect(readSavedPairSession()).toEqual(saved);
    expect(readPairSessionRecovery(roomId)).toEqual(saved);
    expect(readPairSessionRecovery(otherRoomId)).toBeNull();
    const other = { ...saved, roomId: otherRoomId, token: "c".repeat(64) };
    savePairSessionRecovery(other);
    forgetPairSession(roomId);
    expect(readSavedPairSession()).toBeNull();
    expect(readPairSessionRecovery(otherRoomId)).toEqual(other);
    forgetPairSession(otherRoomId);
    expect(readPairSessionRecovery(otherRoomId)).toBeNull();
  });

  it("자동 저장 OFF에서는 영구 주소를 읽거나 새로 남기지 않고 현재 탭의 복구만 허용한다", () => {
    savePairSessionLink(saved);
    window.localStorage.setItem(savePreference, "off");
    expect(readSavedPairSession()).toBeNull();
    expect(clearSavedPairSessionLink()).toBe(true);
    const write = vi.spyOn(Storage.prototype, "setItem");
    expect(savePairSessionLink(saved)).toBe(false);
    expect(write.mock.calls.some(([key]) => key === PAIR_SESSION_LOCAL_KEY)).toBe(false);
    expect(window.localStorage.getItem(PAIR_SESSION_LOCAL_KEY)).toBeNull();
    expect(readPairSessionRecovery(roomId)).toEqual(saved);
    window.localStorage.removeItem(savePreference);
    expect(readSavedPairSession()).toBeNull();
  });

  it("기기 저장 차단은 성공으로 표시하지 않으며 서버 연결 종료를 대신하지 않는다", () => {
    const getLocalStorage = vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    expect(readSavedPairSession()).toBeNull();
    expect(savePairSessionLink(saved)).toBe(false);
    expect(clearSavedPairSessionLink()).toBe(false);
    expect(readPairSessionRecovery(roomId)).toEqual(saved);
    expect(() => forgetPairSession(roomId)).not.toThrow();
    getLocalStorage.mockRestore();
  });

  it("저장소가 막혀 루트 스니펫이 메모리 객체로 바꿔 끼운 브라우저에서는 이 브라우저에 저장했다고 말하지 않는다", () => {
    // 쓰고 읽어도 새로고침에 사라지는 객체라서 쓰기가 늘 성공해 보인다. 진짜 Storage 가 아니면 저장하지 않은 것으로 답해야 한다.
    const data = new Map<string, string>();
    const memory = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), removeItem: (key: string) => void data.delete(key), clear: () => data.clear(), key: () => null, length: 0 };
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => memory });
    try {
      expect(savePairSessionLink(saved)).toBe(false);
      expect(data.size).toBe(0);
      expect(readSavedPairSession()).toBeNull();
      expect(clearSavedPairSessionLink()).toBe(false);
      // 이 탭의 복구 주소(sessionStorage)는 이 변경과 상관없이 현재 탭에서 계속 쓴다.
      expect(readPairSessionRecovery(roomId)).toEqual(saved);
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original); else Reflect.deleteProperty(window, "localStorage");
    }
  });

  it("같은 탭과 다른 탭의 저장 변경을 알리고 구독 해제 후에는 알리지 않는다", () => {
    const listener = vi.fn(); const unsubscribe = subscribePairSession(listener);
    savePairSessionLink(saved); expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: PAIR_SESSION_LOCAL_KEY })); expect(listener).toHaveBeenCalledTimes(2);
    clearSavedPairSessionLink(); expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe(); savePairSessionLink(saved);
    window.dispatchEvent(new StorageEvent("storage", { key: PAIR_SESSION_LOCAL_KEY }));
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("방을 모르는 재방문도 현재 탭의 미확인 요청 주소를 찾고 만료·삭제 시에는 노출하지 않는다", () => {
    const listener = vi.fn(); const unsubscribe = subscribePairSession(listener);
    savePairSessionRecovery(saved);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(readPairSessionRecovery()).toEqual(saved);
    expect(readSavedPairSession()).toBeNull();
    forgetPairSession(roomId);
    expect(readPairSessionRecovery()).toBeNull();
    savePairSessionRecovery(saved);
    vi.mocked(Date.now).mockReturnValue(Date.parse(saved.expiresAt));
    expect(readPairSessionRecovery()).toBeNull();
    unsubscribe();
  });

  it("자동저장 OFF의 성공 주소도 현재 탭 구독자에게만 복구 변경을 알린다", () => {
    window.localStorage.setItem(savePreference, "off");
    const listener = vi.fn(); const unsubscribe = subscribePairSession(listener);
    expect(savePairSessionLink(saved)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(readPairSessionRecovery()).toEqual(saved);
    expect(window.localStorage.getItem(PAIR_SESSION_LOCAL_KEY)).toBeNull();
    unsubscribe();
  });
});
