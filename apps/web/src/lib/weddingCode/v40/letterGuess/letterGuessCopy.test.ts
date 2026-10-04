import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  V40_AXES,
  V40_AXIS_KEYS,
  V40_ESCAPES,
  V40_LETTER_LIST,
  axisInfo,
  letterInfo,
  type Axis,
  type Letter,
} from "@/constants/weddingCodeV40";
import { V40_COPY, V40_COPY_SCREENS, V40_ENTRY_COPY, V40_NOT_VALIDATED_PHRASE, collectedSentence } from "../copy";
import {
  V40_LETTER_GUESS_COPY,
  letterGuessCardText,
  letterGuessLineText,
  letterGuessStorageNote,
  letterGuessTopicTitle,
} from "./letterGuessCopy";
import type { LetterGuessLine } from "./types";

// ---------------------------------------------------------------------------
// 문구 모으기: copy.test.ts 의 모으기와 같은 방식(키 이름이 낱말 꼴이면 라벨)
// ---------------------------------------------------------------------------

interface Leaf {
  readonly path: string;
  readonly text: string;
  readonly label: boolean;
}

const LABEL_KEY = /(label|title|heading|button|name|tag|toggle|option|caption|list|badge|mark|column)s?$/i;

function copyLeaves(value: unknown, path = "", label = false, out: Leaf[] = []): Leaf[] {
  if (typeof value === "string") {
    out.push({ path, text: value, label });
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => copyLeaves(entry, `${path}[${index}]`, label, out));
  } else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      copyLeaves(entry, path === "" ? key : `${path}.${key}`, label || LABEL_KEY.test(key), out);
    }
  }
  return out;
}

/** 모든 주제에서 (먼저 고른 글자, 결과 글자)가 서로 다른 줄 여덟 개. */
function allLines(): LetterGuessLine[] {
  const lines: LetterGuessLine[] = [];
  for (const axis of V40_AXIS_KEYS) {
    const info = axisInfo(axis);
    lines.push({ axis, guessed: info.front, shown: info.back });
    lines.push({ axis, guessed: info.back, shown: info.front });
  }
  return lines;
}

/** 함수가 만든 글 표본. 줄 여덟, 카드 여덟, 저장 안내 셋, 주제 이름 넷. */
function samples(): Leaf[] {
  const out: Leaf[] = [];
  for (const line of allLines()) out.push({ path: `letterGuessLineText(${line.axis},${line.guessed},${line.shown})`, text: letterGuessLineText(line), label: false });
  for (const letter of V40_LETTER_LIST) out.push({ path: `letterGuessCardText(${letter})`, text: letterGuessCardText(letter), label: false });
  for (const mode of ["on", "off", "blocked"] as const) out.push({ path: `letterGuessStorageNote(${mode})`, text: letterGuessStorageNote(mode), label: false });
  for (const axis of V40_AXIS_KEYS) out.push({ path: `letterGuessTopicTitle(${axis})`, text: letterGuessTopicTitle(axis), label: true });
  return out;
}

const BUNDLE_LEAVES = copyLeaves(V40_LETTER_GUESS_COPY, "letterGuess");
const ALL_LEAVES = [...BUNDLE_LEAVES, ...samples()];

// ---------------------------------------------------------------------------
// copy.test.ts 의 낱말 규칙 거울(기준 커밋 5ac9eda24). V40_COPY 에 붙는 순간 같은 규칙이 돈다.
// ---------------------------------------------------------------------------

const BANNED =
  /검증된|정확|과학적|진단|점수|등급|궁합|잘 ?맞|성격|유형|스타일|동물|캐릭터|MBTI|mbti|퍼센트|순위|문항|측면|서버 연결|접근 키|확인 주소|데이터|로딩|에러|오류|타입|속마음|무의식|본모습|모순|일관성|당신은|숨은 ?(?:성향|마음|이유)/u;
const BANNED_FORMAL = /(합니다|입니다|습니다|바랍니다|하십시오)/u;
const BANNED_LABELS_OF_ORDER = /(번째|첫|둘째|셋째) ?(질문|화면|장면)|(질문|화면|장면) ?번호|\d+ ?\/ ?\d+|이야기 ?(카드|편|화면)/u;

function politeEnding(sentence: string): boolean {
  const core = sentence
    .replace(/[.?!…]+$/u, "")
    .replace(/[」』]+$/u, "")
    .replace(/\([^)]*\)$/u, "")
    .trim();
  return /(요|다|죠)$/u.test(core);
}

function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.?!])\s+/u).map((part) => part.trim()).filter((part) => part.length > 0);
}

describe("결과 전 글자 고르기 문구: 화면 문구 규칙(copy.test.ts 의 거울)", () => {
  it("문구가 있고 잎마다 글자가 있다", () => {
    expect(BUNDLE_LEAVES.length).toBe(14);
    expect(ALL_LEAVES.length).toBe(BUNDLE_LEAVES.length + 8 + 8 + 3 + 4);
    for (const leaf of ALL_LEAVES) expect(leaf.text.length, leaf.path).toBeGreaterThan(0);
  });

  it("줄표, 하이픈, 백분율 기호, 물결표, 깨진 글자, 거친 공백, 앞뒤 공백이 없다", () => {
    for (const { path, text } of ALL_LEAVES) {
      expect(text, path).not.toMatch(/[–—‒―−]/u);
      expect(text, path).not.toMatch(/%/u);
      expect(text, path).not.toMatch(/~/u);
      expect(text, path).not.toContain("�");
      expect(text, path).not.toMatch(/\r|\n|\t/u);
      expect(text, path).not.toMatch(/ {2,}/u);
      expect(text, path).not.toMatch(/\\u[0-9a-fA-F]{4}/u);
      expect(text, path).toBe(text.trim());
      expect(text, path).not.toContain("-");
    }
  });

  it("금지된 주장과 낱말이 없다(검증, 정확, 점수, 진단, 속마음, 숨은 성향 같은 말, 문항, 데이터, 자리, 안 맞 포함)", () => {
    for (const { path, text } of ALL_LEAVES) {
      expect(text, path).not.toMatch(BANNED);
      expect(text, path).not.toMatch(BANNED_FORMAL);
      expect(text, path).not.toMatch(BANNED_LABELS_OF_ORDER);
      expect(text, path).not.toMatch(/인 답/u);
      expect(text, path).not.toMatch(/뜻은 아니에요/u);
      expect(text.replace(V40_ESCAPES.notApplicable, ""), path).not.toMatch(/안 ?맞/u);
      expect(text, path).not.toMatch(/자리/u);
    }
  });

  it("숫자가 없다(정적 문구도 함수가 만든 글도)", () => {
    for (const { path, text } of ALL_LEAVES) expect(text, path).not.toMatch(/[0-9０-９]/u);
  });

  it("글자 한 자 뒤에 한글이 오면 그 글자의 이름이 온다", () => {
    let checked = 0;
    for (const { path, text } of ALL_LEAVES) {
      for (const match of text.matchAll(/(?<![A-Za-z])([VSWDUFHA]) (?=[가-힣])/gu)) {
        const letter = match[1] as Letter;
        const after = text.slice((match.index ?? 0) + 2);
        expect(after.startsWith(letterInfo(letter).name), `${path}: ${letter} 뒤 「${after.slice(0, 10)}」`).toBe(true);
        checked += 1;
      }
    }
    // 줄 여덟 개는 글자를 둘씩, 카드 여덟 개는 하나씩 적는다.
    expect(checked).toBe(8 * 2 + 8);
  });

  it("영문자는 여덟 글자뿐이고 A/B 같은 라벨이 없다", () => {
    const allowed = new Set<string>(V40_LETTER_LIST);
    for (const { path, text } of ALL_LEAVES) {
      for (const word of text.match(/[A-Za-z]+/gu) ?? []) {
        expect([...word].every((char) => allowed.has(char)), `${path}: ${word}`).toBe(true);
      }
      expect(text, path).not.toMatch(/[A-Za-z]\s*\/\s*[A-Za-z]/u);
    }
  });

  it("장면, 이야기를 질문이나 구간의 이름으로 쓰지 않는다", () => {
    for (const { path, text } of ALL_LEAVES) {
      expect(text, path).not.toMatch(/(질문|구간|주제|글자|세기) ?(장면|이야기)|(장면|이야기) ?(질문|구간)/u);
    }
  });

  it("문장은 요, 다, 죠로 끝나고 라벨은 마침표로 끝나지 않는다", () => {
    for (const leaf of ALL_LEAVES) {
      if (leaf.label) {
        expect(leaf.text, leaf.path).not.toMatch(/\.$/u);
        continue;
      }
      for (const sentence of sentencesOf(leaf.text)) expect(politeEnding(sentence), `${leaf.path}: ${sentence}`).toBe(true);
    }
  });

  it("라벨 키 규칙이 문장을 삼키지 않는다: 라벨로 분류된 잎에 마침표로 이어진 두 문장이 없다", () => {
    const swallowed = BUNDLE_LEAVES.filter((leaf) => leaf.label && /[.]\s+\S/u.test(leaf.text));
    expect(swallowed.map((leaf) => leaf.path)).toEqual([]);
    // 문장이어야 하는 잎은 라벨로 분류되지 않았다.
    const sentenceKeys = ["screen.lead", "screen.storageOn", "screen.storageOff", "screen.storageBlocked", "lines.same", "lines.unsettledOnly", "lines.closing", "closedCard.note"];
    for (const key of sentenceKeys) {
      const leaf = BUNDLE_LEAVES.find((candidate) => candidate.path === `letterGuess.${key}`);
      expect(leaf, key).toBeDefined();
      expect(leaf?.label, key).toBe(false);
    }
    const labelKeys = ["screen.title", "screen.continueButton", "screen.skipButton", "lines.heading", "closedCard.openButton", "closedCard.closeButton"];
    for (const key of labelKeys) {
      expect(BUNDLE_LEAVES.find((candidate) => candidate.path === `letterGuess.${key}`)?.label, key).toBe(true);
    }
  });

  it("저장소를 말하는 글은 이 기기가 아니라 이 브라우저다(공용 기기만 예외)", () => {
    for (const { path, text } of ALL_LEAVES) expect(text.replace(/공용 기기/gu, ""), path).not.toMatch(/기기/u);
    expect(V40_LETTER_GUESS_COPY.screen.storageOn).toContain("이 브라우저");
    expect(V40_LETTER_GUESS_COPY.screen.storageBlocked).toContain("이 브라우저");
  });
});

// ---------------------------------------------------------------------------
// 이 기능의 문구 약속
// ---------------------------------------------------------------------------

describe("결과 전 글자 고르기 문구: 낱말과 약속", () => {
  it("고지 문장을 쓰지 않는다(고지는 시작, 받는 사람, 결과, 두 사람 결과 화면에 이미 한 번씩 있다)", () => {
    for (const { path, text } of ALL_LEAVES) expect(text, path).not.toContain(V40_NOT_VALIDATED_PHRASE);
  });

  it("「짐작」을 어디에도 쓰지 않는다: 결과를 맞히는 게임으로 읽히지 않게 「골라 보기」 낱말이다", () => {
    for (const { path, text } of ALL_LEAVES) expect(text, path).not.toMatch(/짐작/u);
    const copy = V40_LETTER_GUESS_COPY;
    expect(copy.screen.title).toBe("결과를 보기 전에, 내가 어느 쪽에 가까운지 골라 볼까요?");
    expect(copy.lines.heading).toBe("먼저 고른 글자와 나란히");
    expect(copy.screen.continueButton).toBe("결과 보기");
    expect(copy.screen.skipButton).toBe("고르지 않고 결과 보기");
    expect(copy.closedCard.openButton).toBe("먼저 고른 글자와 나란히 보기");
    expect(copy.closedCard.closeButton).toBe("가리기");
    expect(copy.closedCard.note).toBe("먼저 고른 글자는 누르기 전에는 보이지 않아요.");
  });

  it("줄과 구역 글에 칭찬, 책망, 맞고 틀림, 까닭, 개수, 비율, 진단 같은 말이 없다", () => {
    const judging = /맞혔|맞았|맞춘|틀렸|틀린|정답|오답|잘못|잘했|훌륭|대단|역시|아쉽|안타깝|놀랍|의외|다행|칭찬|축하|제대로|실수|착각|엇나|빗나|일치율|적중/u;
    const causes = /때문|이유|원인|탓|왜냐|덕분|그래서|따라서/u;
    const counts = /몇 ?(?:개|가지|곳)|(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열) ?(?:개|가지|곳)|전부|모두 맞|퍼센트|비율|점수/u;
    const body = [
      V40_LETTER_GUESS_COPY.lines.unsettledOnly,
      V40_LETTER_GUESS_COPY.lines.closing,
      V40_LETTER_GUESS_COPY.closedCard.note,
      V40_LETTER_GUESS_COPY.screen.lead,
      ...allLines().map(letterGuessLineText),
    ];
    for (const text of body) {
      expect(text).not.toMatch(judging);
      expect(text).not.toMatch(causes);
      expect(text).not.toMatch(counts);
    }
    // 같음 한 줄은 「모두 같았어요」라고 하되 칭찬하지 않고 나란히 놓은 주제에 대해서만 말한다.
    expect(V40_LETTER_GUESS_COPY.lines.same).toMatch(/^나란히 놓은 주제는 /u);
    expect(V40_LETTER_GUESS_COPY.lines.same).not.toMatch(judging);
    expect(V40_LETTER_GUESS_COPY.lines.same).not.toMatch(causes);
  });

  it("구역 끝 줄이 「다른 날에는 다르게 나올 수도 있어요」 한계와 이야기해 봐도 좋다는 초대를 말한다", () => {
    const closing = V40_LETTER_GUESS_COPY.lines.closing;
    expect(closing).toContain("다른 날에는 다르게");
    expect(closing).toContain("나올 수도 있어요");
    expect(closing).toContain("이야기해 봐도 좋아요");
    expect(sentencesOf(closing)).toHaveLength(2);
  });

  it("안내는 결과 글자를 암시하지 않고 고르지 않아도 결과는 그대로라고 말한다", () => {
    const lead = V40_LETTER_GUESS_COPY.screen.lead;
    expect(lead).toContain("고르지 않아도 결과는 그대로예요");
    expect(lead).toContain("결과를 본 뒤에 고른 글자와 나란히 놓아 볼게요");
    // 글자 이름이나 글자 한 자를 적지 않는다.
    expect(lead).not.toMatch(/[A-Z]/u);
    for (const letter of V40_LETTER_LIST) expect(lead).not.toContain(letterInfo(letter).name);
  });

  it("저장 안내 세 갈래는 저장 상태를 따른다: 남는다고 말하는 것은 켜짐뿐이고 링크에 안 들어간다는 말은 켜짐에만 있다", () => {
    const on = letterGuessStorageNote("on");
    const off = letterGuessStorageNote("off");
    const blocked = letterGuessStorageNote("blocked");
    expect(on).toBe("고른 글자는 이 브라우저에만 남아요. 링크에는 들어가지 않아요.");
    expect(off).toBe("자동 저장을 꺼 두어서 고른 글자는 저장하지 않아요.");
    expect(blocked).toBe("이 브라우저가 저장을 막고 있어서 고른 글자는 저장하지 않아요.");
    expect(new Set([on, off, blocked]).size).toBe(3);
    for (const text of [off, blocked]) {
      expect(text).toContain("저장하지 않아요");
      expect(text).not.toMatch(/남아요|저장돼요|저장했어요/u);
    }
  });
});

// ---------------------------------------------------------------------------
// 줄 한 개의 모양과 상수와의 일치
// ---------------------------------------------------------------------------

describe("먼저 고른 글자와 결과 글자가 다른 주제의 줄", () => {
  it("모양: 주어, 먼저 고른 글자(이름과 함께), 답을 모아 보니, 결과 글자(이름과 함께) 쪽으로 답했어요", () => {
    const form = /^(돈|준비|정하는 사람|지쳤을 때) 주제에서는 결과를 보기 전에 「([VSWDUFHA]) ([가-힣 ]+)」를 골랐는데, 답을 모아 보니 「([VSWDUFHA]) ([가-힣 ]+)」 쪽으로 답했어요\.$/u;
    for (const line of allLines()) {
      const text = letterGuessLineText(line);
      const match = form.exec(text);
      expect(match, text).not.toBeNull();
      expect(match?.[2]).toBe(line.guessed);
      expect(match?.[4]).toBe(line.shown);
      expect(match?.[3]).toBe(letterInfo(line.guessed).name);
      expect(match?.[5]).toBe(letterInfo(line.shown).name);
    }
  });

  it("예시 줄이 계획의 문장과 글자까지 같다", () => {
    expect(letterGuessLineText({ axis: "process", guessed: "W", shown: "D" })).toBe("준비 주제에서는 결과를 보기 전에 「W 같이 하기」를 골랐는데, 답을 모아 보니 「D 나눠 하기」 쪽으로 답했어요.");
    expect(letterGuessLineText({ axis: "support", guessed: "A", shown: "H" })).toBe("지쳤을 때 주제에서는 결과를 보기 전에 「A 할 일 먼저」를 골랐는데, 답을 모아 보니 「H 마음 먼저」 쪽으로 답했어요.");
  });

  it("주어는 상수의 주제 이름(topic) 뒤에 「 주제에서는」을 붙인 말이다(주제마다, 주제가 글자를 고른 것으로 읽히지 않는다)", () => {
    const stems: Record<Axis, string> = { money: "돈 주제에서는", process: "준비 주제에서는", scope: "정하는 사람 주제에서는", support: "지쳤을 때 주제에서는" };
    for (const axis of V40_AXIS_KEYS) {
      const info = axisInfo(axis);
      const line = letterGuessLineText({ axis, guessed: info.front, shown: info.back });
      expect(stems[axis], axis).toBe(`${info.topic} 주제에서는`);
      expect(line.startsWith(`${stems[axis]} 결과를 보기 전에 「`), line).toBe(true);
      // 세기를 낮춘 반반이에요 문장은 copy.ts 의 TOPIC_SUBJECT(코드 줄 낭독과 같은 주어, 돈은 · 준비는 · 정하는 사람은 · 지쳤을 때는)로 시작한다.
      const readingSubjects: Record<Axis, string> = { money: "돈은", process: "준비는", scope: "정하는 사람은", support: "지쳤을 때는" };
      for (const letter of [info.front, info.back] as const) {
        expect(collectedSentence(axis, letter, "even", true).startsWith(`${readingSubjects[axis]} 글자 옆 표시를 `), `${axis} ${letter}`).toBe(true);
      }
    }
  });

  it("글자 이름은 상수에서 그대로 읽는다(복사본이 없다)", () => {
    for (const line of allLines()) {
      const text = letterGuessLineText(line);
      expect(text).toContain(`「${line.guessed} ${letterInfo(line.guessed).name}」`);
      expect(text).toContain(`「${line.shown} ${letterInfo(line.shown).name}」`);
    }
  });
});

describe("글자 카드와 주제 이름", () => {
  it("글자 카드 글: 글자와 이름, 가운뎃점, 상수의 뜻 한 줄", () => {
    for (const letter of V40_LETTER_LIST) {
      const info = letterInfo(letter);
      expect(letterGuessCardText(letter)).toBe(`${info.letter} ${info.name} · ${info.meaning}`);
    }
    expect(letterGuessCardText("V")).toBe("V 조건 먼저 · 돈이 걸린 결정에서 총액과 계약 조건 같은 숫자를 먼저 맞춰 보고, 돈 쓸 곳은 결혼 뒤 생활 쪽에 둬요.");
  });

  it("카드 글에 상대 글자의 이름이나 판정이 섞이지 않는다(글자마다 자기 이름과 뜻만)", () => {
    for (const letter of V40_LETTER_LIST) {
      const text = letterGuessCardText(letter);
      for (const other of V40_LETTER_LIST) {
        if (other === letter) continue;
        expect(text).not.toContain(`${other} ${letterInfo(other).name}`);
      }
    }
  });

  it("주제 이름은 상수의 제목 그대로다", () => {
    expect(V40_AXES.map((axis) => axis.title)).toStrictEqual(V40_AXIS_KEYS.map((axis) => letterGuessTopicTitle(axis)));
    expect(V40_AXIS_KEYS.map((axis) => letterGuessTopicTitle(axis))).toStrictEqual(["돈을 정할 때", "준비를 굴릴 때", "누구와 함께 정할 때", "지쳤을 때"]);
  });
});

// ---------------------------------------------------------------------------
// V40_COPY 에 붙었을 때: 같은 화면 묶음 안에서 같은 문장이 두 번 나오지 않는다
// ---------------------------------------------------------------------------

describe("V40_COPY 에 붙었을 때(통합 전 거울): 한 화면 묶음 안의 같은 문장 중복과 고지 수", () => {
  const OWN_KEY = "letterGuess";

  /** 통합자가 붙일 모양: 이 묶음을 빼고 지금 V40_COPY 에 이 묶음을 더한 사전. 이미 붙어 있어도 같은 결과다. */
  const merged: Record<string, unknown> = { ...(V40_COPY as unknown as Record<string, unknown>), [OWN_KEY]: V40_LETTER_GUESS_COPY };

  /** 이 묶음이 매핑될 화면: 결과, 두 사람 결과(기존 화면에 이 묶음을 더함)와 새 화면(이 묶음, 공통, 접근성 이름표). */
  function screenGroups(): Record<string, readonly string[]> {
    const existing = V40_COPY_SCREENS as unknown as Record<string, readonly string[]>;
    const withOwn = (groups: readonly string[]) => (groups.includes(OWN_KEY) ? groups : [...groups, OWN_KEY]);
    return {
      result: withOwn(existing.result),
      couple: withOwn(existing.couple),
      letterGuess: existing.letterGuess ?? [OWN_KEY, "common", "a11y"],
    };
  }

  it("결과, 두 사람 결과, 새 화면의 묶음 안에서 같은 문장이 두 번 나오지 않는다", () => {
    for (const [screen, groups] of Object.entries(screenGroups())) {
      const seen = new Map<string, string>();
      for (const group of groups) {
        expect(Object.keys(merged), `${screen}: ${group}`).toContain(group);
        for (const leaf of copyLeaves(merged[group], group)) {
          if (leaf.label || /^(question\.escapeChosen|send\.message(WithAnswers|QuestionsOnly)$)/u.test(leaf.path)) continue;
          for (const sentence of sentencesOf(leaf.text)) {
            const earlier = seen.get(sentence);
            expect(earlier, `${screen}: ${leaf.path} 의 「${sentence}」가 ${earlier} 에도 있다`).toBeUndefined();
            seen.set(sentence, leaf.path);
          }
        }
      }
      // 이 묶음의 문장이 실제로 이 화면에 들어 있다(측정기가 비어 있지 않다).
      expect([...seen.values()].some((path) => path.startsWith(`${OWN_KEY}.`)), screen).toBe(true);
    }
  });

  it("함수가 만든 줄과 카드와 저장 안내가 기존 문구의 문장과 같지 않다", () => {
    const existing = new Set<string>();
    for (const [group, value] of Object.entries(merged)) {
      if (group === OWN_KEY) continue;
      for (const leaf of copyLeaves(value, group)) if (!leaf.label) for (const sentence of sentencesOf(leaf.text)) existing.add(sentence);
    }
    for (const leaf of copyLeaves(V40_ENTRY_COPY, "V40_ENTRY_COPY")) if (!leaf.label) for (const sentence of sentencesOf(leaf.text)) existing.add(sentence);
    expect(existing.size).toBeGreaterThan(200);
    for (const leaf of ALL_LEAVES) {
      if (leaf.label) continue;
      for (const sentence of sentencesOf(leaf.text)) expect(existing.has(sentence), `${leaf.path}: ${sentence}`).toBe(false);
    }
  });

  it("고지 수 기대 표(새 화면 0)와 두 사람 결과와 결과 화면의 고지가 이 묶음 때문에 늘지 않는다", () => {
    for (const [screen, groups] of Object.entries(screenGroups())) {
      const text = groups.flatMap((group) => copyLeaves(merged[group], group).map((leaf) => leaf.text)).join("\n");
      const count = text.split(V40_NOT_VALIDATED_PHRASE).length - 1;
      const expected = screen === "letterGuess" ? 0 : 1;
      expect(count, screen).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// 소스 안의 글: 화면에 나가는 글이 문구 파일 밖에서 낱말 규칙을 피하지 않는다(copy.test.ts 의 재귀 검사가 못 보는 새 폴더)
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPONENT_DIR = resolve(HERE, "../../../../components/wedding-code/v40/letterGuess");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => /\.(ts|tsx)$/u.test(name) && !/\.test\./u.test(name) && !/\.d\.ts$/u.test(name))
    .map((name) => join(dir, name));
}

/** TypeScript 파서로 문자열 리터럴, 템플릿 조각, JSX 글을 뽑는다(주석은 트리에 없다). 가져오기 경로는 뺀다. */
function stringsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) out.push(node.text);
    else if (ts.isJsxText(node)) out.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("이 기능의 소스 안 글", () => {
  const files = [...sourceFiles(HERE), ...sourceFiles(COMPONENT_DIR)];
  const texts = files.flatMap((file) => stringsOf(file).map((text) => ({ file, text })));

  it("문자열을 실제로 뽑고 있다(눈이 멀어 초록불이 되지 않는다)", () => {
    expect(files.length).toBeGreaterThanOrEqual(9);
    expect(texts.length).toBeGreaterThan(40);
    expect(texts.some((entry) => entry.text.includes("먼저 고른 글자와 나란히"))).toBe(true);
  });

  it("한글이 든 모든 글에서 기기, 짐작, 데이터, 자리, 문항을 쓰지 않는다(공용 기기만 예외)", () => {
    for (const { file, text } of texts) {
      if (!/[가-힣]/u.test(text)) continue;
      expect(text.replace(/공용 기기/gu, ""), file).not.toMatch(/기기|짐작|데이터|자리|문항/u);
      expect(text, file).not.toMatch(/[–—‒―−~%]/u);
      expect(text, file).not.toMatch(BANNED);
    }
  });

  it("컴포넌트와 문구 파일에는 고지 문장이 없고 낫표 속 글자는 문구 파일이 상수에서 만든다", () => {
    for (const { file, text } of texts) expect(text, file).not.toContain(V40_NOT_VALIDATED_PHRASE);
    // 컴포넌트 안에 글자 이름을 손으로 적지 않았다(상수에서 읽는다).
    for (const file of sourceFiles(COMPONENT_DIR)) {
      for (const text of stringsOf(file)) {
        for (const letter of V40_LETTER_LIST) expect(text, file).not.toContain(letterInfo(letter).name);
      }
    }
  });
});
