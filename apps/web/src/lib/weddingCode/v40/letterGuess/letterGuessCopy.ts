/**
 * 결과 전 글자 고르기(letterGuess)의 화면 문구. 통합자가 copy.ts 의 V40_COPY 끝에 letterGuess 묶음으로 붙인다.
 * 이 파일은 copy.ts 를 가져오지 않는다(순환을 막으려고). 상수 파일(글자 이름과 뜻, 주제 이름)과 ../types 만 가져온다.
 *
 * 문구 규칙(copy.test.ts 가 V40_COPY 에 붙는 모든 문구에 거는 규칙을 그대로 받는다. letterGuessCopy.test.ts 가 같은 규칙을 거울로 돌린다)
 * - 해요체. 줄표, 하이픈, 물결표, 백분율 기호, 숫자 없음. 「자리」 「기기」 「데이터」 「문항」 같은 낱말 없음. 저장소를 말할 때는 「이 브라우저」다.
 * - 글자는 대문자 여덟 개뿐이고, 글자 한 자 뒤에 한글이 오면 그 글자의 이름이다(「W 같이 하기」). 글자 이름과 뜻은 상수에서 그대로 읽는다.
 * - 키 이름이 label, title, heading, button, name, tag, toggle, option, caption, list, badge, mark, column 으로 끝나면 낱말이나 제목이고, 나머지는 문장이라 요, 다, 죠로 끝난다.
 * - 고지 문장 「검증을 마친 심리검사가 아니」는 어디에도 쓰지 않는다(고지는 시작, 받는 사람, 결과, 두 사람 결과 화면에 이미 한 번씩 있다).
 * - 「짐작」이라는 낱말을 제목과 단추에 쓰지 않는다. 결과를 맞히는 게임으로 읽히기 때문이다. 줄에는 맞혔다, 틀렸다, 칭찬, 책망, 개수, 비율, 까닭이 없다.
 * - 어긋남의 흔한 까닭(그날의 기분, 문항 문구, 잡음)을 제품은 모른다. 그래서 줄은 사실만 적고 끝 줄이 한계를 말한다.
 * 사람이 읽은 문구는 한 줄도 없다(AI 초안과 AI 검사기뿐). 말투 검토와 사실 검토 전에는 어둡게만 둔다.
 */
import { axisInfo, letterInfo } from "@/constants/weddingCodeV40";
import type { Axis, Letter } from "../types";
import type { LetterGuessLine, LetterGuessStorageMode } from "./types";

export const V40_LETTER_GUESS_COPY = {
  // 결과 전 화면 -------------------------------------------------------------
  screen: {
    title: "결과를 보기 전에, 내가 어느 쪽에 가까운지 골라 볼까요?",
    lead: "방금은 카드로 골랐어요. 이번에는 글자 이름과 뜻을 보고, 주제마다 나에게 더 가까운 쪽을 골라 보세요. 결과를 본 뒤에 고른 글자와 나란히 놓아 볼게요. 고르지 않아도 결과는 그대로예요.",
    /** 저장 안내 세 갈래(저장 상태를 따른다. 저장이 정말 되는 상태에서만 남는다고 말한다). */
    storageOn: "고른 글자는 이 브라우저에만 남아요. 링크에는 들어가지 않아요.",
    storageOff: "자동 저장을 꺼 두어서 고른 글자는 저장하지 않아요.",
    storageBlocked: "이 브라우저가 저장을 막고 있어서 고른 글자는 저장하지 않아요.",
    continueButton: "결과 보기",
    skipButton: "고르지 않고 결과 보기",
  },

  // 결과 화면의 구역 「먼저 고른 글자와 나란히」 -----------------------------------
  lines: {
    heading: "먼저 고른 글자와 나란히",
    /** 글자가 정해진 주제를 골랐고 모두 같다. 같은 주제를 주제별 줄로 만들지 않는다. */
    same: "나란히 놓은 주제는 먼저 고른 글자와 답을 모아 본 글자가 모두 같았어요.",
    /** 골랐지만 고른 주제가 모두 글자를 정하지 못했거나 반반이라 견줄 수 없다. */
    unsettledOnly: "먼저 고른 주제는 글자를 정하지 못했거나 반반이어서 나란히 놓지 않았어요.",
    /** 구역 끝 줄: 계약이 이미 쓰는 「다른 날에는 다르게」 한계와 이야기해 봐도 좋다는 초대. */
    closing: "결과의 글자는 이번에 고른 답을 모은 것이라 다른 날에는 다르게 나올 수도 있어요. 혼자 생각해 봐도, 둘이 이야기해 봐도 좋아요.",
  },

  // 두 사람 결과의 닫힌 카드 --------------------------------------------------
  closedCard: {
    openButton: "먼저 고른 글자와 나란히 보기",
    closeButton: "가리기",
    note: "먼저 고른 글자는 누르기 전에는 보이지 않아요.",
  },
} as const;

/** 줄의 주어 조각: 주제 이름 뒤에 「 주제에서는」을 붙인다. 주제가 글자를 고른 것으로 읽히지 않게 하고, 주제 이름은 상수의 topic 을 그대로 쓴다. */
const TOPIC_SUBJECT: Readonly<Record<Axis, string>> = {
  money: `${axisInfo("money").topic} 주제에서는`,
  process: `${axisInfo("process").topic} 주제에서는`,
  scope: `${axisInfo("scope").topic} 주제에서는`,
  support: `${axisInfo("support").topic} 주제에서는`,
};

/** 글자와 이름을 낫표로 묶은 조각: 「W 같이 하기」. 글자 한 자 뒤에는 늘 그 글자의 이름이 온다. */
function letterWithName(letter: Letter): string {
  const info = letterInfo(letter);
  return `「${info.letter} ${info.name}」`;
}

/**
 * 먼저 고른 글자와 결과 글자가 다른 주제의 줄(사실 줄). 칭찬도 책망도 까닭도 개수도 없다.
 * 낫표 뒤 조사는 를로 고정이라 글자 이름의 받침을 따지지 않는다.
 * 예: 준비 주제에서는 결과를 보기 전에 「W 같이 하기」를 골랐는데, 답을 모아 보니 「D 나눠 하기」 쪽으로 답했어요.
 */
export function letterGuessLineText(line: LetterGuessLine): string {
  return `${TOPIC_SUBJECT[line.axis]} 결과를 보기 전에 ${letterWithName(line.guessed)}를 골랐는데, 답을 모아 보니 ${letterWithName(line.shown)} 쪽으로 답했어요.`;
}

/** 주제 이름(화면에 보이는 주제 제목). 상수에서 읽는다. */
export function letterGuessTopicTitle(axis: Axis): string {
  return axisInfo(axis).title;
}

/**
 * 글자 카드 한 장의 글: 글자와 이름, 가운뎃점, 그 글자의 뜻 한 줄. 글자 이름과 뜻은 상수에서 그대로 읽는다.
 * 예: V 조건 먼저 · 돈이 걸린 결정에서 총액과 계약 조건 같은 숫자를 먼저 맞춰 보고, 돈 쓸 곳은 결혼 뒤 생활 쪽에 둬요.
 */
export function letterGuessCardText(letter: Letter): string {
  const info = letterInfo(letter);
  return `${info.letter} ${info.name} · ${info.meaning}`;
}

/** 저장 안내 한 줄(저장 모드를 따른다). 저장이 되는 상태(on)에서만 남는다고 말한다. */
export function letterGuessStorageNote(mode: LetterGuessStorageMode): string {
  switch (mode) {
    case "on":
      return V40_LETTER_GUESS_COPY.screen.storageOn;
    case "off":
      return V40_LETTER_GUESS_COPY.screen.storageOff;
    default:
      return V40_LETTER_GUESS_COPY.screen.storageBlocked;
  }
}
