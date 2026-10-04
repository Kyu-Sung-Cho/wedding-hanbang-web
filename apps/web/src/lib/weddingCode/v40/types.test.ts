import { describe, expect, it } from "vitest";
import {
  V40_AXES,
  V40_AXIS_KEYS,
  V40_COUNTS,
  V40_ESCAPES,
  V40_FACETS,
  V40_FACET_KEYS,
  V40_FORMAT_GUIDES,
  V40_LETTERS,
  V40_LETTER_LIST,
  V40_QUALITY_COPY,
  V40_SECTION_ARIA,
  V40_SECTION_NAMES,
  V40_SEGMENT_NAMES,
  V40_STATE_ALPHABET,
  V40_STATE_COUNTS,
  V40_STORAGE,
  V40_STRENGTH,
  V40_SUFFIX,
  V40_WRAP_UP,
  V40_WRAP_UP_NAME,
  WEDDING_CODE_V40_VERSION,
  axisInfo,
  axisOfFacet,
  axisOfLetter,
  demoteBand,
  evenStrengthSentence,
  facetInfo,
  guideKeyOf,
  isLetter,
  letterInfo,
  letterOf,
  oppositeLetter,
  pairCellAccessibleName,
  reactCellAccessibleName,
  sideOfLetter,
} from "@/constants/weddingCodeV40";
import { V40_LAYOUT, V40_LAYOUT_BY_ID, V40_LAYOUT_SCREENS } from "./layout";

/** 상수 객체 안의 모든 문자열을 모은다(함수와 숫자는 건너뛴다). */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => strings(entry, out));
  else if (value !== null && typeof value === "object") Object.values(value).forEach((entry) => strings(entry, out));
  return out;
}

describe("웨딩코드 4.0 상수", () => {
  it("판 태그", () => {
    expect(WEDDING_CODE_V40_VERSION).toBe("v4.0-tendency");
    // 이용 통계 version 값 규칙: 소문자, 숫자, 점, 밑줄, 하이픈 16자 이하.
    expect(WEDDING_CODE_V40_VERSION).toMatch(/^[a-z0-9][a-z0-9._-]{0,15}$/);
  });

  it("글자는 서로 다른 대문자 여덟 개이고 상태 글자와 소문자 변형이 없다", () => {
    expect(V40_LETTER_LIST).toHaveLength(8);
    expect(new Set(V40_LETTER_LIST).size).toBe(8);
    expect([...V40_LETTER_LIST].sort().join("")).toBe("ADFHSUVW");
    for (const letter of V40_LETTER_LIST) {
      expect(letter).toMatch(/^[A-Z]$/);
      expect("BMN?").not.toContain(letter);
      expect(isLetter(letter)).toBe(true);
    }
    expect(isLetter("b")).toBe(false);
    expect(isLetter("?")).toBe(false);
    expect(V40_LETTERS.map((info) => info.letter)).toEqual([...V40_LETTER_LIST]);
  });

  it("글자는 주제 하나의 한 방향에만 있다", () => {
    const seen = new Map<string, string>();
    for (const axis of V40_AXES) {
      for (const side of ["front", "back"] as const) {
        const letter = letterOf(axis.key, side);
        expect(seen.has(letter), `${letter} 중복`).toBe(false);
        seen.set(letter, `${axis.key}.${side}`);
        expect(axisOfLetter(letter)).toBe(axis.key);
        expect(sideOfLetter(letter)).toBe(side);
      }
    }
    expect(seen.size).toBe(8);
    for (const letter of V40_LETTER_LIST) {
      const opposite = oppositeLetter(letter);
      expect(opposite).not.toBe(letter);
      expect(axisOfLetter(opposite)).toBe(axisOfLetter(letter));
      expect(sideOfLetter(opposite)).not.toBe(sideOfLetter(letter));
      expect(oppositeLetter(opposite)).toBe(letter);
    }
  });

  it("글자마다 모든 글 필드가 있고 읽기 문장이 조각과 이어진다", () => {
    for (const info of V40_LETTERS) {
      expect(letterInfo(info.letter)).toBe(info);
      for (const text of [info.name, info.english, info.mnemonic, info.meaning, info.scopeNote, info.talk, info.tryThis, info.readingPiece, info.answerSentence]) {
        expect(text.trim().length, `${info.letter} 빈 필드`).toBeGreaterThan(0);
      }
      expect(info.appearances).toHaveLength(4);
      info.appearances.forEach((line) => expect(line.trim().length).toBeGreaterThan(0));
      expect(info.mnemonic.startsWith(`${info.english}:`)).toBe(true);
      expect(info.answerSentence).toBe(`${info.readingPiece}${V40_SUFFIX.answered}`);
      expect(info.axis).toBe(axisOfLetter(info.letter));
    }
    expect(V40_LETTERS.map((info) => info.name)).toEqual([
      "조건 먼저", "장면 먼저", "같이 하기", "나눠 하기", "둘이 정하기", "가족과 정하기", "마음 먼저", "할 일 먼저",
    ]);
    expect(V40_LETTERS.map((info) => info.english)).toEqual(["Verify", "Scene", "With", "Divide", "Us", "Family", "Heart", "Action"]);
  });

  it("주제는 네 개이고 글자 위치 순서가 돈, 준비, 정하는 사람, 지쳤을 때다", () => {
    expect(V40_AXES).toHaveLength(4);
    expect(V40_AXIS_KEYS).toEqual(["money", "process", "scope", "support"]);
    expect(V40_AXES.map((axis) => axis.order)).toEqual([0, 1, 2, 3]);
    expect(V40_AXES.map((axis) => `${axis.front}${axis.back}`).join("/")).toBe("VS/WD/UF/HA");
    expect(V40_AXES.map((axis) => axis.title)).toEqual(["돈을 정할 때", "준비를 굴릴 때", "누구와 함께 정할 때", "지쳤을 때"]);
    expect(V40_AXES.map((axis) => axis.topic)).toEqual(["돈", "준비", "정하는 사람", "지쳤을 때"]);
    for (const axis of V40_AXES) {
      expect(axisInfo(axis.key)).toBe(axis);
      expect(axis.evenSentence).toBe(`${axis.evenPiece}${V40_SUFFIX.even}`);
      expect(axis.differentNote.length).toBeGreaterThan(0);
      expect(axis.question.length).toBeGreaterThan(0);
    }
  });

  it("측면은 열여섯 개이고 주제마다 네 개다", () => {
    expect(V40_FACETS).toHaveLength(16);
    expect(V40_FACET_KEYS).toHaveLength(16);
    expect(new Set(V40_FACET_KEYS).size).toBe(16);
    expect(V40_FACETS.map((facet) => facet.key)).toEqual([...V40_FACET_KEYS]);
    for (const axis of V40_AXES) {
      const own = V40_FACETS.filter((facet) => facet.axis === axis.key);
      expect(own.map((facet) => facet.key)).toEqual([...axis.facets]);
      expect(own.map((facet) => facet.order)).toEqual([0, 1, 2, 3]);
    }
    for (const facet of V40_FACETS) {
      expect(facet.name.length).toBeGreaterThan(0);
      expect(facet.probes.length).toBeGreaterThan(0);
      expect(facetInfo(facet.key)).toBe(facet);
      expect(axisOfFacet(facet.key)).toBe(facet.axis);
    }
  });

  it("구간 이름표와 마지막 정리", () => {
    expect(V40_SECTION_NAMES).toEqual(["처음", "이어서", "절반쯤", "거의 다"]);
    expect(V40_WRAP_UP_NAME).toBe("마지막 정리");
    expect(V40_SEGMENT_NAMES).toEqual([...V40_SECTION_NAMES, "마지막 정리"]);
    expect(V40_SECTION_ARIA).toHaveLength(5);
    expect(V40_SECTION_ARIA[1]).toBe("지금 두 번째 구간이에요");
    expect(V40_WRAP_UP.title).toBe("직접 고른 쪽");
  });

  it("세기 세 단계와 문장", () => {
    expect(V40_STRENGTH.clear.label).toBe("뚜렷해요");
    expect(V40_STRENGTH.lean.label).toBe("기울어요");
    expect(V40_STRENGTH.even.label).toBe("반반이에요");
    expect(V40_STRENGTH.even.sentence).toBeNull();
    expect(demoteBand("clear")).toBe("lean");
    expect(demoteBand("lean")).toBe("even");
    expect(demoteBand("even")).toBe("even");
    expect(evenStrengthSentence("support", "A")).toBe(
      "이 주제에서는 어느 쪽으로도 크게 기울지 않았어요. 코드에는 한 글자만 적을 수 있어서 「A 할 일 먼저」를 적었어요.",
    );
  });

  it("고정 문구에 줄표, 백분율 기호, 금지된 주장이 없다", () => {
    const all = [
      ...strings(V40_LETTERS), ...strings(V40_AXES), ...strings(V40_FACETS.map((facet) => ({ n: facet.name, p: facet.probes }))),
      ...strings(V40_STRENGTH), ...strings(V40_QUALITY_COPY), ...strings(V40_FORMAT_GUIDES), ...strings(V40_ESCAPES), ...strings(V40_WRAP_UP),
    ];
    expect(all.length).toBeGreaterThan(100);
    for (const text of all) {
      expect(text, text).not.toMatch(/[–—%]/);
      expect(text, text).not.toMatch(/검증된|과학적|궁합|점수|등급|MBTI|스타일|동물|캐릭터/);
    }
    // 화면 문구가 상태 글자를 뜻으로 쓰지 않는다.
    expect(V40_LETTERS.some((info) => /[BMN?]/.test(info.letter))).toBe(false);
  });

  it("형식 안내 키와 상태 수", () => {
    expect(guideKeyOf("recall")).toBe("choose");
    expect(guideKeyOf("instant")).toBe("choose");
    expect(guideKeyOf("pair")).toBe("pair");
    expect(guideKeyOf("react")).toBe("react");
    expect(guideKeyOf("bestworst")).toBe("bestworst");
    expect(guideKeyOf("split")).toBe("split");
    expect(guideKeyOf("self")).toBeNull();
    expect(V40_STATE_COUNTS).toEqual({ pair: 6, react: 5, recall: 4, instant: 4, bestworst: 12, split: 28, self: 6 });
    expect(V40_STATE_ALPHABET).toHaveLength(62);
    expect(new Set(V40_STATE_ALPHABET).size).toBe(62);
    expect(Math.max(...Object.values(V40_STATE_COUNTS))).toBeLessThanOrEqual(62);
    expect(pairCellAccessibleName(0, 3)).toBe("위 카드에 아주 가까워요");
    expect(pairCellAccessibleName(1, 1)).toBe("아래 카드에 조금 가까워요");
    // 세 단계 이름이 위 카드와 아래 카드 모두에서 자리마다 맞는다(낭독기가 읽는 세기 낱말).
    expect(pairCellAccessibleName(0, 1)).toBe("위 카드에 조금 가까워요");
    expect(pairCellAccessibleName(0, 2)).toBe("위 카드에 꽤 가까워요");
    expect(pairCellAccessibleName(1, 2)).toBe("아래 카드에 꽤 가까워요");
    expect(pairCellAccessibleName(1, 3)).toBe("아래 카드에 아주 가까워요");
    expect(reactCellAccessibleName(2, "가", "나")).toBe("다섯 칸 중 가운데");
    expect(reactCellAccessibleName(0, "서운할 것 같아요", "든든할 것 같아요")).toBe("서운할 것 같아요, 다섯 칸 중 왼쪽 끝");
    // 오른쪽 끝 칸도 끝 이름을 앞에 붙이고, 양끝이 아닌 칸은 끝 이름 없이 자리만 읽는다.
    expect(reactCellAccessibleName(4, "서운할 것 같아요", "든든할 것 같아요")).toBe("든든할 것 같아요, 다섯 칸 중 오른쪽 끝");
    expect(reactCellAccessibleName(1, "서운할 것 같아요", "든든할 것 같아요")).toBe("다섯 칸 중 왼쪽에서 두 번째");
    expect(reactCellAccessibleName(3, "서운할 것 같아요", "든든할 것 같아요")).toBe("다섯 칸 중 오른쪽에서 두 번째");
  });

  it("저장소 키와 기간", () => {
    expect(V40_STORAGE.progressKey).toBe("hanbang:wedding-code:v4:progress");
    expect(V40_STORAGE.ttlMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(V40_STORAGE.historyMax).toBe(3);
  });
});

describe("웨딩코드 4.0 배치 골격", () => {
  const scored = V40_LAYOUT.filter((slot) => slot.fmt !== "self");
  const self = V40_LAYOUT.filter((slot) => slot.fmt === "self");

  it("개수: 질문 68개, 채점 64개, 자기 선택 4개, 화면 42개", () => {
    expect(V40_LAYOUT).toHaveLength(V40_COUNTS.items);
    expect(scored).toHaveLength(V40_COUNTS.scored);
    expect(self).toHaveLength(V40_COUNTS.self);
    expect(V40_COUNTS.codeLength).toBe(1 + V40_COUNTS.items + 1);
    expect(new Set(V40_LAYOUT.map((slot) => slot.id)).size).toBe(68);
    expect(V40_LAYOUT_BY_ID.size).toBe(68);
    expect(V40_LAYOUT_SCREENS).toHaveLength(V40_COUNTS.screens);
    expect(V40_LAYOUT_SCREENS.every((ids) => ids.length >= 1 && ids.length <= 2)).toBe(true);
  });

  it("형식별 개수: 두 가지 16, 이럴 때 16, 지난 일 8, 그때 나는 8, 가장 아닌 8, 칸 나누기 8, 자기 선택 4", () => {
    const count = (fmt: string) => V40_LAYOUT.filter((slot) => slot.fmt === fmt).length;
    expect([count("pair"), count("react"), count("recall"), count("instant"), count("bestworst"), count("split"), count("self")]).toEqual([16, 16, 8, 8, 8, 8, 4]);
    for (const axis of V40_AXIS_KEYS) {
      const own = scored.filter((slot) => slot.axis === axis);
      expect(own).toHaveLength(V40_COUNTS.perAxis);
      const perFacet = new Map<string, number>();
      own.forEach((slot) => perFacet.set(slot.facet as string, (perFacet.get(slot.facet as string) ?? 0) + 1));
      expect([...perFacet.values()]).toEqual([4, 4, 4, 4]);
      expect(own.map((slot) => slot.fmt).filter((fmt) => fmt === "pair")).toHaveLength(4);
    }
  });

  it("id 규칙과 구간, 화면 번호", () => {
    for (const slot of scored) {
      expect(slot.id).toBe(`${slot.axis}.${slot.facet}.${slot.section + 1}`);
      expect(slot.section).toBeLessThanOrEqual(3);
      expect(Math.floor(slot.screen / 10)).toBe(slot.section);
      expect(axisOfFacet(slot.facet!)).toBe(slot.axis);
    }
    for (const slot of self) {
      expect(slot.id).toBe(`self.${slot.axis}`);
      expect(slot.section).toBe(4);
      expect(slot.facet).toBeNull();
    }
    const screens = V40_LAYOUT.map((slot) => slot.screen);
    expect([...screens].sort((a, b) => a - b)).toEqual(screens);
    expect(Math.min(...screens)).toBe(0);
    expect(Math.max(...screens)).toBe(41);
  });

  it("같은 화면의 두 문항은 서로 다른 주제이고 같은 주제가 연달아 나오지 않는다", () => {
    for (const ids of V40_LAYOUT_SCREENS) {
      const axes = ids.map((id) => V40_LAYOUT_BY_ID.get(id)!.axis);
      expect(new Set(axes).size).toBe(axes.length);
    }
    for (let i = 1; i < V40_LAYOUT.length; i += 1) {
      expect(V40_LAYOUT[i].axis, V40_LAYOUT[i].id).not.toBe(V40_LAYOUT[i - 1].axis);
    }
  });

  it("키는 형식마다 앞극과 뒤극이 같은 수이고 구간 c 와 c+2 의 같은 위치 문항은 반대다", () => {
    for (const axis of V40_AXIS_KEYS) {
      for (const fmt of ["pair", "react", "recall", "instant", "bestworst", "split"]) {
        const sum = scored.filter((slot) => slot.axis === axis && slot.fmt === fmt).reduce((total, slot) => total + slot.key, 0);
        expect(sum, `${axis}.${fmt}`).toBe(0);
      }
    }
    expect(self.reduce((total, slot) => total + slot.key, 0)).toBe(0);
    for (const slot of scored.filter((entry) => entry.section < 2)) {
      const mirror = scored.find((entry) => entry.section === slot.section + 2 && entry.axis === slot.axis && entry.screen - 20 === slot.screen && entry.pos === slot.pos);
      expect(mirror, slot.id).toBeDefined();
      expect(mirror!.key, slot.id).toBe(-slot.key);
      // 고르기 슬롯의 하위 종류(지난 일 / 그때 나는)는 측면 순서에 따라 거울에서 바뀔 수 있다.
      const family = (fmt: string) => (fmt === "recall" || fmt === "instant" ? "choose" : fmt);
      expect(family(mirror!.fmt), slot.id).toBe(family(slot.fmt));
    }
  });

  it("하위 종류: 두 가지는 구간 0과 2가 내 방식, 1이 순간, 3이 친구 이야기. 이럴 때는 0과 2가 상대 행동, 1과 3이 사연", () => {
    for (const slot of V40_LAYOUT) {
      if (slot.fmt === "pair") expect(slot.kind).toBe(slot.section === 1 ? "moment" : slot.section === 3 ? "friends" : "method");
      else if (slot.fmt === "react") expect(slot.kind).toBe(slot.section % 2 === 0 ? "action" : "story");
      else expect(slot.kind).toBeNull();
    }
  });
});
