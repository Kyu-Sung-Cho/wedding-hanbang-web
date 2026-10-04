/**
 * 자동 생성 파일이다. 고치지 않는다(do not edit).
 * 원본: docs/wedding-code/2026-10-01_v41_guess_set.json
 * 생성기: scripts/build-wedding-code-v41-guess.mjs (검사기 scripts/lib/wedding-code-v41-guess-lint.mjs 의 규칙을 통과한 원본만 만든다)
 * 허용한 필드만 나간다(빌드 계획 5.2). 문구를 바꾸려면 원본 JSON 을 고치고 생성기를 다시 돌린다.
 * 장면 문장을 바꾸면 세트 글자를 올리고(원본의 세트 글자와 lib/weddingCode/v40/guess/types.ts 의 GuessSetId, guessLink.ts 의 지원 목록) 시험의 표에 새 줄을 더한다.
 * 사람이 읽은 장면은 하나도 없다(V40_GUESS_REVIEW). 화면은 어두운 진입 뒤에서만 열린다.
 */
import type { GuessReviewData, GuessSet, GuessSetId, GuessTextData } from "@/lib/weddingCode/v40/guess/types";

/** 원본이 자리표시 문구이면 true. 출시용 생성(--final)은 이 값이 true 이면 실패한다. */
export const V40_GUESS_IS_PLACEHOLDER: boolean = false;

/** 링크 ga, gb 의 첫 글자. 이 세트의 문장이 가리키는 장면 여섯의 뜻을 정한 판이다. */
export const V40_GUESS_SET_ID: GuessSetId = "1";

/** 내보낸 내용 전체의 해시(문구, 장면). 생성 파일이 원본과 같은지 시험이 대조한다. */
export const V40_GUESS_CONTENT_SHA256 = "8853f4df55156b5f33f8e50eb1d4bc989eeea6a3e2c9df50fec67141f07b038b";

/** 링크의 고름과 짐작이 가리키는 것(두 물음, 짐작 안내, 탈출구 이름, 장면 여섯)의 해시. 바뀌면 세트 글자를 올린다. */
export const V40_GUESS_MEANING_SHA256 = "2b3b86dc016683d32f2b20fae78a381c40f75cc6739308e501ee4a32ee42432e";

/** 사람이 읽은 장면이 없는 동안 humanReviewed 는 false 다. 화면과 문서가 미검증이라고 말할 수 있게 내보낸다. */
export const V40_GUESS_REVIEW: GuessReviewData = {
  humanReviewed: false,
  unreviewedItemIds: ["g.process.share", "g.scope.plans", "g.process.review", "g.support.quiet"],
};

/** 서로 짐작하기 장면 여섯(저장 기준 순서: cards[0] 이 첫째 카드). */
export const V40_GUESS_SET: GuessSet = [
  {
    id: "g.money.gift",
    caption: "주고받는 선물",
    stem: "서로에게 줄 선물을 정해 둔 예산 안에서 고르는 중이에요. 선물이 아니어도, 서로에게 무언가를 골라 주는 일이면 괜찮아요.",
    cards: [
      { act: "갖고 싶은 걸 미리 물어보고 그중에서 골라요.", cost: "다만 열어 보는 순간의 놀라움이 줄어드는 때가 있어요." },
      { act: "평소 눈여겨본 걸 떠올려 묻지 않고 골라요.", cost: "다만 받는 쪽이 바라던 것과 다른 때가 있어요." },
    ],
    escapes: {
      self: ["notmine", "skip"],
      guess: ["unsure"],
    },
  },
  {
    id: "g.process.share",
    caption: "할 일 나누는 날",
    stem: "해야 할 일이 여러 개 남았고 둘이 나눠 맡는 중이에요. 준비하는 일이든 일상의 일이든, 나눠 맡아 본 일이면 괜찮아요.",
    cards: [
      { act: "각자 더 익숙한 일을 정해서 맡아요.", cost: "다만 맡은 사람이 바쁜 날엔 그 일이 밀리는 때가 있어요." },
      { act: "일을 정해 두지 않고 돌아가며 맡아요.", cost: "다만 익숙하지 않은 일은 시간이 더 걸리는 때가 있어요." },
    ],
    escapes: {
      self: ["notmine", "skip"],
      guess: ["unsure"],
    },
  },
  {
    id: "g.support.evening",
    caption: "잠들기 전 시간",
    stem: "하루 일을 마치고 잠들기 전까지 아무 일정 없이 시간이 남은 밤이에요. 함께 있든 떨어져 있든, 비슷한 밤이면 괜찮아요.",
    cards: [
      { act: "아무 계획 없이 둘이 같이 쉬어요.", cost: "다만 한쪽이 혼자 있는 시간이 줄어드는 때가 있어요." },
      { act: "각자 따로 쉬다가 잠들기 전에 얼굴을 봐요.", cost: "다만 나누려던 이야기가 다음 날로 미뤄지는 때가 있어요." },
    ],
    escapes: {
      self: ["notmine", "skip"],
      guess: ["unsure"],
    },
  },
  {
    id: "g.scope.plans",
    caption: "약속이 겹친 날",
    stem: "같은 날 약속이 둘 겹쳐서 함께 갈 곳은 하나인데, 상대와 나는 서로 다른 곳에 마음이 가요. 친구든 가족이든 모임이든, 비슷한 일이면 괜찮아요.",
    cards: [
      { act: "번갈아 가며 한 사람의 뜻을 먼저 따라 정해요.", cost: "다만 이번에 가고 싶던 쪽이 다음 차례를 기다리는 때가 있어요." },
      { act: "서로 얼마나 가고 싶은지 말하고 더 가고 싶은 쪽으로 정해요.", cost: "다만 얼마나 가고 싶은지를 두고 말이 길어지는 때가 있어요." },
    ],
    escapes: {
      self: ["notmine", "skip"],
      guess: ["unsure"],
    },
  },
  {
    id: "g.process.review",
    caption: "만든 걸 보여 줄 때",
    stem: "둘 중 한 사람이 만든 걸 보여 주며 어떠냐고 물었는데, 보는 쪽 눈에 고치고 싶은 곳이 여러 곳 띄어요. 보는 쪽이 되었다고 생각하고, 글이든 계획이든 비슷한 일이면 괜찮아요.",
    cards: [
      { act: "눈에 띈 곳을 빠짐없이 말해요.", cost: "다만 한꺼번에 들은 쪽이 다 기억하지 못하는 때가 있어요." },
      { act: "눈에 띈 곳 중 하나만 골라 말해요.", cost: "다만 말하지 않은 곳이 나중에 따로 나오는 때가 있어요." },
    ],
    escapes: {
      self: ["notmine", "skip"],
      guess: ["unsure"],
    },
  },
  {
    id: "g.support.quiet",
    caption: "말이 적은 저녁",
    stem: "둘 중 한 사람이 평소보다 말이 적은데 무슨 일인지는 아직 몰라요. 곁에 있는 쪽이 되었다고 생각하고, 만나서든 통화로든 비슷한 저녁이면 괜찮아요.",
    cards: [
      { act: "무슨 일 있냐고 먼저 물어봐요.", cost: "다만 아무 일 아니라는 답이 돌아오는 때가 있어요." },
      { act: "말이 나올 때까지 그대로 기다려요.", cost: "다만 무슨 일인지 모른 채 시간이 길어지는 때가 있어요." },
    ],
    escapes: {
      self: ["notmine", "skip"],
      guess: ["unsure"],
    },
  },
];

/** 서로 짐작하기 화면 글(제목, 안내, 두 물음, 탈출구 이름, 두 사람 결과 줄 이름표, 끝 줄, 빈 상태, 보내는 화면 안내 둘). */
export const V40_GUESS_TEXT: GuessTextData = {
  title: "짐작과 답",
  intro: "같은 장면마다 내 답을 고르고, 상대는 어느 쪽을 골랐을지도 짐작해 보세요. 내 답과 짐작은 「내 답과 함께 보내기」 링크에만 들어가고, 링크를 가진 사람은 누구나 읽을 수 있어요. 상대의 답과 다르게 짐작한 장면만 두 사람 결과에 나란히 놓아요.",
  receiverIntro: "상대가 보낸 링크에 이어 나도 같은 장면에서 내 답을 고르고 상대의 답을 짐작해 보세요. 내 답과 짐작은 돌려보내는 두 사람 결과 링크에 들어가고, 그 링크를 가진 사람은 누구나 읽을 수 있어요. 하지 않아도 결과는 그대로예요.",
  skipNote: "이 장면들은 선택이에요. 건너뛰어도 글자와 결과는 그대로예요.",
  prompts: { self: "지금 마음이 가는 쪽 하나를 골라 주세요.", guess: "상대는 같은 장면에서 어느 쪽을 골랐을 것 같아요?" },
  guessNote: "바라는 쪽이 아니라 상대가 고를 것 같은 쪽으로요.",
  escapeTexts: { notmine: "제 상황과 안 맞아요", skip: "지금은 넘어갈게요", unsure: "잘 모르겠어요" },
  resultBlock: {
    sub: "짐작한 쪽과 고른 쪽을 나란히 놓았어요.",
    rows: {
      meGuessedPartner: { subhead: "내가 짐작한 것", actualLabel: "상대가 고른 쪽", guessLabel: "내가 짐작한 쪽" },
      partnerGuessedMe: { subhead: "상대가 짐작한 것", actualLabel: "내가 고른 쪽", guessLabel: "상대가 짐작한 쪽" },
      firstGuessedSecond: { subhead: "먼저 답한 사람이 짐작한 것", actualLabel: "나중에 답한 사람이 고른 쪽", guessLabel: "먼저 답한 사람이 짐작한 쪽" },
      secondGuessedFirst: { subhead: "나중에 답한 사람이 짐작한 것", actualLabel: "먼저 답한 사람이 고른 쪽", guessLabel: "나중에 답한 사람이 짐작한 쪽" },
    },
  },
  unlistedNote: "여기에 없는 장면은 짐작이 서로의 답과 같았거나, 한쪽이 건너뛴 장면이에요.",
  tail: "어떻게 답했는지 혼자 생각해 봐도, 둘이 이야기해 봐도 좋아요.",
  emptyState: "이번 장면들에서는 나란히 놓을 것이 없었어요. 짐작이 상대의 답과 같았거나, 한쪽이 답을 건너뛴 장면일 수 있어요.",
  linkNotices: { sendOwn: "서로 짐작해 보며 고른 내 답과 내가 한 짐작도 이 링크에 들어가요.", sendCouple: "서로 짐작해 보며 고른 두 사람의 답과 짐작도 링크를 가진 사람은 그대로 읽을 수 있어요." },
};
