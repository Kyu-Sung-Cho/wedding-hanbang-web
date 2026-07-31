import { describe, expect, it } from "vitest";

import { guardUnverifiedAmoraPersistenceClaims } from "../amoraPersistenceClaims";

describe("guardUnverifiedAmoraPersistenceClaims", () => {
  it.each([
    "총예산을 3,000만 원으로 반영했어요.",
    "총예산을 3,000만 원으로 반영해드렸어요.",
    "드레스 투어 일정을 저장해뒀어요.",
    "드레스 투어 일정을 저장해놨어요.",
    "예식장을 새 장소로 변경했습니다.",
    "예식장 변경 완료했어요.",
    "기존 일정을 삭제했어요.",
    "체크리스트에 추가됐어요.",
  ])("removes an affirmative write claim without a mutation receipt: %s", (text) => {
    const result = guardUnverifiedAmoraPersistenceClaims({
      text,
      hasVerifiedMutationReceipt: false,
      hasPendingAction: false,
    });

    expect(result.corrected).toBe(true);
    expect(result.removedClaimCount).toBe(1);
    expect(result.text).not.toContain(text);
    expect(result.text).toContain("실제 실행 결과가 확인되지 않아");
    expect(result.text).toContain("아직 반영되지 않았어요");
  });

  it("keeps useful prose while removing only the unverified success sentence", () => {
    const result = guardUnverifiedAmoraPersistenceClaims({
      text: "예산이 넉넉하지 않아 우선순위를 정하는 게 좋아요. 총예산은 3,000만 원으로 반영했어요.",
      hasVerifiedMutationReceipt: false,
      hasPendingAction: false,
    });

    expect(result.text).toContain("예산이 넉넉하지 않아 우선순위를 정하는 게 좋아요.");
    expect(result.text).not.toContain("3,000만 원으로 반영했어요");
    expect(result.text).toContain("아직 반영되지 않았어요");
  });

  it("uses a pending-specific disclosure instead of claiming completion", () => {
    const result = guardUnverifiedAmoraPersistenceClaims({
      text: "예식일을 변경했어요.",
      hasVerifiedMutationReceipt: false,
      hasPendingAction: true,
    });

    expect(result.text).toBe(
      "아직 실제 준비에는 반영되지 않았어요. 아래 확인 내용을 검토해주세요.",
    );
  });

  it.each([
    "예산은 아직 반영되지 않았어요.",
    "\"저장했어요\"라는 문구는 실제 실행 결과가 아니에요.",
    "만약 일정을 변경했다면 업체에도 확인해주세요.",
    "예산 변경을 도와드릴게요.",
  ])("does not rewrite a negative, quoted, hypothetical, or future statement: %s", (text) => {
    expect(guardUnverifiedAmoraPersistenceClaims({
      text,
      hasVerifiedMutationReceipt: false,
      hasPendingAction: false,
    })).toEqual({
      text,
      corrected: false,
      removedClaimCount: 0,
    });
  });

  it("allows an affirmative claim only when a successful mutation receipt exists", () => {
    const text = "총예산을 3,000만 원으로 반영했어요.";
    expect(guardUnverifiedAmoraPersistenceClaims({
      text,
      hasVerifiedMutationReceipt: true,
      hasPendingAction: false,
    })).toEqual({
      text,
      corrected: false,
      removedClaimCount: 0,
    });
  });
});
