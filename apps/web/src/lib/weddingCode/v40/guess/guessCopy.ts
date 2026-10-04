/**
 * 웨딩코드 4.1 단계 2 「서로 짐작하기」 화면 문구(빌드 계획 9절, 트랙 F2).
 *
 * 세트 자료의 문구(제목, 안내, 두 물음, 탈출구 이름, 결과 줄 이름표, 끝 줄, 빈 상태, 보내는 화면 안내 둘)는 생성 상수 V40_GUESS_TEXT 에서 그대로 가져오고,
 * 시작 단추, 진입 카드, 두 사람 결과 구역의 출처 문장과 가리기, 받는 사람 안내 한 줄은 여기서 정한다. 이 파일이 가져오는 것은 생성 상수와 타입뿐이고
 * copy.ts 는 가져오지 않는다(순환 방지). 통합자가 copy.ts 의 V40_COPY 에 guess 묶음으로 붙인다.
 *
 * 문구 규칙(copy.test.ts 의 낱말 규칙이 이 묶음에도 돈다): 해요체, 줄표와 숫자 없음, 「이 브라우저」(「이 기기」가 아님), 「당신은」과 원인, 진단어, 속마음, 숨은 성향 없음,
 * 누가 맞혔는지와 개수와 점수를 말하지 않음, 고지 문장 「검증을 마친 심리검사가 아니」는 이 묶음에 없다(화면당 한 번, 결과와 두 사람 결과가 이미 한다).
 * 키 이름: 문장은 요, 다, 죠로 끝나고 제목, 단추, 이름은 label, title, heading, button, name 으로 끝난다.
 * 사람이 읽은 문구는 한 줄도 없다(AI 초안과 AI 검사기뿐). 어두운 진입 뒤에서만 나간다.
 */
import { V40_GUESS_TEXT } from "@/constants/weddingCodeV40Guess";
import type { Perspective } from "../types";
import type { GuessLineDirection } from "./guessCompare";
import type { GuessLineForm, GuessRowText } from "./types";

export type { GuessLineForm } from "./types";

/** 두 사람 결과 줄 이름표 한 벌: 방향 소제목, 사실 쪽 행의 이름표, 짐작 쪽 행의 이름표. 평범한 문자열이다(자리표시가 없다). */
export type GuessRowLabels = GuessRowText;

export const V40_GUESS_COPY = {
  /** 구역 제목(두 사람 결과)이자 세트 화면의 제목. */
  title: V40_GUESS_TEXT.title,
  /** 시작 화면 안내(보내는 사람). 링크에 들어가는 것과 읽히는 사람을 사실대로 말한다. */
  intro: V40_GUESS_TEXT.intro,
  /** 시작 화면 안내(받는 사람). */
  receiverIntro: V40_GUESS_TEXT.receiverIntro,
  /** 선택이라는 안내. */
  skipNote: V40_GUESS_TEXT.skipNote,
  /** 받는 사람 시작 화면의 저장 한 줄. 보내는 사람은 결과 화면의 진입 카드가 이 말을 이미 한다(받는 사람은 그 카드를 거치지 않는다). 세트 자료는 저장 위치를 말하지 않는다. */
  receiverStorageNote: "이 답은 이 브라우저에 남기지 않아요.",
  startButton: "시작",
  /** 고른 것을 버리고 나간다(남기지 않는다). 받는 사람 첫 화면에서는 시작과 같은 무게의 큰 단추다. */
  leaveButton: "고른 것 없이 나갈게요",
  previousButton: "이전",
  nextButton: "다음",
  finishButton: "마치기",
  /** 장면마다 같은 두 물음. */
  prompts: { self: V40_GUESS_TEXT.prompts.self, guess: V40_GUESS_TEXT.prompts.guess },
  /** 짐작 물음 아래 한 줄(바라는 쪽이 아니라 상대가 고를 것 같은 쪽). */
  guessNote: V40_GUESS_TEXT.guessNote,
  /** 탈출구 단추 이름: 내 답에는 둘, 짐작에는 하나. */
  notMineButton: V40_GUESS_TEXT.escapeTexts.notmine,
  skipButton: V40_GUESS_TEXT.escapeTexts.skip,
  unsureButton: V40_GUESS_TEXT.escapeTexts.unsure,
  /** 탈출구를 누른 뒤 한 줄. 이 화면에는 계산이 없어서 「계산에서 빼요」를 말하지 않고, 기존 질문 화면의 같은 말과 다른 문장으로 쓴다. */
  escapeChosen: {
    notmine: "제 상황과 맞지 않아서 넘어갔어요.",
    skip: "이 장면은 넘어갔어요.",
    unsure: "잘 모르겠어서 넘어갔어요.",
  },
  /** 진입 카드(보내는 사람, 결과 화면의 「상대에게 보내기」 위). 선택이고 이 브라우저에 저장하지 않는다. */
  entry: {
    title: "서로 짐작해 보기 (선택)",
    body: "장면마다 나는 어느 쪽에 가까운지 고르고, 상대는 어느 쪽을 골랐을 것 같은지도 짐작해 보세요. 고른 쪽과 짐작한 쪽은 「내 답과 함께 보내기」 링크에 들어가요. 링크를 가진 사람은 누구나 읽을 수 있어요. 상대도 해 두었다면 두 사람 결과에 짐작이 다른 장면이 나란히 놓여요. 이 브라우저에는 저장하지 않아요.",
    startButton: "해 볼게요",
    dismissButton: "지금은 안 할게요",
    doneNote: "「내 답과 함께 보내기」를 고르면 이 짐작도 링크에 들어가요. 「질문만 보내기」를 고르면 들어가지 않아요.",
    editButton: "고치기",
    removeButton: "빼기",
    removedNote: "이제부터 만드는 링크에서 짐작을 뺐어요. 이미 보낸 링크는 그대로 남아요.",
  },
  /** 보내기 직전에도 링크에 짐작이 든다고 말한다(ShareBlock 의 guessNote). */
  shareInfo: V40_GUESS_TEXT.linkNotices.sendOwn,
  /** 두 사람 결과 링크를 보내기 직전의 한 줄(TwoPersonSendBlock 의 guessNote). */
  coupleSendInfo: V40_GUESS_TEXT.linkNotices.sendCouple,
  /** 같은 자리의 한 줄이지만 링크에 받은 상대의 짐작만 다시 들어갈 때(내가 짐작을 건너뛰었다). */
  coupleSendPartnerInfo: "받은 링크에 든 상대의 답과 상대가 한 짐작도 이 링크에 다시 들어가요.",
  /** 받는 사람 화면의 한 줄(ReceiverScreen 의 guessNote). 상대가 한 것의 내용은 말하지 않고 사실만 말한다. */
  receiverNote: "상대가 서로 짐작해 보기도 해 뒀고, 그 짐작도 링크에 들어 있어요. 내 답을 마친 뒤에 해 볼 수 있고, 하지 않아도 결과는 그대로예요.",
  /** 두 사람 결과 구역: 제목 아래 밑줄, 출처 문장, 가리기와 보기, 가렸을 때 한 줄, 줄 없는 장면 한 줄, 끝 줄, 빈 상태. */
  sub: V40_GUESS_TEXT.resultBlock.sub,
  sourceNote: "링크에 담긴 답을 그대로 옮겼어요. 링크를 보낸 사람이 직접 고른 것인지는 이 화면이 확인하지 못해요. 이 장면들로 서로를 평가하지는 않아요.",
  hideButton: "가리기",
  showButton: "보기",
  hiddenNote: "짐작과 답을 가려 두었어요. 보려면 「보기」를 눌러 주세요.",
  unlistedNote: V40_GUESS_TEXT.unlistedNote,
  tail: V40_GUESS_TEXT.tail,
  emptyState: V40_GUESS_TEXT.emptyState,
  /** 줄 이름표 넷(평범한 문자열). 나 기준을 알면 meGuessedPartner/partnerGuessedMe, 모르면 firstGuessedSecond/secondGuessedFirst. */
  rowLabels: V40_GUESS_TEXT.resultBlock.rows,
} as const;

/**
 * 짐작 방향과 나 기준(누가 나인지)에서 줄 이름표의 꼴을 정한다.
 * 나를 알면 내가 짐작한 쪽(meGuessedPartner)과 상대가 짐작한 쪽(partnerGuessedMe), 모르면 먼저/나중에 답한 사람 꼴이다.
 * 링크가 직접 만든 것이라 나를 알 수 없으면 「상대가 이렇게 짐작했다」를 내 말로 붙이지 않는다.
 */
export function guessLineForm(direction: GuessLineDirection, perspective: Perspective | null): GuessLineForm {
  if (perspective === null) return direction;
  const firstGuessing = direction === "firstGuessedSecond";
  const mine = perspective === "first" ? firstGuessing : !firstGuessing;
  return mine ? "meGuessedPartner" : "partnerGuessedMe";
}

/** 줄 이름표 한 벌. 이름표는 생성 상수의 평범한 문자열이다(행의 값은 카드의 act 를 그대로 쓴다). */
export function guessRowLabels(direction: GuessLineDirection, perspective: Perspective | null): GuessRowLabels {
  return V40_GUESS_COPY.rowLabels[guessLineForm(direction, perspective)];
}
