import { beforeEach, describe, expect, it } from "vitest";
import {
  WC_RESULT_STORAGE_KEY,
  clearWcResultBackup,
  isCompleteCurrentWcResultBackup,
  isCurrentWcResultBackup,
  readWcResultBackup,
  resetWcResultBackupMemoryForTests,
  storeWcResultBackup,
  type WcResultBackup,
} from "./resultBackup";
import {
  WEDDING_CODE_V05_QUESTIONS,
  WEDDING_CODE_V05_SCORING_VERSION,
  WEDDING_CODE_V05_VERSION,
} from "@/constants/weddingCodeV05";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class WriteBlockedStorage extends MemoryStorage {
  override setItem(): void {
    throw new DOMException("storage blocked", "SecurityError");
  }
}

function setStorages(localStorage: Storage, sessionStorage: Storage): void {
  Object.defineProperty(window, "localStorage", { configurable: true, value: localStorage });
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: sessionStorage });
}

function backup(responseId: string): WcResultBackup {
  return {
    answers: { A1: "A" },
    skipped: {},
    version: WEDDING_CODE_V05_VERSION,
    scoringVersion: WEDDING_CODE_V05_SCORING_VERSION,
    responseId,
    paired: false,
    coupleToken: null,
    savedAt: new Date().toISOString(),
  };
}

describe("웨딩코드 결과 브라우저 백업", () => {
  beforeEach(() => {
    resetWcResultBackupMemoryForTests();
    setStorages(new MemoryStorage(), new MemoryStorage());
  });

  it("localStorage 결과를 읽을 때 과거 서버 응답 식별자를 제거한다", () => {
    const result = backup("local-result");

    expect(storeWcResultBackup(result)).toBe("local");
    resetWcResultBackupMemoryForTests();

    const restored = readWcResultBackup();
    expect(restored).not.toHaveProperty("responseId");
    expect(restored).not.toHaveProperty("coupleToken");
    expect(restored?.storageFallback).toBeUndefined();
  });

  it("localStorage 쓰기가 막히면 sessionStorage로 내려가 로컬 결과를 유지한다", () => {
    setStorages(new WriteBlockedStorage(), new MemoryStorage());

    expect(storeWcResultBackup(backup("session-result"))).toBe("session");
    resetWcResultBackupMemoryForTests();

    const restored = readWcResultBackup();
    expect(restored).toMatchObject({ storageFallback: "session" });
    expect(restored).not.toHaveProperty("responseId");
  });

  it("두 브라우저 저장소가 모두 막혀도 현재 탭 메모리에서 즉시 결과를 연다", () => {
    setStorages(new WriteBlockedStorage(), new WriteBlockedStorage());

    expect(storeWcResultBackup(backup("memory-result"))).toBe("memory");
    const restored = readWcResultBackup();
    expect(restored).toMatchObject({ storageFallback: "memory" });
    expect(restored).not.toHaveProperty("responseId");
  });

  it("채점 버전이 빠진 정확한 현재 폼만 보완하고 candidate.9는 새 기준으로 올리지 않는다", () => {
    const local = new MemoryStorage();
    setStorages(local, new MemoryStorage());
    const legacy = { ...backup("legacy-result"), scoringVersion: undefined };
    local.setItem(WC_RESULT_STORAGE_KEY, JSON.stringify(legacy));

    expect(readWcResultBackup()?.scoringVersion).toBe(WEDDING_CODE_V05_SCORING_VERSION);

    resetWcResultBackupMemoryForTests();
    local.setItem(
      WC_RESULT_STORAGE_KEY,
      JSON.stringify({ ...legacy, version: "v0.5-candidate.9" })
    );
    expect(readWcResultBackup()?.scoringVersion).toBeUndefined();
  });

  it("폼·계산 버전과 16개 유효 답변이 모두 맞아야 현재 완료 결과로 인정한다", () => {
    const complete = {
      ...backup("complete"),
      responseId: null,
      answers: Object.fromEntries(WEDDING_CODE_V05_QUESTIONS.map((question) => [question.key, "A"])),
    };
    expect(isCurrentWcResultBackup(complete)).toBe(true);
    expect(isCompleteCurrentWcResultBackup(complete)).toBe(true);

    expect(
      isCurrentWcResultBackup({ ...complete, version: "v0.5-candidate.9" })
    ).toBe(false);
    expect(
      isCompleteCurrentWcResultBackup({ ...complete, version: "v0.5-candidate.9" })
    ).toBe(false);
    expect(isCompleteCurrentWcResultBackup({ ...complete, answers: { A1: "A" } })).toBe(false);
    expect(
      isCompleteCurrentWcResultBackup({ ...complete, answers: { ...complete.answers, A1: "D" } })
    ).toBe(false);
  });

  it("사용자가 요청하면 local·session·memory 결과를 모두 지운다", () => {
    storeWcResultBackup(backup("clear-me"));
    expect(readWcResultBackup()).not.toBeNull();

    clearWcResultBackup();

    expect(readWcResultBackup()).toBeNull();
    expect(window.localStorage.getItem(WC_RESULT_STORAGE_KEY)).toBeNull();
  });

  it("30일이 지난 로컬 결과는 읽지 않고 저장소에서도 제거한다", () => {
    const local = new MemoryStorage();
    setStorages(local, new MemoryStorage());
    local.setItem(
      WC_RESULT_STORAGE_KEY,
      JSON.stringify({
        ...backup("expired-result"),
        savedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      })
    );

    expect(readWcResultBackup()).toBeNull();
    expect(local.getItem(WC_RESULT_STORAGE_KEY)).toBeNull();
  });

  it("rejects a far-future backup so it cannot outlive or mask a current result", () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    setStorages(local, session);
    const currentSavedAt = new Date().toISOString();

    local.setItem(
      WC_RESULT_STORAGE_KEY,
      JSON.stringify({
        ...backup("future-local"),
        answers: { A1: "A" },
        savedAt: "9999-12-31T23:59:59.999Z",
        updatedAt: "9999-12-31T23:59:59.999Z",
      })
    );
    session.setItem(
      "wc_result_v05_session",
      JSON.stringify({
        ...backup("current-session"),
        answers: { A1: "B" },
        savedAt: currentSavedAt,
        updatedAt: currentSavedAt,
      })
    );

    expect(readWcResultBackup()?.answers).toEqual({ A1: "B" });
    expect(local.getItem(WC_RESULT_STORAGE_KEY)).toBeNull();
  });

  it("과거 페어링 capability가 남아 있어도 읽는 즉시 제거하고 다시 쓴다", () => {
    const local = new MemoryStorage();
    setStorages(local, new MemoryStorage());
    const original = backup("freshness-result");
    storeWcResultBackup(original);

    local.setItem(
      WC_RESULT_STORAGE_KEY,
      JSON.stringify({
        ...original,
        coupleToken: "223e4567-e89b-42d3-a456-426614174000",
        updatedAt: "9999-12-31T23:59:59.999Z",
      })
    );

    const restored = readWcResultBackup();
    expect(restored).not.toHaveProperty("responseId");
    expect(restored).not.toHaveProperty("coupleToken");
    expect(restored).not.toHaveProperty("paired");
    expect(restored).not.toHaveProperty("pairingStatus");
    const rewritten = local.getItem(WC_RESULT_STORAGE_KEY) ?? "";
    expect(rewritten).not.toContain("223e4567-e89b-42d3-a456-426614174000");
    expect(rewritten).not.toContain("freshness-result");
  });

  it("더 최신인 clean 세션 결과가 선택돼도 오래된 local capability까지 함께 제거한다", () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    setStorages(local, session);
    const oldSavedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const newSavedAt = new Date().toISOString();

    local.setItem(
      WC_RESULT_STORAGE_KEY,
      JSON.stringify({
        ...backup("old-local-response"),
        coupleToken: "old-local-couple-token",
        pendingCoupleToken: "old-local-pending-token",
        pairingStatus: "paired",
        savedAt: oldSavedAt,
        updatedAt: oldSavedAt,
      })
    );
    session.setItem(
      "wc_result_v05_session",
      JSON.stringify({
        ...backup(""),
        responseId: undefined,
        coupleToken: undefined,
        answers: { A1: "B" },
        savedAt: newSavedAt,
        updatedAt: newSavedAt,
      })
    );

    const restored = readWcResultBackup();
    expect(restored?.answers).toEqual({ A1: "B" });

    const rewrittenLocal = local.getItem(WC_RESULT_STORAGE_KEY) ?? "";
    expect(rewrittenLocal).not.toContain("old-local-response");
    expect(rewrittenLocal).not.toContain("old-local-couple-token");
    expect(rewrittenLocal).not.toContain("old-local-pending-token");
    expect(rewrittenLocal).not.toContain("pairingStatus");
  });
});
