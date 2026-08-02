import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import WeeklyCard from "./WeeklyCard";
import type { ProgressItem } from "@/types/database.types";

function progressWithEvent(date: string): Record<string, ProgressItem> {
  return {
    __events: [
      {
        id: "evt_sanggyeonrye",
        date,
        title: "상견례",
        momentType: "sanggyeonrye",
        createdAt: "2026-06-01T00:00:00Z",
        updatedAt: "2026-06-01T00:00:00Z",
      },
    ],
  } as unknown as Record<string, ProgressItem>;
}

describe("WeeklyCard 신뢰 문구", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("저장되지 않은 채팅 후속 조치를 이미 했다고 말하지 않는다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T03:00:00Z"));

    const html = renderToStaticMarkup(
      <WeeklyCard progress={progressWithEvent("2026-06-16")} />,
    );

    expect(html).toContain(
      "다가오는 일정: 양쪽 부모님이 함께 만나는 자리. 준비 항목을 지금 확인할까요?",
    );
    expect(html).toContain('href="/wedding/schedule"');
    expect(html).not.toContain("채팅에 정리해뒀어요");
  });

  it("저장된 정보가 비어 있을 때 전체 준비가 안전하다고 단정하지 않는다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T03:00:00Z"));

    const html = renderToStaticMarkup(
      <WeeklyCard
        weddingDate="2027-06-15"
        totalBudget={50_000_000}
        progress={{}}
      />,
    );

    expect(html).toContain(
      "현재 저장된 정보 기준으로 오늘 확인된 마감은 없어요. 등록하지 않은 일정과 계약은 포함되지 않아요.",
    );
    expect(html).toContain(
      "현재 저장된 일정 기준으로 이번 주 마감 항목은 확인되지 않았어요. 등록하지 않은 일정은 포함되지 않아요.",
    );
    expect(html).not.toContain("오늘은 급한 일 없어요");
    expect(html).not.toContain("좋은 흐름이에요");
  });

  it("취소된 일정은 이번 주 브리핑이나 일정 보유 판단에 포함하지 않는다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T03:00:00Z"));
    const cancelled = progressWithEvent("2026-06-16") as unknown as Record<string, unknown>;
    cancelled.__events = [{
      ...(cancelled.__events as Array<Record<string, unknown>>)[0],
      status: "cancelled",
      cancellation: {
        cancelledAt: "2026-06-15T01:00:00.000Z",
        cancelledByProfileId: "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2",
      },
      updatedAt: "2026-06-15T01:00:00.000Z",
    }];

    const html = renderToStaticMarkup(
      <WeeklyCard
        weddingDate="2027-06-15"
        totalBudget={50_000_000}
        progress={cancelled as unknown as Record<string, ProgressItem>}
      />,
    );

    expect(html).not.toContain("다가오는 일정: 양쪽 부모님이 함께 만나는 자리");
    expect(html).toContain("현재 저장된 정보 기준으로 오늘 확인된 마감은 없어요");
  });
});
