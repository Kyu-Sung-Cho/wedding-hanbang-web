import { describe, expect, it } from "vitest";

import { landingContent } from "@/components/landing/redesign/landingContent";
import { upcomingWeddingQuarterLabels } from "@/utils/quarter";

/**
 * **랜딩이 지난 분기의 동기방을 내걸지 않는다.**
 *
 * 2026-09-02 실측 — 랜딩이 `2026년 1분기 … 4분기` 를 고정 배열로 걸고 있었다.
 * 9월에 처음 온 사람이 **이미 끝난 결혼식의 방 이름** 둘을 읽고, 정작 자기가
 * 갈 2027년 방은 목록에 없었다. 고정 배열은 시간이 갈수록 더 틀려지는데
 * 알려 주는 것이 하나도 없었다.
 *
 * 그래서 값이 아니라 **성질**을 고정한다: 목록은 지금 기준으로 계산돼야 하고,
 * 지나간 분기를 담으면 안 된다. 누가 다시 고정 배열로 돌려놓으면 여기가 빨개진다.
 */
describe("앞으로 오는 분기 목록", () => {
  it("현재 분기부터 시작해 넷을 준다", () => {
    expect(upcomingWeddingQuarterLabels(new Date("2026-09-02T00:00:00+09:00"))).toEqual([
      "2026년 3분기 (7~9월)",
      "2026년 4분기 (10~12월)",
      "2027년 1분기 (1~3월)",
      "2027년 2분기 (4~6월)",
    ]);
  });

  it("연말에는 해를 넘긴다", () => {
    expect(upcomingWeddingQuarterLabels(new Date("2026-12-31T00:00:00+09:00"))).toEqual([
      "2026년 4분기 (10~12월)",
      "2027년 1분기 (1~3월)",
      "2027년 2분기 (4~6월)",
      "2027년 3분기 (7~9월)",
    ]);
  });

  it("랜딩이 그 계산 결과를 그대로 쓴다 — 고정 배열로 되돌아가면 여기가 잡는다", () => {
    expect(landingContent.community.cohorts).toEqual(upcomingWeddingQuarterLabels());
  });

  it("랜딩 목록에 지나간 분기가 없다", () => {
    // 이 검사가 이 파일의 존재 이유다. 값이 아니라 **오늘 기준 사실**을 본다.
    const now = new Date();
    const nowYear = now.getFullYear();
    const nowQuarter = Math.ceil((now.getMonth() + 1) / 3);
    for (const label of landingContent.community.cohorts) {
      const m = /^(\d{4})년 (\d)분기/.exec(label);
      expect(m, `분기 라벨 형식이 아니다: ${label}`).not.toBeNull();
      const year = Number(m![1]);
      const quarter = Number(m![2]);
      expect(
        year > nowYear || (year === nowYear && quarter >= nowQuarter),
        `이미 지난 분기를 내걸고 있다: ${label}`,
      ).toBe(true);
    }
  });
});
