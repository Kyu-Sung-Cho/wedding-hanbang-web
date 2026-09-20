import { describe, expect, it } from "vitest";

import { WEDDING_CODE_SELF_READING } from "@/constants/weddingCodeSelfReading";
import {
  WEDDING_CODE_TALK_FIRST_ITEMS,
  WEDDING_CODE_TALK_FIRST_MORE,
  WEDDING_CODE_TALK_FIRST_SUMMARY,
  WEDDING_CODE_TALK_FIRST_THIN_NOTE,
} from "@/constants/weddingCodeTalkFirst";
import {
  CURRENT_WEDDING_CODE_SCENE_CONFIG,
  weddingCodeSceneCountLabel,
} from "@/lib/weddingCode/scene/config";
import type { WeddingCodeSelfProfile } from "@/lib/weddingCode/scene/selfProfile";
import { buildWeddingCodeLetters, type WeddingCodeLetters } from "../letters";
import { buildWeddingCodeTalkFirst, type WeddingCodeTalkFirst } from "../talkFirst";

/**
 * 「이번 주엔 뭐부터 같이 얘기해 볼까요?」 고르는 규칙 (2026-09-18).
 *
 * 지키는 것:
 * - 표에 적은 대로 고르고 줄 세운다(차이 → 답한 수 → 축 순서, 하나 차이는 답한 수 → 축 순서).
 * - 건너뛴·같은 수·한 장면 주제는 항목에 절대 안 나오고, 뺀 이유(한 문장)에 반드시 나온다.
 * - 답이 얇으면 덜 말한다. 쓸 주제가 없으면 칸 자체가 없다.
 * - 요약은 순위(「가장 큰」)를 말하지 않는다.
 * - 항목 문구가 같은 화면의 축 카드 문구를 되풀이하지 않는다.
 * - 요약·첫 문장·설명의 모든 문장 끝말이 한 칸에 세 번 같지 않다.
 *
 * 셈은 지금 판의 축 정의에서 만든다 — 판이 바뀌어도 같은 규칙을 본다.
 */

const AXES = CURRENT_WEDDING_CODE_SCENE_CONFIG.axes;
const TOTAL = CURRENT_WEDDING_CODE_SCENE_CONFIG.questions.length;
const SCENE_LABEL = weddingCodeSceneCountLabel(TOTAL);

type Pair = readonly [number, number];

function lettersOf(counts: readonly Pair[]): { letters: WeddingCodeLetters; answered: number } {
  const axes = AXES.map((axis, index) => {
    const [leftCount, rightCount] = counts[index] ?? [0, 0];
    const lean = leftCount === rightCount ? "mixed" : leftCount > rightCount ? "left" : "right";
    return {
      axis: axis.key,
      axisLabel: axis.labelKo,
      lean,
      title: WEDDING_CODE_SELF_READING[axis.key][lean].title,
      leftLabel: "",
      rightLabel: "",
      leftCount,
      rightCount,
      answered: leftCount + rightCount,
      evidence: [],
      missingPhrases: [],
      qualifiers: [],
      tellPartner: "",
      watchOut: "",
    } as const;
  });
  const answered = axes.reduce((sum, axis) => sum + axis.answered, 0);
  const profile: WeddingCodeSelfProfile = { answered, total: TOTAL, complete: answered === TOTAL, repeated: [], axes };
  return { letters: buildWeddingCodeLetters(profile), answered };
}

function talkFirstOf(counts: readonly Pair[]): WeddingCodeTalkFirst | null {
  const { letters, answered } = lettersOf(counts);
  return buildWeddingCodeTalkFirst(letters, { answered, total: TOTAL });
}

/** 「coordinationScope:lean:F」 — 축, 종류, 그 주제에서 더 많았던 글자. */
function itemKeys(result: WeddingCodeTalkFirst | null): string[] {
  return result?.items.map((item) => `${item.axis}:${item.kind}:${item.slot.upper}`) ?? [];
}

const LABEL = Object.fromEntries(AXES.map((axis) => [axis.key, `‘${axis.labelKo}’`]));
const [DC, PM, CS, SO] = AXES.map((axis) => axis.key);

describe("먼저 얘기해 볼 주제 — 고르는 표", () => {
  it("축 네 개가 정할 때·준비·부모님·힘들 때 순서다(이 표의 전제)", () => {
    expect(AXES.map((axis) => axis.key)).toEqual(["decisionCriteria", "preparationMode", "coordinationScope", "supportOrder"]);
  });

  it("V4:1 · T3:2 · F5:0 · H4:1 → F, V, 그리고 하나 차이 T", () => {
    const result = talkFirstOf([[4, 1], [3, 2], [0, 5], [4, 1]]);
    expect(itemKeys(result)).toEqual([`${CS}:lean:F`, `${DC}:lean:V`, `${PM}:split:T`]);
    expect(result?.summary).toBe(WEDDING_CODE_TALK_FIRST_SUMMARY.leanAndSplit);
    expect(result?.leftOut).toBeNull();
  });

  it("V5:0 · O3:0 · 2:2 · 모두 건너뜀 → V, O. 뺀 이유는 건너뜀 → 같은 수 순서로 한 문장", () => {
    const result = talkFirstOf([[5, 0], [0, 3], [2, 2], [0, 0]]);
    expect(itemKeys(result)).toEqual([`${DC}:lean:V`, `${PM}:lean:O`]);
    expect(result?.summary).toBe(WEDDING_CODE_TALK_FIRST_SUMMARY.leanMany);
    expect(result?.leftOut).toBe(`${LABEL[SO]}는 건너뛰었고, ${LABEL[CS]}는 양쪽 답 수가 같아서 여기선 뺐어요.`);
  });

  it("여섯 장면만: V2:0 · T1:0 · 1:1 · H1:0 → V 하나. 같은 수 → 한 장면 순서로 빼고 얇다고 말한다", () => {
    const result = talkFirstOf([[2, 0], [1, 0], [1, 1], [1, 0]]);
    expect(itemKeys(result)).toEqual([`${DC}:lean:V`]);
    expect(result?.summary).toBe(WEDDING_CODE_TALK_FIRST_SUMMARY.leanOne);
    expect(result?.leftOut).toBe(
      `${LABEL[CS]}는 양쪽 답 수가 같았고, ${LABEL[PM]}, ${LABEL[SO]}는 한 장면만 답해서 여기선 뺐어요.`,
    );
    // 몇 장면 답했는지는 다시 말하지 않는다(결과 머리에 이미 있다).
    expect(result?.thinNote).toBe("아직 답한 장면이 적어서, 답이 몇 개만 달라져도 여기 적은 주제가 바뀔 수 있어요.");
  });

  it("건너뜀·같은 수·한 장면이 다 있어도 뺀 이유는 한 문장이다", () => {
    const result = talkFirstOf([[0, 0], [1, 0], [3, 0], [2, 2]]);
    expect(itemKeys(result)).toEqual([`${CS}:lean:U`]);
    expect(result?.leftOut).toBe(
      "‘정할 때 살펴볼 것’은 건너뛰었고, ‘힘들 때 뭐부터 하나’는 양쪽 답 수가 같았고, ‘준비를 어떻게 나누나’는 한 장면만 답해서 여기선 뺐어요.",
    );
  });

  it("요약은 순서를 말하지 않는다 — 네 주제가 모두 5:0 이면 둘만 적고, 나머지는 카드에 있다고 한다", () => {
    const result = talkFirstOf([[5, 0], [5, 0], [0, 5], [0, 5]]);
    expect(itemKeys(result)).toEqual([`${DC}:lean:V`, `${PM}:lean:T`]);
    expect(result?.summary).toBe("한쪽으로 답이 몰린 주제 두 개를 적었어요.");
    expect(result?.more).toBe(WEDDING_CODE_TALK_FIRST_MORE);
    for (const summary of Object.values(WEDDING_CODE_TALK_FIRST_SUMMARY)) {
      expect(summary, summary).not.toMatch(/가장|부터|답 수 차이/);
    }
  });

  it("골라 적을 주제가 자리를 넘지 않으면 「나머지」 줄을 붙이지 않는다", () => {
    // 둘만 몰리고 둘은 건너뜀 — 적을 수 있는 주제가 모두 적혔다.
    const exact = talkFirstOf([[5, 0], [0, 5], [0, 0], [0, 0]]);
    expect(itemKeys(exact)).toHaveLength(2);
    expect(exact?.more).toBeNull();
    // 셋이 몰리면 둘만 적으니 붙는다.
    const over = talkFirstOf([[5, 0], [0, 5], [4, 1], [0, 0]]);
    expect(itemKeys(over)).toHaveLength(2);
    expect(over?.more).toBe(WEDDING_CODE_TALK_FIRST_MORE);
  });

  it("모두 3:2 → 하나 차이 두 개(차이 큰 주제가 없으니)", () => {
    const result = talkFirstOf([[3, 2], [3, 2], [3, 2], [3, 2]]);
    expect(itemKeys(result)).toEqual([`${DC}:split:V`, `${PM}:split:T`]);
    expect(result?.summary).toBe(WEDDING_CODE_TALK_FIRST_SUMMARY.splitMany);
  });

  it("하나 차이끼리는 답한 장면이 많은 쪽 먼저, 같으면 축 순서", () => {
    const result = talkFirstOf([[2, 1], [3, 2], [1, 2], [2, 3]]);
    expect(itemKeys(result)).toEqual([`${PM}:split:T`, `${SO}:split:A`]);
  });

  it("굳기 라벨이 아니라 차이로 줄 세운다 — 2:0 이 4:1 을 앞지르지 않는다", () => {
    expect(itemKeys(talkFirstOf([[2, 0], [4, 1], [0, 0], [0, 0]]))).toEqual([`${PM}:lean:T`, `${DC}:lean:V`]);
    // 차이가 같으면 답한 장면이 많은 쪽 먼저.
    expect(itemKeys(talkFirstOf([[2, 0], [3, 1], [0, 0], [0, 0]]))).toEqual([`${PM}:lean:T`, `${DC}:lean:V`]);
  });

  it("차이 큰 주제가 하나면 하나 차이는 하나만 붙는다", () => {
    const result = talkFirstOf([[5, 0], [3, 2], [2, 3], [0, 0]]);
    expect(itemKeys(result)).toEqual([`${DC}:lean:V`, `${PM}:split:T`]);
    expect(result?.summary).toBe(WEDDING_CODE_TALK_FIRST_SUMMARY.leanAndSplit);
  });

  it("차이 큰 주제가 셋 이상이어도 두 개만, 하나 차이가 없으면 채우지 않는다", () => {
    const result = talkFirstOf([[5, 0], [0, 5], [4, 1], [1, 4]]);
    expect(itemKeys(result)).toEqual([`${DC}:lean:V`, `${PM}:lean:O`]);
    expect(result?.summary).toBe(WEDDING_CODE_TALK_FIRST_SUMMARY.leanMany);
  });

  it("하나 차이 하나뿐이면 그것만", () => {
    const result = talkFirstOf([[2, 1], [1, 1], [0, 0], [1, 0]]);
    expect(itemKeys(result)).toEqual([`${DC}:split:V`]);
    expect(result?.summary).toBe(WEDDING_CODE_TALK_FIRST_SUMMARY.splitOne);
  });

  it("모든 주제가 한 장면이거나 같은 수거나 건너뛰었으면 칸이 없다", () => {
    expect(talkFirstOf([[1, 0], [1, 1], [0, 0], [0, 1]])).toBeNull();
    expect(talkFirstOf([[2, 2], [1, 1], [0, 0], [3, 3]])).toBeNull();
    expect(talkFirstOf([[0, 0], [0, 0], [0, 0], [0, 0]])).toBeNull();
  });

  it("항목 문구는 그 축·그 쪽 문구이고, 굳기 라벨 옆에 답한 장면 수가 붙는다", () => {
    const result = talkFirstOf([[4, 1], [3, 2], [0, 5], [4, 1]])!;
    expect(result.items.map((item) => [item.lead, item.detail])).toEqual([
      [WEDDING_CODE_TALK_FIRST_ITEMS.coordinationScope.right.lead, WEDDING_CODE_TALK_FIRST_ITEMS.coordinationScope.right.detail],
      [WEDDING_CODE_TALK_FIRST_ITEMS.decisionCriteria.left.lead, WEDDING_CODE_TALK_FIRST_ITEMS.decisionCriteria.left.detail],
      [WEDDING_CODE_TALK_FIRST_ITEMS.preparationMode.split.lead, WEDDING_CODE_TALK_FIRST_ITEMS.preparationMode.split.detail],
    ]);
    expect(result.items.map((item) => item.tagLabel)).toEqual([
      "모두 같은 쪽 · 답한 5장면",
      "한쪽이 더 많음 · 답한 5장면",
      "하나 차이 · 답한 5장면",
    ]);
    expect(result.partnerLine).toBe(
      `여기까지는 내 답만 본 거예요. 상대도 같은 ${SCENE_LABEL} 장면에 답하면 둘이 다르게 고른 장면이 나란히 나와요.`,
    );
    expect(result.thinNote).toBeNull();
  });
});

/** 한 축이 가질 수 있는 셈을 종류별로 — 건너뜀, 한 장면, 같은 수, 두 장면 이상 한쪽, 하나 차이. */
const KINDS: readonly Pair[] = [[0, 0], [1, 0], [0, 1], [1, 1], [2, 2], [2, 0], [0, 3], [3, 1], [2, 1], [3, 2], [2, 3], [5, 0], [1, 4]];

function* everyCombination(): Generator<Pair[]> {
  for (const a of KINDS) for (const b of KINDS) for (const c of KINDS) for (const d of KINDS) yield [a, b, c, d];
}

/**
 * 뺀 이유 한 문장을 이유 묶음(절)으로 나눈다. 앞 묶음은 「~고,」로, 마지막 묶음은
 * 「~서 여기선 뺐어요.」로 끝난다. 주제 이름에는 「고,」가 없다.
 */
function leftOutClauses(sentence: string | null): string[] {
  return sentence ? sentence.split(/(?<=고,) /u) : [];
}

/** 이유마다 앞 묶음 꼴과 마지막 묶음 꼴. */
const REASON_FORMS = {
  skipped: ["건너뛰었고,", "건너뛰어서 여기선 뺐어요."],
  tie: ["양쪽 답 수가 같았고,", "양쪽 답 수가 같아서 여기선 뺐어요."],
  single: ["한 장면만 답했고,", "한 장면만 답해서 여기선 뺐어요."],
} as const;

describe("먼저 얘기해 볼 주제 — 없는 답으로 말하지 않는다", () => {
  it("측정기가 살아 있다 — 뺀 이유 문장을 묶음으로 나눈다", () => {
    expect(leftOutClauses("‘가’는 건너뛰었고, ‘나’, ‘다’는 양쪽 답 수가 같았고, ‘라’는 한 장면만 답해서 여기선 뺐어요."))
      .toEqual(["‘가’는 건너뛰었고,", "‘나’, ‘다’는 양쪽 답 수가 같았고,", "‘라’는 한 장면만 답해서 여기선 뺐어요."]);
    expect(leftOutClauses(null)).toEqual([]);
  });

  it("건너뛴·같은 수·한 장면 주제는 항목에 없고, 뺀 이유 한 문장에 그 이름과 맞는 이유가 꼭 있다", () => {
    let checkedExcluded = 0;
    let multiReason = 0;
    for (const counts of everyCombination()) {
      const result = talkFirstOf(counts);
      const label = counts.map(String).join(" ");
      if (result?.leftOut) {
        // 한 문장: 「뺐어요」·「여기선」·마침표가 한 번씩, 맨 끝에만.
        const sentence = result.leftOut;
        expect(sentence.endsWith("여기선 뺐어요."), `${label} ${sentence}`).toBe(true);
        expect(sentence.split("뺐어요").length - 1, `${label} ${sentence}`).toBe(1);
        expect(sentence.split("여기선").length - 1, `${label} ${sentence}`).toBe(1);
        expect(sentence.match(/[.?!]/gu), `${label} ${sentence}`).toHaveLength(1);
        const clauses = leftOutClauses(sentence);
        if (clauses.length > 1) multiReason += 1;
        clauses.slice(0, -1).forEach((clause) => expect(clause.endsWith("고,"), `${label} ${clause}`).toBe(true));
      }
      counts.forEach(([left, right], index) => {
        const axis = AXES[index].key;
        const answered = left + right;
        const reason = answered === 0 ? "skipped" : left === right ? "tie" : answered === 1 ? "single" : null;
        if (!result) {
          // 칸이 없으면 쓸 주제가 하나도 없었어야 한다.
          expect(reason, `${label} ${axis}`).not.toBeNull();
          return;
        }
        const inItems = result.items.some((item) => item.axis === axis);
        const clause = leftOutClauses(result.leftOut).find((line) => line.includes(LABEL[axis]));
        if (reason) {
          checkedExcluded += 1;
          expect(inItems, `${label} ${axis} 항목`).toBe(false);
          const [mid, last] = REASON_FORMS[reason];
          expect(
            Boolean(clause && (clause.endsWith(mid) || clause.endsWith(last))),
            `${label} ${axis} 뺀 이유: ${result.leftOut}`,
          ).toBe(true);
        } else {
          expect(clause, `${label} ${axis} 쓸 수 있는 주제를 뺐다고 하지 않는다`).toBeUndefined();
        }
      });
    }
    // 이 셈이 0 이면 위 검사는 공짜 초록이다.
    expect(checkedExcluded).toBeGreaterThan(1000);
    expect(multiReason).toBeGreaterThan(100);
  });

  it("답이 얇으면 덜 말한다 — 항목은 쓸 주제 수를 넘지 않고, 절반 미만이면 얇다고 말한다", () => {
    let thin = 0;
    for (const counts of everyCombination()) {
      const result = talkFirstOf(counts);
      const usable = counts.filter(([left, right]) => left !== right && left + right >= 2).length;
      const answered = counts.reduce((sum, [left, right]) => sum + left + right, 0);
      if (usable === 0) {
        expect(result, counts.join(" ")).toBeNull();
        continue;
      }
      expect(result!.items.length).toBeGreaterThanOrEqual(1);
      expect(result!.items.length).toBeLessThanOrEqual(Math.min(3, usable));
      expect(new Set(result!.items.map((item) => item.axis)).size).toBe(result!.items.length);
      if (answered * 2 < TOTAL) {
        thin += 1;
        expect(result!.thinNote, counts.join(" ")).toBe(WEDDING_CODE_TALK_FIRST_THIN_NOTE);
      } else {
        expect(result!.thinNote, counts.join(" ")).toBeNull();
      }
    }
    expect(thin).toBeGreaterThan(100);
  });

  it("주제마다 한 장면씩만 답했으면 아무것도 고르지 않는다", () => {
    for (const counts of everyCombination()) {
      if (counts.every(([left, right]) => left + right <= 1)) expect(talkFirstOf(counts), counts.join(" ")).toBeNull();
    }
  });
});

/** 띄어쓰기를 뺀 12글자 이상 같은 토막. 한 화면에서 같은 말을 두 번 읽히지 않게 보는 기준이다. */
const OVERLAP_RUN = 12;

function sharedRun(a: string, b: string): string | null {
  const x = a.replace(/\s+/g, "");
  const y = b.replace(/\s+/g, "");
  for (let start = 0; start + OVERLAP_RUN <= x.length; start += 1) {
    const piece = x.slice(start, start + OVERLAP_RUN);
    if (y.includes(piece)) return piece;
  }
  return null;
}

const ITEM_ENTRIES = AXES.flatMap(({ key }) =>
  (["left", "right", "split"] as const).map((kind) => ({ key, kind, copy: WEDDING_CODE_TALK_FIRST_ITEMS[key][kind] })),
);
const CARD_TEXTS = AXES.flatMap(({ key }) =>
  (["left", "right", "mixed"] as const).flatMap((lean) => {
    const card = WEDDING_CODE_SELF_READING[key][lean];
    return [card.title, card.tellPartner, card.watchOut].map((text) => ({ where: `${key} ${lean}`, text }));
  }),
);

describe("먼저 얘기해 볼 주제 — 축 카드와 같은 말을 되풀이하지 않는다", () => {
  it("측정기가 살아 있다", () => {
    expect(ITEM_ENTRIES).toHaveLength(12);
    expect(CARD_TEXTS).toHaveLength(36);
    // 카드 문장을 그대로 옮겨 오면 잡는다. 띄어쓰기만 바꿔도 잡는다.
    const planted = WEDDING_CODE_SELF_READING.decisionCriteria.mixed.tellPartner;
    expect(sharedRun(planted.replace(/ /g, "  "), planted)).not.toBeNull();
    expect(sharedRun("둘이 같이 할 일 하나를 골라 보세요.", "업체 전화랑 카톡은 요일 나눠서 받을까?")).toBeNull();
  });

  it("어느 항목의 첫 문장·설명도 네 축 카드의 제목·물어볼 말·챙길 것과 12글자 넘게 겹치지 않는다", () => {
    const overlaps: string[] = [];
    for (const { key, kind, copy } of ITEM_ENTRIES) {
      for (const text of [copy.lead, copy.detail]) {
        for (const card of CARD_TEXTS) {
          const run = sharedRun(text, card.text);
          if (run) overlaps.push(`${key} ${kind} ↔ ${card.where}: ${run}`);
        }
      }
    }
    expect(overlaps).toEqual([]);
  });
});

/** 문장으로 나눈다. 마침표·물음표·느낌표 뒤 띄어쓰기가 경계다(따옴표 안 문장에는 마침표가 없다). */
function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.?!])\s+/u).map((sentence) => sentence.trim()).filter(Boolean);
}

/** 문장의 마지막 낱말(문장부호 뺀 것). */
function lastWord(sentence: string): string {
  return sentence.trim().replace(/[.?!…]+$/u, "").split(/\s+/).at(-1) ?? "";
}

/** 한 칸에서 세는 문장: 요약, 항목마다 첫 문장과 설명. */
function sectionSentences(result: WeddingCodeTalkFirst): string[] {
  return [result.summary, ...(result.more ? [result.more] : []), ...result.items.flatMap((item) => [item.lead, item.detail])]
    .flatMap(sentencesOf);
}

/** 세 번 이상 나온 끝말. */
function repeatedEndings(sentences: readonly string[]): string[] {
  const tally = new Map<string, number>();
  for (const sentence of sentences) tally.set(lastWord(sentence), (tally.get(lastWord(sentence)) ?? 0) + 1);
  return [...tally].filter(([, count]) => count >= 3).map(([word, count]) => `「${word}」 ${count}번`);
}

/** 한 축 0..5 × 0..5 의 모든 셈. 네 축이면 36⁴ = 1,679,616 조합이다. */
const EVERY_PAIR: readonly Pair[] = Array.from({ length: 36 }, (_, index) => [Math.floor(index / 6), index % 6] as const);

describe("먼저 얘기해 볼 주제 — 세 항목이 모여도 기계처럼 읽히지 않는다", () => {
  it("측정기가 살아 있다 — 설명 두 문장을 모두 세고, 끝말 세 번을 잡는다", () => {
    const detail = WEDDING_CODE_TALK_FIRST_ITEMS.decisionCriteria.left.detail;
    expect(sentencesOf(detail)).toHaveLength(2);
    expect(sentencesOf(detail).map(lastWord)).toEqual(["돼요", "봐요"]);
    // 따옴표 안 말이 있어도 한 문장이다.
    expect(sentencesOf(WEDDING_CODE_TALK_FIRST_ITEMS.coordinationScope.split.detail)).toHaveLength(2);
    expect(repeatedEndings(["적어 두면 돼요.", "해 보면 돼요.", "듣지 않아도 돼요."])).toEqual(["「돼요」 3번"]);
    expect(repeatedEndings(["적어 두면 돼요.", "해 보면 돼요.", "얘기가 쉬워져요."])).toEqual([]);
    // 요약·첫 문장·설명을 모두 센다: 항목 셋이면 1 + 3 + 6 문장 이상.
    const full = talkFirstOf([[4, 1], [3, 2], [0, 5], [4, 1]])!;
    expect(sectionSentences(full).length).toBeGreaterThanOrEqual(1 + 3 + 6);
    expect(EVERY_PAIR).toHaveLength(36);
  });

  it("0..5 × 0..5 모든 셈에서 요약·첫 문장·설명의 문장 끝말이 한 칸에 세 번 같지 않다", () => {
    const repeated = new Map<string, string>();
    const seen = new Set<string>();
    let sections = 0;
    let threeItemResults = 0;
    for (const a of EVERY_PAIR) for (const b of EVERY_PAIR) for (const c of EVERY_PAIR) for (const d of EVERY_PAIR) {
      const result = talkFirstOf([a, b, c, d]);
      if (!result) continue;
      sections += 1;
      if (result.items.length === 3) threeItemResults += 1;
      // 같은 요약·같은 항목이면 같은 칸이다. 칸마다 한 번만 센다.
      const key = `${result.summary}|${itemKeys(result).join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const found = repeatedEndings(sectionSentences(result));
      if (found.length > 0) repeated.set(key, `${[a, b, c, d].map((pair) => pair.join(":")).join(" ")} → ${found.join(", ")}`);
    }
    // 조합이 비거나 세 항목 칸이 없으면 이 검사는 공짜 초록이다.
    expect(sections).toBeGreaterThan(1_000_000);
    expect(threeItemResults).toBeGreaterThan(100_000);
    expect(seen.size).toBeGreaterThan(100);
    expect([...repeated.values()]).toEqual([]);
  }, 180_000);
});
