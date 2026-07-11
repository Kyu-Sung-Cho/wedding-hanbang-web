import { beforeEach, describe, expect, it } from "vitest";
import {
  WC_RESULT_STORAGE_KEY,
  readWcResultBackup,
  resetWcResultBackupMemoryForTests,
  storeWcResultBackup,
  type WcResultBackup,
} from "./resultBackup";
import {
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

    expect(readWcResultBackup()).toMatchObject({ responseId: null, coupleToken: null });
    expect(readWcResultBackup()?.storageFallback).toBeUndefined();
  });

  it("localStorage 쓰기가 막히면 sessionStorage로 내려가 로컬 결과를 유지한다", () => {
    setStorages(new WriteBlockedStorage(), new MemoryStorage());

    expect(storeWcResultBackup(backup("session-result"))).toBe("session");
    resetWcResultBackupMemoryForTests();

    expect(readWcResultBackup()).toMatchObject({
      responseId: null,
      storageFallback: "session",
    });
  });

  it("두 브라우저 저장소가 모두 막혀도 현재 탭 메모리에서 즉시 결과를 연다", () => {
    setStorages(new WriteBlockedStorage(), new WriteBlockedStorage());

    expect(storeWcResultBackup(backup("memory-result"))).toBe("memory");
    expect(readWcResultBackup()).toMatchObject({
      responseId: null,
      storageFallback: "memory",
    });
  });

  it("채점 버전 필드가 없던 알려진 v0.5 백업만 현재 채점 계약으로 이관한다", () => {
    const local = new MemoryStorage();
    setStorages(local, new MemoryStorage());
    const legacy = { ...backup("legacy-result"), scoringVersion: undefined };
    local.setItem(WC_RESULT_STORAGE_KEY, JSON.stringify(legacy));

    expect(readWcResultBackup()?.scoringVersion).toBe(WEDDING_CODE_V05_SCORING_VERSION);

    resetWcResultBackupMemoryForTests();
    local.setItem(
      WC_RESULT_STORAGE_KEY,
      JSON.stringify({ ...legacy, version: "v0.4.2" })
    );
    expect(readWcResultBackup()?.scoringVersion).toBeUndefined();
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

    expect(readWcResultBackup()).toMatchObject({
      responseId: null,
      coupleToken: null,
      paired: false,
      pairingStatus: "unpaired",
    });
    const rewritten = local.getItem(WC_RESULT_STORAGE_KEY) ?? "";
    expect(rewritten).not.toContain("223e4567-e89b-42d3-a456-426614174000");
    expect(rewritten).not.toContain("freshness-result");
  });
});
