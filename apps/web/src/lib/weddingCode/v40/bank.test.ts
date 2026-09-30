import { describe, expect, it } from "vitest";
import * as lintModule from "../../../../../../scripts/lib/wedding-code-v40-bank-lint.mjs";
import { V40_AXES, V40_AXIS_KEYS, V40_COUNTS, V40_FACETS, V40_LETTERS, V40_WRAP_UP, WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { V40_BANK_DATA, V40_BANK_IS_PLACEHOLDER } from "@/constants/weddingCodeV40Bank";
import type { Axis, BankData, Item, PairItem, ReactItem } from "./types";
import {
  BANK_BANNED_WORDS,
  BANK_FORBIDDEN_TOPICS,
  BANK_LIMITS,
  BANK_VALUE_JUDGEMENT_WORDS,
  WEDDING_CODE_V40_BANK,
  bankModule,
  createBank,
  deriveKey,
  itemById,
  itemsOfFacet,
  itemsOfScreen,
  itemsOfSection,
  scoredItemById,
  selfItemOfAxis,
  validateBank,
} from "./bank";
import { V40_LAYOUT, V40_LAYOUT_BY_ID, V40_LAYOUT_SCREENS } from "./layout";

// ---------------------------------------------------------------------------
// 검사기(lint) 표면: 같은 규칙을 다른 언어로 구현한 것과 결정이 같은지 대조한다
// ---------------------------------------------------------------------------

interface LintIssue {
  readonly rule: string;
  readonly itemId: string | null;
}
interface LintApi {
  lintBank(data: unknown, options?: { allowPlaceholder?: boolean }): { errors: LintIssue[]; warnings: LintIssue[] };
  readonly BANNED_WORDS: readonly string[];
  readonly VALUE_JUDGEMENT_WORDS: readonly string[];
  readonly FORBIDDEN_TOPICS: readonly string[];
  readonly LETTER_NAMES: readonly string[];
  readonly ENGLISH_NAMES: readonly string[];
  readonly AXIS_TITLES: readonly string[];
  readonly WRAP_UP_TITLE: string;
  readonly LIMITS: Readonly<Record<string, number>>;
}
const lint = lintModule as unknown as LintApi;

// ---------------------------------------------------------------------------
// 변형용 복사본
// ---------------------------------------------------------------------------

interface MChoice {
  pole: string;
  text: string;
  strength?: string;
}
interface MItem {
  id: string;
  axis: string;
  facet?: string;
  section: number;
  screen: number;
  key: number;
  fmt: string;
  kind?: string;
  caption: string;
  stem: string;
  cards?: MChoice[];
  options?: MChoice[];
  entries?: MChoice[];
  question?: string;
  recap?: string;
  highPole?: string;
  ends?: { left: string; right: string };
  quote?: { speaker: string; text: string };
}
interface MData {
  version: string;
  items: MItem[];
}

const clone = (): MData => JSON.parse(JSON.stringify(V40_BANK_DATA)) as MData;
const find = (data: MData, id: string): MItem => {
  const item = data.items.find((entry) => entry.id === id);
  if (!item) throw new Error(`${id} 가 없다`);
  return item;
};
const rulesOf = (data: unknown): string[] => validateBank(data as BankData).map((issue) => issue.rule);
const lintRulesOf = (data: unknown): string[] => {
  const result = lint.lintBank(data, { allowPlaceholder: true });
  return [...result.errors, ...result.warnings].map((issue) => issue.rule);
};
const flip = (choices: MChoice[]): void => {
  choices.forEach((choice) => {
    choice.pole = choice.pole === "front" ? "back" : choice.pole === "back" ? "front" : choice.pole;
  });
};

const bank = WEDDING_CODE_V40_BANK;

describe("출하 은행", () => {
  it("검사 문제가 없다(구조, 균형, 문구)", () => {
    expect(validateBank(V40_BANK_DATA)).toEqual([]);
    expect(typeof V40_BANK_IS_PLACEHOLDER).toBe("boolean");
  });

  it("생성된 원본은 검사기(lint)도 통과한다(자리표시 문구 경고만 허용)", () => {
    const result = lint.lintBank(V40_BANK_DATA, { allowPlaceholder: true });
    expect(result.errors).toEqual([]);
  });

  it("createBank(V40_BANK_DATA) 가 WEDDING_CODE_V40_BANK 와 같은 구조를 만든다", () => {
    const again = createBank(V40_BANK_DATA);
    expect(again.items.map((item) => item.id)).toEqual(bank.items.map((item) => item.id));
    expect(again.version).toBe(WEDDING_CODE_V40_VERSION);
  });

  it("문항은 질문 순서 68개이고 배치 골격과 id, 주제, 측면, 구간, 화면, 형식, 종류, 키가 같다", () => {
    expect(bank.items).toHaveLength(68);
    bank.items.forEach((item, index) => {
      const slot = V40_LAYOUT[index];
      expect(item.id).toBe(slot.id);
      expect(item.axis).toBe(slot.axis);
      expect(item.section).toBe(slot.section);
      expect(item.screen).toBe(slot.screen);
      expect(item.fmt).toBe(slot.fmt);
      expect(item.key).toBe(slot.key);
      if (slot.facet !== null) expect((item as { facet: string }).facet).toBe(slot.facet);
      if (slot.kind !== null) expect((item as PairItem | ReactItem).kind).toBe(slot.kind);
    });
  });

  it("조회 구조: scored 64개, self 4개, byId, codeIndexById, 주제별 16개, 화면 42개", () => {
    expect(bank.scored).toHaveLength(64);
    expect(bank.self).toHaveLength(4);
    expect(bank.scored.every((item) => (item.fmt as string) !== "self")).toBe(true);
    expect(bank.self.every((item) => item.fmt === "self")).toBe(true);
    expect(bank.byId.size).toBe(68);
    bank.items.forEach((item, index) => {
      expect(bank.byId.get(item.id)).toBe(item);
      expect(bank.codeIndexById.get(item.id)).toBe(index);
    });
    for (const axis of V40_AXIS_KEYS) {
      expect(bank.scoredByAxis[axis]).toHaveLength(16);
      expect(bank.scoredByAxis[axis].every((item) => item.axis === axis)).toBe(true);
      // 질문 순서
      const indexes = bank.scoredByAxis[axis].map((item) => bank.codeIndexById.get(item.id) as number);
      expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
    }
    expect(bank.screens).toEqual(V40_LAYOUT_SCREENS);
    expect(bank.screens).toHaveLength(42);
    expect(bank.screens.every((ids) => ids.length >= 1 && ids.length <= 2)).toBe(true);
    // 자기 선택은 채점 64개 다음
    expect(bank.items.slice(64).map((item) => item.id)).toEqual(bank.self.map((item) => item.id));
    expect(bank.self.map((item) => item.axis)).toEqual(["money", "process", "scope", "support"]);
  });

  it("측면 조회: 측면마다 4문항이고 서로 다른 네 형식 슬롯을 한 번씩 만난다(라틴 배치)", () => {
    for (const axisInfo of V40_AXES) {
      for (const facet of axisInfo.facets) {
        const items = itemsOfFacet(bank, axisInfo.key, facet);
        expect(items, `${axisInfo.key}.${facet}`).toHaveLength(4);
        const slots = new Set(items.map((item) => (item.fmt === "pair" ? "pair" : item.fmt === "react" ? "react" : item.fmt === "recall" || item.fmt === "instant" ? "choose" : "heavy")));
        expect(slots.size).toBe(4);
        expect(items.map((item) => item.section).sort()).toEqual([0, 1, 2, 3]);
      }
    }
    expect(V40_FACETS).toHaveLength(16);
  });

  it("구간 조회: 구간 0에서 3은 16개, 마지막 정리는 자기 선택 4개", () => {
    for (const section of [0, 1, 2, 3] as const) {
      const items = itemsOfSection(bank, section);
      expect(items).toHaveLength(16);
      expect(items.every((item) => item.fmt !== "self")).toBe(true);
    }
    const wrapUp = itemsOfSection(bank, 4);
    expect(wrapUp).toHaveLength(4);
    expect(wrapUp.every((item) => item.fmt === "self")).toBe(true);
    for (const axis of V40_AXIS_KEYS) {
      for (const section of [0, 1, 2, 3] as const) {
        expect(itemsOfSection(bank, section).filter((item) => item.axis === axis)).toHaveLength(4);
      }
    }
  });

  it("화면 조회: 화면 0에서 41 의 문항, 범위 밖은 빈 배열", () => {
    for (let screen = 0; screen < 42; screen += 1) {
      const items = itemsOfScreen(bank, screen);
      expect(items.map((item) => item.id)).toEqual(V40_LAYOUT_SCREENS[screen]);
    }
    for (const bad of [-1, 42, 100, 1.5, Number.NaN]) expect(itemsOfScreen(bank, bad)).toEqual([]);
  });

  it("id 조회와 주제의 자기 선택", () => {
    expect(itemById(bank, "money.limit.1")?.fmt).toBe("pair");
    expect(itemById(bank, "nope")).toBeUndefined();
    expect(scoredItemById(bank, "money.limit.1")?.id).toBe("money.limit.1");
    expect(scoredItemById(bank, "self.money")).toBeUndefined();
    expect(scoredItemById(bank, "nope")).toBeUndefined();
    for (const axis of V40_AXIS_KEYS as readonly Axis[]) expect(selfItemOfAxis(bank, axis)?.id).toBe(`self.${axis}`);
  });

  it("계약 묶음: bankModule 은 validateBank 와 createBank", () => {
    expect(Object.keys(bankModule).sort()).toEqual(["createBank", "validateBank"]);
    expect(V40_COUNTS.items).toBe(68);
  });
});

describe("deriveKey: 극 배열에서 키 파생", () => {
  it("모든 문항의 파생 키가 배치 골격의 키와 같다", () => {
    for (const item of bank.items) expect(deriveKey(item), item.id).toBe(V40_LAYOUT_BY_ID.get(item.id)?.key);
  });

  it("배열이 어느 쪽도 아니면 null", () => {
    const pair = clone().items.find((item) => item.id === "money.limit.1") as MItem;
    (pair.cards as MChoice[])[1].pole = "front";
    expect(deriveKey(pair as unknown as Item)).toBeNull();
    const recall = clone().items.find((item) => item.id === "scope.timing.1") as MItem;
    (recall.options as MChoice[])[0].strength = "strong";
    expect(deriveKey(recall as unknown as Item)).toBeNull();
    const bestWorst = clone().items.find((item) => item.id === "scope.circle.1") as MItem;
    (bestWorst.cards as MChoice[])[1].pole = "front";
    expect(deriveKey(bestWorst as unknown as Item)).toBeNull();
    const split = clone().items.find((item) => item.id === "support.give.3") as MItem;
    (split.entries as MChoice[])[2].pole = "front";
    expect(deriveKey(split as unknown as Item)).toBeNull();
  });
});

describe("검사 상수는 검사기(lint)와 같다", () => {
  it("금지어, 가치 판단어, 묻지 않는 주제, 글자 수 상한이 같다", () => {
    expect([...BANK_BANNED_WORDS]).toEqual([...lint.BANNED_WORDS]);
    expect([...BANK_VALUE_JUDGEMENT_WORDS]).toEqual([...lint.VALUE_JUDGEMENT_WORDS]);
    expect([...BANK_FORBIDDEN_TOPICS]).toEqual([...lint.FORBIDDEN_TOPICS]);
    expect(BANK_LIMITS.caption).toBe(lint.LIMITS.caption);
    expect(BANK_LIMITS.stem).toBe(lint.LIMITS.stem);
    expect(BANK_LIMITS.text).toBe(lint.LIMITS.text);
    expect(BANK_LIMITS.recap).toBe(lint.LIMITS.recap);
    expect(BANK_LIMITS.end).toBe(lint.LIMITS.end);
    expect(BANK_LIMITS.poleLengthPercent).toBe(lint.LIMITS.poleLengthPercent);
  });

  it("글자 이름, 영어 이름, 주제 이름, 자기 선택 캡션이 상수 파일과 같다", () => {
    expect(V40_LETTERS.map((letter) => letter.name)).toEqual([...lint.LETTER_NAMES]);
    expect(V40_LETTERS.map((letter) => letter.english)).toEqual([...lint.ENGLISH_NAMES]);
    expect(V40_AXES.map((axis) => axis.title)).toEqual([...lint.AXIS_TITLES]);
    expect(V40_WRAP_UP.title).toBe(lint.WRAP_UP_TITLE);
  });
});

// ---------------------------------------------------------------------------
// 변형: 규칙마다 그 규칙을 깨는 변형을 심으면 검사가 그 규칙을 낸다(검사기도 같은 결정)
// ---------------------------------------------------------------------------

interface Mutation {
  readonly name: string;
  readonly apply: (data: MData) => void;
  /** validateBank 가 내야 하는 규칙. */
  readonly ts: readonly string[];
  /** 검사기(lint)가 내야 하는 규칙(같은 문제를 다른 이름으로 부른다). */
  readonly lint: readonly string[];
}

const LONG = (count: number): string => "가".repeat(count);

const MUTATIONS: readonly Mutation[] = [
  { name: "버전이 다르다", apply: (d) => { d.version = "v3.1-preferences"; }, ts: ["version"], lint: ["version"] },
  { name: "문항이 하나 모자라다", apply: (d) => { d.items.pop(); }, ts: ["item-count"], lint: ["item-count"] },
  { name: "문항이 하나 더 있다", apply: (d) => { d.items.push({ ...d.items[0], id: "extra.item" }); }, ts: ["item-count"], lint: ["item-count"] },
  { name: "id 가 겹친다", apply: (d) => { d.items[3].id = d.items[2].id; }, ts: ["id-duplicate", "layout-mismatch"], lint: ["id-duplicate", "layout-id"] },
  { name: "두 문항의 자리를 바꿨다", apply: (d) => { [d.items[0], d.items[2]] = [d.items[2], d.items[0]]; }, ts: ["layout-mismatch"], lint: ["layout-id"] },
  { name: "주제가 배치 골격과 다르다", apply: (d) => { find(d, "process.search.1").axis = "money"; }, ts: ["layout-mismatch"], lint: ["layout-axis"] },
  { name: "측면이 배치 골격과 다르다", apply: (d) => { find(d, "money.limit.1").facet = "check"; }, ts: ["layout-mismatch"], lint: ["layout-facet"] },
  { name: "구간이 배치 골격과 다르다", apply: (d) => { find(d, "money.limit.1").section = 1; }, ts: ["layout-mismatch"], lint: ["layout-section"] },
  { name: "화면 번호가 배치 골격과 다르다", apply: (d) => { find(d, "money.limit.1").screen = 5; }, ts: ["layout-mismatch"], lint: ["layout-screen"] },
  { name: "하위 종류가 배치 골격과 다르다", apply: (d) => { find(d, "money.limit.1").kind = "friends"; }, ts: ["layout-mismatch"], lint: ["layout-kind"] },
  { name: "자기 묘사 문항이 7개가 된다(내 방식 카드 세 장)", apply: (d) => { find(d, "money.moment.2").kind = "method"; }, ts: ["layout-mismatch", "indirect-count"], lint: ["layout-kind", "balance-indirect"] },
  { name: "키 필드만 뒤집었다", apply: (d) => { find(d, "money.limit.1").key = -1; }, ts: ["layout-mismatch", "key-arrangement"], lint: ["layout-key", "key-arrangement"] },
  { name: "카드 극 배열만 뒤집었다", apply: (d) => { flip(find(d, "money.limit.1").cards as MChoice[]); }, ts: ["key-arrangement"], lint: ["key-arrangement"] },
  {
    name: "키와 배열을 함께 뒤집었다(배치 골격을 어기고 균형이 깨진다)",
    apply: (d) => {
      const item = find(d, "money.limit.1");
      flip(item.cards as MChoice[]);
      item.key = -1;
    },
    ts: ["layout-mismatch", "balance-key-sum", "balance-mirror"],
    lint: ["layout-key", "balance-key-sum", "balance-mirror"],
  },
  {
    name: "자기 선택 키를 함께 뒤집었다(2:2 가 깨진다)",
    apply: (d) => {
      const item = find(d, "self.money");
      flip(item.cards as MChoice[]);
      item.key = -1;
    },
    ts: ["balance-self"],
    lint: ["balance-self"],
  },
  { name: "두 카드가 같은 극이다", apply: (d) => { (find(d, "money.limit.1").cards as MChoice[])[1].pole = "front"; }, ts: ["shape"], lint: ["shape"] },
  { name: "칸 나누기 세 번째가 중립이 아니다", apply: (d) => { (find(d, "support.give.3").entries as MChoice[])[2].pole = "front"; }, ts: ["shape"], lint: ["shape"] },
  { name: "보기 세기 값이 잘못됐다", apply: (d) => { (find(d, "scope.timing.1").options as MChoice[])[0].strength = "medium"; }, ts: ["shape"], lint: ["shape"] },
  { name: "카드가 세 장이다", apply: (d) => { (find(d, "money.limit.1").cards as MChoice[]).push({ pole: "front", text: "가나다라요" }); }, ts: ["shape"], lint: ["shape"] },
  { name: "자기 선택 캡션이 다르다", apply: (d) => { find(d, "self.money").caption = "다른 제목"; }, ts: ["self-caption"], lint: ["self-caption"] },
  { name: "캡션이 비어 있다", apply: (d) => { find(d, "money.limit.1").caption = ""; }, ts: ["empty-text"], lint: ["empty-text"] },
  { name: "캡션이 13자다", apply: (d) => { find(d, "money.limit.1").caption = LONG(13); }, ts: ["text-too-long"], lint: ["length-caption"] },
  { name: "앞말이 91자다", apply: (d) => { find(d, "money.limit.1").stem = `${LONG(90)}요`; }, ts: ["text-too-long"], lint: ["length-stem"] },
  {
    name: "카드 글이 61자다",
    apply: (d) => {
      const cards = find(d, "money.limit.1").cards as MChoice[];
      cards[0].text = `${LONG(60)}요`;
      cards[1].text = `${"나".repeat(60)}요`;
    },
    ts: ["text-too-long"],
    lint: ["length-text"],
  },
  { name: "이럴 때 앞 구절이 51자다", apply: (d) => { find(d, "process.search.1").recap = LONG(51); }, ts: ["text-too-long"], lint: ["length-recap"] },
  { name: "이럴 때 양끝 이름이 21자다", apply: (d) => { (find(d, "process.search.1").ends as { left: string; right: string }).left = LONG(21); }, ts: ["text-too-long"], lint: ["length-ends"] },
  {
    name: "이럴 때 앞말과 인용문 합이 91자다",
    apply: (d) => {
      const item = find(d, "process.search.1");
      item.stem = `${LONG(45)}요`;
      item.quote = { speaker: "상대", text: LONG(46) };
    },
    ts: ["text-too-long"],
    lint: ["length-stem"],
  },
  {
    name: "두 극의 카드 길이 차이가 15퍼센트를 넘는다",
    apply: (d) => {
      const cards = find(d, "money.limit.1").cards as MChoice[];
      cards[0].text = "가나다라마바사요";
      cards[1].text = "아자차카타파하고노도로모보소오조초코토포호구누두루무부수우주추쿠투푸후요";
    },
    ts: ["pole-length"],
    lint: ["pole-length"],
  },
  {
    name: "두 극의 카드 길이 차이가 15퍼센트를 살짝 넘는다(40자 대 33자)",
    apply: (d) => {
      const cards = find(d, "money.limit.1").cards as MChoice[];
      cards[0].text = `${"가".repeat(39)}요`;
      cards[1].text = `${"나".repeat(32)}요`;
    },
    ts: ["pole-length"],
    lint: ["pole-length"],
  },
  { name: "아라비아 숫자가 있다", apply: (d) => { find(d, "money.limit.1").stem += " 3"; }, ts: ["digit"], lint: ["digit"] },
  { name: "줄표가 있다", apply: (d) => { find(d, "money.limit.1").stem += " — "; }, ts: ["dash"], lint: ["dash"] },
  { name: "짧은 줄표가 있다", apply: (d) => { find(d, "money.limit.1").stem += " – "; }, ts: ["dash"], lint: ["dash"] },
  { name: "퍼센트 기호가 있다", apply: (d) => { find(d, "money.limit.1").stem += " %"; }, ts: ["percent"], lint: ["percent"] },
  { name: "화면 라벨처럼 보인다", apply: (d) => { find(d, "money.limit.1").stem = "A. 시작해요"; }, ts: ["label"], lint: ["label"] },
  { name: "홀로 선 영문 대문자가 있다", apply: (d) => { find(d, "money.limit.1").stem += " V 라고 해요"; }, ts: ["latin-token"], lint: ["latin-token"] },
  { name: "글자 이름이 나온다", apply: (d) => { find(d, "money.limit.1").stem += ` ${V40_LETTERS[0].name}`; }, ts: ["letter-name"], lint: ["letter-name"] },
  { name: "글자 영어 이름이 나온다", apply: (d) => { find(d, "money.limit.1").stem += " Verify 해요"; }, ts: ["letter-name"], lint: ["letter-name"] },
  { name: "주제 이름이 나온다", apply: (d) => { find(d, "money.limit.1").stem += ` ${V40_AXES[0].title}`; }, ts: ["axis-name"], lint: ["axis-name"] },
  { name: "금지어가 나온다", apply: (d) => { find(d, "money.limit.1").stem += " 점수"; }, ts: ["banned-word"], lint: ["banned-word"] },
  { name: "금지어 MBTI 가 나온다", apply: (d) => { find(d, "money.limit.1").stem += " mbti"; }, ts: ["banned-word"], lint: ["banned-word"] },
  { name: "가치 판단어가 나온다", apply: (d) => { find(d, "money.limit.1").stem += " 현명해요"; }, ts: ["value-judgement"], lint: ["value-judgement"] },
  { name: "묻지 않는 주제가 나온다", apply: (d) => { find(d, "money.limit.1").stem += " 신혼집"; }, ts: ["forbidden-topic"], lint: ["forbidden-topic"] },
  { name: "인 답 꼴이 있다", apply: (d) => { find(d, "money.limit.1").stem += " 이건 좋은 인 답."; }, ts: ["noun-answer"], lint: ["noun-answer"] },
  { name: "합쇼체 말투가 있다", apply: (d) => { find(d, "money.limit.1").stem = "시작합니다."; }, ts: ["system-tone"], lint: ["politeness"] },
  {
    name: "한 문항 안에서 두 극의 글이 같다",
    apply: (d) => {
      const cards = find(d, "money.limit.1").cards as MChoice[];
      cards[1].text = cards[0].text;
    },
    ts: ["same-text"],
    lint: ["same-text"],
  },
  { name: "이럴 때 양끝 이름이 같다", apply: (d) => { const ends = find(d, "process.search.1").ends as { left: string; right: string }; ends.right = ends.left; }, ts: ["same-text"], lint: ["same-text"] },
  { name: "가장 아닌 것 카드가 요로 끝나지 않는다", apply: (d) => { (find(d, "scope.circle.1").cards as MChoice[])[0].text = "가나다"; }, ts: ["bestworst-ending"], lint: ["bestworst-ending"] },
  { name: "가장 아닌 것 카드에 마침표가 있다", apply: (d) => { const card = (find(d, "scope.circle.1").cards as MChoice[])[0]; card.text = `${card.text.replace(/요$/, "")}요.`; }, ts: ["bestworst-ending"], lint: ["bestworst-ending"] },
  {
    name: "가장 아닌 것 카드 글 안쪽에 마침표가 있다(요로는 끝난다)",
    apply: (d) => {
      const card = (find(d, "scope.circle.1").cards as MChoice[])[0];
      expect(card.text.endsWith("요")).toBe(true);
      card.text = `${card.text.slice(0, 6)}.${card.text.slice(6)}`;
    },
    ts: ["bestworst-ending"],
    lint: ["bestworst-ending"],
  },
];

describe("규칙마다 변형을 심으면 그 규칙이 빨개진다(검사기와 같은 결정)", () => {
  it("변형이 없는 복사본은 문제가 없다(시험 자체의 기준)", () => {
    expect(rulesOf(clone())).toEqual([]);
    expect(lint.lintBank(clone(), { allowPlaceholder: true }).errors).toEqual([]);
  });

  for (const mutation of MUTATIONS) {
    it(`${mutation.name}`, () => {
      const data = clone();
      mutation.apply(data);
      const ts = rulesOf(data);
      for (const rule of mutation.ts) expect(ts, `validateBank 규칙 ${rule}`).toContain(rule);
      const lints = lintRulesOf(data);
      for (const rule of mutation.lint) expect(lints, `검사기 규칙 ${rule}`).toContain(rule);
      expect(() => createBank(data as unknown as BankData)).toThrow(/문항 은행 검사/);
    });
  }

  it("변형 목록이 validateBank 의 모든 규칙 코드를 한 번 이상 다룬다", () => {
    const covered = new Set(MUTATIONS.flatMap((mutation) => mutation.ts));
    for (const rule of [
      "version", "item-count", "id-duplicate", "layout-mismatch", "shape", "self-caption", "key-arrangement", "balance-key-sum",
      "balance-mirror", "balance-self", "indirect-count", "empty-text", "text-too-long", "pole-length", "dash", "digit", "percent", "label", "latin-token",
      "letter-name", "axis-name", "banned-word", "value-judgement", "noun-answer", "system-tone", "forbidden-topic", "bestworst-ending", "same-text",
    ]) {
      expect(covered.has(rule), `변형이 없는 규칙 ${rule}`).toBe(true);
    }
  });

  it("두 극의 카드 길이 차이가 정확히 15퍼센트(40자 대 34자)이면 통과하고 검사기도 같다(경계는 초과만 걸린다)", () => {
    const data = clone();
    const cards = find(data, "money.limit.1").cards as MChoice[];
    cards[0].text = `${"가".repeat(39)}요`;
    cards[1].text = `${"나".repeat(33)}요`;
    expect(rulesOf(data)).not.toContain("pole-length");
    expect(lintRulesOf(data)).not.toContain("pole-length");
  });

  it("문제가 있으면 createBank 는 모든 메시지를 담은 Error 를 던진다", () => {
    const data = clone();
    find(data, "money.limit.1").stem += " 3";
    find(data, "money.limit.2").stem += " %";
    let message = "";
    try {
      createBank(data as unknown as BankData);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("[digit] money.limit.1");
    expect(message).toContain("[percent] money.limit.2");
  });

});

describe("문구에 기대지 않는다: 규칙을 지키는 다른 문구로 통째로 바꿔도 검사를 통과한다", () => {
  /** 겹침이 적은 한글 음절 열. 금지어, 글자 이름, 주제 이름, 가치 판단어의 글자를 쓰지 않는다. */
  const SYLLABLES = "구나두라무바수아주추쿠투푸후거너더러머버서어저처커터퍼허고노도로모보소오조초코토포호";
  function sentence(seed: number, size: number): string {
    let state = (seed * 2654435761) >>> 0;
    let text = "";
    for (let i = 0; i < size - 1; i += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      text += SYLLABLES[state % SYLLABLES.length];
    }
    return `${text}요`;
  }

  function rewritten(): MData {
    const data = clone();
    let counter = 0;
    const next = (size: number) => sentence((counter += 1), size);
    for (const item of data.items) {
      item.caption = item.fmt === "self" ? V40_WRAP_UP.title : next(6);
      item.stem = `${next(30)}`;
      // 두 극의 길이를 같게 맞춘다
      const size = 24;
      for (const list of [item.cards, item.options, item.entries]) {
        list?.forEach((choice) => {
          choice.text = next(size);
        });
      }
      if (item.fmt === "react") {
        item.question = "그때 내 마음은?";
        item.recap = next(20);
        item.ends = { left: next(10), right: next(11) };
        if (item.quote) item.quote = { speaker: "상대", text: next(30).replace(/요$/, "요") };
      }
    }
    return data;
  }

  it("바꾼 은행도 validateBank 와 검사기 모두 오류가 없다", () => {
    const data = rewritten();
    expect(rulesOf(data)).toEqual([]);
    const result = lint.lintBank(data, { allowPlaceholder: true });
    expect(result.errors.map((issue) => `${issue.rule}@${issue.itemId}`)).toEqual([]);
    expect(createBank(data as unknown as BankData).items).toHaveLength(68);
  });
});

describe("어떤 입력에도 던지지 않는다", () => {
  it("망가진 원본은 문제 목록으로 답한다", () => {
    const garbage: unknown[] = [
      null,
      undefined,
      42,
      "text",
      [],
      {},
      { version: WEDDING_CODE_V40_VERSION },
      { version: WEDDING_CODE_V40_VERSION, items: "no" },
      { version: WEDDING_CODE_V40_VERSION, items: [null, 5, "x", {}, []] },
      { version: WEDDING_CODE_V40_VERSION, items: V40_BANK_DATA.items.map(() => ({})) },
      { version: WEDDING_CODE_V40_VERSION, items: V40_BANK_DATA.items.map((item) => ({ ...item, cards: 3, options: null, entries: "x", ends: 1, quote: 2 })) },
      { version: WEDDING_CODE_V40_VERSION, items: V40_BANK_DATA.items.map((item) => ({ ...item, caption: 5, stem: null })) },
    ];
    for (const value of garbage) {
      const issues = validateBank(value as BankData);
      expect(issues.length, JSON.stringify(value)?.slice(0, 40)).toBeGreaterThan(0);
      expect(() => createBank(value as BankData)).toThrow();
    }
  });

  it("성긴 배열(빈 칸이 있는 items 와 카드 목록)도 던지지 않고 문제로 알린다", () => {
    const sparseItems = new Array(68) as unknown[];
    const half = V40_BANK_DATA.items.slice(0, 30);
    half.forEach((item, index) => {
      sparseItems[index] = item;
    });
    for (const items of [new Array(3), sparseItems, [, , ,] as unknown[]]) {
      const value = { version: WEDDING_CODE_V40_VERSION, items } as unknown as BankData;
      let issues: ReturnType<typeof validateBank> = [];
      expect(() => {
        issues = validateBank(value);
      }).not.toThrow();
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some((issue) => issue.rule === "shape" || issue.rule === "item-count")).toBe(true);
      expect(() => createBank(value)).toThrow();
    }
    // 빈 칸은 문항이 없는 것과 같은 shape 문제로 잡힌다(검사 없이 통과하지 않는다).
    const holed = [...V40_BANK_DATA.items] as unknown[];
    delete holed[5];
    const holedIssues = validateBank({ version: WEDDING_CODE_V40_VERSION, items: holed } as unknown as BankData);
    expect(holedIssues.some((issue) => issue.rule === "shape")).toBe(true);
    // 카드 목록의 빈 칸도 마찬가지다.
    const data = clone();
    const target = find(data, "process.owner.1");
    const list = (target.cards ?? target.options ?? target.entries) as unknown[];
    delete list[0];
    let holedCards: ReturnType<typeof validateBank> = [];
    expect(() => {
      holedCards = validateBank(data as unknown as BankData);
    }).not.toThrow();
    expect(holedCards.some((issue) => issue.rule === "shape")).toBe(true);
  });

  it("순환 참조, BigInt, 프로토타입 없는 객체가 든 필드도 던지지 않는다(메시지에 값을 적을 때)", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const values: unknown[] = [circular, BigInt(7), Object.create(null), Symbol("x")];
    for (const value of values) {
      for (const field of ["id", "fmt", "key", "section"]) {
        const data = clone();
        (find(data, "money.limit.1") as unknown as Record<string, unknown>)[field] = value;
        let issues: ReturnType<typeof validateBank> = [];
        expect(() => {
          issues = validateBank(data as unknown as BankData);
        }, field).not.toThrow();
        expect(issues.length, field).toBeGreaterThan(0);
      }
      const versioned = { ...clone(), version: value };
      expect(() => validateBank(versioned as unknown as BankData)).not.toThrow();
      expect(validateBank(versioned as unknown as BankData).some((issue) => issue.rule === "version")).toBe(true);
    }
  });

  it("한 문항의 일부 필드가 망가진 경우도 다른 문항 검사는 이어진다", () => {
    const data = clone();
    (find(data, "money.limit.1") as unknown as Record<string, unknown>).cards = "망가짐";
    find(data, "money.limit.2").stem += " 3";
    const rules = rulesOf(data);
    expect(rules).toContain("shape");
    expect(rules).toContain("digit");
  });
});
