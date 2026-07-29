import { describe, expect, it } from "vitest";

import {
  DRAW_SIZE,
  TODAY_DECK,
  TODAY_DECK_VERSION,
  TODAY_GIVE_LINE,
  TODAY_OPENING_LINE,
  drawThree,
  findCard,
  kstDateString,
  seedFromDate,
} from "../deck";

describe("오늘 한 마디 덱", () => {
  it("버전이 고정돼 있고 카드가 충분하다", () => {
    expect(TODAY_DECK_VERSION).toBe("today-deck.2");
    expect(TODAY_DECK.length).toBeGreaterThanOrEqual(24);
  });

  it("id가 중복되지 않는다", () => {
    expect(new Set(TODAY_DECK.map((card) => card.id)).size).toBe(TODAY_DECK.length);
  });

  /**
   * 알아봄은 **과잉 구체**에서 나온다. 너무 짧으면 추상적이고, 너무 길면 한 줄에 안 들어간다.
   * 이전 버전이 실패한 지점이 정확히 여기다 — 「후보를 처음 찾는 장면」처럼 짧고 추상적이면
   * 아무도 자기 얘기로 읽지 않는다.
   */
  it("장면이 20~34자다", () => {
    for (const card of TODAY_DECK) {
      expect(card.scene.length, `${card.id}: "${card.scene}" (${card.scene.length}자)`)
        .toBeGreaterThanOrEqual(20);
      expect(card.scene.length, `${card.id}: "${card.scene}" (${card.scene.length}자)`)
        .toBeLessThanOrEqual(34);
    }
  });

  it("한 마디가 30자 이내 물음표 문장이다", () => {
    for (const card of TODAY_DECK) {
      expect(card.say.length, `${card.id}: "${card.say}"`).toBeLessThanOrEqual(30);
      expect(card.say.endsWith("?"), `${card.id}: "${card.say}"`).toBe(true);
    }
  });

  // 판정 금지는 이 저장소의 확정 결정이다(CLAUDE.md). 점수·등급·가격대 분류로 읽히는
  // 어휘가 하나라도 들어가면 「사실과 절차만」이라는 원칙이 깨진다.
  it("판정 언어를 쓰지 않는다", () => {
    const banned =
      /점수|등급|유형|궁합|정확도|희귀|상위 \d|퍼센트|성공률|이혼|안전한|위험한|추천드려|해야 한다|해야 해/;
    for (const card of TODAY_DECK) {
      for (const text of [card.scene, card.say, card.when, card.check]) {
        expect(text, `${card.id}: "${text}"`).not.toMatch(banned);
      }
    }
  });

  // 상대를 평가하거나 대신 말해주겠다고 하면 카드가 관계 위해가 된다.
  it("상대 평가·대리 개입을 하지 않는다", () => {
    const banned = /대신 말해|편을 들|누가 더 잘|네 잘못|탓이야|설득해/;
    for (const card of TODAY_DECK) {
      expect(`${card.scene} ${card.say}`, card.id).not.toMatch(banned);
    }
  });

  // 가사 성역할·운전·특정 가족 형태를 전제하면 그 전제에 안 맞는 커플이 통째로 배제된다.
  it("성역할·운전·특정 가족 형태를 전제하지 않는다", () => {
    const banned = /반찬|설거지|빨래|요리는|운전|차 안에서|시부모|장인|장모|며느리|사위/;
    for (const card of TODAY_DECK) {
      for (const text of [card.scene, card.say, card.when]) {
        expect(text, `${card.id}: "${text}"`).not.toMatch(banned);
      }
    }
  });

  /**
   * `check`는 돈·계약이 걸린 카드에만 붙인다. 비율이 높아지면 대화 카드가 아니라
   * **잔소리 목록**으로 읽힌다 — 재미가 죽고 아무도 끝까지 안 본다.
   */
  it("계약 확인 문구가 1/3을 넘지 않는다", () => {
    const withCheck = TODAY_DECK.filter((card) => card.check !== "");
    expect(withCheck.length, `${withCheck.length}/${TODAY_DECK.length}`)
      .toBeGreaterThan(3);
    expect(withCheck.length / TODAY_DECK.length).toBeLessThanOrEqual(1 / 3);
  });

  /**
   * 반복은 카드가 목록에서 뭉개지는 가장 큰 원인이다. 이전 버전은 「언제」 고유값이
   * 5개뿐이었고 행동의 82%가 같은 형태였다.
   */
  it("「언제」가 겹치지 않는다", () => {
    const counts = new Map<string, number>();
    for (const card of TODAY_DECK) counts.set(card.when, (counts.get(card.when) ?? 0) + 1);
    const worst = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    expect(counts.size).toBeGreaterThanOrEqual(TODAY_DECK.length - 4);
    expect(worst[1], `"${worst[0]}"이 ${worst[1]}회`).toBeLessThanOrEqual(2);
  });

  it("같은 문장이 두 번 나오지 않는다", () => {
    expect(new Set(TODAY_DECK.map((card) => card.say)).size).toBe(TODAY_DECK.length);
    expect(new Set(TODAY_DECK.map((card) => card.scene)).size).toBe(TODAY_DECK.length);
  });

  /**
   * 이 덱의 존재 이유는 **결혼 준비**다. 결혼과 무관한 일반 협업 문장이 되는 순간
   * 이전 버전의 실패를 반복한다(실측: 회수 문장 17개 중 결혼 고유어 1개).
   */
  it("장면이 실제로 결혼 준비 얘기다", () => {
    const weddingWords = [
      "예식", "결혼", "웨딩", "드레스", "스냅", "본식", "하객", "청첩", "상견례", "예단",
      "예물", "신혼", "투어", "견적", "계약", "헬퍼", "촬영", "메이크업", "식장", "보증인원",
      "위약금", "반지", "항공권", "전세", "샵", "시식", "버진로드", "대행사", "플래너", "계산서",
    ];
    const missing = TODAY_DECK.filter(
      (card) => !weddingWords.some((word) => `${card.scene} ${card.say}`.includes(word)));
    expect(missing.map((card) => `${card.id}: ${card.scene}`), "결혼 고유어가 없는 카드")
      .toEqual([]);
  });

  /**
   * `say`는 **상대가 답할 수 있어야** 한다. 「추가금 얼마 붙어?」·「몇 장까지 받기로 했더라?」는
   * 업체에 물을 말이라 상대 앞에서 아무 대화도 열지 못한다 — 초판에 이런 카드가 4장 있었다.
   *
   * 정규식이 「답할 수 있는 질문」을 판정할 수는 없다. 여기서 막는 것은 **초판이 실제로 낸
   * 실패 형태**(가격·수량·정책을 묻는 어투)이지 전수 증명이 아니다.
   */
  it("업체에 물을 말을 상대에게 묻지 않는다", () => {
    const vendorLookup =
      /얼마 붙|얼마야\?|얼마예요|몇 장까지|포함이야\?|물어봤어\?|되나요|가능한가요|단가|견적에 있었/;
    for (const card of TODAY_DECK) {
      expect(card.say, `${card.id}: "${card.say}"`).not.toMatch(vendorLookup);
    }
  });

  it("모든 카드에 kind가 있고 양쪽 다 충분하다", () => {
    const heart = TODAY_DECK.filter((card) => card.kind === "heart");
    const money = TODAY_DECK.filter((card) => card.kind === "money");
    expect(heart.length + money.length).toBe(TODAY_DECK.length);
    // 한 번 뽑을 때 마음 2 + 돈 1을 쓰므로 각각 그만큼은 있어야 뽑기가 성립한다.
    expect(heart.length).toBeGreaterThanOrEqual(2);
    expect(money.length).toBeGreaterThanOrEqual(1);
  });

  it("첫 화면·주는 화면 문구가 있다", () => {
    expect(TODAY_OPENING_LINE.length).toBeGreaterThan(10);
    expect(TODAY_GIVE_LINE.length).toBeGreaterThan(10);
    // 헤더 소제목 자리다. 길면 모바일에서 세 줄이 되고 아무도 안 읽는다.
    expect(TODAY_OPENING_LINE.length).toBeLessThanOrEqual(45);
    expect(TODAY_GIVE_LINE.length).toBeLessThanOrEqual(45);
  });
});

describe("세 장 뽑기", () => {
  it("항상 세 장이고, 마음 2 + 돈 1이다", () => {
    // 초판의 실패는 「돈 카드가 앞에 몰렸다」였다. 무작위로 세 장을 뽑으면 돈만 세 장인
    // 날이 반드시 생기므로, 구성을 seed 운에 맡기지 않는다는 것을 여기서 못 박는다.
    for (let seed = 0; seed < 200; seed += 1) {
      const drawn = drawThree(seed);
      expect(drawn.length, `seed ${seed}`).toBe(DRAW_SIZE);
      expect(drawn.filter((card) => card.kind === "money").length, `seed ${seed}`).toBe(1);
      expect(drawn.filter((card) => card.kind === "heart").length, `seed ${seed}`).toBe(2);
      expect(new Set(drawn.map((card) => card.id)).size, `seed ${seed}`).toBe(DRAW_SIZE);
    }
  });

  it("같은 seed면 같은 세 장이다 — SSR과 첫 렌더가 어긋나면 안 된다", () => {
    expect(drawThree(12345).map((card) => card.id)).toEqual(
      drawThree(12345).map((card) => card.id),
    );
  });

  it("seed가 다르면 대체로 다른 세 장이다", () => {
    const signatures = new Set<string>();
    for (let seed = 0; seed < 60; seed += 1) {
      signatures.add(drawThree(seed).map((card) => card.id).join("|"));
    }
    expect(signatures.size).toBeGreaterThan(30);
  });

  it("돈 카드가 늘 같은 자리에 오지 않는다", () => {
    const positions = new Set<number>();
    for (let seed = 0; seed < 60; seed += 1) {
      positions.add(drawThree(seed).findIndex((card) => card.kind === "money"));
    }
    expect(positions).toEqual(new Set([0, 1, 2]));
  });

  it("exclude한 카드는 뽑히지 않는다", () => {
    const excluded = TODAY_DECK.filter((card) => card.kind === "heart")
      .slice(0, 8)
      .map((card) => card.id);
    for (let seed = 0; seed < 60; seed += 1) {
      for (const card of drawThree(seed, excluded)) {
        expect(excluded, `seed ${seed}: ${card.id}`).not.toContain(card.id);
      }
    }
  });
});

describe("오늘 날짜 seed", () => {
  // 「오늘」은 한국 자정에 넘어가야 한다. UTC로 자르면 한국 아침 9시에 날이 바뀐다.
  it("KST 기준으로 날짜를 자른다", () => {
    expect(kstDateString(new Date("2026-07-29T14:30:00Z"))).toBe("2026-07-29");
    expect(kstDateString(new Date("2026-07-29T15:30:00Z"))).toBe("2026-07-30");
    expect(kstDateString(new Date("2026-07-29T00:30:00Z"))).toBe("2026-07-29");
  });

  it("날이 바뀌면 뽑히는 세 장이 바뀐다", () => {
    const today = drawThree(seedFromDate("2026-07-29")).map((card) => card.id);
    const tomorrow = drawThree(seedFromDate("2026-07-30")).map((card) => card.id);
    expect(tomorrow).not.toEqual(today);
  });

  it("같은 날짜면 같은 seed다", () => {
    expect(seedFromDate("2026-07-29")).toBe(seedFromDate("2026-07-29"));
    expect(seedFromDate("2026-07-29")).not.toBe(seedFromDate("2026-07-30"));
  });
});

describe("카드 조회", () => {
  it("id로 찾는다", () => {
    const first = TODAY_DECK[0];
    expect(findCard(first.id)).toEqual(first);
  });

  // 링크로 받은 카드 id가 덱에 없으면 조용히 아무거나 보여주면 안 된다.
  it("없는 id는 null이다", () => {
    expect(findCard("없는-카드")).toBeNull();
    expect(findCard("")).toBeNull();
  });
});
