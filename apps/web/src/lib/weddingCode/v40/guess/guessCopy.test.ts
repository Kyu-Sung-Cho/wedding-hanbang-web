/**
 * 「서로 짐작하기」 화면 문구 시험(빌드 계획 5.7, 9절). copy.test.ts 의 낱말 규칙(계획 A8)이 V40_COPY 의 모든 새 문구에 돈다는 것을 이 묶음에도 미리 돌린다.
 * 통합자가 이 묶음을 V40_COPY 에 붙이는 순간 copy.test.ts 가 결정적으로 빨개지지 않게, 같은 규칙과 같은 문장 중복 규칙을 여기서 먼저 본다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { V40_ESCAPES, V40_LETTER_LIST } from "@/constants/weddingCodeV40";
import { V40_GUESS_SET, V40_GUESS_TEXT } from "@/constants/weddingCodeV40Guess";
import { V40_COPY, V40_COPY_SCREENS, V40_NOT_VALIDATED_PHRASE } from "../copy";
import { V40_GUESS_COPY, guessLineForm, guessRowLabels, type GuessLineForm } from "./guessCopy";
import type { GuessLineDirection } from "./guessCompare";

interface Leaf {
  readonly path: string;
  readonly text: string;
  readonly label: boolean;
}

/** copy.test.ts 와 같은 라벨 키 규칙: 이 낱말로 끝나는 키(복수형 포함)와 그 아래는 낱말이나 제목이라 문장 끝맺음 검사에서 빠진다. */
const LABEL_KEY = /(label|title|heading|button|name|tag|toggle|option|caption|list|badge|mark|column)s?$/i;

function leavesOf(value: unknown, path = "", label = false, out: Leaf[] = [], labelKey: RegExp = LABEL_KEY): Leaf[] {
  if (typeof value === "string") out.push({ path, text: value, label });
  else if (Array.isArray(value)) value.forEach((entry, index) => leavesOf(entry, `${path}[${index}]`, label, out, labelKey));
  else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) leavesOf(entry, path === "" ? key : `${path}.${key}`, label || labelKey.test(key), out, labelKey);
  }
  return out;
}

const LEAVES = leavesOf(V40_GUESS_COPY, "guess");
/** 세트 문구의 원래 키(subhead 는 방향 소제목이라 낱말이다)로 모은 잎. 묶음에서는 rowLabels 아래라 라벨로 분류된다. */
const TEXT_LEAVES = leavesOf(V40_GUESS_TEXT, "text", false, [], /(label|title|heading|button|name|tag|toggle|option|caption|list|badge|mark|column|subhead)s?$/i);

const BANNED =
  /검증된|정확|과학적|진단|점수|등급|궁합|잘 ?맞|성격|유형|스타일|동물|캐릭터|MBTI|mbti|퍼센트|순위|문항|측면|서버 연결|접근 키|확인 주소|데이터|로딩|에러|오류|타입|속마음|무의식|본모습|모순|일관성|당신은|숨은 ?(?:성향|마음|이유)/u;
const BANNED_FORMAL = /(합니다|입니다|습니다|바랍니다|하십시오)/u;
const BANNED_LABELS_OF_ORDER = /(번째|첫|둘째|셋째) ?(질문|화면|장면)|(질문|화면|장면) ?번호|\d+ ?\/ ?\d+|이야기 ?(카드|편|화면)/u;
const SCENE_NAMES = /(질문|구간|주제|글자|세기) ?(장면|이야기)|(장면|이야기) ?(질문|구간)/u;
/** 이 단계 문구 규칙(CLAUDE.md, 계획 9절): 원인, 진단, 숨은 속, 맞힘과 점수, 개수 말. */
const CAUSES = /때문|그래서|따라서|그러므로|왜냐하면|탓|덕분|원인|이유|까닭/u;
const HIDDEN_CLAIMS = /속마음|숨은|무의식|진짜|모순|일관성|본모습|속내|본심|내면|민낯|본성/u;
const SCORING = /맞혔|맞았|맞힌|맞히|틀렸|틀린|정답|오답|일치|적중|점수|개수|몇 개|몇 번/u;
const COUNT_WORDS = /(?<![가-힣])(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|몇|여러) ?(?:가지|개|명|곳|장면|번|질문|문항)|절반|대부분|나머지|모든 ?장면/u;

function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.?!])\s+/u).map((part) => part.trim()).filter((part) => part.length > 0);
}
function politeEnding(sentence: string): boolean {
  const core = sentence.replace(/[.?!…]+$/u, "").replace(/[」』]+$/u, "").replace(/\([^)]*\)$/u, "").trim();
  return /(요|다|죠)$/u.test(core);
}

describe("묶음의 모양", () => {
  it("문구가 충분히 있고 잎마다 글자가 있다", () => {
    expect(LEAVES.length).toBeGreaterThan(35);
    for (const leaf of LEAVES) expect(leaf.text.length, leaf.path).toBeGreaterThan(0);
  });

  it("최상위 키가 정해진 목록과 같다(조용히 늘거나 줄지 않는다)", () => {
    expect(Object.keys(V40_GUESS_COPY).sort()).toEqual(
      [
        "title", "intro", "receiverIntro", "skipNote", "startButton", "leaveButton", "previousButton", "nextButton", "finishButton", "prompts", "guessNote",
        "notMineButton", "skipButton", "unsureButton", "escapeChosen", "entry", "shareInfo", "coupleSendInfo", "coupleSendPartnerInfo", "receiverStorageNote", "receiverNote", "sub", "sourceNote",
        "hideButton", "showButton", "hiddenNote", "unlistedNote", "tail", "emptyState", "rowLabels",
      ].sort(),
    );
  });

  it("copy.ts 를 가져오지 않는다(순환 방지). 가져오는 것은 생성 상수와 타입뿐이다", () => {
    const source = readFileSync(join(__dirname, "guessCopy.ts"), "utf8");
    const imports = [...source.matchAll(/^import[^;]*from\s+"([^"]+)";/gmu)].map((match) => match[1]);
    expect(imports.sort()).toEqual(["../types", "./guessCompare", "./types", "@/constants/weddingCodeV40Guess"].sort());
    expect(source).not.toMatch(/from\s+"\.\.\/copy"|from\s+"\.\/copy"/u);
  });
});

describe("copy.test.ts 의 낱말 규칙 거울(계획 A8): 이 묶음과 세트 문구 전부", () => {
  const ALL = [...LEAVES, ...TEXT_LEAVES];

  it("줄표, 하이픈, 백분율, 물결표, 깨진 글자, 거친 공백이 없다", () => {
    for (const { path, text } of ALL) {
      expect(text, path).not.toMatch(/[–—‒―−]/u);
      expect(text, path).not.toContain("-");
      expect(text, path).not.toMatch(/%/u);
      expect(text, path).not.toMatch(/~/u);
      expect(text, path).not.toContain("�");
      expect(text, path).not.toMatch(/\r|\n|\t/u);
      expect(text, path).not.toMatch(/ {2,}/u);
      expect(text, path).toBe(text.trim());
    }
  });

  it("숫자가 없다", () => {
    for (const { path, text } of ALL) expect(text, path).not.toMatch(/[0-9０-９]/u);
  });

  it("금지 낱말, 합쇼체, 번호 라벨, 장면 이름꼴, 인 답, 뜻은 아니에요, 자리, 데이터가 없고 안 맞아요는 단추 이름에만 있다", () => {
    for (const { path, text } of ALL) {
      expect(text, path).not.toMatch(BANNED);
      expect(text, path).not.toMatch(BANNED_FORMAL);
      expect(text, path).not.toMatch(BANNED_LABELS_OF_ORDER);
      expect(text, path).not.toMatch(SCENE_NAMES);
      expect(text, path).not.toMatch(/인 답/u);
      expect(text, path).not.toMatch(/뜻은 아니에요/u);
      expect(text, path).not.toMatch(/자리/u);
      expect(text, path).not.toMatch(/데이터/u);
      expect(text.replace(V40_ESCAPES.notApplicable, ""), path).not.toMatch(/안 ?맞/u);
    }
  });

  it("저장 낱말은 「이 브라우저」다: 「기기」가 없다(공용 기기만 예외)", () => {
    for (const { path, text } of ALL) expect(text.replaceAll("공용 기기", ""), path).not.toMatch(/기기/u);
    expect(V40_GUESS_COPY.entry.body).toContain("이 브라우저에는 저장하지 않아요");
  });

  it("영문자가 하나도 없다(글자 여덟 개 규칙을 넘어 이 묶음은 영문자를 쓰지 않는다)", () => {
    const allowed = new Set<string>(V40_LETTER_LIST);
    for (const { path, text } of ALL) {
      for (const word of text.match(/[A-Za-z]+/gu) ?? []) expect([...word].every((char) => allowed.has(char)), `${path}: ${word}`).toBe(true);
      expect(text, path).not.toMatch(/[A-Za-z]/u);
    }
  });

  it("문장은 요, 다, 죠로 끝나고 라벨 키 아래는 마침표로 끝나지 않는다", () => {
    for (const leaf of ALL) {
      if (leaf.label) {
        expect(leaf.text, leaf.path).not.toMatch(/\.$/u);
        continue;
      }
      for (const sentence of sentencesOf(leaf.text)) expect(politeEnding(sentence), `${leaf.path}: ${sentence}`).toBe(true);
    }
  });

  it("라벨 키 규칙이 문장을 삼키지 않는다(라벨로 분류된 잎이 마침표로 이어진 문장 둘 이상이 아니다)", () => {
    const swallowed = LEAVES.filter((leaf) => leaf.label && /[.]\s+\S/u.test(leaf.text));
    expect(swallowed.map((leaf) => leaf.path)).toEqual([]);
  });
});

describe("이 단계의 문구 규칙", () => {
  const ALL = [...LEAVES, ...TEXT_LEAVES];

  it("원인, 숨은 속 주장, 맞힘과 점수, 개수 말이 없다", () => {
    for (const { path, text } of ALL) {
      expect(text, path).not.toMatch(CAUSES);
      expect(text, path).not.toMatch(HIDDEN_CLAIMS);
      expect(text, path).not.toMatch(SCORING);
      expect(text, path).not.toMatch(COUNT_WORDS);
    }
  });

  it("고지 문장은 이 묶음에 없다(화면당 한 번이고 결과와 두 사람 결과가 이미 한다)", () => {
    for (const { path, text } of ALL) expect(text, path).not.toContain(V40_NOT_VALIDATED_PHRASE);
  });

  it("누가 맞혔는지 말하는 낱말이 행 이름표와 구역 문구에 없고 끝 줄은 하나다", () => {
    for (const [form, row] of Object.entries(V40_GUESS_COPY.rowLabels)) {
      for (const text of Object.values(row)) expect(text, form).not.toMatch(/맞|틀|정답|점수/u);
    }
    expect(sentencesOf(V40_GUESS_COPY.tail)).toHaveLength(1);
    expect(V40_GUESS_COPY.tail).toMatch(/혼자/u);
  });

  it("끝 줄, 빈 상태, 줄 없는 장면 한 줄은 차이나 개수를 주장하지 않고 같았거나 건너뛴 두 이유를 함께 말한다", () => {
    for (const text of [V40_GUESS_COPY.emptyState, V40_GUESS_COPY.unlistedNote]) {
      expect(text).toMatch(/같았거나/u);
      expect(text).toMatch(/건너뛴/u);
    }
    for (const text of [V40_GUESS_COPY.tail, V40_GUESS_COPY.emptyState]) expect(text).not.toMatch(/달랐|달라|다르|바뀌|변했|차이|반대/u);
  });

  it("두 물음과 짐작 안내: 내 답은 골라 달라는 말, 짐작은 상대가 고를 것 같은 쪽이고 바라는 쪽이 아니라고 닻을 박는다", () => {
    expect(V40_GUESS_COPY.prompts.self).toMatch(/골라 주세요\.$/u);
    expect(V40_GUESS_COPY.prompts.guess).toMatch(/^상대는[^.?]*어느 쪽[^.?]*골랐을 것 같아요\?$/u);
    expect(V40_GUESS_COPY.guessNote).toMatch(/바라는 쪽이 아니라/u);
  });

  it("소개 글은 링크에 무엇이 들어가고 누가 읽을 수 있는지를 사실대로 말한다(옛 「상대에게 보내는 링크」는 질문만 보내기에는 거짓이다)", () => {
    expect(V40_GUESS_COPY.intro).toContain(`「${V40_COPY.send.withAnswersOption}」 링크에만 들어가고`);
    expect(V40_GUESS_COPY.intro).toContain("링크를 가진 사람은 누구나 읽을 수 있어요");
    expect(V40_GUESS_COPY.intro).toContain("다르게 짐작한 장면만");
    expect(V40_GUESS_COPY.intro).not.toContain("상대에게 보내는 링크");
    expect(V40_GUESS_COPY.receiverIntro).toContain("두 사람 결과 링크");
    expect(V40_GUESS_COPY.receiverIntro).toContain("하지 않아도 결과는 그대로예요");
    expect(V40_GUESS_COPY.skipNote).toContain("선택이에요");
  });

  it("진입 카드는 「내 답과 함께 보내기」와 「질문만 보내기」의 실제 단추 이름을 그대로 쓴다", () => {
    expect(V40_GUESS_COPY.entry.body).toContain(`「${V40_COPY.send.withAnswersOption}」`);
    expect(V40_GUESS_COPY.entry.doneNote).toContain(`「${V40_COPY.send.withAnswersOption}」`);
    expect(V40_GUESS_COPY.entry.doneNote).toContain(`「${V40_COPY.send.questionsOnlyOption}」`);
    expect(V40_GUESS_COPY.entry.doneNote).toContain("들어가지 않아요");
    // 보내기 직전의 한 줄 둘은 세트 작성자의 문장 그대로다.
    expect(V40_GUESS_COPY.shareInfo).toBe(V40_GUESS_TEXT.linkNotices.sendOwn);
    expect(V40_GUESS_COPY.coupleSendInfo).toBe(V40_GUESS_TEXT.linkNotices.sendCouple);
    expect(V40_GUESS_COPY.shareInfo).toMatch(/짐작/u);
    expect(V40_GUESS_COPY.shareInfo).toMatch(/링크/u);
    expect(V40_GUESS_COPY.coupleSendInfo).toMatch(/두 사람/u);
  });

  it("보내는 화면 안내는 링크에 실리는 것과 맞는다: 둘 다는 두 사람의 것, 받은 상대의 것만 다시 실릴 때는 그것만 말한다", () => {
    // 이름: 보내는 사람이 본 카드의 이름(서로 짐작해 보기)과 맞춘다. 세트 제목(짐작과 답)을 장면 이름처럼 쓰지 않는다.
    expect(V40_GUESS_COPY.shareInfo).toContain("서로 짐작해 보며");
    expect(V40_GUESS_COPY.coupleSendInfo).toContain("서로 짐작해 보며");
    expect(V40_GUESS_COPY.coupleSendInfo).not.toContain("짐작과 답 장면");
    expect(V40_GUESS_COPY.shareInfo).not.toContain("짐작과 답 장면");
    // 링크를 가진 사람이 읽는다는 것을 말하고, 「두 사람 모두」처럼 누가 읽는지 모호한 말은 쓰지 않는다.
    expect(V40_GUESS_COPY.coupleSendInfo).toContain("링크를 가진 사람은");
    expect(V40_GUESS_COPY.coupleSendInfo).not.toContain("두 사람 모두");
    // 한쪽 짐작만 실리는 링크(받는 사람이 짐작을 건너뛰었다)에는 두 사람의 짐작이 읽힌다고 하지 않는다.
    expect(V40_GUESS_COPY.coupleSendPartnerInfo).toMatch(/받은 링크에 든 상대/u);
    expect(V40_GUESS_COPY.coupleSendPartnerInfo).toMatch(/다시 들어가요/u);
    expect(V40_GUESS_COPY.coupleSendPartnerInfo).not.toMatch(/두 사람/u);
    expect(V40_GUESS_COPY.coupleSendPartnerInfo).not.toBe(V40_GUESS_COPY.coupleSendInfo);
    // 받는 사람의 시작 화면은 저장하지 않는다고 말한다(받는 사람은 진입 카드를 거치지 않는다).
    expect(V40_GUESS_COPY.receiverStorageNote).toContain("이 브라우저에 남기지 않아요");
    expect(V40_GUESS_COPY.receiverStorageNote).not.toMatch(/기기|[0-9]/u);
  });

  it("받는 사람 한 줄에는 상대가 한 것의 내용(장면 이름, 카드 글, 코드)이 없다", () => {
    for (const item of V40_GUESS_SET) {
      expect(V40_GUESS_COPY.receiverNote).not.toContain(item.caption);
      for (const card of item.cards) {
        expect(V40_GUESS_COPY.receiverNote).not.toContain(card.act);
        expect(V40_GUESS_COPY.receiverNote).not.toContain(card.cost);
      }
    }
    expect(V40_GUESS_COPY.receiverNote).not.toMatch(/[0-9]/u);
    expect(V40_GUESS_COPY.receiverNote).toContain("하지 않아도 결과는 그대로예요");
  });

  it("출처 문장은 링크에서 옮겼다는 것을 밝히고 가리기와 보기 단추 이름이 가렸을 때 한 줄의 말과 맞는다", () => {
    expect(V40_GUESS_COPY.sourceNote).toContain("링크에 담긴 답을 그대로 옮겼어요");
    // 체크 글자는 오타만 잡고 위조를 막지 못한다: 링크를 보낸 사람이 실제로 고른 것인지 이 화면이 확인하지 못한다고 사실대로 말한다.
    expect(V40_GUESS_COPY.sourceNote).toContain("링크를 보낸 사람이 직접 고른 것인지는 이 화면이 확인하지 못해요");
    expect(V40_GUESS_COPY.hiddenNote).toContain(`「${V40_GUESS_COPY.showButton}」`);
    expect(V40_GUESS_COPY.hideButton).not.toBe(V40_GUESS_COPY.showButton);
  });
});

describe("탈출구 이름", () => {
  it("제 상황과 안 맞아요와 잘 모르겠어요는 질문 화면의 탈출구 이름과 같고 지금은 넘어갈게요가 내 답의 두 번째 탈출구다", () => {
    expect(V40_GUESS_COPY.notMineButton).toBe(V40_ESCAPES.notApplicable);
    expect(V40_GUESS_COPY.unsureButton).toBe(V40_ESCAPES.unsure);
    expect(V40_GUESS_COPY.skipButton).toBe("지금은 넘어갈게요");
    expect(V40_GUESS_COPY.leaveButton).toBe("짐작은 건너뛸게요");
  });

  it("누른 뒤 한 줄은 「계산」을 말하지 않고(이 화면에는 계산이 없다) 기존 질문 화면의 같은 문장이 아니다", () => {
    for (const text of Object.values(V40_GUESS_COPY.escapeChosen)) {
      expect(text).not.toMatch(/계산/u);
      for (const existing of leavesOf(V40_COPY.question)) {
        for (const sentence of sentencesOf(existing.text)) expect(text, `${existing.path}: ${sentence}`).not.toBe(sentence);
      }
    }
  });
});

describe("행 이름표 넷(두 사람 결과 줄)", () => {
  const EXPECTED: Record<GuessLineForm, readonly [string, string, string]> = {
    meGuessedPartner: ["내가 짐작한 것", "상대가 고른 쪽", "내가 짐작한 쪽"],
    partnerGuessedMe: ["상대가 짐작한 것", "내가 고른 쪽", "상대가 짐작한 쪽"],
    firstGuessedSecond: ["먼저 답한 사람이 짐작한 것", "나중에 답한 사람이 고른 쪽", "먼저 답한 사람이 짐작한 쪽"],
    secondGuessedFirst: ["나중에 답한 사람이 짐작한 것", "먼저 답한 사람이 고른 쪽", "나중에 답한 사람이 짐작한 쪽"],
  };

  it("글자까지 고정한다: 소제목, 사실 쪽 이름, 짐작 쪽 이름 순서", () => {
    for (const form of Object.keys(EXPECTED) as GuessLineForm[]) {
      const [subhead, actualLabel, guessLabel] = EXPECTED[form];
      expect(V40_GUESS_COPY.rowLabels[form], form).toEqual({ subhead, actualLabel, guessLabel });
      expect(Object.keys(V40_GUESS_COPY.rowLabels[form]), form).toEqual(["subhead", "actualLabel", "guessLabel"]);
    }
  });

  it("사람 지칭이 뒤바뀌지 않는다: 사실 쪽 이름은 고른 사람, 짐작 쪽 이름은 짐작한 사람을 말한다", () => {
    expect(V40_GUESS_COPY.rowLabels.meGuessedPartner.actualLabel).toMatch(/^상대가 고른/u);
    expect(V40_GUESS_COPY.rowLabels.meGuessedPartner.guessLabel).toMatch(/^내가 짐작한/u);
    expect(V40_GUESS_COPY.rowLabels.partnerGuessedMe.actualLabel).toMatch(/^내가 고른/u);
    expect(V40_GUESS_COPY.rowLabels.partnerGuessedMe.guessLabel).toMatch(/^상대가 짐작한/u);
    expect(V40_GUESS_COPY.rowLabels.firstGuessedSecond.actualLabel).toMatch(/^나중에 답한 사람이 고른/u);
    expect(V40_GUESS_COPY.rowLabels.firstGuessedSecond.guessLabel).toMatch(/^먼저 답한 사람이 짐작한/u);
    expect(V40_GUESS_COPY.rowLabels.secondGuessedFirst.actualLabel).toMatch(/^먼저 답한 사람이 고른/u);
    expect(V40_GUESS_COPY.rowLabels.secondGuessedFirst.guessLabel).toMatch(/^나중에 답한 사람이 짐작한/u);
  });

  it("나 기준을 알면 내가 짐작한 쪽과 상대가 짐작한 쪽, 모르면 먼저/나중에 답한 사람 꼴이다(여섯 경우 전수)", () => {
    const table: readonly [GuessLineDirection, "first" | "second" | null, GuessLineForm][] = [
      ["firstGuessedSecond", "first", "meGuessedPartner"],
      ["secondGuessedFirst", "first", "partnerGuessedMe"],
      ["firstGuessedSecond", "second", "partnerGuessedMe"],
      ["secondGuessedFirst", "second", "meGuessedPartner"],
      ["firstGuessedSecond", null, "firstGuessedSecond"],
      ["secondGuessedFirst", null, "secondGuessedFirst"],
    ];
    for (const [direction, perspective, form] of table) {
      expect(guessLineForm(direction, perspective), `${direction} ${String(perspective)}`).toBe(form);
      expect(guessRowLabels(direction, perspective), `${direction} ${String(perspective)}`).toEqual(V40_GUESS_COPY.rowLabels[form]);
    }
  });

  it("이름표는 자리표시가 없는 평범한 문자열이다", () => {
    for (const row of Object.values(V40_GUESS_COPY.rowLabels)) {
      for (const text of Object.values(row)) expect(text).not.toMatch(/[{}]/u);
    }
  });
});

describe("같은 문장이 두 번 나오지 않는다(copy.test.ts 의 화면 묶음 중복 규칙)", () => {
  const sentenceLeaves = LEAVES.filter((leaf) => !leaf.label);

  it("이 묶음 안에서 같은 문장이 두 번 나오지 않는다(라벨은 뺀다)", () => {
    const seen = new Map<string, string>();
    for (const leaf of sentenceLeaves) {
      for (const sentence of sentencesOf(leaf.text)) {
        expect(seen.get(sentence), `${leaf.path} 의 「${sentence}」`).toBeUndefined();
        seen.set(sentence, leaf.path);
      }
    }
    expect(seen.size).toBeGreaterThan(25);
  });

  it("이 묶음이 붙을 화면(받는 사람, 결과, 두 사람 결과, 짐작 화면)의 기존 문구와 같은 문장이 없다", () => {
    const screens: Record<string, readonly string[]> = {
      receive: V40_COPY_SCREENS.receive,
      result: V40_COPY_SCREENS.result,
      couple: V40_COPY_SCREENS.couple,
      pairGuess: ["common", "a11y"],
    };
    for (const [screen, groups] of Object.entries(screens)) {
      const existing = new Map<string, string>();
      for (const group of groups) {
        if (group === "guess") continue;
        for (const leaf of leavesOf((V40_COPY as Record<string, unknown>)[group], group)) {
          if (leaf.label) continue;
          for (const sentence of sentencesOf(leaf.text)) existing.set(sentence, leaf.path);
        }
      }
      for (const leaf of sentenceLeaves) {
        for (const sentence of sentencesOf(leaf.text)) {
          expect(existing.get(sentence), `${screen}: ${leaf.path} 의 「${sentence}」가 ${existing.get(sentence)} 에도 있다`).toBeUndefined();
        }
      }
    }
  });
});
