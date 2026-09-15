import { describe, expect, it } from "vitest";
import { resolveAmoraWeddingContext } from "@/lib/ai/amoraWeddingContext";

describe("resolveAmoraWeddingContext", () => {
  it("uses only the canonical journey for an authenticated user", () => {
    const result = resolveAmoraWeddingContext({
      canonicalJourney: {
        wedding_date: "2027-05-03",
        total_budget: 40_000_000,
        venue: "DB 웨딩홀",
        progress: {},
      },
      clientContext: {
        weddingDate: "2030-01-01",
        budget: 1,
        venue: "CLIENT INJECTION",
        progress: { __events: "not-an-array" },
      },
      allowClientContext: false,
    });

    expect(result).toMatchObject({
      weddingDate: "2027-05-03",
      budget: 40_000_000,
      venue: "DB 웨딩홀",
      scheduleEvents: [],
    });
    expect(JSON.stringify(result)).not.toContain("CLIENT INJECTION");
  });

  it("does not fall back to client state when the canonical journey is absent", () => {
    const result = resolveAmoraWeddingContext({
      canonicalJourney: null,
      clientContext: {
        weddingDate: "2030-01-01",
        budget: 999_999_999,
        venue: "UNTRUSTED VENUE",
        progress: { studio: { status: "completed" } },
      },
      allowClientContext: false,
    });

    expect(result).toEqual({
      weddingDate: null,
      budget: 0,
      venue: null,
      progress: {},
      storedProgress: {},
      scheduleEvents: [],
      storedScheduleEventIds: [],
      preferences: null,
    });
  });

  it("accepts a bounded demo context and drops malformed events and preferences", () => {
    const result = resolveAmoraWeddingContext({
      canonicalJourney: null,
      allowClientContext: true,
      clientContext: {
        weddingDate: "2027-02-29",
        budget: Number.POSITIVE_INFINITY,
        venue: `  ${"홀".repeat(250)}  `,
        progress: {
          __events: [
            { date: "2027-05-03", title: "드레스 피팅", memo: "준비", categoryKey: "dress" },
            { date: "not-a-date", title: "DROP" },
            { date: "2027-06-01", title: 123 },
          ],
          __preferences: {
            weddingStyle: "minimal",
            priorities: ["venue", 123, "dress"],
            budgetTendency: "balanced",
            guestCount: "100to200",
          },
          constructor: { polluted: true },
        },
      },
    });

    expect(result.weddingDate).toBeNull();
    expect(result.budget).toBe(0);
    expect(result.venue).toHaveLength(200);
    expect(result.scheduleEvents).toEqual([
      { date: "2027-05-03", title: "드레스 피팅", memo: "준비", categoryKey: "dress" },
    ]);
    expect(result.preferences).toEqual({
      weddingStyle: "minimal",
      priorities: ["venue", "dress"],
      budgetAttitude: "balanced",
      guestCount: "100to200",
    });
    expect(Object.prototype.hasOwnProperty.call(result.progress, "constructor")).toBe(false);
  });

  it("bounds nested progress values before they reach prompts or tools", () => {
    const progress = Object.fromEntries(
      Array.from({ length: 130 }, (_, index) => [
        `category_${index}`,
        { status: "completed", memo: "x".repeat(2_000) },
      ]),
    );
    const result = resolveAmoraWeddingContext({
      canonicalJourney: { progress },
      clientContext: null,
      allowClientContext: false,
    });

    expect(Object.keys(result.progress)).toHaveLength(100);
    expect((result.progress.category_0 as { memo: string }).memo).toHaveLength(1_000);
  });

  // 2026-09-15 점검: 잘린 progress 가 쓰기 도구의 CAS 기대값으로 가서, 메모 1,001자나
  // 일정 101개인 커플은 일정 추가·변경·취소가 전부 "다른 일정 변경이 먼저 반영되어" 로 끝났다.
  it("keeps an untruncated, independent copy of the stored progress for write tools", () => {
    const events = Array.from({ length: 101 }, (_, index) => ({
      id: `evt_${index}`,
      date: "2027-05-03",
      title: `일정 ${index}`,
      status: "planned",
      memo: index === 0 ? "메".repeat(1_001) : "메모",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    }));
    const storedRow = {
      progress: {
        ...Object.fromEntries(Array.from({ length: 130 }, (_, index) => [
          `custom_${index}`,
          { status: "not_started", memo: "x".repeat(2_000), deep: { a: { b: { c: "깊음" } } } },
        ])),
        __events: events,
      },
    };
    const snapshot = structuredClone(storedRow);

    const result = resolveAmoraWeddingContext({
      canonicalJourney: storedRow,
      clientContext: null,
      allowClientContext: false,
    });

    // 프롬프트용은 그대로 잘린다.
    expect((result.progress.__events as unknown[] | undefined)?.length ?? 0).toBeLessThanOrEqual(100);
    // 쓰기 기준값은 DB 가 비교할 저장 행과 한 글자도 다르지 않다.
    expect(result.storedProgress).toStrictEqual(snapshot.progress);
    expect((result.storedProgress.__events as Array<{ memo: string }>)[0].memo).toHaveLength(1_001);
    expect(result.storedProgress.__events).toHaveLength(101);
    expect(Object.keys(result.storedProgress)).toHaveLength(131);

    // 도구 실행이 문맥을 고쳐도 라우트가 따로 읽는 정본은 바뀌지 않는다.
    (result.storedProgress.__events as unknown[]).push({ id: "evt_leak" });
    expect(storedRow).toStrictEqual(snapshot);
  });

  it("lists every stored schedule id, including cancelled ones and those past the first hundred", () => {
    const planned = (index: number, date: string) => ({
      id: `evt_${index}`,
      date,
      title: `일정 ${index}`,
      status: "planned",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    const events: Array<Record<string, unknown>> = Array.from(
      { length: 120 },
      (_, index) => planned(index, "2026-01-01"),
    );
    events[115] = planned(115, "2027-05-03");
    events[119] = {
      ...planned(119, "2027-06-01"),
      status: "cancelled",
      cancellation: {
        cancelledAt: "2026-08-02T03:00:00.000Z",
        cancelledByProfileId: "018f4dc8-3f4b-7d29-a271-0e27a7ea4cb8",
      },
      updatedAt: "2026-08-02T03:00:00.000Z",
    };

    const result = resolveAmoraWeddingContext({
      canonicalJourney: { progress: { __events: events } },
      clientContext: null,
      allowClientContext: false,
    });

    expect(result.storedScheduleEventIds).toHaveLength(120);
    expect(result.storedScheduleEventIds).toContain("evt_115");
    // 복원 카드는 취소한 일정을 가리킨다.
    expect(result.storedScheduleEventIds).toContain("evt_119");
    // 저장 순서상 116번째인 다가오는 일정도 아모라가 볼 수 있다.
    expect(result.scheduleEvents.map((event) => event.id)).toContain("evt_115");
    // 취소한 일정은 여전히 현재 일정처럼 보이지 않는다.
    expect(result.scheduleEvents.map((event) => event.id)).not.toContain("evt_119");
  });

  it("uses only the bounded client copy as the write base for the signed demo", () => {
    const result = resolveAmoraWeddingContext({
      canonicalJourney: null,
      allowClientContext: true,
      clientContext: {
        progress: {
          studio: { status: "completed", memo: "x".repeat(2_000) },
          constructor: { polluted: true },
        },
      },
    });

    expect(result.storedProgress).toBe(result.progress);
    expect((result.storedProgress.studio as { memo: string }).memo).toHaveLength(1_000);
    expect(Object.prototype.hasOwnProperty.call(result.storedProgress, "constructor")).toBe(false);
  });

  it("does not send a legacy booking id from schedule memos into the model context", () => {
    const result = resolveAmoraWeddingContext({
      canonicalJourney: {
        progress: {
          __events: [{
            date: "2027-05-03",
            title: "드레스 피팅",
            memo: "예약 자동 등록 · booking 018f4dc8 · 15,000원",
          }],
        },
      },
      clientContext: null,
      allowClientContext: false,
    });

    expect(result.scheduleEvents[0]?.memo).toBe("예약 자동 등록 · 15,000원");
    expect(JSON.stringify(result.scheduleEvents)).not.toContain("018f4dc8");
  });

  it("does not expose cancelled schedules to the model as active wedding context", () => {
    const result = resolveAmoraWeddingContext({
      canonicalJourney: {
        progress: {
          __events: [
            {
              id: "018f4dc8-3f4b-7d29-a271-0e27a7ea4cb7",
              date: "2027-05-03",
              title: "취소한 드레스 피팅",
              status: "cancelled",
              cancellation: {
                cancelledAt: "2026-08-02T03:00:00.000Z",
                cancelledByProfileId: "018f4dc8-3f4b-7d29-a271-0e27a7ea4cb8",
              },
            },
            {
              id: "018f4dc8-3f4b-7d29-a271-0e27a7ea4cb9",
              date: "2027-05-10",
              title: "진행할 드레스 피팅",
              status: "planned",
            },
          ],
        },
      },
      clientContext: null,
      allowClientContext: false,
    });

    // 2026-08-23부터 `id`도 함께 싣는다 — 일정 취소·변경 도구가 `event_id`를
    // 필수로 받는데 그 값을 아모라가 볼 길이 없어서, 사용자에게 화면에서 ID를
    // 읽어오라고 되물었다. 이 테스트의 계약은 "취소된 일정을 현재처럼 보여주지
    // 않는다"이고 그건 아래 두 줄이 지킨다.
    expect(result.scheduleEvents).toEqual([
      { id: "018f4dc8-3f4b-7d29-a271-0e27a7ea4cb9", date: "2027-05-10", title: "진행할 드레스 피팅" },
    ]);
    expect(JSON.stringify(result.scheduleEvents)).not.toContain("취소한 드레스 피팅");
    // 취소된 일정의 id도 새지 않는다 — 새면 아모라가 그걸로 표식을 낼 수 있다.
    expect(JSON.stringify(result.scheduleEvents)).not.toContain("018f4dc8-3f4b-7d29-a271-0e27a7ea4cb7");
  });

  it("uses the same 10억원 product ceiling as every wedding budget write path", () => {
    expect(resolveAmoraWeddingContext({
      canonicalJourney: { total_budget: 1_000_000_000, progress: {} },
      clientContext: null,
      allowClientContext: false,
    }).budget).toBe(1_000_000_000);

    expect(resolveAmoraWeddingContext({
      canonicalJourney: { total_budget: 1_000_000_001, progress: {} },
      clientContext: null,
      allowClientContext: false,
    }).budget).toBe(0);
  });
});
