import { afterEach, describe, expect, it, vi } from "vitest";

import { executeTool } from "@/lib/ai/toolExecutor";

/**
 * `get_wedding_info` 가 정하지 않은 것을 정한 것처럼 말했다.
 *
 * 신규 커플의 총예산은 0이다(`route.ts` 의 `journey?.total_budget ?? 0`).
 * 그런데 출력은 `예산: 0원` 이었다 — **정하지 않은 것**과 **0원으로 정한 것**이
 * 같은 문장이 된다. 예정일은 이미 "결혼 예정일 미설정" 이라고 구분해 말하는데
 * 예산만 그러지 않았다.
 *
 * 같이 고친 것: D-day 표기가 `(D-${dDay})` 로 고정돼 있었다. 같은 날
 * `daysUntilWedding`(KST) 으로 바꾸면서 이 값이 null 일 수 있게 됐는데
 * — 계산할 수 없는 날짜면 null 이다 — 표기를 안 고쳤으면 아모라에게
 * "D-null" 이 갔다. 당일과 지난 날도 "D-0"·"D--3" 이었다.
 */

const BASE_CONTEXT = {
  coupleId: "couple-1",
  weddingContext: {
    weddingDate: null as string | null,
    venue: null,
    budget: 0,
    progress: {},
  },
} as never;

function contextWith(over: Record<string, unknown>) {
  return {
    ...(BASE_CONTEXT as object),
    weddingContext: { ...(BASE_CONTEXT as { weddingContext: object }).weddingContext, ...over },
  } as never;
}

async function info(over: Record<string, unknown> = {}) {
  const result = await executeTool("get_wedding_info", {}, contextWith(over));
  return result.displayMessage ?? "";
}

/** 한국시각을 UTC 인스턴트로. */
function kst(y: number, m: number, d: number, hour: number): number {
  return Date.UTC(y, m - 1, d, hour - 9, 0, 0);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("총예산을 정하지 않았을 때", () => {
  it("0원이라고 말하지 않는다", async () => {
    const message = await info();
    expect(message).not.toContain("예산: 0원");
    expect(message).toContain("예산: 아직 정하지 않음");
  });

  it("예정일이 있어도 마찬가지다", async () => {
    const message = await info({ weddingDate: "2027-05-15" });
    expect(message).not.toContain("예산: 0원");
    expect(message).toContain("아직 정하지 않음");
  });

  it("정한 뒤에는 금액을 그대로 말한다", async () => {
    const message = await info({ budget: 62_000_000 });
    expect(message).toContain("6,200만원");
    expect(message).not.toContain("아직 정하지 않음");
  });
});

describe("D-day 표기", () => {
  it("결혼식 날에는 D-Day 라고 한다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(kst(2026, 8, 25, 6));
    expect(await info({ weddingDate: "2026-08-25" })).toContain("(D-Day)");
  });

  it("남은 날은 D-N 이다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(kst(2026, 8, 20, 6));
    expect(await info({ weddingDate: "2026-08-25" })).toContain("(D-5)");
  });

  it("지난 날은 D+N 이다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(kst(2026, 8, 28, 6));
    const message = await info({ weddingDate: "2026-08-25" });
    expect(message).toContain("(D+3)");
    expect(message).not.toContain("D--");
  });

  it("계산할 수 없는 날짜면 D-day 를 적지 않는다", async () => {
    // 예전 표기는 여기서 "D-null" 을 내보냈다.
    const message = await info({ weddingDate: "2026-02-30" });
    expect(message).not.toContain("null");
    expect(message).not.toContain("(D-");
    expect(message).toContain("결혼 예정일: 2026-02-30");
  });
});
