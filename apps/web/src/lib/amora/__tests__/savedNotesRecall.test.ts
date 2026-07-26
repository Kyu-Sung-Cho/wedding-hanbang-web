import { describe, expect, it } from "vitest";

import {
  SAVED_NOTES_RECALL_DAYS_BEFORE,
  shouldRecallSavedNotes,
} from "../savedNotesRecall";

// 발화는 하루짜리 창이라 경계에서 어긋나면 영영 안 나가거나 매일 나간다.
// KST 기준으로 D-60 하루만 열리는지 양옆까지 확인한다.
const NOW = new Date("2026-07-26T03:00:00Z"); // KST 2026-07-26 12:00
const WEDDING_D60 = "2026-09-24"; // NOW 기준 정확히 60일 뒤

describe("shouldRecallSavedNotes", () => {
  it("예식 60일 전 하루에만 발화한다", () => {
    const due = shouldRecallSavedNotes({ weddingDate: WEDDING_D60, savedCount: 3, now: NOW });
    expect(due).not.toBeNull();
    expect(due?.message).toContain("3건");
    expect(due?.requestId).toBe(`saved-notes-recall:${WEDDING_D60}`);
  });

  it("하루라도 어긋나면 발화하지 않는다", () => {
    for (const weddingDate of ["2026-09-23", "2026-09-25"]) {
      expect(shouldRecallSavedNotes({ weddingDate, savedCount: 3, now: NOW })).toBeNull();
    }
  });

  it("저장본이 없으면 발화하지 않는다", () => {
    expect(shouldRecallSavedNotes({ weddingDate: WEDDING_D60, savedCount: 0, now: NOW })).toBeNull();
    expect(shouldRecallSavedNotes({ weddingDate: WEDDING_D60, savedCount: -1, now: NOW })).toBeNull();
  });

  it("예식일을 모르거나 형식이 깨지면 발화하지 않는다", () => {
    for (const weddingDate of [null, undefined, "", "언젠가", "2026-13-45"]) {
      expect(shouldRecallSavedNotes({ weddingDate, savedCount: 3, now: NOW })).toBeNull();
    }
  });

  // 같은 예식일이면 요청 키가 같아 유니크 인덱스가 두 번째 발화를 막는다.
  it("같은 커플에게 두 번 가지 않도록 예식일에 키를 묶는다", () => {
    const first = shouldRecallSavedNotes({ weddingDate: WEDDING_D60, savedCount: 3, now: NOW });
    const second = shouldRecallSavedNotes({ weddingDate: WEDDING_D60, savedCount: 9, now: NOW });
    expect(first?.requestId).toBe(second?.requestId);
  });

  // 저장본 내용은 절대 인용하지 않는다 — 요약은 해석이고, 해석은 판정에 가깝다.
  it("건수와 위치만 말하고 내용은 담지 않는다", () => {
    const due = shouldRecallSavedNotes({ weddingDate: WEDDING_D60, savedCount: 2, now: NOW });
    expect(due?.message).toContain("저장한 이야기");
    expect(due?.message).not.toMatch(/위약금|환불|업체명/);
  });

  it("상수는 두 달 전으로 고정돼 있다", () => {
    expect(SAVED_NOTES_RECALL_DAYS_BEFORE).toBe(60);
  });
});
