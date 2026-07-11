import { describe, expect, it } from "vitest";
import { approxMeasure } from "@/lib/weddingCode/shareCard";
import {
  buildItemLine,
  formatReportManwon,
  selectReportItems,
  REPORT_W,
  REPORT_PAD,
} from "../reportCard";

const MAX_W = REPORT_W - REPORT_PAD * 2;

describe("추가비용 확인 카드 레이아웃", () => {
  it("초장문 항목명도 가격 문구 없이 폭 안에서 말줄임한다", () => {
    const line = buildItemLine(
      { name: "아주아주아주아주 길고 긴 스튜디오 원본 전체 데이터 제공 확인 항목" },
      38,
      approxMeasure,
      380
    );
    expect(approxMeasure(line, 38)).toBeLessThanOrEqual(380);
    expect(line).toContain("…");
    expect(line).not.toContain("평균");
    expect(line).not.toContain("만원");
  });

  it("일반 항목명은 그대로 유지된다", () => {
    expect(buildItemLine({ name: "원본 데이터 제공" }, 38, approxMeasure)).toBe(
      "원본 데이터 제공"
    );
  });

  it("항목 선택은 중요도를 만들지 않고 입력 순서를 유지한다", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({ name: `항목${index}` }));
    const { shown, moreCount } = selectReportItems(items);
    expect(shown).toEqual(items.slice(0, 8));
    expect(moreCount).toBe(2);
  });

  it("0개 항목이면 moreCount 0", () => {
    expect(selectReportItems([])).toEqual({ shown: [], moreCount: 0 });
  });

  it("사용자 입력 견적가 포맷은 반올림·천단위 구분을 유지한다", () => {
    expect(formatReportManwon(38.5)).toBe("39만원");
    expect(formatReportManwon(1250)).toBe("1,250만원");
    expect(MAX_W).toBeGreaterThan(0);
  });
});
