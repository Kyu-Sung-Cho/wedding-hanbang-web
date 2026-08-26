import { describe, expect, it } from "vitest";

import { executeGetMarketPrice } from "../quoteMarketTools";

/**
 * 아모라가 공시가 **일부만 보고** 중간값을 말했다.
 *
 * ## 무엇이 있었나
 *
 * 조회가 `.limit(2_000)` 이었는데 **PostgREST 는 서버 쪽 상한 1,000행에서 자른다.**
 * 2026-08-26 운영 실측:
 *
 *     limit=2000 → 실제 받은 행 1000 · content-range: 0-999/1081
 *     limit=5000 → 실제 받은 행 1000 · content-range: 0-999/1081
 *
 * 예식장은 1,081건이라 **81건이 조용히 빠진 채** min/median/max 가 나왔다.
 * 정렬이 무작위가 아니라 중간값이 한쪽으로 밀린다 — 운영 데이터로 재보니:
 *
 *     1,000건만 볼 때  중간값 200,000원
 *     1,081건 전부     중간값 300,000원      ← 1.5배
 *
 * 이 파일의 첫 원칙이 "없는 표본에서 평균을 내면 그게 곧 지어낸 수치다" 인데,
 * **일부 표본에서 낸 중간값도 같은 종류다.**
 *
 * ## 무엇을 잠그나
 *
 * 1. 한 페이지에 다 안 오면 **끝까지 넘겨서** 모은다.
 * 2. 상한까지 채웠는데도 더 남았으면 **통계를 내지 않는다.** 반쪽 중간값을 내느니
 *    말하지 않는 편이 낫다.
 */

type Row = { price_min_krw: number; price_max_krw: number; source_label: string; region_code: string; item_name: string };

function row(min: number): Row {
  return {
    price_min_krw: min,
    price_max_krw: min,
    source_label: "kca_tprice",
    region_code: "seoul_gangnam3",
    item_name: "대관료",
  };
}

/** PostgREST 를 흉내낸다 — `range` 를 존중하되 한 번에 1,000행까지만 준다. */
function pagingClient(rows: Row[], opts: { pageCap?: number } = {}) {
  const cap = opts.pageCap ?? 1_000;
  const ranges: Array<[number, number]> = [];
  const builder = () => {
    const api: Record<string, unknown> = {};
    for (const k of ["select", "eq"]) api[k] = () => api;
    api.range = async (from: number, to: number) => {
      ranges.push([from, to]);
      return { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null };
    };
    api.limit = async (n: number) => ({ data: rows.slice(0, Math.min(n, cap)), error: null });
    return api;
  };
  return { client: { from: () => builder() } as never, ranges };
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

describe("한 페이지에 안 들어가도 전부 본다", () => {
  it("1,081행이면 두 번 넘겨서 다 모은다 — 운영 예식장과 같은 크기", async () => {
    // **잘리면 중간값이 실제로 달라지도록 짠다.** 앞 520개가 작고 나머지가 크면
    //   전체 1,081건 → 중앙 index 540 → 큰 값
    //   앞 1,000건만 → 중앙 index 500 → 작은 값
    // 처음엔 앞 1,000개를 작게 잡았는데, 그러면 잘려도 중간값이 100,500 vs 100,540
    // 으로 거의 같아 **이 검사가 아무것도 막지 못했다.**
    const rows = [
      ...Array.from({ length: 520 }, () => row(100_000)),
      ...Array.from({ length: 561 }, () => row(9_000_000)),
    ];
    expect(rows).toHaveLength(1_081);
    expect(median(rows.slice(0, 1_000).map((r) => r.price_min_krw)))
      .not.toBe(median(rows.map((r) => r.price_min_krw)));

    const { client, ranges } = pagingClient(rows);
    const result = await executeGetMarketPrice({ category: "hall" }, client);

    expect(ranges.length, "한 번만 조회했다 — 뒤 81건을 못 본다").toBeGreaterThan(1);
    expect(result.success).toBe(true);
    // 예식장은 항목별 breakdown 으로 나온다.
    const breakdown = (result.toolOutput as { breakdown?: Array<Record<string, number>> }).breakdown ?? [];
    expect(breakdown.length, "breakdown 이 비었다").toBeGreaterThan(0);
    expect(breakdown[0].sampleCount).toBe(1_081);
    expect(breakdown[0].medianKrw, "잘린 표본의 중간값이 나왔다")
      .toBe(median(rows.map((r) => r.price_min_krw)));
  });

  it("한 페이지에 다 들어가면 한 번만 조회한다", async () => {
    const rows = Array.from({ length: 285 }, (_, i) => row(50_000 + i));
    const { client, ranges } = pagingClient(rows);

    const result = await executeGetMarketPrice({ category: "makeup" }, client);

    expect(ranges).toHaveLength(1);
    expect(result.toolOutput).toMatchObject({ sampleCount: 285 });
    expect(result.success).toBe(true);
  });
});

describe("다 못 모으면 수치를 말하지 않는다", () => {
  it("상한을 넘겨도 더 남으면 중간값을 내지 않는다", async () => {
    // 2,000행 상한을 꽉 채우고도 더 있는 상황.
    const rows = Array.from({ length: 2_500 }, (_, i) => row(100_000 + i));
    const { client } = pagingClient(rows);

    const result = await executeGetMarketPrice({ category: "hall" }, client);

    expect(result.toolOutput).toMatchObject({
      sampleCount: 0,
      medianKrw: null,
      minKrw: null,
      maxKrw: null,
    });
    expect(result.displayMessage ?? "", "반쪽 표본으로 수치를 말했다")
      .not.toMatch(/\d{2,}만원|중간값\s*\d/u);
  });
});
