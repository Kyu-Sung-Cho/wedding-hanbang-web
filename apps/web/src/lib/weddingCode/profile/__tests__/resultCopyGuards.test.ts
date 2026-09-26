import { describe, expect, it } from "vitest";

import { WEDDING_CODE_V06_AXES, type WeddingCodeV06AxisKey } from "@/constants/weddingCodeV06";
import {
  WEDDING_CODE_V31_AVOIDANCES,
  WEDDING_CODE_V31_QUESTIONS,
  WEDDING_CODE_V31_SPENDING,
  WEDDING_CODE_V31_TASTES,
  type V31Choice,
  type V31Draft,
} from "@/constants/weddingCodeV31";
import { buildV31Profile, createV31Draft, getV31PriorityOptions } from "@/lib/weddingCode/v31";
import {
  WEDDING_CODE_CHECK_PHRASE,
  WEDDING_CODE_SELF_READING,
  type WeddingCodeSelfLean,
} from "@/constants/weddingCodeSelfReading";
import {
  describeSelfAxisAbsence,
  describeSelfAxisReading,
  type WeddingCodeSelfAxisReading,
  type WeddingCodeSelfProfile,
} from "@/lib/weddingCode/scene/selfProfile";
import {
  WEDDING_CODE_TALK_FIRST_HEADING,
  WEDDING_CODE_TALK_FIRST_ITEMS,
  WEDDING_CODE_TALK_FIRST_SHARE_JUMP,
  WEDDING_CODE_TALK_FIRST_SUMMARY,
  WEDDING_CODE_TALK_FIRST_THIN_NOTE,
} from "@/constants/weddingCodeTalkFirst";
import {
  CURRENT_WEDDING_CODE_SCENE_CONFIG,
} from "@/lib/weddingCode/scene/config";
import {
  WEDDING_CODE_LETTERS,
  buildWeddingCodeLetters,
  parseWeddingCodeString,
} from "../letters";
import { buildWeddingCodeTalkFirst } from "../talkFirst";

/**
 * 결과 화면 문장의 기계 가드 (2026-09-17).
 *
 * ## 왜 생성해서 보나
 *
 * 팀원이 라이브에서 「답한 5장면에서 이쪽과 반대쪽 답은 4 대 1예요」를 봤다. 1 은 「일」로
 * 읽으니 「1이에요」가 맞다. 같은 코드의 「M로」도 「M으로」여야 했다. 둘 다 **특정 숫자·
 * 글자에서만** 틀리므로, 손으로 고른 예시 몇 개로는 못 잡는다(그 테스트는 4 대 1 을
 * 고르지 않았다). 그래서 0..5 × 0..5 모든 셈과 여덟 글자 모두로 문장을 만들어 본다.
 *
 * 규칙: 숫자 바로 뒤에는 「장면」만, 영문 글자 바로 뒤에는 한글이 오지 않는다.
 * 숫자·영문 뒤 조사는 받침을 코드가 알 수 없으므로, 틀 자체가 그런 자리를 만들지 않는다.
 */
const GLUED_PARTICLE = /\d(?!장면)[가-힣]|[A-Za-z][가-힣]/;

/** 판정 언어. 축 카드 팁과 「먼저 얘기해 볼 주제」 칸이 같이 쓴다. */
const JUDGMENT_WORDS = /유형|궁합|점수|등급|성격|당신은|예측|잘 맞|%/;

type Side = "left" | "right";
const COUNTS = [0, 1, 2, 3, 4, 5] as const;

function leanOf(left: number, right: number): WeddingCodeSelfLean {
  return left === right ? "mixed" : left > right ? "left" : "right";
}

/** 그 축 한쪽 편의 주제 문구. 실제 축 정의에서 가져온다. */
function phrasesOf(axis: WeddingCodeV06AxisKey, side: Side): string[] {
  const definition = WEDDING_CODE_V06_AXES.find((item) => item.key === axis)!;
  return (definition[side].constructs as readonly string[])
    .filter((construct): construct is keyof typeof WEDDING_CODE_CHECK_PHRASE => construct in WEDDING_CODE_CHECK_PHRASE)
    .map((construct) => WEDDING_CODE_CHECK_PHRASE[construct]);
}

function readingFor(
  axis: WeddingCodeV06AxisKey,
  leftCount: number,
  rightCount: number,
  missing: "none" | "whole" | "part",
): WeddingCodeSelfAxisReading {
  const definition = WEDDING_CODE_V06_AXES.find((item) => item.key === axis)!;
  const lean = leanOf(leftCount, rightCount);
  const unchosen = lean === "left" ? "right" : lean === "right" ? "left" : null;
  const unchosenPhrases = unchosen ? phrasesOf(axis, unchosen) : [];
  return {
    axis,
    axisLabel: definition.labelKo,
    lean,
    title: WEDDING_CODE_SELF_READING[axis][lean].title,
    leftLabel: WEDDING_CODE_LETTERS[axis].left.short,
    rightLabel: WEDDING_CODE_LETTERS[axis].right.short,
    leftCount,
    rightCount,
    answered: leftCount + rightCount,
    evidence: [],
    missingPhrases: missing === "none" ? [] : missing === "whole" ? unchosenPhrases : unchosenPhrases.slice(0, 1),
    qualifiers: [],
    tellPartner: WEDDING_CODE_SELF_READING[axis][lean].tellPartner,
    watchOut: WEDDING_CODE_SELF_READING[axis][lean].watchOut,
  };
}

function profileWith(axis: WeddingCodeV06AxisKey, leftCount: number, rightCount: number): WeddingCodeSelfProfile {
  const axes = WEDDING_CODE_V06_AXES.map((definition) =>
    definition.key === axis
      ? readingFor(axis, leftCount, rightCount, "none")
      : readingFor(definition.key, 0, 0, "none"),
  );
  const answered = leftCount + rightCount;
  return { answered, total: 20, complete: false, repeated: [], axes };
}

/** 한 축의 모든 셈(0..5 × 0..5)에서 화면에 나갈 수 있는 사실 문장을 전부 만든다. */
function generatedSentences(): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  for (const { key: axis } of WEDDING_CODE_V06_AXES) {
    for (const left of COUNTS) {
      for (const right of COUNTS) {
        const label = `${axis} ${left}:${right}`;
        const slot = buildWeddingCodeLetters(profileWith(axis, left, right)).slots.find((item) => item.axis === axis)!;
        out.push({ label: `${label} countLine`, text: slot.countLine });
        out.push({ label: `${label} meaning`, text: slot.meaning });
        if (slot.narrowCaution) out.push({ label: `${label} narrowCaution`, text: slot.narrowCaution });
        for (const missing of ["none", "whole", "part"] as const) {
          const reading = readingFor(axis, left, right, missing);
          out.push({ label: `${label} reading`, text: describeSelfAxisReading(reading) });
          const absence = describeSelfAxisAbsence(reading);
          if (absence) out.push({ label: `${label} absence/${missing}`, text: absence });
        }
      }
    }
  }
  return out;
}

describe("결과 화면 사실 문장 — 숫자·영문 뒤 조사", () => {
  it("측정기가 살아 있다", () => {
    // 옛 문장과 팀원이 본 오류를 실제로 잡는지 먼저 본다. 이게 초록이면 아래 초록은 공짜다.
    for (const broken of ["4 대 1예요", "답을 바꾸면 M로 바뀔 수 있어요", "V를 골랐어요", "3곳에서", "O와 T"]) {
      expect(broken, broken).toMatch(GLUED_PARTICLE);
    }
    for (const fine of ["답한 5장면 중 4장면은 V(조건 먼저), 1장면은 M(분위기 먼저) 쪽이었어요.", "V 대신 M 글자가"]) {
      expect(fine, fine).not.toMatch(GLUED_PARTICLE);
    }
    const sentences = generatedSentences();
    // 4축 × 36셈 × (countLine + meaning + reading×3) 이상. 생성이 비면 「위반 0」이 공짜가 된다.
    expect(sentences.length).toBeGreaterThanOrEqual(4 * 36 * 5);
    expect(sentences.some((item) => item.label.endsWith("narrowCaution"))).toBe(true);
    expect(sentences.some((item) => item.label.endsWith("absence/part"))).toBe(true);
  });

  it("모든 셈·모든 글자에서 숫자나 영문 바로 뒤에 조사가 붙지 않는다", () => {
    const glued = generatedSentences().filter((item) => GLUED_PARTICLE.test(item.text));
    expect(glued.map((item) => `${item.label}: ${item.text}`)).toEqual([]);
  });

  it("셈 문장은 0장면·「대 0」을 말하지 않고, 양쪽을 쓸 때 왼쪽 글자를 먼저 쓴다", () => {
    for (const { key: axis } of WEDDING_CODE_V06_AXES) {
      const pair = WEDDING_CODE_LETTERS[axis];
      for (const left of COUNTS) {
        for (const right of COUNTS) {
          const line = buildWeddingCodeLetters(profileWith(axis, left, right)).slots.find((item) => item.axis === axis)!.countLine;
          const label = `${axis} ${left}:${right} ${line}`;
          expect(line, label).not.toMatch(/(?<!\d)0장면|대 0|\d+\s*%/);
          if (left > 0 && right > 0) {
            expect(line.indexOf(`${pair.left.letter}(`), label).toBeGreaterThan(-1);
            expect(line.indexOf(`${pair.left.letter}(`), label).toBeLessThan(line.indexOf(`${pair.right.letter}(`));
            if (left !== right) {
              expect(line, label).toContain(`${left}장면은 ${pair.left.letter}(${pair.left.short})`);
              expect(line, label).toContain(`${right}장면은 ${pair.right.letter}(${pair.right.short})`);
            }
          }
          if (left + right > 0) expect(line, label).toContain(`답한 ${left + right}장면`);
        }
      }
    }
  });

  it("하나 차이 안내는 대문자 두 글자를 정확히 쓴다", () => {
    for (const { key: axis } of WEDDING_CODE_V06_AXES) {
      const pair = WEDDING_CODE_LETTERS[axis];
      for (const [left, right] of [[3, 2], [2, 3], [2, 1], [1, 2]] as const) {
        const slot = buildWeddingCodeLetters(profileWith(axis, left, right)).slots.find((item) => item.axis === axis)!;
        const [own, other] = left > right ? [pair.left, pair.right] : [pair.right, pair.left];
        expect(slot.narrowCaution, `${axis} ${left}:${right}`).toContain(`${own.letter} 대신 ${other.letter} 글자가`);
      }
    }
  });

  it("코드만으로 푼 뜻에도 양쪽 짧은 이름이 들어 있다", () => {
    for (let mask = 0; mask < 16; mask += 1) {
      const code = WEDDING_CODE_V06_AXES.map(({ key }, index) =>
        (mask >> index) & 1 ? WEDDING_CODE_LETTERS[key].right.letter : WEDDING_CODE_LETTERS[key].left.letter,
      ).join("");
      for (const variant of [code, code.toLowerCase()]) {
        const parsed = parseWeddingCodeString(variant)!;
        for (const letter of parsed) {
          const pair = WEDDING_CODE_LETTERS[letter.axis];
          const own = pair[letter.side];
          const other = pair[letter.side === "left" ? "right" : "left"];
          expect(letter, `${variant} ${letter.axis}`).toMatchObject({
            letter: own.letter, short: own.short, opposite: other.letter, oppositeShort: other.short,
          });
        }
      }
    }
  });
});

describe("축 카드 팁 — 판정 언어 없이 바로 물어볼 수 있는 말", () => {
  const BANNED = JUDGMENT_WORDS;
  const entries = WEDDING_CODE_V06_AXES.flatMap(({ key }) =>
    (["left", "right", "mixed"] as const).map((lean) => ({ key, lean, copy: WEDDING_CODE_SELF_READING[key][lean] })),
  );

  it("열두 개 문구를 모두 본다", () => {
    expect(entries).toHaveLength(12);
    expect("우리 궁합 보자").toMatch(BANNED);
    expect("추가 금액이 20% 넘는지").toMatch(BANNED);
  });

  it.each(entries)("$key $lean — tellPartner·watchOut 에 판정 언어가 없다", ({ copy }) => {
    expect(copy.tellPartner).not.toMatch(BANNED);
    expect(copy.watchOut).not.toMatch(BANNED);
    expect(copy.title).not.toMatch(BANNED);
  });

  it.each(entries)("$key $lean — tellPartner 는 상대에게 묻는 말이다", ({ copy }) => {
    expect(copy.tellPartner).toContain("?");
    // 제목은 사람이 아니라 고른 답을 설명한다.
    expect(copy.title).toContain("답");
  });
});

/**
 * 「이번 주엔 뭐부터 같이 얘기해 볼까요?」 칸 (2026-09-18).
 *
 * 이 칸 문장은 셈에 따라 골라 붙인다(요약 다섯 갈래, 뺀 이유 세 갈래 × 앞 묶음·마지막 묶음을
 * 이은 한 문장, 얇다는 안내, 항목 열두 개, 굳기 라벨 + 답한 수). 손으로 고른 예시로는 조합을 다 못 보니, 축마다
 * 0..5 × 0..5 와 네 축 섞은 셈으로 **나올 수 있는 문장을 전부 만들어** 본다.
 *
 * 먼저 모든 갈래가 실제로 나왔는지 본다. 한 갈래라도 안 나오면 아래 「위반 0」은 공짜다.
 */
const TALK_AXES = CURRENT_WEDDING_CODE_SCENE_CONFIG.axes;
const TALK_TOTAL = CURRENT_WEDDING_CODE_SCENE_CONFIG.questions.length;

/** 판정 말고도 막는 것: 줄표로 절 잇기, 겹친 「~뜻은 아니에요」, 명사로 끝낸 「~인 답」, 누가 맞는지 가리기. */
const TALK_BANNED: readonly { name: string; pattern: RegExp }[] = [
  { name: "숫자·영문 뒤 조사", pattern: GLUED_PARTICLE },
  { name: "판정 언어", pattern: JUDGMENT_WORDS },
  { name: "줄표", pattern: /[—–]/ },
  { name: "뜻은 아니", pattern: /뜻은 아니/ },
  { name: "명사형 「~인 답」", pattern: /[가-힣]인 답/ },
  { name: "누가 맞는지", pattern: /누가 맞|맞는 쪽|틀렸|옳/ },
  // v0.9 문항과 같은 초보자 기준(weddingCodeV09.test.ts). 업계 말과 가리키는 말을 쓰지 않는다.
  {
    name: "업계 말·가리키는 말",
    pattern:
      /스드메|예식장|본식|폐백|상견례|전통 인사|원판|헬퍼비|피팅|컨펌|워크인|혼주|부토니에|얼리스타트|양가|업체나 장소|모르는 조항|이거|그거|저거|넘겼다|느낌이 오면|마음에 남을|믿음이 가면|걱정돼 보인다/,
  },
];

function talkFirstFor(counts: readonly (readonly [number, number])[], total: number) {
  const axes = TALK_AXES.map((definition, index) => {
    const [leftCount, rightCount] = counts[index] ?? [0, 0];
    const lean = leanOf(leftCount, rightCount);
    return {
      axis: definition.key,
      axisLabel: definition.labelKo,
      lean,
      title: WEDDING_CODE_SELF_READING[definition.key][lean].title,
      leftLabel: WEDDING_CODE_LETTERS[definition.key].left.short,
      rightLabel: WEDDING_CODE_LETTERS[definition.key].right.short,
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
  const profile: WeddingCodeSelfProfile = { answered, total, complete: answered === total, repeated: [], axes };
  return buildWeddingCodeTalkFirst(buildWeddingCodeLetters(profile), { answered, total });
}

type TalkSentence = { label: string; text: string };

function generatedTalkFirst(): { sentences: TalkSentence[]; reached: Set<string> } {
  const sentences = new Map<string, TalkSentence>();
  const reached = new Set<string>();
  const add = (label: string, text: string) => {
    if (!sentences.has(text)) sentences.set(text, { label, text });
  };
  add("heading", WEDDING_CODE_TALK_FIRST_HEADING);
  add("shareJump", WEDDING_CODE_TALK_FIRST_SHARE_JUMP);

  const collect = (counts: readonly (readonly [number, number])[], total: number) => {
    const result = talkFirstFor(counts, total);
    if (!result) return;
    const label = `${counts.map((pair) => pair.join(":")).join(" ")} /${total}`;
    add(`${label} summary`, result.summary);
    if (result.more) add(`${label} more`, result.more);
    if (result.leftOut) add(`${label} leftOut`, result.leftOut);
    if (result.thinNote) add(`${label} thin`, result.thinNote);
    add(`${label} partner`, result.partnerLine);
    for (const item of result.items) {
      reached.add(`${item.axis}:${item.kind === "split" ? "split" : item.slot.chosen}`);
      add(`${label} ${item.axis} tag`, item.tagLabel);
      add(`${label} ${item.axis} lead`, item.lead);
      add(`${label} ${item.axis} detail`, item.detail);
    }
  };

  // 한 축씩 0..5 × 0..5. 나머지 축은 건너뛴 채로 둔다.
  TALK_AXES.forEach((_, index) => {
    for (const left of COUNTS) {
      for (const right of COUNTS) {
        const counts = TALK_AXES.map((__, other) => (other === index ? [left, right] as const : [0, 0] as const));
        collect(counts, TALK_TOTAL);
      }
    }
  });
  // 네 축을 섞은 셈. 건너뜀·한 장면·같은 수·한쪽·하나 차이가 한 화면에 같이 나온다.
  const MIXED = [[0, 0], [1, 0], [1, 1], [2, 2], [2, 0], [0, 3], [3, 2], [2, 3], [4, 1]] as const;
  for (const a of MIXED) for (const b of MIXED) for (const c of MIXED) for (const d of MIXED) collect([a, b, c, d], TALK_TOTAL);
  // 문항 수가 달라도(판이 바뀌거나 이름 없는 수) 「N 장면」 틀이 조사를 붙이지 않는다.
  for (const total of [12, 16, 18, 24]) collect([[2, 0], [1, 0], [0, 0], [0, 0]], total);

  return { sentences: [...sentences.values()], reached };
}

describe("「먼저 얘기해 볼 주제」 칸 — 만들 수 있는 모든 문장", () => {
  const { sentences, reached } = generatedTalkFirst();
  const texts = sentences.map((item) => item.text);

  it("측정기가 살아 있다 — 모든 갈래가 실제로 나오고, 금지 틀을 잡는다", () => {
    // 항목 열두 개(축 넷 × 왼쪽·오른쪽·하나 차이)가 모두 나왔다.
    const every = TALK_AXES.flatMap(({ key }) => ["left", "right", "split"].map((kind) => `${key}:${kind}`));
    expect([...reached].sort()).toEqual([...every].sort());
    for (const { key } of TALK_AXES) {
      for (const kind of ["left", "right", "split"] as const) {
        expect(texts, `${key} ${kind} lead`).toContain(WEDDING_CODE_TALK_FIRST_ITEMS[key][kind].lead);
        expect(texts, `${key} ${kind} detail`).toContain(WEDDING_CODE_TALK_FIRST_ITEMS[key][kind].detail);
      }
    }
    // 요약 다섯 갈래, 얇다는 안내.
    for (const summary of Object.values(WEDDING_CODE_TALK_FIRST_SUMMARY)) expect(texts, summary).toContain(summary);
    expect(texts).toContain(WEDDING_CODE_TALK_FIRST_THIN_NOTE);
    // 뺀 이유는 한 문장이다. 이유마다 앞 묶음(「~고,」)과 마지막 묶음(「~서 여기선 뺐어요.」)이 모두
    // 나왔는지 본다. 한 장면은 늘 마지막 묶음이라(건너뜀 → 같은 수 → 한 장면 순) 앞 묶음 꼴은 나오지 않는다.
    const leftOuts = sentences.filter((item) => item.label.endsWith(" leftOut")).map((item) => item.text);
    expect(leftOuts.length).toBeGreaterThan(20);
    const forms = [
      ["건너뜀", "건너뛰었고, ", "건너뛰어서 여기선 뺐어요."],
      ["같은 수", "양쪽 답 수가 같았고, ", "양쪽 답 수가 같아서 여기선 뺐어요."],
    ] as const;
    for (const [reason, mid, last] of forms) {
      expect(leftOuts.some((text) => text.includes(mid)), `${reason} 앞 묶음`).toBe(true);
      expect(leftOuts.some((text) => text.endsWith(last)), `${reason} 마지막 묶음`).toBe(true);
    }
    expect(leftOuts.some((text) => text.endsWith("한 장면만 답해서 여기선 뺐어요.")), "한 장면 마지막 묶음").toBe(true);
    expect(leftOuts.some((text) => text.includes("한 장면만 답했고,"))).toBe(false);
    // 세 이유가 한 문장에 다 나오는 꼴도 실제로 나온다.
    expect(leftOuts.some((text) => text.includes("건너뛰었고, ") && text.includes("같았고, ") && text.endsWith("한 장면만 답해서 여기선 뺐어요."))).toBe(true);
    // 「여기선」·「뺐어요」는 한 문장에 한 번씩, 맨 끝에만.
    for (const text of leftOuts) {
      expect(text.split("뺐어요").length - 1, text).toBe(1);
      expect(text.split("여기선").length - 1, text).toBe(1);
      expect(text.endsWith("여기선 뺐어요."), text).toBe(true);
    }

    // 금지 틀마다 실제로 잡는 예.
    const caught: Record<string, string> = {
      "숫자·영문 뒤 조사": "V로 기운 주제예요",
      "판정 언어": "당신은 조건을 먼저 보는 사람이에요",
      줄표: "업체를 같이 볼 때 — 순서를 맞춰 두세요",
      "뜻은 아니": "조건만 본다는 뜻은 아니에요",
      "명사형 「~인 답」": "조건 먼저인 답",
      "누가 맞는지": "누가 맞는지 정해 보세요",
      "업계 말·가리키는 말": "스드메 견적부터 보세요",
    };
    for (const { name, pattern } of TALK_BANNED) expect(caught[name], name).toMatch(pattern);
    expect(sentences.length).toBeGreaterThan(40);
  });

  it.each(TALK_BANNED)("$name — 어느 문장에도 없다", ({ pattern }) => {
    const hits = sentences.filter((item) => pattern.test(item.text));
    expect(hits.map((item) => `${item.label}: ${item.text}`)).toEqual([]);
  });
});

/**
 * 웨딩코드 v3.1 개인 결과 설명 (2026-09-27 감사).
 *
 * 한 가상 응답자의 설명 17개 중 15개가 방금 고른 답을 「~라고 답했어요」로 다시 말했고, 본문마다
 * 「~뜻은 아니에요」가 붙었다. 설명 문장은 답에 따라 골라 붙이므로(문장 하나, 두 문장 조합, 두 답을 잇는
 * 교차 안내, 우선순위 안내, 취향·피하고 싶은 것의 다음 행동, 하객 없는 예식 변형), 손으로 고른 예시가 아니라
 * 나올 수 있는 응답을 전부 만들어 모든 제목·본문·다음 행동을 본다.
 */
type V31CopyPart = "title" | "body" | "nextStep";
type V31Copy = { label: string; part: V31CopyPart; text: string };

function answeredChoice(values: string[]): V31Choice {
  return { status: "answered", values };
}
function allHigh(draft: V31Draft): void {
  for (const question of WEDDING_CODE_V31_QUESTIONS) draft.answers[question.id] = 5;
}
function v31Drafts(): V31Draft[] {
  const drafts: V31Draft[] = [];
  const make = (fill: (draft: V31Draft) => void) => {
    const draft = createV31Draft();
    fill(draft);
    drafts.push(draft);
  };
  for (const question of WEDDING_CODE_V31_QUESTIONS) {
    make((draft) => { draft.answers[question.id] = 4; });
    make((draft) => { draft.answers[question.id] = 5; draft.tastes.guests = answeredChoice(["no_guests"]); });
  }
  for (const spending of WEDDING_CODE_V31_SPENDING) make((draft) => { allHigh(draft); draft.spending = answeredChoice([spending.value]); });
  for (const taste of WEDDING_CODE_V31_TASTES) {
    for (const option of taste.options) {
      make((draft) => { draft.tastes[taste.key] = answeredChoice([option.value]); });
      if (taste.key !== "guests") make((draft) => { draft.tastes[taste.key] = answeredChoice([option.value]); draft.tastes.guests = answeredChoice(["no_guests"]); });
    }
  }
  for (const noGuests of [false, true]) {
    for (const avoidStage of [false, true]) {
      make((draft) => {
        draft.answers.V1 = 5;
        draft.tastes.ceremony = answeredChoice(["participatory"]);
        if (noGuests) draft.tastes.guests = answeredChoice(["no_guests"]);
        draft.avoidances = answeredChoice(avoidStage
          ? WEDDING_CODE_V31_AVOIDANCES.map((option) => option.value)
          : ["heavy_decoration", "crowded_space", "long_photography", "loud_music"]);
      });
    }
  }
  // 우선순위는 고를 수 있는 보기마다 하나씩 골라 안내 카드를 만든다.
  // 참여 순서나 꽃 장식을 높게 고르면 식순·장식 회피 우선순위가 교차 안내로 가므로, 둘 다 아닌 경우도 함께 본다.
  for (const [noGuests, ceremony] of [[false, "short"], [false, "participatory"], [true, "short"], [true, "participatory"]] as const) {
    const rich = createV31Draft();
    allHigh(rich);
    if (ceremony === "short") rich.answers.V1 = 2;
    for (const taste of WEDDING_CODE_V31_TASTES) rich.tastes[taste.key] = answeredChoice([taste.options[0].value]);
    rich.tastes.ceremony = answeredChoice([ceremony]);
    if (noGuests) rich.tastes.guests = answeredChoice(["no_guests"]);
    rich.avoidances = answeredChoice(WEDDING_CODE_V31_AVOIDANCES.map((option) => option.value));
    rich.spending = answeredChoice(["photo"]);
    for (const option of getV31PriorityOptions(rich)) {
      make((draft) => { Object.assign(draft, structuredClone(rich)); draft.priorities = answeredChoice([option.value]); });
    }
  }
  return drafts;
}

function generatedV31Copy(): { copies: V31Copy[]; reached: Set<string> } {
  const copies = new Map<string, V31Copy>();
  const reached = new Set<string>();
  const add = (label: string, part: V31CopyPart, text: string | null | undefined) => {
    if (!text) return;
    const key = `${part}|${text}`;
    if (!copies.has(key)) copies.set(key, { label, part, text });
  };
  for (const draft of v31Drafts()) {
    const profile = buildV31Profile(draft);
    for (const item of [...profile.insights, ...profile.priorityGuides]) {
      const id = item.sourceInsightId ?? item.id;
      reached.add(id);
      add(id, "title", item.title);
      add(id, "body", item.body);
      add(id, "nextStep", item.nextStep);
    }
    for (const taste of profile.tastes) {
      if (!taste.nextStep) continue;
      reached.add(`taste:${taste.key}`);
      add(`taste:${taste.key}`, "nextStep", taste.nextStep);
    }
    for (const step of profile.avoidanceSteps) {
      reached.add(`avoidance:${step.value}`);
      add(`avoidance:${step.value}`, "nextStep", step.nextStep);
    }
  }
  return { copies: [...copies.values()], reached };
}

/** 모든 문장에서 막는 것. 판정, 줄표, 「~뜻은 아니에요」류 면책, 명사형 「~인 답」, 시스템 말투, 업계 말. */
const V31_COPY_BANNED: readonly { name: string; pattern: RegExp }[] = [
  { name: "판정 언어", pattern: JUDGMENT_WORDS },
  { name: "줄표", pattern: /[—–]/ },
  { name: "뜻은 아니", pattern: /뜻은 아니|뜻으로 읽지|뜻이 다를 수/ },
  { name: "명사형 「~인 답」", pattern: /[가-힣]인 답/ },
  { name: "시스템 말투", pattern: /선택값|요약 보류|\d+\/\d+개/ },
  { name: "업계 말", pattern: TALK_BANNED.find((item) => item.name === "업계 말·가리키는 말")!.pattern },
];
/** 본문은 고른 답을 다시 말하지 않는다. 원래 문장과 답은 근거로 따로 보여준다. */
const V31_BODY_RESTATES = /답했어요|골랐어요|고른 답이에요|라고 답/;
const V31_NEGATIONS = /아니에요|않아요|않았어요/g;

describe("웨딩코드 v3.1 개인 결과 — 만들 수 있는 모든 설명 문장", () => {
  const { copies, reached } = generatedV31Copy();

  it("측정기가 살아 있다 — 모든 설명 갈래가 실제로 나오고, 금지 틀을 잡는다", () => {
    const expected = [
      ...WEDDING_CODE_V31_QUESTIONS.map((question) => `single-${question.id}`),
      "attire-comfort", "budget-reallocate", "budget-revisit", "decision-conditions", "delegate-update", "family-listen-decide", "support-listen-help",
      "budget-explicit-spending", "flower-amount", "participation-format", "guests-participation",
      ...WEDDING_CODE_V31_TASTES.map((taste) => `direct-${taste.key}`),
      ...WEDDING_CODE_V31_AVOIDANCES.map((option) => `avoid-${option.value}`),
      ...WEDDING_CODE_V31_TASTES.map((taste) => `taste:${taste.key}`),
      ...WEDDING_CODE_V31_AVOIDANCES.map((option) => `avoidance:${option.value}`),
    ];
    for (const id of expected) expect(reached.has(id), id).toBe(true);
    expect(copies.filter((item) => item.part === "nextStep").length).toBeGreaterThan(50);
    expect(copies.some((item) => item.part === "body")).toBe(true);
    const caught: Record<string, string> = {
      "판정 언어": "당신은 예산을 지키는 유형이에요",
      줄표: "예산은 지키고 — 다시 의논해요",
      "뜻은 아니": "작은 결혼식을 원한다는 뜻으로 읽지는 않아요",
      "명사형 「~인 답」": "예산을 지키는 쪽인 답",
      "시스템 말투": "2/2개 문장에 답했어요",
      "업계 말": "상견례 전에 정해 보세요",
    };
    for (const { name, pattern } of V31_COPY_BANNED) expect(caught[name], name).toMatch(pattern);
    expect("평소 가깝게 지내는 사람 위주로 초대하고 싶다고 답했어요.").toMatch(V31_BODY_RESTATES);
    expect("해결책이 필요 없다는 뜻은 아니에요. 도울 여유가 있다는 뜻도 아니에요.".match(V31_NEGATIONS)).toHaveLength(2);
  });

  it.each(V31_COPY_BANNED)("$name — 어느 설명 문장에도 없다", ({ pattern }) => {
    const hits = copies.filter((item) => pattern.test(item.text));
    expect(hits.map((item) => `${item.label} ${item.part}: ${item.text}`)).toEqual([]);
  });

  it("본문은 고른 답을 「~라고 답했어요」로 다시 말하지 않는다", () => {
    const hits = copies.filter((item) => item.part === "body" && V31_BODY_RESTATES.test(item.text));
    expect(hits.map((item) => `${item.label}: ${item.text}`)).toEqual([]);
  });

  it("한 설명 칸에 부정 고지를 둘 이상 겹쳐 쓰지 않는다", () => {
    const hits = copies.filter((item) => (item.text.match(V31_NEGATIONS) ?? []).length > 1);
    expect(hits.map((item) => `${item.label} ${item.part}: ${item.text}`)).toEqual([]);
  });
});
