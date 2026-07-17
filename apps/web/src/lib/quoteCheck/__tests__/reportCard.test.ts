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

describe("견적 리포트 카드 레이아웃", () => {
  it("초장문 항목명도 말줄임으로 폭 안에 들어간다 (38px)", () => {
    const line = buildItemLine(
      { name: "아주아주아주아주 길고 긴 스튜디오 원본 전체 데이터 구매 비용 항목", severity: "high" },
      38,
      approxMeasure
    );
    expect(approxMeasure(line, 38)).toBeLessThanOrEqual(MAX_W);
    expect(line).toContain("…");
    expect(line).not.toContain("평균");
  });

  it("일반 항목명은 그대로 유지된다", () => {
    const line = buildItemLine(
      { name: "원본구매비", severity: "high" },
      38,
      approxMeasure
    );
    expect(line).toBe("원본구매비");
  });

  it("태그 폭을 뺀 좁은 폭에서도 안전하다", () => {
    const line = buildItemLine(
      { name: "본식드레스도우미헬퍼추가비용", severity: "critical" },
      38,
      approxMeasure,
      MAX_W - 120
    );
    expect(approxMeasure(line, 38)).toBeLessThanOrEqual(MAX_W - 120);
  });

  it("항목 선택 — 필수 우선 정렬, 최대 6개, 나머지는 moreCount로 정직 표기", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({
      name: `항목${i}`,
      severity: (i < 3 ? "medium" : i < 6 ? "high" : "critical") as "critical" | "high" | "medium",
    }));
    const { shown, moreCount } = selectReportItems(items);
    expect(shown).toHaveLength(6);
    expect(moreCount).toBe(3);
    expect(shown.slice(0, 3).every((item) => item.severity === "critical")).toBe(true);
  });

  it("0개 항목이면 moreCount 0", () => {
    const { shown, moreCount } = selectReportItems([]);
    expect(shown).toHaveLength(0);
    expect(moreCount).toBe(0);
  });

  it("만원 포맷 — 반올림·천단위 구분", () => {
    expect(formatReportManwon(38.5)).toBe("39만원");
    expect(formatReportManwon(1250)).toBe("1,250만원");
  });
});
