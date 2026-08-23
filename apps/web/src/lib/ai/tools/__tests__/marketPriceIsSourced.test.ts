import { describe, expect, it, vi } from "vitest";
import { executeGetMarketPrice } from "@/lib/ai/tools/quoteMarketTools";
import { DISCLOSURE_ROUND, disclosureRoundLabel } from "@/lib/price/period";

/**
 * 2026-08-22 스테이징 실측: "웨딩홀 대관료 평균 알려줘" 에 아모라가
 * "확인되지 않은 금액을 임의로 말씀드리진 않을게요" 라고 답했다. 정직하지만
 * **알 수 있는 것을 모른다고 말한 것**이다.
 *
 * `v_public_official_prices` 에 공시가 2,609건이 있고 그중 2,154건에 실제 금액이 있다.
 * 출처는 `한국소비자원 참가격 · 2026Q3`, 카테고리는 hall/studio/dress/makeup,
 * 지역 14종. 그런데 `executeGetMarketPrice` 는 **데이터를 한 줄도 읽지 않고**
 * "과거 고정 시세표는 종료했어요" 라는 고정 문구만 돌려주고 있었다 — 도구 설명문은
 * 모델에게 "한국소비자원 참가격 통계를 조회합니다" 라고 말하는데도.
 *
 * 이 파일이 고정하는 계약: **수치를 돌려줄 때는 출처와 기준 시점을 함께 돌려준다.**
 * 근거 없는 숫자는 아모라가 지어낸 것과 구별되지 않는다.
 */

type Row = {
  price_min_krw: number | null;
  price_max_krw: number | null;
  source_label: string | null;
  period_label: string | null;
  region_code: string | null;
  item_name: string | null;
};

function clientReturning(rows: Row[], error: unknown = null) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.in = vi.fn(chain);
  builder.gt = vi.fn(chain);
  builder.limit = vi.fn(() => Promise.resolve({ data: rows, error }));
  return {
    from: vi.fn(() => builder),
    __builder: builder,
  } as unknown as Parameters<typeof executeGetMarketPrice>[1] & {
    from: ReturnType<typeof vi.fn>;
    __builder: Record<string, unknown>;
  };
}

/** DB 에 실제로 저장된 값. 내부 스냅샷 이름이 박혀 있다(운영 실측). */
const SOURCE = "한국소비자원 참가격 · 2026Q3";

function row(min: number, max: number, region = "seoul_gangnam3"): Row {
  return {
    price_min_krw: min,
    price_max_krw: max,
    source_label: SOURCE,
    period_label: "2026Q3",
    region_code: region,
    item_name: "샘플스튜디오 촬영",
  };
}

/** 결혼식장 공시는 `<홀이름> <항목>` 형태다. 실측 접미어: 식대·옵션·대관료·장식비. */
function hallRow(itemType: string, min: number, max: number): Row {
  return { ...row(min, max), item_name: `그랜드볼룸 ${itemType}` };
}

describe("공시가를 돌려줄 때 출처를 함께 돌려준다", () => {
  it("금액과 함께 출처·기준시점·건수를 낸다", async () => {
    // 결혼식장은 항목 유형을 나눠서 주므로(아래 describe) 단일 통계 계약은
    // 유형이 갈리지 않는 카테고리로 확인한다.
    const client = clientReturning([row(1_000_000, 2_000_000), row(2_000_000, 4_000_000), row(3_000_000, 3_000_000)]);
    const result = await executeGetMarketPrice({ category: "studio" }, client);

    expect(result.success).toBe(true);
    const output = result.toolOutput as Record<string, unknown>;
    // **DB 값을 그대로 말하면 안 된다.** `2026Q3` 은 우리 내부 스냅샷 이름이고
    // 실제 공시 라운드는 2025-11 이다(lib/price/period.ts). 소비자 화면은 이미
    // 이 보정을 거치는데 아모라만 안 거쳐서, 같은 자료를 화면은 "2025년 11월",
    // 아모라는 "2026년 3분기"라고 말하고 있었다 — 9개월 된 가격이 현재 분기로
    // 보인다. 예전 이 테스트가 그 틀린 값을 고정하고 있었다.
    expect(output.period).toBe(disclosureRoundLabel());
    expect(output.source).toBe(`한국소비자원 참가격 · ${disclosureRoundLabel()}`);
    expect(output.sampleCount).toBe(3);

    // 내부 스냅샷 이름은 사용자에게 닿는 어디에도 없어야 한다.
    const surfaced = JSON.stringify(output) + String(result.displayMessage);
    expect(surfaced, "내부 스냅샷 이름이 새어 나갔다").not.toMatch(/\d{4}Q[1-4]/u);
    // 표시값이 리터럴로 굳지 않게 정본 상수와 묶어 둔다.
    expect(disclosureRoundLabel()).toBe(
      `${DISCLOSURE_ROUND.slice(0, 4)}년 ${Number(DISCLOSURE_ROUND.slice(5))}월`,
    );
    // 사용자에게 보이는 문장에도 출처가 있어야 한다. 도구 출력에만 있으면
    // 모델이 숫자만 옮겨 적고 출처는 흘린다.
    expect(result.displayMessage).toContain("한국소비자원 참가격");
  });

  it("최소·중간·최대를 실제 값에서 계산한다", async () => {
    const client = clientReturning([row(1_000_000, 1_000_000), row(2_000_000, 2_000_000), row(9_000_000, 9_000_000)]);
    const output = (await executeGetMarketPrice({ category: "studio" }, client))
      .toolOutput as Record<string, unknown>;
    expect(output.minKrw).toBe(1_000_000);
    expect(output.medianKrw).toBe(2_000_000);
    expect(output.maxKrw).toBe(9_000_000);
  });

  it("표본이 없으면 수치를 지어내지 않고 없다고 말한다", async () => {
    const client = clientReturning([]);
    const result = await executeGetMarketPrice({ category: "dress", region: "jeju" }, client);
    const output = result.toolOutput as Record<string, unknown>;
    expect(output.sampleCount).toBe(0);
    expect(output.minKrw).toBeNull();
    expect(result.displayMessage).toMatch(/없|확인되지/u);
    // 없는데 있다고 하면 안 되지만, 출처 자체는 여전히 밝힌다.
    expect(result.displayMessage).toContain("한국소비자원 참가격");
  });

  it("조회가 실패하면 실패라고 말한다 — 빈 통계로 위장하지 않는다", async () => {
    const client = clientReturning([], { message: "boom" });
    const result = await executeGetMarketPrice({ category: "makeup" }, client);
    expect(result.success).toBe(false);
    expect((result.toolOutput as Record<string, unknown>).sampleCount).toBeUndefined();
  });

  it("카테고리가 없으면 조회하지 않는다", async () => {
    const client = clientReturning([row(1, 1)]);
    const result = await executeGetMarketPrice({}, client);
    expect(result.success).toBe(false);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("모르는 카테고리는 거부한다 — 공시가에 없는 항목을 통계로 만들지 않는다", async () => {
    const client = clientReturning([row(1, 1)]);
    const result = await executeGetMarketPrice({ category: "honeymoon" }, client);
    expect(result.success).toBe(false);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("현재 공시분만 본다", async () => {
    const client = clientReturning([row(1_000_000, 1_000_000)]);
    await executeGetMarketPrice({ category: "hall" }, client);
    expect(client.from).toHaveBeenCalledWith("v_public_official_prices");
    // 지난 분기 공시를 섞으면 "기준 시점"이 거짓이 된다.
    expect(client.__builder.eq).toHaveBeenCalledWith("is_current", true);
  });

  it("업체 이름을 돌려주지 않는다 — 이 도구는 통계이지 업체 추천이 아니다", async () => {
    const client = clientReturning([hallRow("대관료", 1_000_000, 2_000_000)]);
    const result = await executeGetMarketPrice({ category: "hall", itemType: "대관료" }, client);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/vendor_name|vendor_id|vendor_slug/u);
  });
});

/**
 * 결혼식장 공시는 한 카테고리 안에 **성격이 다른 네 가지**가 섞여 있다
 * (2026-08-22 실측: 식대 326 · 옵션 325 · 대관료 318 · 장식비 112).
 * 식대는 1인당 금액이라 5만~7만 원대이고 대관료는 건당이라 수백만 원대다.
 *
 * 이걸 한 덩어리로 중위값을 내면 "웨딩홀 대관료 중위가 105만 원, 범위 3만 5천 원~
 * 6,600만 원" 같은 숫자가 나온다 — 실제로 라이브에서 그렇게 나왔다. 출처가 있어도
 * **뜻이 틀린 숫자**이고, 지어낸 숫자보다 나을 것이 없다.
 */
describe("결혼식장은 항목 성격이 다른 것을 섞지 않는다", () => {
  it("항목을 지정하지 않으면 유형별로 나눠서 준다", async () => {
    const client = clientReturning([
      hallRow("대관료", 3_000_000, 3_000_000),
      hallRow("대관료", 5_000_000, 5_000_000),
      hallRow("식대", 58_000, 68_000),
      hallRow("식대", 62_000, 62_000),
      hallRow("옵션", 300_000, 300_000),
    ]);
    const output = (await executeGetMarketPrice({ category: "hall" }, client))
      .toolOutput as Record<string, unknown>;

    const breakdown = output.breakdown as Array<Record<string, unknown>>;
    expect(Array.isArray(breakdown)).toBe(true);
    const rental = breakdown.find((entry) => entry.itemType === "대관료");
    const meal = breakdown.find((entry) => entry.itemType === "식대");
    expect(rental?.medianKrw).toBe(4_000_000);
    // 공시 한 행은 구간(min~max)이라 중점을 그 행의 대표값으로 쓴다.
    // 식대 두 행은 58,000~68,000(중점 63,000)과 62,000 → 중위값 62,500.
    expect(meal?.medianKrw).toBe(62_500);
    expect(meal?.perPerson).toBe(true);
    expect(rental?.perPerson).toBe(false);
    // 섞인 단일 중위값을 함께 주면 모델이 그걸 집어 쓴다.
    expect(output.medianKrw).toBeUndefined();
  });

  it("식대는 1인당이라고 말한다", async () => {
    const client = clientReturning([hallRow("식대", 58_000, 58_000)]);
    const result = await executeGetMarketPrice({ category: "hall", itemType: "식대" }, client);
    expect(result.displayMessage).toContain("1인");
  });

  it("항목을 지정하면 그 항목만 집계한다", async () => {
    const client = clientReturning([hallRow("대관료", 3_000_000, 3_000_000)]);
    const output = (await executeGetMarketPrice({ category: "hall", itemType: "대관료" }, client))
      .toolOutput as Record<string, unknown>;
    expect(output.itemType).toBe("대관료");
    expect(output.medianKrw).toBe(3_000_000);
    expect(output.breakdown).toBeUndefined();
  });

  it("결혼식장이 아닌 항목은 유형을 나누지 않는다", async () => {
    const client = clientReturning([row(1_000_000, 1_000_000), row(3_000_000, 3_000_000)]);
    const output = (await executeGetMarketPrice({ category: "studio" }, client))
      .toolOutput as Record<string, unknown>;
    expect(output.medianKrw).toBe(2_000_000);
    expect(output.breakdown).toBeUndefined();
  });
});
