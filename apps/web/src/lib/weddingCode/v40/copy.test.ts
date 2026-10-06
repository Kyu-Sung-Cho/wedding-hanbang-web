import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  V40_AXES,
  V40_AXIS_KEYS,
  V40_COUNTS,
  V40_ESCAPES,
  V40_LETTERS,
  V40_LETTER_LIST,
  V40_SAME_LETTER_NOTE,
  V40_SPLIT_TOTAL,
  V40_STORAGE,
  V40_STRENGTH,
  axisInfo,
  letterInfo,
  type Axis,
  type Letter,
  type StrengthBand,
} from "@/constants/weddingCodeV40";
import {
  V40_CLIENT_COPY,
  V40_COPY,
  V40_COPY_SCREENS,
  V40_COUPLE_SEND_EXTRA_COPY,
  V40_ENTRY_COPY,
  V40_NOT_VALIDATED_PHRASE,
  V40_QUOTE_TEMPLATES,
  autosaveTurnOffWarning,
  bestWorstPickedAnnouncement,
  codeCopyText,
  codeLineAccessibleName,
  collectedSentence,
  coupleTagNote,
  evenOneSidedLine,
  evenSideAnswersHeading,
  formatGuideRepeatsStem,
  historyCell,
  historyChangedLine,
  historyLead,
  introBullets,
  introStorage,
  koreanDateLabel,
  legendLetterCell,
  legendRows,
  letterAriaLabel,
  letterBandCell,
  letterHeading,
  meaningLine,
  myLetterCell,
  oppositeMeaningLine,
  personName,
  receiveStorage,
  savedOnLine,
  selfChoiceLine,
  selfChoiceParts,
  selfContrastSentence,
  selfLevelPhrase,
  splitAddLabel,
  splitCountLabel,
  splitRemainingNotice,
  splitRemoveLabel,
  splitStatus,
  storageExpiredNote,
  strengthSentence,
  talkLine,
  tryLine,
  withoutQuoteQualifier,
  type CodeLineEntry,
  type V40StorageMode,
} from "./copy";
import * as copyExports from "./copy";

// ---------------------------------------------------------------------------
// 문구 모으기
// ---------------------------------------------------------------------------

interface Leaf {
  readonly path: string;
  readonly text: string;
  /** 낱말이나 짧은 제목이라 문장 끝맺음 검사에서 빠지는가(키 이름이 label, title 등으로 끝남). */
  readonly label: boolean;
}

const LABEL_KEY = /(label|title|heading|button|name|tag|toggle|option|caption|list|badge|mark|column|step)s?$/i;

/** V40_COPY 안의 문자열 잎을 모두 모은다. 라벨 키 아래는 모두 라벨이다. */
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

/** 함수가 만든 문구 표본. sentence 는 문장이라 끝맺음 검사를 받고 label 은 낱말이다. */
function samples(): Leaf[] {
  const out: Leaf[] = [];
  const sentence = (path: string, text: string) => out.push({ path, text, label: false });
  const label = (path: string, text: string) => out.push({ path, text, label: true });
  const bands: StrengthBand[] = ["clear", "lean", "even"];
  const at = Date.UTC(2026, 8, 29, 10, 0);

  for (const mode of STORAGE_MODES) {
    introBullets(mode).forEach((text, index) => sentence(`introBullets(${mode})[${index}]`, text));
    sentence(`introStorage(${mode}).plain`, introStorage(mode).plain);
    label(`introStorage(${mode}).linkLabel`, introStorage(mode).linkLabel);
    sentence(`receiveStorage(${mode})`, receiveStorage(mode));
  }
  for (const warning of [
    autosaveTurnOffWarning({ saved: true, legacy: true }),
    autosaveTurnOffWarning({ saved: false, legacy: true }),
    autosaveTurnOffWarning({ saved: true, legacy: false }),
    autosaveTurnOffWarning({ saved: false, legacy: false }),
  ]) {
    sentence("autosaveTurnOffWarning", warning);
  }
  sentence("storageExpiredNote", storageExpiredNote());
  sentence("savedOnLine", savedOnLine(at) ?? "");
  sentence("splitRemainingNotice", splitRemainingNotice(2));
  sentence("splitStatus(0)", splitStatus(0));
  sentence("splitStatus(3)", splitStatus(3));
  label("splitAddLabel", splitAddLabel("사진 촬영 시간을 늘려요"));
  label("splitRemoveLabel", splitRemoveLabel("사진 촬영 시간을 늘려요"));
  label("splitCountLabel", splitCountLabel("사진 촬영 시간을 늘려요", 3));
  sentence("bestWorstPickedAnnouncement(best)", bestWorstPickedAnnouncement("best", "사진 촬영 시간을 늘려요"));
  sentence("bestWorstPickedAnnouncement(worst)", bestWorstPickedAnnouncement("worst", "예비비를 남겨 둬요"));

  for (const axis of V40_AXES) {
    sentence(`collected.${axis.key}.unusable`, collectedSentence(axis.key, null, null));
    sentence(`collected.${axis.key}.even`, collectedSentence(axis.key, axis.front, "even"));
    sentence(`collected.${axis.key}.lowered`, collectedSentence(axis.key, axis.front, "even", true));
    for (const letter of [axis.front, axis.back]) {
      sentence(`strengthSentence(${letter},even,lowered)`, strengthSentence(axis.key, letter, "even", true));
      sentence(`evenOneSidedLine(${letter})`, evenOneSidedLine(letter));
      sentence(`collected.${letter}`, collectedSentence(axis.key, letter, "clear"));
      sentence(`meaningLine(${letter})`, meaningLine(letter));
      sentence(`oppositeMeaningLine(${letter})`, oppositeMeaningLine(letter));
      sentence(`talkLine(${letter})`, talkLine(letter));
      sentence(`tryLine(${letter})`, tryLine(letter));
      label(`evenSideAnswersHeading(${letter})`, evenSideAnswersHeading(letter));
      label(`legendLetterCell(${letter})`, legendLetterCell(letter));
      for (const band of bands) {
        sentence(`strengthSentence(${letter},${band})`, strengthSentence(axis.key, letter, band));
        label(`letterHeading(${letter},${band})`, letterHeading(letter, band));
        label(`letterHeading(${letter},${band},provisional)`, letterHeading(letter, band, true));
        label(`letterAriaLabel(${letter},${band})`, letterAriaLabel(letter, band));
        label(`myLetterCell(${letter},${band})`, myLetterCell(letter, band));
        label(`historyCell(${letter},${band})`, historyCell(letter, band, false));
        label(`letterBandCell(${letter},${band})`, letterBandCell(letter, band, false));
      }
      for (const level of [1, 2, 3] as const) {
        sentence(
          `selfChoiceLine(${letter},${level})`,
          selfChoiceLine({ axis: axis.key, side: letter === axis.front ? "front" : "back", letter, level }),
        );
      }
      for (const gathered of [axis.front, axis.back]) {
        for (const gatheredBand of ["clear", "lean"] as const) {
          sentence(
            `selfContrastSentence(${letter},${gathered},${gatheredBand})`,
            selfContrastSentence({ selfLetter: letter, gatheredLetter: gathered, gatheredBand }),
          );
        }
      }
    }
    sentence(`historyChangedLine(${axis.key})`, historyChangedLine(axis.key, axis.front, axis.back));
    sentence(`coupleTagNote(${axis.key},same)`, coupleTagNote(axis.key, "same", false));
    sentence(`coupleTagNote(${axis.key},different)`, coupleTagNote(axis.key, "different", false));
    sentence(`coupleTagNote(${axis.key},even)`, coupleTagNote(axis.key, "even", false));
    sentence(`coupleTagNote(${axis.key},excluded)`, coupleTagNote(axis.key, "same", true));
  }
  for (const changed of [true, false]) {
    sentence(`historyLead(${changed})`, historyLead("9월 29일", changed));
    sentence(`historyLead(${changed},noDate)`, historyLead("", changed));
  }
  label("historyCell(null)", historyCell(null, null, false));
  label("letterBandCell(null)", letterBandCell(null, null, false));
  sentence("codeLineAccessibleName", codeLineAccessibleName(SWUA));
  sentence("codeLineAccessibleName(unusable)", codeLineAccessibleName(WITH_UNUSABLE));
  label("codeCopyText", codeCopyText(SWUA));
  for (const perspective of [null, "first", "second"] as const) {
    for (const person of ["first", "second"] as const) {
      label(`personName(${perspective},${person})`, personName(perspective, person));
    }
  }
  sentence("quote.bestWorst", V40_QUOTE_TEMPLATES.bestWorst("사진 촬영 시간을 늘려요"));
  sentence("quote.split", V40_QUOTE_TEMPLATES.split(3, "사진과 꽃에 써요"));
  return out;
}

const SWUA: readonly CodeLineEntry[] = [
  { axis: "money", letter: "S", band: "lean", provisional: false },
  { axis: "process", letter: "W", band: "clear", provisional: false },
  { axis: "scope", letter: "U", band: "lean", provisional: false },
  { axis: "support", letter: "A", band: "even", provisional: false },
];

const STORAGE_MODES: readonly V40StorageMode[] = ["on", "off", "blocked"];

const WITH_UNUSABLE: readonly CodeLineEntry[] = [
  { axis: "money", letter: "S", band: "lean", provisional: false },
  { axis: "process", letter: null, band: null, provisional: false },
  { axis: "scope", letter: "U", band: "even", provisional: true },
  { axis: "support", letter: "H", band: "clear", provisional: false },
];

const CONST_LEAVES = copyLeaves(V40_COPY);
/** 입구 묶음도 같은 문구 규칙을 받는다(V40_COPY 에 없는 문구가 있어서 따로 모은다). */
const ENTRY_LEAVES = copyLeaves(V40_ENTRY_COPY, "V40_ENTRY_COPY");
const ALL_LEAVES = [...CONST_LEAVES, ...ENTRY_LEAVES, ...samples()];

// ---------------------------------------------------------------------------
// 문장 검사
// ---------------------------------------------------------------------------

/** 명사구를 나열한 첫 문장이라 끝맺음 검사에서 빼는 조각(시작 화면 소개글). 목록에 없는 문장은 모두 요, 다, 죠로 끝나야 한다. */
const SENTENCE_ENDING_EXEMPT = ["돈을 정할 때, 준비를 굴릴 때, 함께 정하는 사람, 지쳤을 때."];

function politeEnding(sentence: string): boolean {
  const core = sentence
    .replace(/[.?!…]+$/u, "")
    .replace(/[」』]+$/u, "")
    .replace(/\([^)]*\)$/u, "")
    .trim();
  return /(요|다|죠)$/u.test(core);
}

function sentencesOf(text: string): string[] {
  let rest = text;
  for (const fragment of SENTENCE_ENDING_EXEMPT) rest = rest.replace(fragment, "");
  return rest.split(/(?<=[.?!])\s+/u).map((part) => part.trim()).filter((part) => part.length > 0);
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** 화면에 아무 문구도 못 내보내는 낱말. 안 맞아요는 「제 상황과 안 맞아요」에만 남는다. 자리는 아래 검사에서 어디에도 쓰지 못한다. */
const BANNED =
  /검증된|정확|과학적|진단|점수|등급|궁합|잘 ?맞|성격|유형|스타일|동물|캐릭터|MBTI|mbti|퍼센트|순위|문항|측면|서버 연결|접근 키|확인 주소|데이터|로딩|에러|오류|타입|속마음|무의식|본모습|모순|일관성|당신은|숨은 ?(?:성향|마음|이유)/u;
const BANNED_FORMAL = /(합니다|입니다|습니다|바랍니다|하십시오)/u;
const BANNED_LABELS_OF_ORDER = /(번째|첫|둘째|셋째) ?(질문|화면|장면)|(질문|화면|장면) ?번호|\d+ ?\/ ?\d+|이야기 ?(카드|편|화면)/u;

describe("웨딩코드 4.0 화면 문구", () => {
  it("문구가 충분히 많고 잎마다 글자가 있다", () => {
    expect(CONST_LEAVES.length).toBeGreaterThan(200);
    expect(ALL_LEAVES.length).toBeGreaterThan(CONST_LEAVES.length + 100);
    for (const leaf of ALL_LEAVES) {
      expect(leaf.text.length, leaf.path).toBeGreaterThan(0);
    }
  });

  it("줄표, 백분율 기호, 물결표, 깨진 글자, 거친 공백이 없다", () => {
    for (const { path, text } of ALL_LEAVES) {
      expect(text, path).not.toMatch(/[–—‒―−]/u);
      expect(text, path).not.toMatch(/%/u);
      expect(text, path).not.toMatch(/~/u);
      expect(text, path).not.toContain("�");
      expect(text, path).not.toMatch(/\r|\n|\t/u);
      expect(text, path).not.toMatch(/ {2,}/u);
      expect(text, path).not.toMatch(/\\u[0-9a-fA-F]{4}/u);
      expect(text, path).toBe(text.trim());
    }
    // 하이픈은 어디에도 쓰지 않는다(줄표 대용 금지).
    for (const { path, text } of ALL_LEAVES) expect(text, path).not.toContain("-");
  });

  it("금지된 주장과 낱말이 없다", () => {
    for (const { path, text } of ALL_LEAVES) {
      expect(text, path).not.toMatch(BANNED);
      expect(text, path).not.toMatch(BANNED_FORMAL);
      expect(text, path).not.toMatch(BANNED_LABELS_OF_ORDER);
      expect(text, path).not.toMatch(/인 답/u);
      expect(text, path).not.toMatch(/뜻은 아니에요/u);
      // 안 맞아요는 「제 상황과 안 맞아요」 단추 이름에만 남는다.
      expect(text.replace(V40_ESCAPES.notApplicable, ""), path).not.toMatch(/안 ?맞/u);
      // 글자 위치를 뜻하는 ‘자리’는 쓰지 않는다. 반올림 안내의 소수 자릿수는 위치와 관계없는 산술 용어다.
      if (path === "evidence.precisionNote") {
        expect(text).toContain("소수점 둘째 자리까지");
      } else {
        expect(text, path).not.toMatch(/자리/u);
      }
    }
  });

  it("정적 문구에 숫자가 없다(칸 나누기 안내의 6칸만 예외)", () => {
    for (const { path, text } of CONST_LEAVES) {
      const withoutSix = text.split(`${V40_SPLIT_TOTAL}칸`).join("");
      expect(withoutSix, path).not.toMatch(/[0-9０-９]/u);
    }
  });

  it("글자 한 자 뒤에 한글이 오면 그 글자의 이름이 온다(뜻을 알 수 없는 글자만 덩그러니 적지 않는다)", () => {
    // 「S 장면 먼저」「H 마음 먼저 쪽으로 고른 답」처럼 글자 다음 낱말은 늘 그 글자의 이름이다. 코드 「SWUA」처럼 이어 쓴 글자는 한글이 뒤따르지 않아 해당이 없다.
    let checked = 0;
    for (const { path, text } of ALL_LEAVES) {
      for (const match of text.matchAll(/(?<![A-Za-z])([VSWDUFHA]) (?=[가-힣])/gu)) {
        const letter = match[1] as Letter;
        const after = text.slice((match.index ?? 0) + 2);
        expect(after.startsWith(letterInfo(letter).name), `${path}: ${letter} 뒤 「${after.slice(0, 10)}」`).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it("영문자는 여덟 글자뿐이고(코드 SWUA 처럼 이어 쓰기 가능) A/B 같은 라벨이 없다", () => {
    const allowed = new Set<string>(V40_LETTER_LIST);
    for (const { path, text } of ALL_LEAVES) {
      for (const word of text.match(/[A-Za-z]+/gu) ?? []) {
        expect([...word].every((char) => allowed.has(char)), `${path}: ${word}`).toBe(true);
      }
      expect(text, path).not.toMatch(/[A-Za-z]\s*\/\s*[A-Za-z]/u);
    }
    expect(V40_LETTER_LIST).toHaveLength(8);
    expect(new Set(V40_LETTER_LIST).size).toBe(8);
  });

  it("장면, 이야기, 자리를 질문이나 구간의 이름으로 쓰지 않는다", () => {
    for (const { path, text } of ALL_LEAVES) {
      expect(text, path).not.toMatch(/(질문|구간|주제|글자|세기) ?(장면|이야기)|(장면|이야기) ?(질문|구간)/u);
    }
  });

  it("문장 끝이 해요체다(라벨 키는 빼고 문장은 요, 다, 죠로 끝난다)", () => {
    for (const leaf of ALL_LEAVES) {
      if (leaf.label) {
        expect(leaf.text, leaf.path).not.toMatch(/\.$/u);
        continue;
      }
      for (const sentence of sentencesOf(leaf.text)) {
        expect(politeEnding(sentence), `${leaf.path}: ${sentence}`).toBe(true);
      }
    }
    // 예외 조각이 실제로 문구에 있다(죽은 예외를 남기지 않는다).
    for (const fragment of SENTENCE_ENDING_EXEMPT) {
      expect(CONST_LEAVES.some((leaf) => leaf.text.includes(fragment)), fragment).toBe(true);
    }
  });

  it("라벨 키 규칙이 라벨이 아닌 낱말을 삼키지 않는다", () => {
    // 규칙이 너무 넓으면 문장을 라벨로 착각해 검사에서 빼 버린다. 라벨로 분류된 문구가 짧은 제목과 낱말인지 본다.
    const labelSentences = CONST_LEAVES.filter((leaf) => leaf.label && /[.]\s+\S/u.test(leaf.text));
    // 마침표로 이어진 두 문장 이상이 라벨로 분류되면 이름을 다시 짓는다(시작 소개글은 lede 라서 문장이다).
    expect(labelSentences.map((leaf) => leaf.path)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 고지와 화면 묶음
// ---------------------------------------------------------------------------

describe("고지 「검증을 마친 심리검사가 아니」", () => {
  function screenText(screen: keyof typeof V40_COPY_SCREENS): string {
    return V40_COPY_SCREENS[screen]
      .flatMap((group) => copyLeaves(V40_COPY[group]).map((leaf) => leaf.text))
      .join("\n");
  }

  it("시작, 받는 사람, 결과, 두 사람 결과에 정확히 한 번, 나머지 화면에는 없다", () => {
    const expected: Record<keyof typeof V40_COPY_SCREENS, number> = {
      intro: 1, receive: 1, question: 0, rest: 0, wrapUp: 0, result: 1, couple: 1,
      // 4.1 단계 2 의 단계 화면 둘(결과 전 글자 고르기, 서로 짐작하기)에는 고지가 없다(화면당 한 번 규칙은 시작, 받는 사람, 결과, 두 사람 결과가 이미 맡는다).
      letterGuess: 0, pairGuess: 0,
    };
    for (const screen of Object.keys(V40_COPY_SCREENS) as (keyof typeof V40_COPY_SCREENS)[]) {
      expect(countOf(screenText(screen), V40_NOT_VALIDATED_PHRASE), screen).toBe(expected[screen]);
    }
    // 어떤 화면 묶음에서도 두 번 나오지 않으므로 화면 하나 안에서 최대 한 번이라는 규칙이 지켜진다.
    for (const screen of Object.keys(V40_COPY_SCREENS)) {
      expect(countOf(screenText(screen as keyof typeof V40_COPY_SCREENS), V40_NOT_VALIDATED_PHRASE), screen).toBeLessThanOrEqual(1);
    }
  });

  it("문구 전체에서 고지는 네 곳뿐이고 함수가 만든 글에는 없다", () => {
    const all = CONST_LEAVES.filter((leaf) => leaf.text.includes(V40_NOT_VALIDATED_PHRASE)).map((leaf) => leaf.path);
    expect(all.sort()).toEqual(["couple.notice", "intro.notice", "receive.notice", "result.notice"]);
    for (const leaf of samples()) expect(leaf.text, leaf.path).not.toContain(V40_NOT_VALIDATED_PHRASE);
    // 시작, 결과의 고지는 같은 문장이고 받는 사람 화면은 문서 8절의 문장이다.
    expect(V40_COPY.intro.notice).toBe(V40_COPY.result.notice);
    expect(V40_COPY.receive.notice).toBe("새로 만든 질문이라 아직 여러 사람에게 확인해 보지 못했고 검증을 마친 심리검사가 아니에요.");
  });

  it("모든 문구 묶음이 어느 화면에서는 쓰이고, 화면 묶음 이름은 실제 묶음이다", () => {
    const used = new Set<string>(Object.values(V40_COPY_SCREENS).flat());
    expect([...used].sort()).toEqual(Object.keys(V40_COPY).sort());
    for (const groups of Object.values(V40_COPY_SCREENS)) {
      for (const group of groups) expect(Object.keys(V40_COPY)).toContain(group);
    }
  });

  it("한 화면 묶음 안에서 같은 문장이 두 번 나오지 않는다(같은 주의를 두 번 읽히지 않는다)", () => {
    // 라벨(제목, 단추 이름 등)은 빼고 문장만 센다. 같은 문장이 두 군데에 있으면 읽는 사람은 새 정보로 착각하거나 지쳐서 넘긴다.
    // 예외 둘, 모두 한 화면에 함께 보이지 않는 문구다.
    // - 넘어간 이유별 세 줄(escapeChosen...)은 질문 아래에 하나만 보이는 서로 바꿔 쓰는 문구라 끝 문장이 같아도 된다.
    // - 보낼 말 두 개는 라디오에서 고른 쪽 하나만 보인다.
    const alternatives = /^(question\.escapeChosen|send\.message(WithAnswers|QuestionsOnly)$)/u;
    for (const screen of Object.keys(V40_COPY_SCREENS) as (keyof typeof V40_COPY_SCREENS)[]) {
      const seen = new Map<string, string>();
      for (const group of V40_COPY_SCREENS[screen]) {
        for (const leaf of copyLeaves(V40_COPY[group], group)) {
          if (leaf.label || alternatives.test(leaf.path)) continue;
          for (const sentence of sentencesOf(leaf.text)) {
            const earlier = seen.get(sentence);
            expect(earlier, `${screen}: ${leaf.path} 의 「${sentence}」가 ${earlier} 에도 있다`).toBeUndefined();
            seen.set(sentence, leaf.path);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 글자 읽는 법과 열두 문장
// ---------------------------------------------------------------------------

describe("글자 읽는 법 표", () => {
  it("글자 여덟 개가 상수와 1대 1로 한 번씩 나온다", () => {
    const rows = legendRows();
    expect(rows.map((row) => row.axis)).toEqual([...V40_AXIS_KEYS]);
    const letters = rows.flatMap((row) => [row.front.letter, row.back.letter]);
    expect(letters).toEqual([...V40_LETTER_LIST]);
    expect(new Set(letters).size).toBe(8);
    for (const row of rows) {
      const axis = axisInfo(row.axis);
      expect(row.title).toBe(axis.title);
      expect(row.front.letter).toBe(axis.front);
      expect(row.back.letter).toBe(axis.back);
      for (const side of [row.front, row.back]) {
        const info = letterInfo(side.letter);
        expect(side.name).toBe(info.name);
        expect(side.english).toBe(info.english);
        expect(side.cell).toBe(`${side.letter} ${info.name}`);
        expect(legendLetterCell(side.letter)).toBe(side.cell);
      }
    }
    // 글자마다 표에 나오는 줄이 하나이고, 이름도 서로 다르다.
    expect(new Set(rows.flatMap((row) => [row.front.name, row.back.name])).size).toBe(8);
    expect(rows.flatMap((row) => [row.front.english, row.back.english])).toEqual([
      "Verify", "Scene", "With", "Divide", "Us", "Family", "Heart", "Action",
    ]);
  });

  it("문서 7절의 글자 읽는 법 예시와 같은 칸", () => {
    expect(legendRows().map((row) => `${row.title} | ${row.front.cell} | ${row.back.cell}`)).toEqual([
      "돈을 정할 때 | V 조건 먼저 | S 장면 먼저",
      "준비를 굴릴 때 | W 같이 하기 | D 나눠 하기",
      "함께 정하는 사람 | U 둘이 정하기 | F 가족과 정하기",
      "지쳤을 때 | H 마음 먼저 | A 할 일 먼저",
    ]);
    expect(V40_COPY.legend.mineColumn).toBe("내 글자");
    // 어느 글자가 내 글자인지 테두리와 표식뿐 아니라 글로도 말한다.
    expect(myLetterCell("S", "lean")).toBe("내 글자 S · 기울어요");
    expect(myLetterCell("W", "clear")).toBe("내 글자 W · 뚜렷해요");
    expect(myLetterCell("A", "even")).toBe("내 글자 A · 반반이에요");
    expect(myLetterCell("A", "even", true)).toBe("내 글자 A · 반반이에요 · 임시");
  });

  it("세기 낱말이 상수와 같고 풀이 세 줄이 있다", () => {
    expect(Object.keys(V40_COPY.legend.strengthGuide)).toEqual(["clear", "lean", "even"]);
    expect(V40_COPY.legend.strengthGuide.clear.startsWith(V40_STRENGTH.clear.label)).toBe(true);
    expect(V40_COPY.legend.strengthGuide.lean.startsWith(V40_STRENGTH.lean.label)).toBe(true);
    expect(V40_COPY.legend.strengthGuide.even.startsWith(V40_STRENGTH.even.label)).toBe(true);
  });
});

describe("답을 모아 보니 열두 문장", () => {
  const spec: Record<Axis, { front: string; back: string; even: string }> = {
    money: {
      front: "돈은 조건과 총액부터 맞춰 보는 쪽으로 답했어요.",
      back: "돈은 남을 장면부터 그려 보는 쪽으로 답했어요.",
      even: "돈은 조건과 장면 어느 쪽으로도 크게 기울지 않았어요.",
    },
    process: {
      front: "준비는 같이 하는 쪽으로 답했어요.",
      back: "준비는 나눠 맡는 쪽으로 답했어요.",
      even: "준비는 같이 하기와 나눠 하기 어느 쪽으로도 크게 기울지 않았어요.",
    },
    scope: {
      front: "정할 때는 둘이 먼저 정하는 쪽으로 답했어요.",
      back: "정할 때는 가족의 마음도 먼저 모으는 쪽으로 답했어요.",
      even: "정하는 사람은 둘과 가족 어느 쪽으로도 크게 기울지 않았어요.",
    },
    support: {
      front: "지친 날에는 마음부터 알아주는 쪽으로 답했어요.",
      back: "지친 날에는 할 일부터 덜어 내는 쪽으로 답했어요.",
      even: "지친 날에는 마음과 할 일 어느 쪽으로도 크게 기울지 않았어요.",
    },
  };

  it("문서 7절의 열두 문장을 글자 그대로 낸다", () => {
    for (const axis of V40_AXES) {
      const expected = spec[axis.key];
      expect(V40_COPY.collected.sentences[axis.key].front).toBe(expected.front);
      expect(V40_COPY.collected.sentences[axis.key].back).toBe(expected.back);
      expect(V40_COPY.collected.sentences[axis.key].even).toBe(expected.even);
      for (const band of ["clear", "lean"] as const) {
        expect(collectedSentence(axis.key, axis.front, band)).toBe(expected.front);
        expect(collectedSentence(axis.key, axis.back, band)).toBe(expected.back);
      }
      expect(collectedSentence(axis.key, axis.front, "even")).toBe(expected.even);
      expect(collectedSentence(axis.key, axis.back, "even")).toBe(expected.even);
    }
    expect(V40_COPY.collected.title).toBe("답을 모아 보니");
  });

  it("글자 문장은 상수의 글자 풀이와 같고 반반이에요 문장에는 한쪽으로 답했다는 말이 없다", () => {
    for (const info of V40_LETTERS) {
      expect(V40_COPY.collected.sentences[info.axis][info.side]).toBe(info.answerSentence);
    }
    for (const axis of V40_AXES) {
      const even = V40_COPY.collected.sentences[axis.key].even;
      expect(even).toBe(axis.evenSentence);
      expect(even).not.toMatch(/쪽으로 답|쪽으로 모였|답이 모였/u);
      expect(even).toMatch(/어느 쪽으로도 크게 기울지 않았어요\.$/u);
      // 반반이에요는 약한 한쪽 답이나 힌트로 내려간 세기에서도 나오므로 두 쪽이 같은 만큼이었다는 말을 하지 않는다.
      expect(even).not.toMatch(/비슷하게|거의|똑같이|같은 만큼/u);
    }
  });

  it("글자를 못 정한 주제 문장이 있고 다른 주제의 글자를 넣으면 거절한다", () => {
    expect(collectedSentence("money", null, null)).toBe("돈은 답할 수 있는 질문이 적어서 글자를 정하지 못했어요.");
    expect(collectedSentence("support", null, null)).toBe("지친 날에는 답할 수 있는 질문이 적어서 글자를 정하지 못했어요.");
    expect(() => collectedSentence("money", "W", "clear")).toThrow(RangeError);
    expect(() => strengthSentence("scope", "H", "lean")).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 문서에 최종 문구가 있는 것: 글자 그대로
// ---------------------------------------------------------------------------

describe("문서의 최종 문구를 그대로 옮겼다", () => {
  it("시작 화면", () => {
    expect(V40_COPY.intro.brandLabel).toBe("웨딩한방 · 웨딩코드");
    expect(V40_COPY.intro.title).toBe("결혼을 준비할 때, 나는 어느 쪽으로 기울까요?");
    expect(V40_COPY.intro.lede).toBe(
      "돈을 정할 때, 준비를 굴릴 때, 함께 정하는 사람, 지쳤을 때. 결혼을 준비하며 자주 만나는 이 네 가지를 여러 방식으로 물어봐요. 답을 모으면 네 글자 코드가 나와요.",
    );
    expect(introBullets("on", V40_COUNTS.items)).toEqual([
      "정답은 없어요. 어느 쪽도 다 괜찮은 준비 방식이에요.",
      "질문은 모두 68개예요. 네 구간과 마지막 정리로 나눠 물어보고, 쉬고 싶을 때 멈춰도 이 브라우저에 저장돼요.",
      "끝나면 글자마다 뜻과 함께, 그 글자가 나온 내 답도 보여 줘요.",
      "링크를 보내면 상대도 답할 수 있어요. 상대가 두 사람 결과 링크를 다시 보내 주면 둘이 나란히 볼 수 있어요.",
    ]);
    expect(V40_COPY.intro.notice).toBe(
      "새로 만든 질문이라 아직 여러 사람에게 확인해 보지 못했어요. 검증을 마친 심리검사가 아니고, 다시 하면 글자가 달라질 수 있어요.",
    );
    expect(introStorage("on").plain).toBe(
      "답은 웨딩한방에 보내지 않고 이 브라우저에만 30일 동안 저장돼요. 카카오톡 같은 앱 안에서 열었다면 다음에도 같은 곳에서 열어야 이어서 할 수 있어요. 결과 글자와 세기는 지난번과 비교하려고 같은 기간 최근 세 번까지 남아요. 끝까지 마쳤는지 같은 이용 통계만 남겨요. 자세한 내용은 개인정보 처리방침에서 볼 수 있어요. 공용 기기에서는 저장을 꺼 주세요.",
    );
    expect(introStorage("on").linkLabel).toBe("개인정보 처리방침");
    expect(V40_COPY.intro.scope).toBe(
      "식을 올리지 않아도, 부모님이 안 계셔도, 재혼이어도 답할 수 있어요. 맞지 않는 질문은 「제 상황과 안 맞아요」를 눌러 주세요. 신혼집, 예단과 예물, 양가 비용 분담, 실제 금액은 묻지 않아요.",
    );
    expect(V40_COPY.intro.startButton).toBe("시작하기");
    expect(V40_COPY.autosave.turnOnButton).toBe("자동 저장 켜기");
    expect(V40_COPY.autosave.turnOffButton).toBe("자동 저장 끄기");
    expect(V40_COPY.intro.legacy.title).toBe("이전 웨딩코드에 남겨 둔 답이 있어요");
    expect(V40_COPY.intro.newVersionButton).toBe("새 웨딩코드로 시작하기");
    // 안내 문장 속 단추 이름이 실제 단추 이름과 같다.
    expect(V40_COPY.intro.scope).toContain(`「${V40_ESCAPES.notApplicable}」`);
  });

  it("질문 화면, 쉬는 카드, 마지막 정리", () => {
    expect(V40_COPY.question.guides.pair).toBe("더 나 같은 쪽을 골라 주세요. 얼마나 가까운지도 함께 눌러요.");
    expect(V40_COPY.question.guides.react).toBe("그때 내 마음에 가까운 칸을 눌러 주세요.");
    expect(V40_COPY.question.guides.choose).toBe("가장 가까운 것 하나를 골라 주세요. 해 본 적이 없으면 「이런 일이 없었어요」를 눌러도 돼요.");
    expect(V40_COPY.question.guides.bestworst).toBe("가장 나 같은 것 하나, 가장 나 같지 않은 것 하나를 골라 주세요.");
    expect(V40_COPY.question.guides.split).toBe("6칸을 나눠 놓아 주세요. 한 곳에 몰아도 괜찮아요.");
    expect(V40_COPY.question.elderHint).toBe("가까운 어른을 떠올려도 돼요");
    expect(V40_COPY.question.unsureButton).toBe("잘 모르겠어요");
    expect(V40_COPY.question.notApplicableButton).toBe("제 상황과 안 맞아요");
    expect(V40_COPY.question.recallNoneOption).toBe("이런 일이 없었어요");
    expect(V40_COPY.rest.saved).toBe("여기까지 저장했어요. 쉬었다 와도 돼요.");
    expect(V40_COPY.rest.autosaveOff).toBe("쉬었다 오려면 자동 저장을 켜 주세요.");
    expect(V40_COPY.wrapUp.intro).toBe("마지막 정리예요. 하나씩만 더 골라 주세요.");
    expect(V40_COPY.progress.sectionAnnouncements[1]).toBe("지금 두 번째 구간이에요");
    expect(V40_COPY.progress.segmentNames).toEqual(["처음", "이어서", "조금만 더", "마지막 구간", "마지막 정리"]);
    // 쉬는 카드는 구간 0, 1, 2 뒤에만 있다(V40_COUNTS.restCards). 쉬는 카드에는 몇 번째 구간이라는 순서 낱말을 쓰지 않는다
    // (진행 막대가 구간 이름 처음, 이어서, 조금만 더로 부르므로 같은 자리를 두 가지 이름으로 부르게 된다).
    expect(V40_COUNTS.restCards).toBe(3);
    expect("restSectionDone" in copyExports).toBe(false);
    for (const leaf of copyLeaves(V40_COPY.rest, "rest")) expect(leaf.text, leaf.path).not.toMatch(/번째/u);
  });

  it("결과 화면의 제목과 품질 안내와 취향 카드", () => {
    expect(V40_COPY.result.title).toBe("웨딩코드 · 내 결과");
    expect(V40_COPY.result.evenMark).toBe("반반");
    expect(V40_COPY.result.evenCodeNote).toBe("어느 쪽으로도 크게 기울지 않은 주제는 「반반」으로 적었어요.");
    // 세기를 낮추는 것이지 글자를 낮추는 것이 아니다. 결과 화면의 고지가 이미 「다시 하면 글자가 달라질 수 있어요」를 말해서 되풀이하지 않는다.
    // 세기라는 낱말은 화면 어디서도 풀어 주지 않으므로 두 안내가 세 낱말을 직접 보여 준다. 질문을 탓하는 말(반복해서 눌렀어요)과 늘(항상)이라는 과장이 없다.
    expect(V40_COPY.quality.rhythmHint).toBe(
      "답이 같은 위치에 여러 번 몰렸어요. 그래서 이번에는 글자 옆 표시(뚜렷해요, 기울어요, 반반이에요)를 모두 한 단계 낮춰 적었어요. 천천히 다시 해 볼 수도 있어요.",
    );
    expect(V40_COPY.quality.skipHint).toBe(
      "잘 모르겠다고 넘어간 질문이 많아서 이번에는 글자 옆 표시(뚜렷해요, 기울어요, 반반이에요)를 모두 한 단계 낮춰 적었어요.",
    );
    expect(V40_COPY.quality.rhythmHint).not.toContain("글자가 달라질");
    for (const hint of [V40_COPY.quality.rhythmHint, V40_COPY.quality.skipHint]) {
      for (const word of Object.values(V40_STRENGTH).map((info) => info.label)) expect(hint, word).toContain(word);
      expect(hint).not.toMatch(/눌렀어요|늘 /u);
    }
    expect(V40_COPY.gate.rhythmBody).toBe("답이 같은 위치에 몰려 있어서 이번에는 글자를 정하지 못했어요. 처음부터 다시 해 볼 수 있어요.");
    expect(V40_COPY.gate.rhythmBody).not.toMatch(/늘 /u);
    // 관문 제목은 본문 첫 문장과 같은 말로 시작하지 않는다.
    expect(V40_COPY.gate.title).toBe("이번에는 코드가 나오지 않았어요");
    expect(V40_COPY.gate.rhythmBody.startsWith(V40_COPY.gate.title)).toBe(false);
    expect(V40_COPY.gate.noInformationBody).toBe(
      "답할 수 있는 질문이 적거나 두 쪽이 똑같이 나와서 이번에는 글자를 정하지 못했어요. 넘어간 질문을 다시 보거나 처음부터 다시 답할 수 있어요.",
    );
    expect(V40_COPY.gate.noLinkNote).toBe("코드가 없어서 보낼 링크도 만들지 않았어요.");
    expect(V40_COPY.quality.omitted).toBe("넘어간 질문은 계산에서 뺐어요.");
    // 글자를 못 정한 주제: 이유는 「답을 모아 보니」 문장, 다시 보기는 주제 블록, 품질 안내는 코드 줄의 「·」 설명으로 서로 다른 말을 한다.
    expect(V40_COPY.quality.unusableAxis).toBe("글자를 정하지 못한 주제는 코드에 「·」로 적었어요.");
    expect(V40_COPY.block.unusableNote).toBe("넘어간 질문이 있다면 다시 볼 수 있어요.");
    expect(V40_COPY.block.unusableNote).not.toBe(V40_COPY.quality.unusableAxis);
    // 글자를 못 정한 이유가 「제 상황과 안 맞아요」뿐이면 넘어간 질문 다시 보기(그 질문은 나오지 않는다) 대신 이 주제 답 다시 보기를 말한다.
    expect(V40_COPY.block.unusableNoteNotApplicable).toBe("「제 상황과 안 맞아요」로 넘어간 질문은 「이 주제 답 다시 보기」에서 다시 답할 수 있어요.");
    expect(V40_COPY.block.unusableNoteNotApplicable).not.toContain("넘어간 질문 다시 보기");
    // 다시 볼 넘어간 질문이 없을 때의 관문 문장은 없는 단추(넘어간 질문 다시 보기)를 권하지 않는다.
    expect(V40_COPY.gate.noInformationBodyRestartOnly).not.toContain("다시 보거나");
    expect(V40_COPY.gate.noInformationBodyRestartOnly).toContain("처음부터 다시 답할 수 있어요");
    // 힌트가 세기를 낮춰서 반반이에요가 된 주제는 「크게 기울지 않았어요」라고 하지 않는다(낮추기 전에는 한쪽으로 기울어 있었다).
    expect(V40_COPY.result.evenCodeNoteLowered).toBe("「반반」은 어느 쪽으로도 크게 기울지 않았거나, 세기를 한 단계 낮춘 주제예요.");
    expect(collectedSentence("money", "V", "even", true)).toBe("돈은 세기를 한 단계 낮춰 「반반이에요」로 적었어요.");
    expect(collectedSentence("support", "H", "even", true)).toBe("지쳤을 때는 세기를 한 단계 낮춰 「반반이에요」로 적었어요.");
    expect(strengthSentence("money", "V", "even", true)).toBe(
      "세기를 한 단계 낮춰 「반반이에요」로 적었어요. 고른 답은 아래에 그대로 보여 드려요. 코드에는 한 글자만 적을 수 있어서 「V 조건 먼저」를 적었어요.",
    );
    for (const axis of V40_AXES) {
      for (const letter of [axis.front, axis.back]) {
        const lowered = [collectedSentence(axis.key, letter, "even", true), strengthSentence(axis.key, letter, "even", true), V40_COPY.result.evenCodeNoteLowered];
        for (const text of lowered) {
          expect(text).not.toContain("어느 쪽으로도 크게 기울지 않았어요");
          expect(text).not.toContain("쪽으로 답했어요");
        }
        // 낮추지 않은 문장은 그대로다
        expect(collectedSentence(axis.key, letter, "even", false)).toBe(collectedSentence(axis.key, letter, "even"));
        expect(strengthSentence(axis.key, letter, "even", false)).toBe(strengthSentence(axis.key, letter, "even"));
      }
    }
    expect(evenOneSidedLine("H")).toBe("고른 답은 「H 마음 먼저」 쪽에만 있었지만 모인 정도가 약해서 한쪽으로 기울었다고 보지는 않았어요.");
    // 형식 안내가 앞말이 이미 한 말이면 되풀이하지 않는다(「6칸」은 앞말의 「여섯 칸」과 같은 말이다)
    const splitGuide = V40_COPY.question.guides.split;
    expect(formatGuideRepeatsStem(splitGuide, "오늘 정말 힘들었다고 털어놓았어요. 여섯 칸을 나눠 놓아 주세요. 한 곳에 몰아도 괜찮아요.")).toBe(true);
    expect(formatGuideRepeatsStem(splitGuide, "어떤 반응이 반가운지 정해 주세요.")).toBe(false);
    expect(formatGuideRepeatsStem(splitGuide, "여섯 칸을 나눠 놓아 주세요.")).toBe(false);
    expect(formatGuideRepeatsStem(V40_COPY.question.guides.pair, "더 나 같은 쪽을 골라 주세요.")).toBe(false);
    expect(formatGuideRepeatsStem("", "아무 앞말")).toBe(false);
    // 「앞 글자」는 코드의 첫 글자로 읽힐 수 있어서, 표에서 어디에 있는 글자인지로 말한다(표의 앞 글자 칸이 왼쪽이다).
    expect(V40_COPY.quality.provisional).toBe("두 쪽이 똑같이 나와서, 글자 읽는 법 표에서 왼쪽에 있는 글자를 임시로 적었어요.");
    expect(V40_COPY.legend.frontColumn).toBe("앞 글자");
    expect(V40_COPY.taste.title).toBe("결혼식 모습도 골라 볼까요? (선택)");
    expect(V40_COPY.taste.newTabHint).toBe("새 탭에서 열려요");
    expect(V40_COPY.copyCode.button).toBe("코드 복사");
    expect(V40_COPY.copyCode.hint).toBe(
      "글자와 뜻, 세기만 복사하고 내 답은 넣지 않아요. 복사한 글은 상대가 답하기 전에는 보내지 않는 게 좋아요. 내 글자를 먼저 보면 답이 끌릴 수 있어요.",
    );
  });

  it("주제 블록 예시(코드 SWUA)와 같은 문장", () => {
    expect(meaningLine("S")).toBe("S는 돈이 걸린 결정에서 결혼식이 끝난 뒤 남을 장면과 분위기를 먼저 그려 보고 정해요.");
    expect(oppositeMeaningLine("S")).toBe("반대쪽 V는 돈이 걸린 결정에서 총액, 한도, 계약 조건 같은 숫자를 먼저 맞춰 보고 정해요.");
    expect(letterHeading("S", "lean")).toBe("S 장면 먼저 · 기울어요");
    expect(strengthSentence("money", "S", "lean")).toBe("이 주제에서는 대체로 이쪽으로 답했어요. 뚜렷하게 한쪽으로 모인 정도는 아니에요.");
    expect(strengthSentence("process", "W", "clear")).toBe("이 주제에서는 답이 한쪽으로 뚜렷하게 모였어요.");
    expect(strengthSentence("support", "A", "even")).toBe(
      "「H 마음 먼저」와 「A 할 일 먼저」 중 어느 쪽으로도 크게 기울지 않았어요. 코드에는 한 글자만 적을 수 있어서 「A 할 일 먼저」를 적었어요.",
    );
    expect(meaningLine("H")).toBe("H는 지치고 힘든 날, 해결보다 마음을 알아주는 게 먼저인 쪽이에요.");
    expect(meaningLine("A")).toBe("A는 지치고 힘든 날, 할 일을 정리하고 덜어 내는 게 먼저인 쪽이에요.");
    expect(evenSideAnswersHeading("H")).toBe("H 마음 먼저 쪽으로 고른 답");
    expect(talkLine("S")).toBe("둘이 이야기해 봐요: 마음이 움직여도 꼭 확인하고 싶은 조건이 있나요?");
    expect(tryLine("S")).toBe("이렇게 해 봐요: 계약 조건은 서면으로 받아 두세요. 마음에 드는 곳을 고를 때도 든든해요.");
    expect(V40_COPY.block.answersMineHeading).toBe("내가 고른 답");
    expect(V40_COPY.block.answersOppositeHeading).toBe("반대로 고른 답");
    expect(V40_COPY.block.moreToggle).toBe("더 보기");
    expect(V40_COPY.block.appearancesHeading).toBe("이렇게 나타날 수 있어요");
    expect(V40_COPY.block.reviewAxisButton).toBe("이 주제 답 다시 보기");
  });

  it("반대로 고른 답이 없다는 줄은 뚜렷하게 반대로 고른 것이 없다는 뜻으로만 말한다", () => {
    // 반대쪽 답은 값이 3 이상인 것만 뽑으므로(quote.pickQuotes) 약하게 반대로 고른 답은 있을 수 있다. 「없었어요」만 쓰면 거짓이다.
    expect(V40_COPY.block.noOppositeLine).toBe("반대로 뚜렷하게 고른 답은 없었어요.");
    expect(V40_COPY.block.noOppositeLine).toContain("뚜렷하게");
    expect(V40_COPY.block.noAnswersLine).toBe("보여 줄 답이 없어요.");
    expect(V40_COPY.block.evenAppearancesNote).toBe("두 글자 모두 이런 모습으로 나타날 수 있어요.");
  });

  it("세기 문장은 채점이 실제로 낼 수 있는 경우에도 참이다(기울어요에 반대쪽 답이 없어도, 반반이에요가 한쪽 약한 답이어도)", () => {
    // 기울어요는 모든 답이 한쪽으로 약하게만 있어도 나온다(반대쪽 답 0개). 그래서 「반대쪽으로 고른 답도 있었어요」를 말하지 않는다.
    expect(V40_STRENGTH.lean.sentence).not.toMatch(/반대쪽으로 고른 답도/u);
    expect(V40_COPY.legend.strengthGuide.lean).not.toMatch(/반대쪽|고른 답도 있었/u);
    expect(V40_STRENGTH.lean.sentence).toContain("뚜렷하게 한쪽으로 모인 정도는 아니에요");
    expect(V40_COPY.legend.strengthGuide.lean).toBe("기울어요: 대체로 한쪽으로 답했지만 뚜렷하게 모인 정도는 아니에요.");
    // 반반이에요는 두 쪽이 비슷했다는 말을 하지 않는다(가운데 칸만 눌렀거나, 한쪽 약한 답이거나, 힌트로 한 단계 내려간 경우에도 나온다).
    expect(V40_COPY.legend.strengthGuide.even).toBe("반반이에요: 어느 쪽으로도 크게 기울지 않았어요.");
    for (const axis of V40_AXES) {
      for (const shown of [axis.front, axis.back]) {
        const text = strengthSentence(axis.key, shown, "even");
        expect(text, `${axis.key} ${shown}`).not.toMatch(/비슷하게|거의|똑같이|같은 만큼|다른 날/u);
        expect(text, `${axis.key} ${shown}`).toContain("어느 쪽으로도 크게 기울지 않았어요");
        // 글자는 늘 이름과 함께 적는다(글자만 덩그러니 적지 않는다).
        expect(text, `${axis.key} ${shown}`).toContain(`코드에는 한 글자만 적을 수 있어서 「${legendLetterCell(shown)}」를 적었어요.`);
        expect(text).toContain(`「${legendLetterCell(axis.front)}」와 「${legendLetterCell(axis.back)}」 중 어느 쪽으로도`);
      }
    }
    expect(V40_COPY.result.evenCodeNote).not.toMatch(/비슷하게/u);
    // 한 화면에 반반이에요 주제가 여럿이어도 같은 「다른 날에는 …가 나올 수 있어요」가 주제마다 되풀이되지 않는다.
    const evenTexts = V40_AXES.map((axis) => strengthSentence(axis.key, axis.front, "even"));
    for (const text of evenTexts) expect(text).not.toContain("나올 수 있어요");
  });

  it("직접 고른 쪽 대비", () => {
    expect(selfContrastSentence({ selfLetter: "F", gatheredLetter: "U", gatheredBand: "clear" })).toBe(
      "마지막에 직접 고른 쪽은 「F 가족과 정하기」였어요. 여러 질문에서 고른 답은 「U 둘이 정하기」 쪽으로 뚜렷하게 모였어요. 어느 쪽이 지금 나에게 더 가까운지 둘이 이야기해 봐도 좋아요.",
    );
    expect(selfContrastSentence({ selfLetter: "F", gatheredLetter: "U", gatheredBand: "lean" })).toBe(
      "마지막에 직접 고른 쪽은 「F 가족과 정하기」였어요. 여러 질문에서 고른 답은 「U 둘이 정하기」 쪽으로 대체로 모였어요. 어느 쪽이 지금 나에게 더 가까운지 둘이 이야기해 봐도 좋아요.",
    );
    expect(V40_COPY.block.selfChoiceHeading).toBe("직접 고른 쪽");
  });

  it("마지막에 직접 고른 쪽 줄: 글자와 이름, 세기 낱말만 적고 모은 답과 견주지 않는다", () => {
    expect(selfChoiceLine({ axis: "process", side: "back", letter: "D", level: 3 })).toBe("내가 마지막에 직접 고른 쪽: 「D 나눠 하기」 · 아주 가까워요");
    expect(selfChoiceLine({ axis: "money", side: "front", letter: "V", level: 2 })).toBe("내가 마지막에 직접 고른 쪽: 「V 조건 먼저」 · 꽤 가까워요");
    expect(selfChoiceLine({ axis: "support", side: "front", letter: "H", level: 1 })).toBe("내가 마지막에 직접 고른 쪽: 「H 마음 먼저」 · 조금 가까워요");
    expect(V40_COPY.block.selfLineLeadLabel).toBe("내가 마지막에 직접 고른 쪽");
    // 세기 낱말은 고른 답 덧말과 같은 낱말이다(같은 뜻을 화면 두 곳에서 다르게 적지 않는다).
    expect(V40_QUOTE_TEMPLATES.pairStrongSuffix).toBe(` (${selfLevelPhrase(3)})`);
    expect(V40_QUOTE_TEMPLATES.reactNearSuffix).toBe(` (${selfLevelPhrase(1)})`);
    expect([1, 2, 3].map((level) => selfLevelPhrase(level as 1 | 2 | 3))).toEqual(["조금 가까워요", "꽤 가까워요", "아주 가까워요"]);
    // 모은 답 쪽 낱말, 판단, 원인, 숫자가 없다.
    for (const axis of V40_AXES) {
      for (const letter of [axis.front, axis.back]) {
        for (const level of [1, 2, 3] as const) {
          const line = selfChoiceLine({ axis: axis.key, side: letter === axis.front ? "front" : "back", letter, level });
          expect(line).not.toMatch(/모였|모은|여러 질문|뚜렷|기울|반반|당신|때문|그래서|진짜|숨은|속마음|무의식|모순|일관|\d/u);
          expect(line.split("「")).toHaveLength(2);
        }
      }
    }
  });

  it("마지막에 직접 고른 쪽 줄: 잘못된 세기나 그 주제의 글자가 아닌 글자는 던진다", () => {
    expect(() => selfLevelPhrase(0 as 1)).toThrow(RangeError);
    expect(() => selfLevelPhrase(4 as 3)).toThrow(RangeError);
    expect(() => selfChoiceLine({ axis: "money", side: "back", letter: "D", level: 2 })).toThrow(RangeError);
    expect(() => selfChoiceParts({ axis: "money", side: "back", letter: "D", level: 2 })).toThrow(RangeError);
  });

  it("내가 마지막에 직접 고른 쪽 줄: 세 덩어리(머리말, 글자와 이름, 세기 낱말)로 나뉘고 덩어리를 공백으로 이으면 줄 전체다", () => {
    const line = { axis: "process", side: "back", letter: "D", level: 3 } as const;
    expect(selfChoiceParts(line)).toEqual({ label: "내가 마지막에 직접 고른 쪽:", pick: "「D 나눠 하기」 ·", level: "아주 가까워요" });
    for (const axis of V40_AXES) {
      for (const letter of [axis.front, axis.back]) {
        for (const level of [1, 2, 3] as const) {
          const each = { axis: axis.key, side: letter === axis.front ? "front" : "back", letter, level } as const;
          const parts = selfChoiceParts(each);
          expect(selfChoiceLine(each), `${axis.key} ${letter} ${level}`).toBe(`${parts.label} ${parts.pick} ${parts.level}`);
          // 글자 이름은 낫표 안에 있고, 세기 낱말은 낫표 밖의 끝에 있다.
          expect(parts.pick).toBe(`「${legendLetterCell(letter)}」 ·`);
          expect(parts.level).toBe(selfLevelPhrase(level));
        }
      }
    }
    // 머리말은 본인이 고른 것임을 「내가」로 밝힌다(시스템이 세는 문장이 아니다).
    expect(V40_COPY.block.selfLineLeadLabel.startsWith("내가 ")).toBe(true);
  });

  it("지난번과 비교", () => {
    expect(historyLead("9월 29일", true)).toBe("지난번(9월 29일)과 달라진 글자가 있어요.");
    // 글자는 이름과 함께 적는다(글자만 적으면 어떤 뜻인지 알 수 없다).
    expect(historyChangedLine("money", "V", "S")).toBe("돈을 정할 때는 「V 조건 먼저」에서 「S 장면 먼저」로 바뀌었어요.");
    // 주제 이름 뒤에 은, 는이 받침에 맞게 붙는다.
    expect(historyChangedLine("process", "W", "D")).toBe("준비를 굴릴 때는 「W 같이 하기」에서 「D 나눠 하기」로 바뀌었어요.");
    expect(historyChangedLine("scope", "U", "F")).toBe("함께 정하는 사람은 「U 둘이 정하기」에서 「F 가족과 정하기」로 바뀌었어요.");
    expect(historyChangedLine("support", "H", "A")).toBe("지쳤을 때는 「H 마음 먼저」에서 「A 할 일 먼저」로 바뀌었어요.");
    // 바뀐 것이 없다고 해도 반반이에요가 낀 주제는 글자가 달라 보일 수 있다. 표에 다른 글자가 보이는데 「달라진 글자가 없어요」라고 하면
    // 스스로 어긋나므로 무엇을 기준으로 봤는지(두 번 모두 뚜렷하거나 기울었는데 글자가 달라진 주제)를 말한다.
    expect(historyLead("9월 29일", false)).toBe(
      "지난번(9월 29일)과 비교했어요. 두 번 모두 뚜렷하거나 기울었는데 글자가 달라진 주제는 없어요.",
    );
    expect(historyLead("", false)).toBe("지난번과 비교했어요. 두 번 모두 뚜렷하거나 기울었는데 글자가 달라진 주제는 없어요.");
    expect(historyLead("9월 29일", false)).not.toContain("글자가 같아요");
    expect(historyLead("9월 29일", false)).not.toMatch(/달라진 글자는 없|달라졌다고 볼 만한 글자는 없/u);
    expect(historyLead("", true)).toBe("지난번과 달라진 글자가 있어요.");
    expect(V40_COPY.history.changedTag).toBe("달라졌어요");
    expect(V40_COPY.history.unstableTag).toBe("지난번이나 이번이 반반이에요");
    expect(V40_COPY.history.unstableNote).toBe("지난번이나 이번이 반반이면 글자 변화로 해석하지 않아요.");
    expect(historyCell("S", "lean", false)).toBe("S 장면 먼저 · 기울어요");
    expect(historyCell("A", "even", true)).toBe("A 할 일 먼저 · 반반이에요 · 임시");
    expect(historyCell(null, null, false)).toBe("정하지 못했어요");
    // 잘못된 글자 쌍은 거절한다.
    expect(() => historyChangedLine("money", "W", "S")).toThrow(RangeError);
  });

  it("보내기 블록과 보낼 말", () => {
    expect(V40_COPY.send.withAnswersOption).toBe("파트너와 비교하기");
    expect(V40_COPY.send.questionsOnlyOption).toBe("테스트 질문만 보내기");
    expect(V40_COPY.send.withAnswersHelp).toBe(
      "내 답이 포함된 초대 링크예요. 상대가 이 링크에서 답하면 두 사람 결과가 열려요. 내 화면에는 자동으로 나타나지 않으니, 상대가 두 사람 결과 링크를 다시 보내 줘야 나도 볼 수 있어요.",
    );
    expect(V40_COPY.send.questionsOnlyHelp).toBe("내 답은 들어 있지 않아요. 상대는 혼자 답하고 자기 결과만 봐요. 두 사람 비교는 만들어지지 않아요.");
    expect(V40_COPY.send.consent).toBe("링크를 받은 사람은 누구나 내 답을 읽을 수 있다는 걸 알아요. 상대에게만 보낼게요.");
    expect(V40_COPY.send.messageWithAnswers).toBe(
      "웨딩코드에 먼저 답해 봤어요. 이 링크에서 답하면 우리 결과가 나란히 보여요. 다 마치면 ‘두 사람 결과 링크 보내기’를 눌러 저에게도 보내 주세요.",
    );
    expect(V40_COPY.send.messageQuestionsOnly).toBe("같은 웨딩코드 질문에 각자 답해 볼까요? 이 링크에는 제 답이 없어요. 다 마치면 서로 결과를 보여 줘요.");
    expect(V40_COPY.send.copied).toBe("링크를 복사했어요. 상대와의 대화창에 붙여 넣어 주세요.");
    // 마우스로 선택해 복사하는 화면에서도 맞는 말이다(「길게 눌러」는 휴대폰에서만 맞는다).
    expect(V40_COPY.send.manualCopy).toBe("아래 주소를 선택해서 복사해 주세요");
    expect(V40_COPY.send.manualCopy).not.toContain("길게 눌러");
    expect(V40_COPY.send.shareSheetInfo).toBe("휴대폰에서는 공유 창이 열려요. 열리지 않으면 주소를 복사할 수 있게 보여 줘요.");
    // 되돌릴 수 없다는 안내는 답이 든 링크(내 답과 함께 보내기)에만 붙는다. 질문만 보내기의 링크에는 답이 없어서 겁을 줄 까닭이 없다.
    expect(V40_COPY.send.withAnswersLinkInfo).toBe("보낸 링크는 되돌릴 수 없고, 답을 고쳐 새 링크를 만들어도 예전 링크는 남아요.");
    expect(V40_COPY.send.withAnswersLinkInfo).not.toContain("읽을 수 있");
    expect("anyoneCanReadInfo" in V40_COPY.send).toBe(false);
    expect("oldLinksRemainInfo" in V40_COPY.send).toBe(false);
    // 질문만 보내기의 「답이 없다」는 라디오 도움말 하나가 말한다. 같은 사실의 안내 문장은 따로 두지 않는다.
    expect("questionsOnlyInfo" in V40_COPY.send).toBe(false);
    expect(V40_COPY.send.disabledReason).toBe("위 칸에 체크하면 보낼 수 있어요.");
    expect(V40_COPY.send.linkFailed).toBe("링크를 만들지 못했어요. 다시 눌러 주세요.");
  });

  it("보낼 말에는 내 글자도 고지 문장도 들어 있지 않고, 왕복 사실을 말한다", () => {
    const messages = [V40_COPY.send.messageWithAnswers, V40_COPY.send.messageQuestionsOnly, V40_COPY.coupleSend.message];
    for (const message of messages) {
      expect(message, message).not.toMatch(/[A-Za-z]/u);
      expect(message, message).not.toContain(V40_NOT_VALIDATED_PHRASE);
    }
    // 보내는 사람이 두 사람 결과를 보려면 상대가 결과 링크를 돌려보내야 한다는 사실이 세 곳에 모두 있다.
    expect(V40_COPY.send.withAnswersHelp).toContain("두 사람 결과 링크를 다시 보내 줘야");
    expect(V40_COPY.send.messageWithAnswers).toContain("‘두 사람 결과 링크 보내기’를 눌러 저에게도 보내 주세요");
    expect(V40_COPY.intro.title.length).toBeGreaterThan(0);
    expect(introBullets("on")[3]).toContain("두 사람 결과 링크를 다시 보내 주면");
    expect(V40_COPY.coupleSend.help).toContain("이 링크를 보내면 두 사람의 답을 나란히 볼 수 있어요");
  });

  it("링크를 보내는 말에는 가리키는 것이 불분명한 말과 어색한 말이 없다", () => {
    const sending = [
      ...copyLeaves(V40_COPY.send, "send"),
      ...copyLeaves(V40_COPY.coupleSend, "coupleSend"),
      ...copyLeaves(V40_COPY.copyCode, "copyCode"),
    ];
    for (const leaf of sending) {
      // 「그 결과 링크」「이걸」은 무엇을 가리키는지 알 수 없다. 「자기 코드만 받아요」는 코드를 받는다는 어색한 말이다. 「길게 눌러」는 휴대폰에서만 맞다.
      expect(leaf.text, leaf.path).not.toMatch(/그 결과 링크|이걸|자기 코드|길게 눌러/u);
    }
  });

  it("받는 사람 화면", () => {
    expect(V40_COPY.receive.title).toBe("상대가 웨딩코드를 보냈어요");
    expect(V40_COPY.receive.lead).toBe(
      "먼저 내 답을 마치면 두 사람 결과를 나란히 볼 수 있어요. 링크 안에는 상대의 답이 들어 있어요. 내가 마치기 전에는 화면에 나오지 않게 해 뒀어요.",
    );
    expect(receiveStorage("on")).toBe(
      "질문은 모두 68개예요. 답은 웨딩한방에 보내지 않고 이 브라우저에 30일 동안 저장돼요. 카카오톡 같은 앱 안에서 열었다면 다음에도 같은 곳에서 열어야 이어서 할 수 있어요. 웨딩코드는 상대의 답을 이 브라우저에 저장하지 않아요. 받은 링크는 받은 곳에서 지우기 전까지 남아 있어요. 끝까지 마쳤는지 같은 이용 통계만 남겨요.",
    );
    expect(V40_COPY.receive.scope).toBe("식을 올리지 않아도, 부모님이 안 계셔도, 재혼이어도 답할 수 있어요.");
    expect(V40_COPY.receive.answerButton).toBe("나도 답해 보기");
    expect(V40_COPY.receive.reloadNote).toBe("이 화면을 새로고침하면 상대의 답이 화면에서 사라져요. 그럴 때는 받은 링크를 다시 열어 주세요.");
    expect(V40_COPY.receive.noCompareNote).toBe("이번에는 글자를 정하지 못해서 두 사람 결과를 만들 수 없어요. 처음부터 다시 답해 볼 수 있어요.");
    expect(V40_COPY.receive.noCompareRestartButton).toBe(V40_COPY.manage.restart.button);
    // 두 사람 결과가 없는 화면은 「우리 둘의 웨딩코드」라는 결과 제목을 쓰지 않는다.
    expect(V40_COPY.receive.noCompareTitle).toBe("두 사람 결과를 만들지 못했어요");
    expect(V40_COPY.receive.noCompareTitle).not.toBe(V40_COPY.couple.title);
    expect(V40_COPY.receive.ownAnswersNote).toBe("내 답도 내가 링크를 보내기 전에는 상대에게 가지 않아요.");
    expect(V40_COPY.error.brokenLink.notice).toBe("링크를 읽지 못했어요. 처음부터 시작할 수 있어요.");
  });

  it("질문에 답하는 동안의 받은 링크 안내는 질문 묶음에 있고 새로고침 경고를 함께 말한다", () => {
    expect(V40_COPY.question.receivedNote).toContain("상대가 보낸 링크로 열었어요");
    expect(V40_COPY.question.receivedNote).toContain("새로고침하면 상대의 답이 화면에서 사라져요");
    expect(V40_COPY.question.receivedNote).toContain("받은 링크를 다시 열어 주세요");
    // 받는 사람 묶음에는 이 문장이 없다(그 묶음은 고지 문장이 있어서 질문 화면에 끌어오면 고지 수 규칙이 깨진다).
    expect("inProgressNote" in V40_COPY.receive).toBe(false);
    expect(V40_COPY.question.receivedNote).not.toContain(V40_NOT_VALIDATED_PHRASE);
  });

  it("저장이 안 될 때의 안내는 사실대로 말하고, 창끼리 어긋났을 때는 고를 단추가 있다", () => {
    // 저장 계약: 다른 창이 쓴 것을 지우지 않고 이 창의 저장을 거절한다. 그래서 「덮어써요」라고 말하지 않는다.
    // 두 단추가 각각 무엇을 버리는지 누르기 전에 말한다.
    expect(V40_COPY.storageNotice.conflict).toBe(
      "다른 창에서 저장된 답이 바뀌었어요. 그 답이 사라지지 않도록 이 창의 자동 저장을 멈췄어요. 저장된 답을 불러오면 이 창에서 넘긴 답은 쓰이지 않고, 이 창의 답으로 저장하면 다른 창에서 저장한 답은 사라져요.",
    );
    expect(V40_COPY.storageNotice.conflict).not.toMatch(/덮어/u);
    expect(V40_COPY.storageNotice.loadSavedButton).toBe("저장된 답 불러오기");
    expect(V40_COPY.storageNotice.keepThisButton).toBe("이 창의 답으로 저장하기");
    expect(V40_COPY.leave.autosaveOnNote).toBe("지금 나가도 다음을 눌러 넘긴 답까지는 이 브라우저에 저장돼 있어요. 다음에 이어서 할 수 있어요.");
    expect(V40_COPY.error.boundary.body).toBe(
      "새로고침해 보세요. 자동 저장을 켜 두었다면 넘긴 답까지는 이 브라우저에 남아 있어요. 상대가 보낸 링크로 열었다면 받은 링크를 다시 열어 주세요.",
    );
    // 소개 화면으로 돌아가는 길이 없다(첫 질문 화면에서 이전은 무시된다). 나가기 확인 창과 결과에서 돌아가는 알림은 만들지 않았다.
    expect("backToIntroNote" in V40_COPY.leave).toBe(false);
    expect(Object.keys(V40_COPY.leave).sort()).toEqual(["autosaveOffNote", "autosaveOnNote"]);
    // 쉬는 카드도 저장이 막혔거나 어긋났다는 말을 보일 수 있어야 「여기까지 저장했어요」가 거짓이 되지 않는다.
    expect(V40_COPY_SCREENS.rest).toContain("storageNotice");
  });

  it("이어 하기 카드와 초대 링크 충돌 카드", () => {
    expect(V40_COPY.intro.resume.body).toBe("저장해 둔 곳부터 이어서 할 수 있어요. 처음부터 다시 하면 저장된 답은 지워져요.");
    expect(V40_COPY.intro.resume.continueButton).toBe(V40_COPY.rest.continueButton);
    expect(V40_COPY.intro.inviteConflict.title).toBe("하던 답을 이어서 할까요?");
    expect(V40_COPY.intro.inviteConflict.body).toBe(
      "이 브라우저에 하던 답이 남아 있어요. 이어서 해도 상대가 보낸 링크의 답은 그대로 쓰여요. 받은 링크로 처음부터 하면 하던 답은 지워져요.",
    );
    expect(V40_COPY.intro.inviteConflict.keepMineButton).toBe("하던 답 이어서 하기");
    expect(V40_COPY.intro.inviteConflict.useLinkButton).toBe("받은 링크로 처음부터 하기");
    expect(V40_COPY.intro.legacy.body).toBe("질문이 바뀌어서 새 웨딩코드로 옮길 수는 없어요. 새 질문에 처음부터 답하면 돼요.");
    expect(V40_COPY.error.brokenLink.body).toBe("링크가 중간에 잘렸거나 예전 웨딩코드에서 만든 링크일 수 있어요. 보낸 사람에게 링크를 다시 받아 보세요.");
  });

  it("두 사람 결과", () => {
    expect(V40_COPY.couple.title).toBe("우리 둘의 웨딩코드");
    expect(V40_COPY.couple.perspective.groupLabel).toBe("나 기준으로 보기");
    expect(V40_COPY.couple.tagLabels).toEqual({ same: "같은 글자", different: "다른 글자", even: "한쪽 또는 둘 다 반반이에요" });
    expect(coupleTagNote("money", "different", false)).toBe("돈을 정할 때 무엇부터 보는지가 다를 수 있어요.");
    expect(coupleTagNote("process", "different", false)).toBe("준비를 굴리는 방식이 다를 수 있어요.");
    expect(coupleTagNote("scope", "different", false)).toBe("누구까지 함께 정할지가 다를 수 있어요.");
    expect(coupleTagNote("support", "different", false)).toBe("지친 날 필요한 도움이 다를 수 있어요.");
    expect(coupleTagNote("money", "same", false)).toBe(`${V40_SAME_LETTER_NOTE}.`);
    expect(V40_SAME_LETTER_NOTE).toBe("같은 쪽이어도 이유는 다를 수 있어요");
    expect(coupleTagNote("money", "even", false)).toBe(V40_COPY.couple.evenTagNote);
    expect(coupleTagNote("money", "same", true)).toBe(V40_COPY.couple.excludedTagNote);
    expect(V40_COPY.couple.talk.title).toBe("먼저 이야기해 볼 질문");
    expect(V40_COPY.couple.talk.lead).toBe("이 질문에서는 두 사람이 다르게 골랐어요. 다른 날에는 다르게 고를 수도 있어요.");
    expect(V40_COPY.couple.similar.title).toBe("이미 비슷하게 고른 질문");
    expect(Object.keys(V40_COPY.couple.talk.opening)).toEqual([...V40_AXIS_KEYS]);
    expect(V40_COPY.couple.notice).toBe(
      "새로 만든 질문이라 아직 여러 사람에게 확인해 보지 못했어요. 검증을 마친 심리검사가 아니고, 다시 하면 글자가 달라질 수 있어요. 글자가 같은지 다른지로 두 사람을 평가하지 않아요. 이야기를 꺼낼 실마리만 보여 줘요.",
    );
    expect(V40_COPY.couple.perspective.askNote).toBe("어느 쪽이 나인지 이 브라우저에서는 알 수 없어요. 직접 골라 주세요.");
    expect(V40_COPY.couple.perspective.autoNote).toBe("이 브라우저에 저장된 내 답과 같아서 「나」로 표시했어요.");
    // 누르면 지금 보던 결과가 닫히므로 단추 이름은 「처음부터」를 빼고, 닫힌다는 것을 바로 아래에서 말한다.
    expect(V40_COPY.couple.startOwnButton).toBe("내 웨딩코드 해 보기");
    expect(V40_COPY.couple.startOwnNote).toBe("누르면 이 결과 화면은 닫혀요. 다시 보려면 받은 링크를 다시 열어 주세요.");
    expect(V40_COPY.couple.bothTopic).toBe("둘 다");
    expect(V40_COPY.couple.viewpointNote).toBe("질문에 나오는 「상대」는 각자 자기 곁의 사람이에요.");
    expect(V40_COPY.coupleSend.title).toBe("상대에게 두 사람 결과 보내기");
    // 두 사람의 답이 링크에 든다는 말은 바로 아래 체크 문장이 하므로 도움말은 되풀이하지 않는다.
    expect(V40_COPY.coupleSend.help).toBe("상대에게는 결과가 자동으로 뜨지 않아요. 이 링크를 보내면 두 사람의 답을 나란히 볼 수 있어요.");
    expect(V40_COPY.coupleSend.help).not.toContain("들어 있어요");
    expect(V40_COPY.coupleSend.disabledReason).toBe("위 칸 두 개에 모두 체크하면 보낼 수 있어요.");
    expect(V40_COPY.coupleSend.message).toBe("우리 둘의 웨딩코드 결과예요. 링크를 열면 나란히 볼 수 있어요.");
    expect(V40_COPY.coupleSend.consentAllAnswers).toBe("이 링크에 두 사람의 답이 모두 들어 있다는 걸 알아요.");
    // 이 화면의 사람은 다른 사람의 동의를 알 수 없으므로 「먼저 답한 사람도 동의했어요」를 체크로 받지 않는다. 자기가 지킬 수 있는 약속만 받는다.
    expect(V40_COPY.coupleSend.consentSelf).toBe("이 링크는 상대에게만 보낼게요.");
    expect("consentFirstPerson" in V40_COPY.coupleSend).toBe(false);
    for (const leaf of copyLeaves(V40_COPY.coupleSend, "coupleSend")) {
      expect(leaf.text, leaf.path).not.toMatch(/동의|먼저 답한 사람/u);
    }
    expect(V40_COPY.coupleSend.sensitiveInfo).toBe("가족, 돈, 다툰 뒤와 지쳤을 때에 관한 답도 그대로 읽혀요.");
    expect(V40_COPY.coupleSend.anyoneCanReadInfo).toBe("링크를 가진 누구나 읽고 다시 전달할 수 있고, 이미 보낸 링크는 되돌릴 수 없어요.");
  });

  it("두 사람 결과에는 평가하는 말이 없고 여는 질문이 주제마다 하나 있다", () => {
    const openings = Object.values(V40_COPY.couple.talk.opening);
    expect(openings).toHaveLength(4);
    expect(new Set(openings).size).toBe(4);
    // 부록 E: 둘의 대화 제안은 「이야기해 봐요」 계열이다(「말해 볼까요」가 아니다).
    for (const line of openings) {
      expect(line).toMatch(/이야기해 볼까요\?$/u);
      expect(line).not.toContain("말해");
    }
    for (const leaf of copyLeaves(V40_COPY.couple).concat(copyLeaves(V40_COPY.coupleSend))) {
      expect(leaf.text, leaf.path).not.toMatch(/잘 ?맞|안 ?맞|어울|좋은 사이|나쁜|점수|등급|궁합/u);
    }
  });
});

// ---------------------------------------------------------------------------
// 도우미
// ---------------------------------------------------------------------------

describe("도우미 함수", () => {
  it("코드 복사 글은 글자, 뜻, 세기만 담는다", () => {
    expect(codeCopyText(SWUA)).toBe(
      "웨딩코드 SWUA (S 장면 먼저 · 기울어요, W 같이 하기 · 뚜렷해요, U 둘이 정하기 · 기울어요, A 할 일 먼저 · 반반이에요)",
    );
    expect(codeCopyText(WITH_UNUSABLE)).toBe(
      "웨딩코드 S·UH (S 장면 먼저 · 기울어요, 준비 · 정하지 못했어요, U 둘이 정하기 · 반반이에요 · 임시, H 마음 먼저 · 뚜렷해요)",
    );
    for (const entries of [SWUA, WITH_UNUSABLE]) {
      const text = codeCopyText(entries);
      expect(text).not.toContain(V40_NOT_VALIDATED_PHRASE);
      expect(text).not.toMatch(/\d|%|점수/u);
    }
    // 반반이에요 글자에는 항상 반반이에요가 붙고 임시 글자에는 임시가 붙는다.
    for (const entry of [...SWUA, ...WITH_UNUSABLE]) {
      if (entry.letter !== null && entry.band === "even") {
        expect(codeCopyText([entry])).toContain("반반이에요");
      }
    }
  });

  it("코드 줄 낭독 이름", () => {
    expect(codeLineAccessibleName(SWUA)).toBe(
      "웨딩코드 네 글자예요. 돈은 S 장면 먼저, 기울어요. 준비는 W 같이 하기, 뚜렷해요. 정하는 사람은 U 둘이 정하기, 기울어요. 지쳤을 때는 A 할 일 먼저, 반반이에요.",
    );
    expect(codeLineAccessibleName(WITH_UNUSABLE)).toContain("준비는 글자를 정하지 못했어요.");
    expect(codeLineAccessibleName(WITH_UNUSABLE)).toContain("정하는 사람은 U 둘이 정하기, 반반이에요, 임시 글자예요.");
    expect(letterAriaLabel("V", "clear")).toBe("V 조건 먼저, 뚜렷해요");
    expect(letterAriaLabel("V", "even", true)).toBe("V 조건 먼저, 반반이에요, 임시");
    for (const axis of V40_AXES) {
      const subject = codeLineAccessibleName([{ axis: axis.key, letter: null, band: null, provisional: false }]);
      expect(subject).toContain(axis.topic);
    }
  });

  it("한국 시간 기준 날짜", () => {
    expect(koreanDateLabel(Date.UTC(2026, 8, 29, 10, 0))).toBe("9월 29일");
    // 한국 시간으로 자정 바로 전과 바로 뒤.
    expect(koreanDateLabel(Date.UTC(2026, 8, 29, 14, 59, 59))).toBe("9월 29일");
    expect(koreanDateLabel(Date.UTC(2026, 8, 29, 15, 0, 0))).toBe("9월 30일");
    // UTC 로는 아직 어제인 한국 새벽.
    expect(koreanDateLabel(Date.UTC(2026, 0, 1, 0, 30))).toBe("1월 1일");
    expect(koreanDateLabel(Date.UTC(2026, 11, 31, 15, 0))).toBe("1월 1일");
    expect(koreanDateLabel(Number.NaN)).toBe("");
    expect(koreanDateLabel(Number.POSITIVE_INFINITY)).toBe("");
    expect(koreanDateLabel(8.64e15 + 1)).toBe("");
    expect(savedOnLine(Date.UTC(2026, 8, 29, 10, 0))).toBe("9월 29일에 저장했어요.");
    expect(savedOnLine(null)).toBeNull();
    expect(savedOnLine(Number.NaN)).toBeNull();
  });

  it("숫자는 상수에서 읽는다", () => {
    expect(V40_COUNTS.items).toBe(68);
    expect(introBullets("on", 70)[1]).toContain("질문은 모두 70개예요.");
    expect(introBullets("on")[1]).toContain(`질문은 모두 ${V40_COUNTS.items}개예요.`);
    expect(introBullets("off", 70)[1]).toContain("질문은 모두 70개예요.");
    expect(V40_STORAGE.ttlMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(introStorage("on").plain).toContain("이 브라우저에만 30일 동안 저장돼요");
    expect(introStorage("on", 7, 1).plain).toContain("이 브라우저에만 7일 동안 저장돼요");
    expect(introStorage("on", 7, 1).plain).toContain("최근 한 번까지");
    expect(introStorage("on", 30, 3).plain).toContain("최근 세 번까지");
    expect(introStorage("on", 30, 12).plain).toContain("최근 12번까지");
    // 지난번과 비교하는 기록도 같은 기간이 지나면 지워진다(storage.readHistory)고 밝힌다.
    expect(introStorage("on").plain).toContain("같은 기간 최근 세 번까지");
    expect(receiveStorage("on", 68, 7)).toContain("이 브라우저에 7일 동안 저장돼요");
    expect(storageExpiredNote()).toBe("저장한 지 30일이 지나서 이전 답은 지워졌어요.");
    const parts = introStorage("on");
    expect(parts.before + parts.linkLabel + parts.after).toBe(parts.plain);
    expect(parts.after.startsWith("에서 볼 수 있어요.")).toBe(true);
  });

  it("칸 나누기와 가장 나 같은 것 알림", () => {
    // 「6칸을 나눠 놓아 주세요」는 형식 안내가 이미 말하므로 여기서는 남은 수와 다음으로 가는 조건만 말한다.
    expect(splitRemainingNotice(2)).toBe("다음으로 가려면 2칸을 더 놓아 주세요.");
    expect(splitRemainingNotice(6)).toBe("다음으로 가려면 6칸을 더 놓아 주세요.");
    expect(splitRemainingNotice(2)).not.toContain(V40_COPY.question.guides.split);
    expect(splitStatus(0)).toBe("6칸을 모두 놓았어요");
    expect(splitStatus(4)).toBe("4칸 남았어요");
    expect(splitAddLabel("내가 맡아서 알아보고 결과를 정리해서 알려 주기")).toBe("「내가 맡아서 알아보고 결과를 정리해서 알려 주기」에 한 칸 더 놓기");
    expect(splitRemoveLabel("일단 미루고 다른 급한 일부터 하기")).toBe("「일단 미루고 다른 급한 일부터 하기」에서 한 칸 빼기");
    expect(splitCountLabel("일단 미루고 다른 급한 일부터 하기", 3)).toBe("「일단 미루고 다른 급한 일부터 하기」: 3칸");
    expect(bestWorstPickedAnnouncement("best", "사진 촬영 시간을 늘려요")).toBe("「사진 촬영 시간을 늘려요」를 가장 나 같은 것으로 골랐어요");
    expect(bestWorstPickedAnnouncement("worst", "예비비를 남겨 둬요")).toBe("「예비비를 남겨 둬요」를 가장 나 같지 않은 것으로 골랐어요");
    expect(V40_COPY.inputs.duplicateAnnouncement).toBe("같은 카드를 두 곳에 고를 수 없어서 먼저 고른 쪽을 지웠어요");
  });

  it("인용 서식이 계약(present.answerText)과 같다", () => {
    expect(V40_QUOTE_TEMPLATES.pairStrongSuffix).toBe(" (아주 가까워요)");
    expect(V40_QUOTE_TEMPLATES.reactNearSuffix).toBe(" (조금 가까워요)");
    expect(V40_QUOTE_TEMPLATES.label("첫 주말의 대화", "먼저 남기고 싶은 모습을 그려 봐요")).toBe("첫 주말의 대화: 먼저 남기고 싶은 모습을 그려 봐요");
    expect(V40_QUOTE_TEMPLATES.react("상대가 「많이 힘들었겠다」 하고 먼저 말해 주면", "든든할 것 같아요", false)).toBe(
      "상대가 「많이 힘들었겠다」 하고 먼저 말해 주면 든든할 것 같아요",
    );
    expect(V40_QUOTE_TEMPLATES.react("상대가 「많이 힘들었겠다」 하고 먼저 말해 주면", "든든할 것 같아요", true)).toBe(
      "상대가 「많이 힘들었겠다」 하고 먼저 말해 주면 든든할 것 같아요 (조금 가까워요)",
    );
    expect(V40_QUOTE_TEMPLATES.bestWorst("사진 촬영 시간을 늘려요")).toBe("가장 나 같은 것으로 「사진 촬영 시간을 늘려요」를 골랐어요");
    expect(V40_QUOTE_TEMPLATES.split(4, "사진과 꽃에 써요")).toBe("6칸 중 4칸을 「사진과 꽃에 써요」에 놓았어요");
  });

  it("두 사람 결과의 이름과 주어", () => {
    expect(personName("first", "first")).toBe("나");
    expect(personName("first", "second")).toBe("상대");
    expect(personName("second", "second")).toBe("나");
    expect(personName("second", "first")).toBe("상대");
    expect(personName(null, "first")).toBe("먼저 답한 사람");
    expect(personName(null, "second")).toBe("나중에 답한 사람");
    // 답 글 앞에 이름표를 조사로 이어 붙이지 않는다(명사로 끝나는 보기, 남의 이야기 보기가 어색한 문장이 된다). 이름표는 별도 줄이다.
    expect(copyExports).not.toHaveProperty("personTopic");
    expect(copyExports).not.toHaveProperty("coupleAnswerLine");
    // 덧말만 다르면 같은 보기다
    expect(withoutQuoteQualifier("총액부터 정해요 (아주 가까워요)")).toBe("총액부터 정해요");
    expect(withoutQuoteQualifier("상대가 먼저 말해 주면 든든할 것 같아요 (조금 가까워요)")).toBe("상대가 먼저 말해 주면 든든할 것 같아요");
    expect(withoutQuoteQualifier("총액부터 정해요")).toBe("총액부터 정해요");
    expect(withoutQuoteQualifier("(아주 가까워요) 가운데")).toBe("(아주 가까워요) 가운데");
    expect(letterBandCell("U", "clear", false)).toBe("U 둘이 정하기 · 뚜렷해요");
    expect(letterBandCell("U", "even", true)).toBe("U 둘이 정하기 · 반반이에요 · 임시");
    expect(letterBandCell(null, null, false)).toBe("정하지 못했어요");
  });

  it("주제마다 조사가 붙은 주어가 주제 이름으로 시작한다", () => {
    const expected: Record<Axis, string> = { money: "돈", process: "준비", scope: "정하는 사람", support: "지쳤을 때" };
    expect(V40_COPY.result.topicLabels).toEqual(expected);
    for (const axis of V40_AXES) {
      expect(axis.topic).toBe(expected[axis.key]);
      const text = codeLineAccessibleName([{ axis: axis.key, letter: axis.front, band: "clear", provisional: false }]);
      expect(text).toMatch(new RegExp(`${axis.topic}(은|는) ${axis.front} `, "u"));
    }
  });

  it("글자 이름 뒤 조사는 문서 규칙대로 는, 와, 가, 로, 를이 여덟 글자 모두에 맞는다", () => {
    // 여덟 글자는 읽는 소리가 모두 모음으로 끝난다(브이, 에스, 더블유, 디, 유, 에프, 에이치, 에이).
    const finalVowel: Record<Letter, string> = { V: "이", S: "스", W: "유", D: "이", U: "유", F: "프", H: "치", A: "이" };
    for (const letter of V40_LETTER_LIST) {
      const reading = finalVowel[letter];
      const code = reading.charCodeAt(0) - 0xac00;
      expect(code % 28, `${letter} 받침`).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 저장 문구는 저장 상태에 맞게 참이고, 저장소는 기기가 아니라 브라우저다
// ---------------------------------------------------------------------------

describe("저장 상태별 시작 화면 문구", () => {
  it("켜져 있을 때 네 줄은 저장을 말하고, 꺼짐과 막힘은 둘째 줄에서 저장 이야기를 뺀다", () => {
    const base = introBullets("on", V40_COUNTS.items);
    expect(base[1]).toContain("멈춰도 이 브라우저에 저장돼요");
    for (const mode of ["off", "blocked"] as const) {
      const bullets = introBullets(mode, V40_COUNTS.items);
      expect(bullets[0]).toBe(base[0]);
      expect(bullets[2]).toBe(base[2]);
      expect(bullets[3]).toBe(base[3]);
      expect(bullets[1]).toContain(`질문은 모두 ${V40_COUNTS.items}개예요`);
      expect(bullets[1], mode).not.toContain("저장");
    }
  });

  it("저장 문단은 조각을 이으면 전체가 되고, 처리방침 링크 글자는 세 갈래 모두 같다", () => {
    for (const mode of STORAGE_MODES) {
      const storage = introStorage(mode);
      expect(storage.plain).toBe(`${storage.before}${storage.linkLabel}${storage.after}`);
      expect(storage.linkLabel).toBe("개인정보 처리방침");
      expect(storage.plain, mode).toContain("이용 통계만 남겨요");
      expect(storage.plain, mode).toContain("웨딩한방에");
    }
  });

  it("켜져 있으면 브라우저 저장이라는 것과 앱 안 브라우저 주의를 말하고, 꺼짐과 막힘은 저장 기간이나 최근 기록을 말하지 않는다", () => {
    const on = introStorage("on").plain;
    expect(on).toContain("이 브라우저에만");
    expect(on).toContain("30일 동안 저장돼요");
    expect(on).toContain("카카오톡 같은 앱 안에서 열었다면 다음에도 같은 곳에서 열어야 이어서 할 수 있어요");
    expect(on).toContain("최근 세 번까지");
    for (const mode of ["off", "blocked"] as const) {
      const text = introStorage(mode).plain;
      expect(text, mode).not.toMatch(/일 동안|저장돼요|최근|브라우저에만|카카오톡/u);
    }
    expect(introStorage("off").plain).toContain("자동 저장이 꺼져 있어서 답은 저장되지 않고");
    expect(introStorage("blocked").plain).toContain("답은 웨딩한방에 보내지 않아요");
  });

  it("고지 문장은 저장 문단에 섞이지 않는다", () => {
    for (const mode of STORAGE_MODES) {
      expect(introStorage(mode).plain).not.toContain(V40_NOT_VALIDATED_PHRASE);
      expect(receiveStorage(mode)).not.toContain(V40_NOT_VALIDATED_PHRASE);
    }
  });
});

describe("저장 상태별 받는 사람 화면 문구", () => {
  it("세 갈래 모두 질문 수, 상대 답을 저장하지 않는다는 것, 받은 링크가 받은 곳에 남는다는 것, 이용 통계를 말한다", () => {
    for (const mode of STORAGE_MODES) {
      const text = receiveStorage(mode, V40_COUNTS.items);
      expect(text, mode).toContain(`질문은 모두 ${V40_COUNTS.items}개예요`);
      expect(text, mode).toContain("웨딩코드는 상대의 답을 이 브라우저에 저장하지 않아요");
      expect(text, mode).toContain("받은 링크는 받은 곳에서 지우기 전까지 남아 있어요");
      expect(text, mode).toContain("끝까지 마쳤는지 같은 이용 통계만 남겨요");
    }
  });

  it("켜져 있을 때만 내 답이 저장된다고 하고, 꺼짐과 막힘에서는 내 답은 저장되지 않거나 보내지 않는다고만 한다", () => {
    expect(receiveStorage("on")).toContain("30일 동안 저장돼요");
    expect(receiveStorage("on")).toContain("카카오톡 같은 앱 안에서 열었다면");
    expect(receiveStorage("off")).toContain("자동 저장이 꺼져 있어서 내 답은 저장되지 않고");
    for (const mode of ["off", "blocked"] as const) {
      expect(receiveStorage(mode), mode).not.toMatch(/일 동안|이 브라우저에 \d+일|카카오톡/u);
    }
    expect(receiveStorage("blocked")).toContain("내 답은 웨딩한방에 보내지 않아요");
  });
});

describe("자동 저장 끄기 경고와 저장 문구", () => {
  it("끄기 경고는 저장된 답이 없어도 늘 한 줄이다(지난번 비교용 기록이 혼자 남아 있을 수 있다)", () => {
    for (const saved of [true, false]) {
      for (const legacy of [true, false]) {
        const warning = autosaveTurnOffWarning({ saved, legacy });
        expect(typeof warning).toBe("string");
        expect(warning).toContain("지난번 비교용 기록");
      }
    }
    expect(autosaveTurnOffWarning({ saved: false, legacy: true })).toContain("이전 웨딩코드에 남겨 둔 답");
    expect(autosaveTurnOffWarning({ saved: true, legacy: true })).toContain("이전 웨딩코드에 남겨 둔 답");
    expect(autosaveTurnOffWarning({ saved: false, legacy: false })).not.toContain("이전 웨딩코드");
  });

  it("껐다는 알림은 저장돼 있던 것이 없었을 수도 있어서 「저장돼 있던」으로 말하고 비교 기록도 지웠다고 한다", () => {
    expect(V40_COPY.autosave.turnedOffNote).toBe("자동 저장을 껐어요. 저장돼 있던 답과 지난번 비교용 기록은 이 브라우저에서 지웠어요.");
    expect(V40_COPY.autosave.statusOn).toBe("자동 저장이 켜져 있어요. 넘길 때마다 이 브라우저에 저장돼요.");
    expect(V40_COPY.autosave.turnedOnNote).toBe("자동 저장을 켰어요. 지금부터 넘길 때마다 이 브라우저에 저장돼요.");
  });

  it("저장 지우기와 다시 하기 확인은 이 브라우저를 말한다", () => {
    expect(V40_COPY.manage.clear.button).toBe("이 브라우저의 저장 지우기");
    expect(V40_COPY.manage.clear.confirmTitle).toBe("이 브라우저의 저장을 지울까요?");
    expect(V40_COPY.manage.clear.done).toBe("이 브라우저에 저장된 답과 기록을 지웠어요.");
    expect(V40_COPY.manage.restart.confirmBody).toContain("이 브라우저에서 지워지고");
  });

  it("입구 문구: 이전 판 안내는 「판」이라는 말을 쓰지 않고, 새로 시작하는 단추는 시작 화면의 같은 이름 단추 문구다", () => {
    expect(V40_ENTRY_COPY.olderVersion.notice).not.toMatch(/판/u);
    expect(V40_ENTRY_COPY.olderVersion.startNewButton).toBe(V40_COPY.intro.newVersionButton);
    expect(V40_ENTRY_COPY.olderVersion.startNewButton).not.toMatch(/판/u);
    // 깨진 링크 문구와 불러오는 중 문구는 입구와 화면이 같은 값을 쓴다.
    expect(V40_ENTRY_COPY.brokenLink).toBe(V40_COPY.error.brokenLink);
    expect(V40_ENTRY_COPY.loadingLabel).toBe(V40_COPY.common.loadingLabel);
  });

  it("라운지 안 안내는 화면 밖에서는 알 수 없는 안쪽 이름을 쓰지 않는다", () => {
    expect(V40_COPY.intro.embeddedNote).not.toMatch(/함께 보기|도움 설정/u);
    expect(V40_COPY.intro.embeddedNote).toBe("로그인한 상태여도 이 웨딩코드의 답은 계정에 저장되지 않고, 아모라에게도 전해지지 않아요.");
  });
});

// ---------------------------------------------------------------------------
// 「이 기기」는 어디에도 없다: 저장소는 브라우저 하나다
// ---------------------------------------------------------------------------

const SRC_ROOT = resolve(__dirname, "../../..");

/** 소스에서 사용자에게 보일 수 있는 글(문자열, 템플릿 문자열, JSX 글자)을 TypeScript 파서로 뽑는다. 주석은 트리에 없다. */
function sourceTexts(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) out.push(node.text);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) out.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function v40SourceFiles(): string[] {
  const files: string[] = [join(SRC_ROOT, "constants/weddingCodeV40.ts"), join(SRC_ROOT, "app/wedding-code/WeddingCodeEntryClient.tsx")];
  for (const dir of [join(SRC_ROOT, "lib/weddingCode/v40"), join(SRC_ROOT, "components/wedding-code/v40"), join(SRC_ROOT, "app/wedding-code")]) {
    for (const name of readdirSync(dir).sort()) {
      if (!/\.(ts|tsx)$/u.test(name) || /\.(test|spec)\./u.test(name) || /\.d\.ts$/u.test(name)) continue;
      // app/wedding-code 에는 v3.1 이하 화면도 있다. 여기서는 v4 화면(WeddingCodeV40 로 시작하는 파일)만 본다.
      if (dir.replaceAll("\\", "/").endsWith("app/wedding-code") && !/^WeddingCodeV40/u.test(name)) continue;
      files.push(join(dir, name));
    }
  }
  return files;
}

describe("저장소를 말하는 글은 이 기기가 아니라 이 브라우저다", () => {
  it("V40_COPY, 입구 문구, 함수가 만든 글에 「이 기기」가 없다(공용 기기만 예외)", () => {
    const extra = [
      ...copyLeaves(V40_CLIENT_COPY, "V40_CLIENT_COPY"),
      ...copyLeaves(V40_COUPLE_SEND_EXTRA_COPY, "V40_COUPLE_SEND_EXTRA_COPY"),
    ];
    for (const leaf of [...ALL_LEAVES, ...extra]) {
      const text = leaf.text.replaceAll("공용 기기", "");
      expect(text, leaf.path).not.toMatch(/기기/u);
    }
  });

  it("v4 소스의 문자열과 화면 글에도 「이 기기」가 없다(주석은 파서가 트리에서 뺀다)", () => {
    const files = v40SourceFiles();
    expect(files.length).toBeGreaterThan(40);
    const hits: string[] = [];
    for (const file of files) {
      for (const text of sourceTexts(file)) {
        if (text.replaceAll("공용 기기", "").includes("기기")) hits.push(`${file.slice(SRC_ROOT.length)}: ${text.slice(0, 60)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("문자열을 실제로 뽑고 있다(뽑는 눈이 멀어서 초록불이 되지 않는다)", () => {
    const texts = sourceTexts(join(SRC_ROOT, "lib/weddingCode/v40/copy.ts"));
    expect(texts.length).toBeGreaterThan(300);
    expect(texts).toContain(V40_COPY.manage.clear.button);
    expect(texts.some((text) => text.includes("공용 기기에서는 저장을 꺼 주세요"))).toBe(true);
    // 주석 속 글은 뽑지 않는다.
    expect(texts.some((text) => text.includes("통합 검토(2026-09-30)"))).toBe(false);
  });
});
