import { describe, expect, it } from "vitest";

import { summarizeBlogMentions } from "@/lib/ai/tools/placeSearchTools";

/**
 * 네이버 지역 검색은 이름·주소·분류까지만 준다. 사용자가 알고 싶은 "사람들이
 * 뭐라고 하나", "얼마쯤 하나" 는 거기 아예 없다 — 블로그 검색이 그 자리를 메우는
 * 유일한 출처다.
 *
 * 위험은 **엉뚱한 글을 그 가게 후기로 세는 것**이다. 검색어가 느슨하면 같은
 * 동네 다른 가게 글이 섞이고, 그러면 아무 가게나 후기가 많아 보인다.
 */
const blog = (
  items: { title: string; description: string }[],
  total?: number,
) => ({ items, ...(total === undefined ? {} : { total }) });

describe("summarizeBlogMentions", () => {
  it("가게 이름이 든 글만 센다", () => {
    const result = summarizeBlogMentions("수서역 벌교한상", blog([
      { title: "수서역 벌교한상 다녀왔어요", description: "한정식이 정갈했어요." },
      { title: "강남 맛집 정리", description: "다른 집 이야기입니다." },
      { title: "후기", description: "수서역벌교한상 룸이 조용했어요. 1인 4만원." },
    ]));

    expect(result.count).toBe(2);
  });

  it("이름이 하나도 없으면 후기가 없는 것이다", () => {
    const result = summarizeBlogMentions("수서역 벌교한상", blog([
      { title: "강남 한정식 모음", description: "여러 곳을 다녀왔습니다." },
    ]));

    expect(result).toEqual({
      count: 0, snippet: null, priceRange: null, hasPrivateRoom: false,
    });
  });

  it("블로그가 말한 가격을 그대로 옮긴다", () => {
    const result = summarizeBlogMentions("벌교한상", blog([
      { title: "벌교한상", description: "코스가 1인 4만원이었어요." },
    ]));

    expect(result.priceRange).toBe("4만원");
  });

  it("룸 언급을 알아본다", () => {
    const result = summarizeBlogMentions("벌교한상", blog([
      { title: "벌교한상 후기", description: "별실이 있어 조용했어요." },
    ]));

    expect(result.hasPrivateRoom).toBe(true);
  });

  it("한 줄은 길이를 제한한다 — 카드가 밀리면 안 된다", () => {
    const long = "벌교한상 ".repeat(60);
    const result = summarizeBlogMentions("벌교한상", blog([
      { title: "벌교한상", description: long },
    ]));

    expect(result.snippet!.length).toBeLessThanOrEqual(90);
  });

  it("태그를 벗겨서 옮긴다", () => {
    const result = summarizeBlogMentions("벌교한상", blog([
      { title: "<b>벌교한상</b>", description: "<b>벌교한상</b> 정갈했어요." },
    ]));

    expect(result.snippet).not.toContain("<b>");
    expect(result.count).toBe(1);
  });

  it.each([null, undefined, {}, { items: null }, "x"])(
    "응답이 깨져도 조용히 비운다: %s",
    (bad) => {
      expect(summarizeBlogMentions("벌교한상", bad)).toEqual({
        count: 0, snippet: null, priceRange: null, hasPrivateRoom: false,
      });
    },
  );

  it("이름이 너무 짧으면 세지 않는다 — 아무 글에나 걸린다", () => {
    expect(summarizeBlogMentions("가", blog([
      { title: "가나다 식당", description: "좋았어요." },
    ])).count).toBe(0);
  });
});

/**
 * 우리는 앞의 다섯 글만 읽는다. 그중 몇 개가 이름을 말했는지 세면 그 수는
 * **절대 5를 넘지 못한다** — 수천 건 있는 가게가 3건짜리로 보인다.
 * 화면에 낼 수는 네이버가 알려준 검색 결과 총 수를 쓴다.
 */
describe("리뷰 수는 표본 크기에 갇히지 않는다", () => {
  it("네이버가 알려준 총 수를 쓴다", () => {
    const result = summarizeBlogMentions("벌교한상", blog([
      { title: "벌교한상 후기", description: "좋았어요." },
      { title: "벌교한상 재방문", description: "또 갔어요." },
    ], 3128));

    expect(result.count).toBe(3128);
  });

  it("총 수가 없으면 우리가 센 것을 쓴다", () => {
    const result = summarizeBlogMentions("벌교한상", blog([
      { title: "벌교한상 후기", description: "좋았어요." },
    ]));

    expect(result.count).toBe(1);
  });

  it("총 수가 이상하면 우리가 센 것으로 버틴다", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, "많음"]) {
      const result = summarizeBlogMentions("벌교한상", {
        items: [{ title: "벌교한상", description: "좋았어요." }],
        total: bad,
      });
      expect(result.count).toBe(1);
    }
  });

  it("이름을 말한 글이 하나도 없으면 총 수가 커도 0이다", () => {
    // 검색어가 헐거워 엉뚱한 글만 잡힌 경우. 그 숫자를 그대로 쓰면
    // 아무 가게나 후기가 수천 건 있는 것처럼 보인다.
    const result = summarizeBlogMentions("벌교한상", blog([
      { title: "강남 한정식 모음", description: "여러 곳입니다." },
    ], 99999));

    expect(result.count).toBe(0);
  });
});
