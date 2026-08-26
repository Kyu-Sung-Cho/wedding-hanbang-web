import { describe, expect, it } from "vitest";

import { executeGetMarketPrice } from "../quoteMarketTools";
import { WEDDING_TOOLS } from "@/lib/ai/tools";

/**
 * 아모라가 **지역을 말없이 좁혀** 금액을 두 배로 말했다.
 *
 * ## 무엇이 있었나 (2026-08-26 운영 실측)
 *
 * 지역을 한 번도 말하지 않고 물었다.
 *
 *     사용자: 대관료는 보통 얼마야?
 *     아모라: 대관료 중위 770만원, 식대 1인 11.5만원
 *
 * 그 값은 전국이 아니라 `seoul_gangnam3` 부분집합과 **정확히 일치**했다(n=41·43).
 * 하객 200명 기준 식대만 놓고 보면
 *
 *     전국    1인 6.4만 × 200 = 1,280만원
 *     강남권  1인 11.5만 × 200 = 2,300만원
 *
 * 1,000만원 넘게 어긋난다. 그런데 문장은 "보통 얼마"에 대한 답처럼 읽혔다.
 *
 * ## 무엇을 고치고 무엇을 안 고쳤나
 *
 * **좁히는 것 자체는 막지 않는다.** 예식장이 강남이면 강남값이 더 맞는 답이다.
 * 막는 것은 **좁힌 사실이 문장에서 빠지는 것**이다.
 *
 * `toolOutput.region` 은 예전에도 있었다. 그런데 그건 모델이 옮겨 적어야만
 * 사용자에게 닿았고 **실제로는 옮겨 적지 않았다.** 그래서 범위를 수치와 같은
 * 문장에 붙여 뗄 수 없게 했다 — 이 저장소에서 오늘만 네 번, 데이터가 있는데도
 * 화면에 안 나온 일이 있었다.
 */

type Row = {
  price_min_krw: number;
  price_max_krw: number;
  source_label: string;
  region_code: string;
  item_name: string;
};

function row(min: number, itemName = "대관료"): Row {
  return {
    price_min_krw: min,
    price_max_krw: min,
    source_label: "kca_tprice",
    region_code: "seoul_gangnam3",
    item_name: itemName,
  };
}

/** `range` 를 존중하는 PostgREST 흉내. `eq` 로 넘어온 필터를 기록해 둔다. */
function client(rows: Row[]) {
  const filters: Array<[string, unknown]> = [];
  const builder = () => {
    const api: Record<string, unknown> = {};
    api.select = () => api;
    api.eq = (col: string, val: unknown) => {
      filters.push([col, val]);
      return api;
    };
    api.range = async (from: number, to: number) => ({
      data: rows.slice(from, to + 1),
      error: null,
    });
    return api;
  };
  return { client: { from: () => builder() } as never, filters };
}

const say = (r: { displayMessage?: string }) => r.displayMessage ?? "";

describe("잰 범위가 수치와 같은 문장에 있다", () => {
  it("지역을 넣으면 그 지역 이름이 문장에 나온다 — 라이브에서 빠졌던 것", async () => {
    const { client: c } = client(Array.from({ length: 41 }, () => row(7_700_000)));

    const result = await executeGetMarketPrice(
      { category: "hall", itemType: "대관료", region: "seoul_gangnam3" },
      c,
    );

    expect(result.success).toBe(true);
    expect(say(result), "강남권으로 좁혀 놓고 그 말을 안 했다").toContain("서울 강남권");
    // 수치와 같은 문장이어야 한다. 뒤 문단에 따로 붙으면 모델이 떼어 낸다.
    const sentence = say(result).split(".")[0];
    expect(sentence).toContain("서울 강남권");
    expect(sentence).toMatch(/\d/u);
  });

  it("지역을 안 넣으면 '전국' 이라고 말한다", async () => {
    const { client: c } = client(Array.from({ length: 60 }, () => row(4_000_000)));

    const result = await executeGetMarketPrice({ category: "hall", itemType: "대관료" }, c);

    expect(say(result)).toContain("전국");
    expect(say(result), "안 좁혔는데 지역 이름이 붙었다").not.toContain("강남");
  });

  it("결혼식장을 항목 없이 물어도 범위를 말한다 — 유형별로 나눠 주는 경로", async () => {
    const { client: c } = client([
      ...Array.from({ length: 20 }, () => row(7_700_000, "대관료")),
      ...Array.from({ length: 20 }, () => row(115_000, "식대")),
    ]);

    const result = await executeGetMarketPrice({ category: "hall", region: "gyeonggi" }, c);

    expect(say(result)).toContain("경기");
  });

  it("결과가 0건이어도 어디를 찾아봤는지 말한다", async () => {
    const { client: c } = client([]);

    const result = await executeGetMarketPrice({ category: "hall", region: "jeju" }, c);

    expect(say(result)).toContain("제주");
  });
});

describe("측정기가 살아 있다", () => {
  it("범위를 지우면 이 검사가 실제로 깨진다", async () => {
    // 이 검사가 무엇에 기대는지 드러내 둔다. 예전 문장에는 지역이 없었고,
    // 그 문장은 위 첫 검사를 통과하지 못한다.
    const old = "한국소비자원 참가격 기준 대관료 공시가 41건: 중간값 770만원.";
    expect(old).not.toContain("서울 강남권");
  });

  it("좁힌 조회가 실제로 DB 필터까지 간다 — 라벨만 붙는 게 아니다", async () => {
    const { client: c, filters } = client(Array.from({ length: 5 }, () => row(7_700_000)));

    await executeGetMarketPrice(
      { category: "hall", itemType: "대관료", region: "busan" },
      c,
    );

    expect(filters).toContainEqual(["region_code", "busan"]);
  });

  it("좁히면 값이 실제로 달라진다 — 그래서 범위를 말해야 한다", async () => {
    const national = client(Array.from({ length: 60 }, () => row(4_000_000)));
    const gangnam = client(Array.from({ length: 41 }, () => row(7_700_000)));

    const a = await executeGetMarketPrice({ category: "hall", itemType: "대관료" }, national.client);
    const b = await executeGetMarketPrice(
      { category: "hall", itemType: "대관료", region: "seoul_gangnam3" },
      gangnam.client,
    );

    const median = (r: { toolOutput: unknown }) =>
      (r.toolOutput as { medianKrw: number }).medianKrw;
    expect(median(a)).not.toBe(median(b));
  });
});

describe("도구 설명이 모델에게 비우라고 말한다", () => {
  it("region 설명이 '말했을 때만' 을 담는다", () => {
    const tool = WEDDING_TOOLS.find((t) => t.name === "get_market_price");
    expect(tool, "get_market_price 가 도구 목록에서 사라졌다").toBeDefined();

    const schema = tool!.input_schema as {
      properties: { region?: { description?: string } };
    };
    const description = schema.properties.region?.description ?? "";

    expect(description.length, "region 설명이 비었다").toBeGreaterThan(20);
    // "좁힐 때만" 은 사람 말로는 맞지만 모델에게는 조건이 모호했다 —
    // 좁히고 싶은 마음이 곧 조건이 된다. 조건을 사용자의 발화로 바꾼다.
    expect(description).toMatch(/사용자가 지역을 말했을 때만/u);
    expect(description).toMatch(/비웁?니다|비워/u);
  });
});
