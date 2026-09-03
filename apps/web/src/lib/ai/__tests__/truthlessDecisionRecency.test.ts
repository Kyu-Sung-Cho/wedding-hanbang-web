import { describe, expect, it } from "vitest";

import {
  dropOutdatedTruthlessDecisions,
  dropSupersededDecisions,
  isSupersededDecision,
} from "@/lib/ai/supersededDecisions";

/**
 * 2026-09-03. 방향을 크게 바꾼 커플에서 옛 결정이 되살아난다.
 *
 * `wedding_journeys` 에는 하객 수·예식 형태·시기에 해당하는 열이 없어서
 * `isSupersededDecision` 이 이 category 들을 영원히 판정하지 못한다. 그래서
 * "하객 180명" 영수증이 "40명" 으로 바꾼 뒤에도 살아 있고, 프롬프트의
 * "혹시 아직도..." 회상 자리에 함께 실린다.
 *
 * DB 는 건드리지 않는다 — 읽는 시점에만 거른다.
 */

type Row = {
  id: string;
  category: string;
  visibility: string;
  createdAt: string;
  chosenValue: Record<string, unknown> | null;
};

const ids = (rows: readonly Row[]): string[] => rows.map((row) => row.id);

describe("대조할 진실값이 없는 category 는 마지막 말만 남는다", () => {
  it("하객 180명 → 40명 으로 바꾸면 40명만 남는다", () => {
    const rows: Row[] = [
      {
        id: "40명",
        category: "guestcount",
        visibility: "shared",
        createdAt: "2026-09-02T09:00:00Z",
        chosenValue: { value: "하객 40명 가족식" },
      },
      {
        id: "180명",
        category: "guestcount",
        visibility: "shared",
        createdAt: "2026-07-11T09:00:00Z",
        chosenValue: { value: "하객 180명" },
      },
    ];

    expect(ids(dropOutdatedTruthlessDecisions(rows))).toEqual(["40명"]);
  });

  it("읽기 질의 순서가 뒤집혀도 최신이 남는다", () => {
    const rows: Row[] = [
      {
        id: "180명",
        category: "guestcount",
        visibility: "shared",
        createdAt: "2026-07-11T09:00:00Z",
        chosenValue: { value: "하객 180명" },
      },
      {
        id: "40명",
        category: "guestcount",
        visibility: "shared",
        createdAt: "2026-09-02T09:00:00Z",
        chosenValue: { value: "하객 40명 가족식" },
      },
    ];

    expect(ids(dropOutdatedTruthlessDecisions(rows))).toEqual(["40명"]);
  });

  it("예식 형태·시기도 같이 걸린다", () => {
    const rows: Row[] = [
      {
        id: "가족식",
        category: "style",
        visibility: "shared",
        createdAt: "2026-09-02T09:00:00Z",
        chosenValue: { value: "제주 가족식" },
      },
      {
        id: "컨벤션",
        category: "style",
        visibility: "shared",
        createdAt: "2026-07-11T09:00:00Z",
        chosenValue: { value: "일반 컨벤션 예식" },
      },
      {
        id: "가을",
        category: "timeline",
        visibility: "shared",
        createdAt: "2026-09-02T09:00:00Z",
        chosenValue: { value: "내년 가을" },
      },
      {
        id: "봄",
        category: "timeline",
        visibility: "shared",
        createdAt: "2026-07-11T09:00:00Z",
        chosenValue: { value: "내년 봄" },
      },
    ];

    expect(ids(dropOutdatedTruthlessDecisions(rows))).toEqual(["가족식", "가을"]);
  });

  it("공유 결정과 개인 결정을 섞어 지우지 않는다", () => {
    const rows: Row[] = [
      {
        id: "공유-최신",
        category: "guestcount",
        visibility: "shared",
        createdAt: "2026-09-02T09:00:00Z",
        chosenValue: { value: "40명" },
      },
      {
        id: "개인-옛것",
        category: "guestcount",
        visibility: "bride_private",
        createdAt: "2026-07-11T09:00:00Z",
        chosenValue: { value: "180명" },
      },
    ];

    expect(ids(dropOutdatedTruthlessDecisions(rows))).toEqual(["공유-최신", "개인-옛것"]);
  });

  it("같은 category 라도 다른 주제면 남긴다 — 온보딩이 timeline 을 둘 남긴다", () => {
    // apps/web/src/app/api/onboarding/route.ts 는 결혼식 날짜와 상견례 일정을
    // 모두 category "timeline" 으로 적는다. 묶어서 지우면 상견례를 적었다는
    // 이유로 결혼식 날짜 영수증이 사라진다.
    const rows: Row[] = [
      {
        id: "상견례",
        category: "timeline",
        visibility: "shared",
        createdAt: "2026-09-02T09:00:00Z",
        chosenValue: { sanggyeonrye_date: "2026-10-04" },
      },
      {
        id: "결혼식날짜",
        category: "timeline",
        visibility: "shared",
        createdAt: "2026-07-11T09:00:00Z",
        chosenValue: { wedding_date: "2027-05-15" },
      },
    ];

    expect(ids(dropOutdatedTruthlessDecisions(rows))).toEqual(["상견례", "결혼식날짜"]);
  });

  it("날짜를 읽을 수 없으면 판단하지 않고 남긴다", () => {
    const rows: Row[] = [
      {
        id: "깨진날짜",
        category: "guestcount",
        visibility: "shared",
        createdAt: "언젠가",
        chosenValue: { value: "180명" },
      },
      {
        id: "정상",
        category: "guestcount",
        visibility: "shared",
        createdAt: "2026-09-02T09:00:00Z",
        chosenValue: { value: "40명" },
      },
    ];

    expect(ids(dropOutdatedTruthlessDecisions(rows))).toEqual(["깨진날짜", "정상"]);
  });
});

describe("대조군 — 진실값이 있는 category 는 기존 판정 그대로", () => {
  it("예산·예식장·일정 판정 네 가지가 그대로다", () => {
    const current = {
      venue: "B홀",
      events: [{ id: "e1", date: "2027-03-27", title: "본식" }],
      totalBudgetKrw: 50_000_000,
    };

    // 1) 지금 예식장과 다른 이름은 지나간 판본이다.
    expect(isSupersededDecision(
      { category: "venue", title: "A홀", chosenValue: { value: "A홀" } },
      current,
    )).toBe(true);
    // 2) 같은 이름은 남는다.
    expect(isSupersededDecision(
      { category: "venue", title: "B홀", chosenValue: { value: "B홀" } },
      current,
    )).toBe(false);
    // 3) 총예산이 바뀌었으면 옛 금액은 지나간 판본이다.
    expect(isSupersededDecision(
      { category: "budget", title: "총예산 3000만원", chosenValue: { value: "총 예산 3000만원" } },
      current,
    )).toBe(true);
    // 4) 일정이 옮겨졌으면 옛 날짜 영수증은 지나간 판본이다.
    expect(isSupersededDecision(
      {
        category: "schedule",
        title: "본식 확정",
        chosenValue: { eventId: "e1", after: { date: "2027-03-20", title: "본식" } },
      },
      current,
    )).toBe(true);
  });

  it("새 필터는 그 category 들을 건드리지 않는다", () => {
    const rows: Row[] = [
      {
        id: "예산-최신",
        category: "budget",
        visibility: "shared",
        createdAt: "2026-09-02T09:00:00Z",
        chosenValue: { value: "총 예산 5000만원" },
      },
      {
        id: "예산-옛것",
        category: "budget",
        visibility: "shared",
        createdAt: "2026-07-11T09:00:00Z",
        chosenValue: { value: "총 예산 3000만원" },
      },
      {
        id: "예식장-후보1",
        category: "venue",
        visibility: "shared",
        createdAt: "2026-09-02T09:00:00Z",
        chosenValue: { value: "B홀" },
      },
      {
        id: "예식장-후보2",
        category: "venue",
        visibility: "shared",
        createdAt: "2026-07-11T09:00:00Z",
        chosenValue: { value: "A홀" },
      },
      {
        id: "선호",
        category: "preference",
        visibility: "shared",
        createdAt: "2026-08-01T09:00:00Z",
        chosenValue: { value: "미니멀" },
      },
      {
        id: "선호-옛것",
        category: "preference",
        visibility: "shared",
        createdAt: "2026-06-01T09:00:00Z",
        chosenValue: { value: "화려한" },
      },
    ];

    expect(ids(dropOutdatedTruthlessDecisions(rows))).toEqual(ids(rows));
  });

  it("기존 dropSupersededDecisions 는 그대로 동작한다", () => {
    const decisions = [
      { category: "venue", title: "A홀", chosenValue: null },
      { category: "venue", title: "B홀", chosenValue: null },
    ];
    expect(dropSupersededDecisions(decisions, { venue: "B홀", events: [] })).toEqual([
      { category: "venue", title: "B홀", chosenValue: null },
    ]);
  });
});
