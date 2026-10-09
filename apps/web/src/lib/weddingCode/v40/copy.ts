/**
 * 웨딩코드 4.0 (v4.0-tendency) 화면 문구 전부.
 *
 * 화면 빌더는 문구를 여기서만 가져온다. 글자 이름, 뜻, 세기 낱말, 품질 안내처럼 이미 constants/weddingCodeV40.ts 에 있는
 * 문구는 여기서 다시 쓰지 않고 그 값을 그대로 이어 받는다(글자와 뜻이 두 군데에서 갈라지지 않게). 설계 문서(spec.md) 6, 7, 8절에
 * 최종 문구가 있는 것은 글자 그대로 옮겼고, 문서가 「작성 필요」라고만 한 것은 같은 말투로 새로 썼다(아래 「새로 쓴 문구」).
 *
 * 규칙
 * - 정적 문구(V40_COPY)에는 숫자를 쓰지 않는다. 질문 수, 저장 기간, 칸 수, 날짜처럼 숫자가 들어가는 문장은 함수가 상수에서 읽어 만든다.
 *   단 칸 나누기 안내의 「6칸」은 상수 V40_SPLIT_TOTAL 과 같은 값이라 그대로 둔다.
 * - 해요체. 줄표(긴 것과 짧은 것), 백분율 기호, 물결표 없음. 시스템 말투와 AI 티 없음. 명사로 끝나는 「~인 답」 같은 말 없음.
 * - 글자는 대문자 여덟 개(V S W D U F H A)뿐이고 화면에 A/B 카드 라벨을 쓰지 않는다.
 * - 「검증을 마친 심리검사가 아니」라는 고지는 시작, 받는 사람, 결과, 두 사람 결과 화면에 화면마다 한 번씩만 있고
 *   질문 화면, 쉬는 카드, 마지막 정리, 코드 복사 글, 보낼 말에는 없다(V40_COPY_SCREENS 와 copy.test.ts 가 세어 본다).
 * - 이름 짓기: 키 이름이 label, title, heading, button, name, tag, toggle, option, caption, list, badge, mark, column 으로 끝나면
 *   낱말이나 짧은 제목이라서 문장 끝맺음 검사에서 빠지고, 그 밖의 키는 모두 문장이라 요, 다, 죠로 끝나야 한다.
 *
 * 화면별로 어느 묶음을 쓰는지는 V40_COPY_SCREENS. 함수 목록은 이 파일 아래쪽 「도우미」.
 *
 * 말투 검토와 사실 검토(2026-09-29)를 거치며 문서 6, 7, 8절의 몇 문구를 고쳤다. 고친 곳은 copy.test.ts 가 새 문구로 고정하고,
 * 문서 6, 7, 8절의 해당 문장도 함께 바꿔야 한다(리드가 spec.md 를 맞춘다).
 *
 * 통합 검토(2026-09-30)에서 사실과 다르다고 지적된 문구를 이 파일 한 곳으로 모았다(따로 붙여 둔 수정 묶음은 없다):
 * - 기울어요, 반반이에요 문장은 실제 채점이 낼 수 있는 경우(반대쪽 답이 없는 기울어요, 약한 답이나 힌트로 내려간 반반이에요)에도 참이다.
 * - 저장 문구는 저장이 정말 되는 상태(켜짐)에서만 「저장돼요」라고 하고, 꺼짐과 막힘에서는 저장한다고 하지 않는다.
 * - 저장 문구의 「기기」는 모두 「브라우저」다. 답은 브라우저 저장소에 있어서 카카오톡 같은 앱 안 브라우저와 사파리, 크롬은 서로 다른 저장소다.
 * - 두 사람 결과 보내기의 체크는 읽는 사람이 자기 행동과 사실로 참이라고 할 수 있는 말만 받는다.
 *
 * 새로 쓴 문구(문서에 최종 문구가 없어서 같은 말투로 만든 것): 시작 화면의 이전 웨딩코드 카드, 이어 하기 카드, 초대 링크 충돌 카드,
 * 라운지 안내, 자동 저장 안내, 쉬는 카드 제목과 단추, 질문 화면 알림(안 채운 질문, 칸 나누기 남은 칸, 넘긴 질문), 나가기 알림,
 * 답 다시 보기 안내, 세기 읽는 법 한 줄씩, 반대로 고른 답이 없을 때의 줄, 반반 주제의 모습 안내, 지난번과 비교의 표 제목과 꼬리표,
 * 보내기 단추 비활성 이유, 복사 실패, 취향 카드 본문, 지우기 확인, 관문 화면, 깨진 링크 본문, 두 사람 화면의 나 기준 안내와 꼬리표 아래 안내,
 * 주제별 여는 질문 네 줄, 직접 고른 쪽 대비의 기울어요 문형, 접근성 이름표.
 *
 * 입구가 쓰는 작은 묶음(V40_ENTRY_COPY)은 entryCopy.ts 에 있고 여기서 다시 내보낸다. 기본 진입(v3.1) 화면이 이 큰 파일을 통째로 싣지 않게 하려는
 * 것이다. 입구 파일(entry.ts, WeddingCodeEntryClient.tsx)은 이 파일을 가져오지 않는다(app/wedding-code/entry.v40.test.ts 가 확인한다).
 */
import {
  V40_BESTWORST_LABELS,
  V40_COUNTS,
  V40_ELDER_HINT,
  V40_ESCAPES,
  V40_EVEN_CODE_NOTE,
  V40_EVEN_CODE_NOTE_LOWERED,
  V40_EVEN_MARK,
  V40_FORMAT_GUIDES,
  V40_LABELS,
  V40_PAIR_LEVEL_LABELS,
  V40_QUALITY_COPY,
  V40_REST_CARD,
  V40_SAME_LETTER_NOTE,
  V40_SECTION_ARIA,
  V40_SEGMENT_NAMES,
  V40_SPLIT_TOTAL,
  V40_STORAGE,
  V40_STRENGTH,
  V40_WRAP_UP,
  V40_WRAP_UP_NAME,
  axisInfo,
  evenStrengthSentence,
  loweredStrengthSentence,
  letterInfo,
  oppositeLetter,
  type Axis,
  type Letter,
  type StrengthBand,
} from "@/constants/weddingCodeV40";
import { V40_ENTRY_COPY } from "./entryCopy";
import { V40_GUESS_COPY } from "./guess/guessCopy";
import { V40_LETTER_GUESS_COPY } from "./letterGuess/letterGuessCopy";
import type { Perspective, SelfLine } from "./types";

export { V40_ENTRY_COPY };

// ---------------------------------------------------------------------------
// 공통 조각
// ---------------------------------------------------------------------------

/** 고지 문장에서 세는 부분 문자열. 화면 묶음마다 이 조각이 최대 한 번, 시작, 받는 사람, 결과, 두 사람 결과에는 정확히 한 번 있다. */
export const V40_NOT_VALIDATED_PHRASE = "검증을 마친 심리검사가 아니";

/** 시작 화면과 결과 화면의 고지(문서 6절, 7절 예시와 같은 문장). */
const NOTICE_STANDARD =
  "새로 만든 질문이라 아직 여러 사람에게 확인해 보지 못했어요. 검증을 마친 심리검사가 아니고, 다시 하면 글자가 달라질 수 있어요.";

/** 주제 이름 뒤에 조사가 붙은 주어 조각(코드 줄 낭독과 「답을 모아 보니」 안내에 쓴다). 조사는 은, 는만 쓴다. */
const TOPIC_SUBJECT: Readonly<Record<Axis, string>> = {
  money: "돈은",
  process: "준비는",
  scope: "정하는 사람은",
  support: "지쳤을 때는",
};

const COUNT_WORDS = ["영", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열"] as const;

/** 횟수 말: 1에서 10까지는 「세 번」처럼 우리말 수 낱말, 그 밖에는 「12번」. */
function timesWord(n: number): string {
  return Number.isInteger(n) && n >= 1 && n <= 10 ? `${COUNT_WORDS[n]} 번` : `${n}번`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** 진행 저장 보관일(상수 V40_STORAGE.ttlMs 에서 읽는다). */
const STORAGE_DAYS = Math.round(V40_STORAGE.ttlMs / DAY_MS);

/** 코드에 적힌 글자를 문자열로 이을 때 글자를 못 정한 주제에 쓰는 기호. constants 의 V40_UNSET_LETTER_MARK 와 같다. */
const UNSET_MARK = "·";

// ---------------------------------------------------------------------------
// 정적 문구
// ---------------------------------------------------------------------------

export const V40_COPY = {
  // 공통 --------------------------------------------------------------------
  common: {
    /** 입구가 v4 화면을 불러오는 동안 쓰는 글과 같은 값(entryCopy.ts 한 곳에서 가져온다). */
    loadingLabel: V40_ENTRY_COPY.loadingLabel,
  },

  // 시작 화면 ----------------------------------------------------------------
  intro: {
    brandLabel: "웨딩한방 · 웨딩코드",
    title: "결혼을 준비할 때, 나는 어느 쪽으로 기울까요?",
    /** 네 주제를 나열한 첫 문장은 명사구 나열이라 끝맺음 검사에서 빠진다(copy.test.ts 의 SENTENCE_ENDING_EXEMPT). */
    lede: "돈을 정할 때, 준비를 굴릴 때, 함께 정하는 사람, 지쳤을 때. 결혼을 준비하며 자주 만나는 이 네 가지를 여러 방식으로 물어봐요. 답을 모으면 네 글자 코드가 나와요.",
    /** 정직한 고지. 이 화면에서 한 번. */
    notice: NOTICE_STANDARD,
    /** 식을 올리지 않거나 부모님이 안 계시거나 재혼인 사람도 답할 수 있다는 안내와 넘기는 방법, 묻지 않는 것. */
    scope:
      "식을 올리지 않아도, 부모님이 안 계셔도, 재혼이어도 답할 수 있어요. 맞지 않는 질문은 「제 상황과 안 맞아요」를 눌러 주세요. 신혼집, 예단과 예물, 양가 비용 분담, 실제 금액은 묻지 않아요.",
    startButton: "시작하기",
    /**
     * 라운지 안(embedded)에서 열렸을 때 위에 한 줄. 로그인 사용자도 v4 에서 계정 저장, 함께 보기, 아모라 도움 설정 연결을 쓰지 못한다.
     * 「함께 보기」와 「아모라 도움 설정」은 화면 밖에서는 알 수 없는 안쪽 이름이라 쓰지 않는다.
     */
    embeddedNote: "로그인한 상태여도 이 웨딩코드의 답은 계정에 저장되지 않고, 아모라에게도 전해지지 않아요.",
    /** 이 브라우저에 이전 웨딩코드(v3.1) 진행 저장이 있을 때 시작 화면 위에 읽기만 하는 카드. 자동 이전은 없다. */
    legacy: {
      title: "이전 웨딩코드에 남겨 둔 답이 있어요",
      body: "질문이 바뀌어서 새 웨딩코드로 옮길 수는 없어요. 새 질문에 처음부터 답하면 돼요.",
    },
    /** 이 브라우저에 v4 진행 저장이 있을 때(재방문). 처음부터 다시 하면 저장된 답이 지워지는 것을 카드에서 미리 알린다. */
    resume: {
      title: "하던 답이 있어요",
      body: "저장해 둔 곳부터 이어서 할 수 있어요. 처음부터 다시 하면 저장된 답은 지워져요.",
      continueButton: "이어서 하기",
      restartButton: "처음부터 다시 하기",
    },
    /**
     * 초대 링크로 열었는데 이 브라우저에 하던 답이 있을 때 어느 쪽을 이어 할지 한 번 묻는다.
     * 상대의 답은 방금 연 링크에서 메모리로 읽으므로, 하던 답을 이어 해도 그대로 쓰인다(화면 빌더가 이 동작을 지켜야 본문이 참이다).
     */
    inviteConflict: {
      title: "하던 답을 이어서 할까요?",
      body: "이 브라우저에 하던 답이 남아 있어요. 이어서 해도 상대가 보낸 링크의 답은 그대로 쓰여요. 받은 링크로 처음부터 하면 하던 답은 지워져요.",
      keepMineButton: "하던 답 이어서 하기",
      useLinkButton: "받은 링크로 처음부터 하기",
    },
    /** 이전 웨딩코드(v3.1) 화면에서 v4 로 옮겨 가는 단추. 명시로만 옮겨 간다. 입구의 이전 판 안내 단추와 같은 값(entryCopy.ts). */
    newVersionButton: V40_ENTRY_COPY.olderVersion.startNewButton,
  },

  // 자동 저장 ----------------------------------------------------------------
  autosave: {
    turnOffButton: "자동 저장 끄기",
    turnOnButton: "자동 저장 켜기",
    statusOn: "자동 저장이 켜져 있어요. 넘길 때마다 이 브라우저에 저장돼요.",
    statusOff: "자동 저장이 꺼져 있어요. 나가면 답이 사라져요.",
    turnedOnNote: "자동 저장을 켰어요. 지금부터 넘길 때마다 이 브라우저에 저장돼요.",
    /** 저장돼 있던 것이 없었을 수도 있어서 「있던」으로 말한다. 이전 웨딩코드(v3.1)의 저장된 답도 함께 지워지므로 「답」이라고만 쓴다. */
    turnedOffNote: "자동 저장을 껐어요. 저장돼 있던 답과 지난번 비교용 기록은 이 브라우저에서 지웠어요.",
  },

  // 저장이 안 될 때 ------------------------------------------------------------
  storageNotice: {
    unavailable: "이 브라우저에서는 답을 저장할 수 없어요. 창을 닫으면 답이 사라져요.",
    /**
     * 다른 창이 저장한 답이 바뀌어 이 창의 저장이 거절된 경우(저장 계약: 다른 창이 쓴 것을 지우지 않는다).
     * 이 창의 자동 저장은 멈춰 있고, 아래 두 단추 중 하나를 누를 때까지 다시 쓰지 않는다.
     * 두 단추가 각각 무엇을 버리는지 누르기 전에 밝힌다.
     */
    conflict:
      "다른 창에서 저장된 답이 바뀌었어요. 그 답이 사라지지 않도록 이 창의 자동 저장을 멈췄어요. 저장된 답을 불러오면 이 창에서 넘긴 답은 쓰이지 않고, 이 창의 답으로 저장하면 다른 창에서 저장한 답은 사라져요.",
    /** 저장된 답을 불러오면 이 창에서 넘긴 답은 쓰이지 않는다. */
    loadSavedButton: "저장된 답 불러오기",
    /** 이 창의 답으로 다시 저장하면 다른 창이 저장한 답은 사라진다(단추를 누르는 것이 그 확인이다). */
    keepThisButton: "이 창의 답으로 저장하기",
    invalid: "저장된 답을 읽지 못해서 처음부터 시작해요.",
  },

  // 진행 표시 ----------------------------------------------------------------
  progress: {
    regionLabel: "진행 상황",
    /** 다섯 칸 이름표(네 구간과 마지막 정리). 현재 칸에만 보인다. */
    segmentNames: V40_SEGMENT_NAMES,
    /** 낭독기용 구간 알림(SectionIndex 로 찾는다). */
    sectionAnnouncements: V40_SECTION_ARIA,
    restAnnouncement: "여기서 잠깐 쉬어 가도 돼요",
    nextQuestionAnnouncement: "다음 질문이에요",
    previousQuestionAnnouncement: "이전 질문이에요",
  },

  // 질문 화면 ----------------------------------------------------------------
  question: {
    nextButton: "다음",
    previousButton: "이전",
    resultButton: "결과 보기",
    /** 형식이 처음 나오는 화면에만 한 줄(guideKeyOf 로 찾는다). */
    guides: V40_FORMAT_GUIDES,
    /** 정하는 사람 주제의 첫 질문 위에 한 번. */
    elderHint: V40_ELDER_HINT,
    /** 모든 질문 아래의 두 단추와 지난 일 떠올리기의 보기 하나. */
    unsureButton: V40_ESCAPES.unsure,
    notApplicableButton: V40_ESCAPES.notApplicable,
    recallNoneOption: V40_ESCAPES.recallNone,
    /** 두 단추에 붙이는 낭독 설명. */
    escapeDescription: "누르면 이 질문은 결과 계산에서 빠져요. 다른 답을 고르면 다시 계산에 들어가요.",
    /** 두 단추를 누른 뒤 그 질문 아래에 한 줄. */
    escapeChosenUnsure: "잘 모르겠다고 넘어갔어요. 이 질문은 계산에서 빼요.",
    escapeChosenNotApplicable: "제 상황과 맞지 않아 넘어갔어요. 이 질문은 계산에서 빼요.",
    escapeChosenRecallNone: "이런 일이 없었다고 넘어갔어요. 이 질문은 계산에서 빼요.",
    /** 다음을 눌렀는데 답이 없는 질문이 있을 때(FlowNotice incomplete). 칸 나누기는 splitRemainingNotice. */
    incomplete: "아직 답하지 않은 질문이 있어요. 답을 하나 고르거나 「잘 모르겠어요」를 눌러 주세요.",
    incompleteBestWorst: "가장 나 같은 것과 가장 나 같지 않은 것을 하나씩 골라 주세요.",
    /**
     * 상대가 보낸 링크로 열어 질문에 답하는 동안 질문 화면 위에 붙이는 한 줄(받는 사람 묶음이 아니라 질문 묶음에 둔다:
     * 받는 사람 묶음에는 고지 문장이 있어서 질문 화면에 끌어오면 고지 수 규칙이 깨진다). 새로고침하면 링크 주소의 뒷부분을 지웠기 때문에
     * 상대의 답이 화면에서 사라진다는 것을 답하는 도중에도 한 번 알린다.
     */
    receivedNote:
      "상대가 보낸 링크로 열었어요. 내 답을 마치면 두 사람 결과가 열려요. 새로고침하면 상대의 답이 화면에서 사라져요. 그럴 때는 받은 링크를 다시 열어 주세요.",
  },

  // 입력 컴포넌트 안의 말 -----------------------------------------------------
  inputs: {
    pairLevelLabels: V40_PAIR_LEVEL_LABELS,
    bestLabel: V40_BESTWORST_LABELS.best,
    worstLabel: V40_BESTWORST_LABELS.worst,
    duplicateAnnouncement: V40_BESTWORST_LABELS.duplicateAnnounce,
    splitAllPlacedAnnouncement: `${V40_SPLIT_TOTAL}칸을 모두 놓았어요`,
    splitNoRoomReason: "남은 칸이 없어요. 다른 항목에서 먼저 빼 주세요.",
    splitEmptyReason: "이 항목에는 놓은 칸이 없어요.",
  },

  // 쉬는 카드(구간 0, 1, 2 뒤) ---------------------------------------------------
  rest: {
    title: "잠깐 쉬어 가요",
    saved: V40_REST_CARD.saved,
    autosaveOff: V40_REST_CARD.autosaveOff,
    continueButton: "이어서 하기",
    turnOnAutosaveButton: "자동 저장 켜기",
  },

  // 마지막 정리(자기 선택 화면 2개 앞) ------------------------------------------
  wrapUp: {
    nameLabel: V40_WRAP_UP_NAME,
    intro: V40_WRAP_UP.intro,
    title: V40_WRAP_UP.title,
    prompt: V40_WRAP_UP.prompt,
    continueButton: "이어서 하기",
  },

  // 답 다시 보기와 넘어간 질문 다시 보기(새 화면이 아니라 필터) --------------------
  edit: {
    axisLead: "이 주제의 질문을 처음 나왔던 순서대로 다시 열었어요. 답을 고치면 결과가 다시 계산돼요.",
    backToResultButton: "결과로 돌아가기",
    skippedReviewTitle: "넘어간 질문 다시 보기",
    /** 다시 보여 주는 것은 「잘 모르겠어요」로 넘긴 질문뿐이다(flow.skippedReviewIds). 「제 상황과 안 맞아요」로 넘긴 질문은 다시 나오지 않는다. */
    skippedReviewLead:
      "답할 수 있는 질문이 적은 주제가 있어요. 잘 모르겠다고 넘어간 질문을 한 번만 다시 보여 줄게요. 그대로 결과를 봐도 돼요.",
    skippedReviewSkipButton: "그대로 결과 보기",
    /**
     * 결과 앞에 선택 화면(결과 전 글자 고르기, 받는 사람의 서로 짐작하기)이 끼어들 수 있을 때 위 단추 대신 쓰는 이름.
     * 「그대로 결과 보기」는 결과가 곧 나온다는 말이 되고, 이 화면의 아래 단추 「다음」(다음 넘어간 질문)과 같은 이름을 쓰면 낭독기가
     * 같은 이름의 단추 둘을 읽는데 하나는 다시 보기를 끝내고 하나는 다음 질문으로 간다. 그래서 둘과 다른 이름을 준다.
     */
    skippedReviewFinishButton: "다시 보기 마치기",
  },

  // 나가기와 돌아가기 알림 -------------------------------------------------------
  leave: {
    /** 마지막으로 저장한 결과가 「저장했어요」일 때만 보인다. 저장이 안 된 상태에서는 storageNotice 가 대신 나온다. 이 화면에서 고르기만 하고 넘기지 않은 답은 저장되지 않는다. */
    autosaveOnNote: "지금 나가도 다음을 눌러 넘긴 답까지는 이 브라우저에 저장돼 있어요. 다음에 이어서 할 수 있어요.",
    autosaveOffNote: "자동 저장이 꺼져 있어서 지금 나가면 답이 사라져요.",
  },

  // 내 결과: 위쪽 ------------------------------------------------------------
  result: {
    title: "웨딩코드 · 내 결과",
    /** 정직한 고지. 이 화면에서 한 번. */
    notice: NOTICE_STANDARD,
    /** 코드 줄에서 각 글자 위에 붙는 작은 주제 이름(돈, 준비, 정하는 사람, 지쳤을 때). */
    topicLabels: topicLabelsFromAxes(),
    evenMark: V40_EVEN_MARK,
    /** 반반이에요 글자가 하나라도 있을 때 코드 줄 아래에 한 줄. */
    evenCodeNote: V40_EVEN_CODE_NOTE,
    /** 「반반」 중에 힌트가 세기를 낮춰서 된 것이 있을 때 evenCodeNote 대신 쓴다. */
    evenCodeNoteLowered: V40_EVEN_CODE_NOTE_LOWERED,
    unsetLetterLabel: "정하지 못했어요",
    provisionalMark: "임시",
  },

  // 글자 읽는 법(접히지 않는 표) ---------------------------------------------------
  legend: {
    title: "글자 읽는 법",
    topicColumn: "주제",
    frontColumn: "앞 글자",
    backColumn: "뒤 글자",
    mineColumn: V40_LABELS.myLetter,
    note: "글자 하나에는 뜻이 하나뿐이에요. 나도 상대도 같은 표로 읽어요.",
    notSetLabel: "정하지 못했어요",
    /**
     * 세기 낱말을 풀어 쓴 한 줄씩(선택). 각 줄은 세기 낱말로 시작한다. 숫자로 세기를 말하지 않는다.
     * 기울어요와 반반이에요는 반대쪽 답이 있었는지, 두 쪽이 같은 만큼이었는지를 말하지 않는다(그렇지 않은 경우에도 나오는 세기다).
     */
    strengthGuide: {
      clear: "뚜렷해요: 답이 한쪽으로 크게 모였어요.",
      lean: "기울어요: 대체로 한쪽으로 답했지만 뚜렷하게 모인 정도는 아니에요.",
      even: "반반이에요: 어느 쪽으로도 크게 기울지 않았어요.",
    },
  },

  // 답을 모아 보니 ------------------------------------------------------------
  collected: {
    title: V40_LABELS.collectedTitle,
    /** 주제별 문장 열두 개(뚜렷해요, 기울어요는 글자 쪽, 반반이에요는 둘 다) + 글자를 못 정한 주제 문장 네 개. */
    sentences: buildCollectedSentences(),
  },

  // 주제 블록 ----------------------------------------------------------------
  block: {
    answersMineHeading: V40_LABELS.answersMine,
    answersOppositeHeading: V40_LABELS.answersOpposite,
    /**
     * 뚜렷해요, 기울어요 주제에서 보여 줄 만한 반대쪽 답이 없을 때. 반대쪽 답은 값이 3 이상인 것만 뽑으므로(quote.pickQuotes)
     * 약하게 반대로 고른 답은 있을 수 있다. 「없었어요」만 쓰면 거짓이 되니 뚜렷하게 반대로 고른 것이 없다고만 말한다.
     */
    noOppositeLine: "반대로 뚜렷하게 고른 답은 없었어요.",
    noAnswersLine: "보여 줄 답이 없어요.",
    /** 반반이에요 주제에서 그 방향(부호)의 후보가 하나도 없을 때만 보인다(반반이에요 주제의 인용에는 값 크기 조건이 없다). */
    noSideAnswersLine: "이쪽으로 고른 답은 없었어요.",
    moreToggle: V40_LABELS.moreToggle,
    lessToggle: "접기",
    appearancesHeading: V40_LABELS.appearances,
    /** 반반이에요 주제에서 두 글자의 모습을 함께 보여 줄 때 한 줄. 어느 쪽으로도 기울지 않았다는 이유는 세기 문장이 이미 말해서 되풀이하지 않는다. */
    evenAppearancesNote: "두 글자 모두 이런 모습으로 나타날 수 있어요.",
    reviewAxisButton: V40_LABELS.reviewAxis,
    provisionalBadge: "임시",
    /**
     * 글자를 정하지 못한 주제 블록의 한 줄. 정하지 못한 이유(답할 수 있는 질문이 적음)는 「답을 모아 보니」 문장이 이미 말하므로
     * 여기서는 되풀이하지 않고 다시 보기만 알린다. 품질 안내의 unusableAxis 와 다른 문장이다.
     */
    unusableNote: "넘어간 질문이 있다면 다시 볼 수 있어요.",
    /**
     * 글자를 정하지 못한 이유가 「제 상황과 안 맞아요」뿐일 때(잘 모르겠어요로 넘어간 질문이 그 주제에 없다). 넘어간 질문 다시 보기에는 그 질문이 나오지 않으므로
     * 그 단추를 약속하는 unusableNote 대신, 아래 「이 주제 답 다시 보기」에서 다시 답할 수 있다고 말한다(그 단추는 열여섯 질문을 모두 다시 연다).
     */
    unusableNoteNotApplicable: `「${V40_ESCAPES.notApplicable}」로 넘어간 질문은 「${V40_LABELS.reviewAxis}」에서 다시 답할 수 있어요.`,
    /** 직접 고른 쪽 대비 블록의 제목. */
    selfChoiceHeading: V40_WRAP_UP.title,
    /**
     * 주제 블록의 「내가 마지막에 직접 고른 쪽」 줄의 머리말(4.1 단계 1, selfChoiceLine). 본인이 자기 선택 문항에서 고른 것만 말하는 사실 줄이다.
     * 「내가」로 시작해 시스템이 세는 세기 문장이 아니라 본인이 고른 것이라는 점이 머리말에서 읽힌다.
     * 대비 문장(selfContrastSentence)이 같은 사실을 이미 말하는 주제에서는 이 줄을 그리지 않는다.
     */
    selfLineLeadLabel: "내가 마지막에 직접 고른 쪽",
  },

  // 품질 안내 ----------------------------------------------------------------
  quality: {
    title: "결과를 볼 때 알아 두세요",
    /**
     * 같은 위치를 반복해서 누른 응답 두 형식 이상. 낮추는 것은 글자가 아니라 글자 옆 세기다.
     * 두 힌트가 함께 걸려도 세기는 한 단계만 낮아지므로(buildResult) 둘 다 있으면 이 줄만 보이고 skipHint 는 보이지 않는다.
     */
    rhythmHint: V40_QUALITY_COPY.rhythmHint,
    /** 잘 모르겠어요가 많음. rhythmHint 가 함께 걸리면 보이지 않는다. */
    skipHint: V40_QUALITY_COPY.skipHint,
    /** 넘어간 질문이 있음. */
    omitted: V40_QUALITY_COPY.omitted,
    /** 글자를 못 정한 주제가 있음: 코드 줄의 「·」가 무엇인지 알린다. 주제 블록이 이미 이유를 말하므로 이유는 되풀이하지 않는다. */
    unusableAxis: V40_QUALITY_COPY.unusableAxis,
    /** 임시 글자가 있음. */
    provisional: V40_QUALITY_COPY.provisional,
    reviewSkippedButton: "넘어간 질문 다시 보기",
  },

  // 위치 관문(코드를 만들지 않는 결과) ---------------------------------------------
  gate: {
    /** 본문 첫 문장이 이유와 함께 「글자를 정하지 못했어요」를 말하므로 제목은 결과만 말한다. */
    title: "이번에는 코드가 나오지 않았어요",
    /** 같은 위치를 반복해서 누른 응답이 세 형식. */
    rhythmBody: V40_QUALITY_COPY.gate,
    /** 확정한 글자가 하나도 없음: 답할 수 있는 질문이 모자란 주제뿐이거나, 마지막 동점 단계까지 가서 임시 글자만 남은 경우도 들어간다. */
    noInformationBody:
      "답할 수 있는 질문이 적거나 두 쪽이 똑같이 나와서 이번에는 글자를 정하지 못했어요. 넘어간 질문을 다시 보거나 처음부터 다시 답할 수 있어요.",
    /**
     * 위 문장에서 넘어간 질문 다시 보기를 뺀 것. 다시 볼 질문이 없을 때(「제 상황과 안 맞아요」로만 넘어갔을 때) 쓴다. 다시 보기 단추가 없는데 다시 볼 수 있다고 하지 않는다.
     */
    noInformationBodyRestartOnly:
      "이번에는 글자를 정하지 못했어요. 답할 수 있는 질문이 적거나 두 쪽이 똑같이 나온 주제뿐이에요. 처음부터 다시 답할 수 있어요.",
    noLinkNote: "코드가 없어서 보낼 링크도 만들지 않았어요.",
    restartButton: "처음부터 다시 하기",
    reviewSkippedButton: "넘어간 질문 다시 보기",
  },

  // 지난번과 비교 --------------------------------------------------------------
  history: {
    title: "지난번과 비교",
    topicColumn: "주제",
    previousColumn: "지난번",
    currentColumn: "이번",
    changedTag: "달라졌어요",
    unstableTag: "바뀌기 쉬운 주제예요",
    sameTag: "같은 글자예요",
    excludedTag: "비교에서 뺐어요",
    /** 반반이에요가 낀 주제가 있을 때 표 아래에 한 줄. */
    unstableNote: "반반이에요가 낀 주제는 바뀌기 쉬워요.",
    /** 화면 빌더가 실제로 그 주제를 비교에서 뺄 때만 excludedTag 와 함께 쓴다(문서 7절은 두 사람 결과에서만 뺀다고 정했다). 빼지 않으면 이 두 문구를 쓰지 않는다. */
    excludedNote: "글자를 정하지 못했거나 임시 글자였던 주제는 비교에서 뺐어요.",
  },

  // 상대에게 보내기 --------------------------------------------------------------
  send: {
    title: "상대에게 보내기",
    groupLabel: "무엇을 보낼까요?",
    withAnswersOption: "내 답과 함께 보내기",
    /** 「그 결과 링크」는 무엇을 가리키는지 알 수 없었다. 두 사람 결과 링크라고 밝힌다. */
    withAnswersHelp:
      "상대가 답을 마치면 상대 화면에 두 사람 결과가 열려요. 나도 함께 보려면 상대가 두 사람 결과 링크를 나에게 다시 보내 줘야 해요.",
    questionsOnlyOption: "질문만 보내기",
    /** 코드는 「받는」 것이 아니라 결과를 보는 것이다. */
    questionsOnlyHelp: "내 답은 들어 있지 않아요. 상대는 질문에 답하고 자기 결과만 보게 돼요.",
    /** 체크 문장(내 답과 함께 보내기에서만). 켜기 전에는 링크 단추가 aria-disabled 이다. */
    consent: "링크를 받은 사람은 누구나 내 답을 읽을 수 있다는 걸 알아요. 상대에게만 보낼게요.",
    sendButton: "링크 보내기",
    disabledReason: "위 칸에 체크하면 보낼 수 있어요.",
    messageLabel: "보낼 말 (고쳐 쓸 수 있어요)",
    /** 보낼 말 미리 보기. 내 글자는 넣지 않고 고지 문장도 넣지 않는다. */
    messageWithAnswers:
      "웨딩코드 해 봤어요. 링크 열어서 답해 줘요. 다 하면 두 사람 결과 링크를 나한테도 보내 줘요. 그래야 같이 볼 수 있어요.",
    messageQuestionsOnly: "웨딩코드 해 봤어요. 링크 열어서 답해 봐요. 다 하면 서로 코드를 이야기해 봐요.",
    shareSheetInfo: "휴대폰에서는 공유 창이 열려요. 열리지 않으면 주소를 복사할 수 있게 보여 줘요.",
    /**
     * 내 답과 함께 보내기가 골라져 있을 때만 보인다. 「누구나 읽을 수 있다」는 말은 체크 문장(consent)이 이미 한다.
     * 질문만 보내기의 링크에는 답이 없어서 되돌릴 것도, 남는 예전 링크도 없으니 그쪽에는 겁을 주는 말을 붙이지 않는다.
     */
    withAnswersLinkInfo: "보낸 링크는 되돌릴 수 없고, 답을 고쳐 새 링크를 만들어도 예전 링크는 남아요.",
    /**
     * 내 답과 함께 보내기가 골라져 있을 때만 보인다. 체크 문장은 「내 답」이라고만 해서 어떤 답이 읽히는지 모르는데, 두 사람 결과 링크의 안내(coupleSend.sensitiveInfo)는
     * 가족, 돈, 다툰 뒤와 지쳤을 때의 답이라고 밝힌다. 같은 링크 안의 같은 종류의 답이라서 첫 링크에서도 같은 것을 밝힌다.
     */
    withAnswersSensitiveInfo: "가족, 돈, 다툰 뒤와 지쳤을 때에 관한 답도 그대로 읽혀요.",
    /** 클립보드 복사에 성공했을 때. */
    copied: "링크를 복사했어요. 대화창에 붙여 넣어 주세요.",
    /** 공유 창이 없거나 복사가 안 될 때(실패가 아니라 중립 안내). 「길게 눌러」는 휴대폰에서만 맞는 말이라 쓰지 않는다. */
    manualCopy: "아래 주소를 선택해서 복사해 주세요",
    addressLabel: "링크 주소",
    /** 링크를 만들지 못했을 때(코드가 없는 응답 등). */
    linkFailed: "링크를 만들지 못했어요. 다시 눌러 주세요.",
    /** 공유 창 제목. */
    sheetTitle: "웨딩코드",
  },

  // 코드 복사 ----------------------------------------------------------------
  copyCode: {
    button: "코드 복사",
    /** 상대가 답하기 전에 코드를 보내지 않는 까닭(내 글자를 먼저 보면 답이 끌린다)을 화면에서 말한다. */
    hint: "글자와 뜻, 세기만 복사하고 내 답은 넣지 않아요. 복사한 글은 상대가 답하기 전에는 보내지 않는 게 좋아요. 내 글자를 먼저 보면 답이 끌릴 수 있어요.",
    copied: "코드를 복사했어요",
    failed: "복사하지 못했어요. 아래 글을 직접 복사해 주세요.",
  },

  // 취향 카드(결과 아래, 코드와 분리한 선택 2부) -------------------------------------
  taste: {
    title: "결혼식 모습도 골라 볼까요? (선택)",
    body: "코드와는 따로, 끌리는 결혼식 모습을 골라 보는 거예요. 안 해도 코드는 그대로예요.",
    button: "결혼식 모습 골라 보기",
    /** 취향 링크는 새 탭에서 열린다(자동 저장을 끈 채로 결과를 보고 있을 때 결과 화면이 사라지지 않게). 낭독기에만 읽힌다. */
    newTabHint: "새 탭에서 열려요",
  },

  // 다시 하기와 저장 지우기 -----------------------------------------------------
  manage: {
    restart: {
      button: "처음부터 다시 하기",
      confirmTitle: "처음부터 다시 할까요?",
      confirmBody:
        "지금까지 한 답이 이 브라우저에서 지워지고 처음부터 다시 시작해요. 결과를 보기 전에 먼저 고른 글자도 함께 지워져요. 지난번과 비교하는 데 쓰는 결과 글자와 세기는 그대로 남아요. 이미 보낸 링크는 그대로 열려서 받은 사람이 계속 볼 수 있어요.",
      confirmButton: "지우고 다시 하기",
      cancelButton: "그대로 두기",
    },
    clear: {
      button: "이 브라우저의 저장 지우기",
      confirmTitle: "이 브라우저의 저장을 지울까요?",
      confirmBody:
        "저장된 답과 지난번 비교용 기록이 지워져요. 이 브라우저에 남겨 둔 먼저 고른 글자도 함께 지워져요. 지운 뒤에는 되돌릴 수 없어요. 이미 보낸 링크는 지울 수 없어요.",
      confirmButton: "저장 지우기",
      cancelButton: "그대로 두기",
      done: "이 브라우저에 저장된 답과 기록을 지웠어요.",
      failed: "저장을 지우지 못했어요. 브라우저 설정에서 이 사이트에 저장된 정보를 지워 주세요.",
    },
  },

  // 받는 사람 화면 ---------------------------------------------------------------
  receive: {
    title: "상대가 웨딩코드를 보냈어요",
    lead: "먼저 내 답을 마치면 두 사람 결과를 나란히 볼 수 있어요. 링크 안에는 상대의 답이 들어 있어요. 내가 마치기 전에는 화면에 나오지 않게 해 뒀어요.",
    /** 정직한 고지. 이 화면에서 한 번. */
    notice: "새로 만든 질문이라 아직 여러 사람에게 확인해 보지 못했고 검증을 마친 심리검사가 아니에요.",
    scope: "식을 올리지 않아도, 부모님이 안 계셔도, 재혼이어도 답할 수 있어요.",
    answerButton: "나도 답해 보기",
    /** 새로고침하면 상대의 답이 화면에서 사라진다(주소의 # 뒤를 지우기 때문). 링크에는 그대로 남아 있어서 다시 열면 돌아온다. 질문에 답하는 동안의 같은 안내는 question.receivedNote. */
    reloadNote: "이 화면을 새로고침하면 상대의 답이 화면에서 사라져요. 그럴 때는 받은 링크를 다시 열어 주세요.",
    /** 두 사람 결과가 없는 화면의 제목. 결과가 없는데 「우리 둘의 웨딩코드」라고 하지 않는다. */
    noCompareTitle: "두 사람 결과를 만들지 못했어요",
    /** 내 답에서 글자를 정하지 못해 두 사람 결과를 만들 수 없을 때. 다시 해도 또 못 정할 수 있어서 볼 수 있다고 약속하지 않는다. */
    noCompareNote: "이번에는 글자를 정하지 못해서 두 사람 결과를 만들 수 없어요. 처음부터 다시 답해 볼 수 있어요.",
    noCompareRestartButton: "처음부터 다시 하기",
    /** 받는 사람 화면에서 내 답이 자동으로 상대에게 가지 않는다는 것을 미리 알린다(두 사람 결과를 돌려받는 규칙은 링크를 보낼 때 알린다). */
    ownAnswersNote: "내 답도 내가 링크를 보내기 전에는 상대에게 가지 않아요.",
    /**
     * 받는 사람이 꼭 알아야 하는 다음 걸음. 보낸 사람은 이 사람이 두 사람 결과 링크를 다시 보내 주기 전에는 두 사람 결과를 볼 수 없다.
     * 이 말이 보내는 쪽의 보낼 말과 두 사람 결과 화면 맨 아래에만 있으면 받는 사람은 답을 다 마친 뒤 긴 결과를 내려가서야 알게 된다.
     */
    returnStepNote: "내 답을 마치면 나오는 두 사람 결과 링크를 상대에게 다시 보내야 상대도 그 결과를 볼 수 있어요.",
  },

  // 두 사람 결과 ------------------------------------------------------------------
  couple: {
    title: "우리 둘의 웨딩코드",
    /** 정직한 고지와 이 화면이 하는 일. 이 화면에서 한 번. */
    notice:
      "새로 만든 질문이라 아직 여러 사람에게 확인해 보지 못했어요. 검증을 마친 심리검사가 아니고, 다시 하면 글자가 달라질 수 있어요. 글자가 같은지 다른지로 두 사람을 평가하지 않아요. 이야기를 꺼낼 실마리만 보여 줘요.",
    perspective: {
      groupLabel: "나 기준으로 보기",
      meLabel: "나",
      partnerLabel: "상대",
      firstLabel: "먼저 답한 사람",
      secondLabel: "나중에 답한 사람",
      iAmFirstOption: "먼저 답한 사람이 나예요",
      iAmSecondOption: "나중에 답한 사람이 나예요",
      /** 이 브라우저에 저장된 내 답이 링크의 a 나 b 와 같아서 자동으로 「나」를 표시했을 때. */
      autoNote: "이 브라우저에 저장된 내 답과 같아서 「나」로 표시했어요.",
      /** 맞는 것이 없어서 고르게 할 때. */
      askNote: "어느 쪽이 나인지 이 브라우저에서는 알 수 없어요. 직접 골라 주세요.",
    },
    tagLabels: {
      same: "같은 글자",
      different: "다른 글자",
      even: "한쪽 또는 둘 다 반반이에요",
    },
    /** 태그 아래 안내: 반반이에요 주제와 비교에서 뺀 주제. 같은 글자와 다른 글자의 안내는 constants 의 V40_SAME_LETTER_NOTE, AxisInfo.differentNote. */
    evenTagNote: "반반이에요가 낀 주제는 같은지 다른지 말하지 않아요.",
    excludedTagNote: "글자를 정하지 못했거나 임시 글자라서 이 주제는 비교에서 뺐어요.",
    talk: {
      title: "먼저 이야기해 볼 질문",
      lead: "이 질문에서는 두 사람이 다르게 골랐어요. 다른 날에는 다르게 고를 수도 있어요.",
      none: "이번에는 두 사람이 크게 다르게 고른 질문이 없었어요.",
      /** 그 주제의 여는 질문 한 줄. 질문이 뽑힌 주제 아래에 붙인다. */
      opening: {
        money: "돈이 걸린 결정에서 나는 무엇부터 보는지, 상대는 무엇부터 보는지 서로 이야기해 볼까요?",
        process: "준비를 굴릴 때 어디까지 같이 하고 어디부터 나눠 맡고 싶은지 이야기해 볼까요?",
        scope: "결혼 준비의 결정에 누구까지 함께하면 좋을지, 언제 알리면 좋을지 이야기해 볼까요?",
        support: "지친 날 각자 먼저 필요한 게 무엇인지, 그걸 어떻게 알리면 좋을지 이야기해 볼까요?",
      },
    },
    similar: {
      title: "이미 비슷하게 고른 질문",
      lead: "이 질문에서는 두 사람이 같은 쪽으로 골랐어요.",
      none: "이번에는 두 사람이 뚜렷하게 같은 쪽으로 고른 질문이 없었어요.",
    },
    /**
     * 「이야기해 볼 질문」과 「비슷하게 고른 질문」의 답 글에 「상대」라는 말이 들어갈 때(「상대가 ~하면」으로 시작하는 이럴 때 내 마음 질문과
     * 다른 형식의 보기 글 모두), 목록 제목 아래에 한 번만 붙인다.
     * 질문 속 「상대」는 답한 사람마다 자기 곁의 사람이라, 나란히 볼 때 「나는 …, 상대는 상대가 …」처럼 읽히는 혼동을 막는다.
     */
    viewpointNote: "질문에 나오는 「상대」는 각자 자기 곁의 사람이에요.",
    /**
     * 내 답을 마쳐 두 사람 결과가 열린 화면(상대에게 다시 보내는 블록이 있는 화면)의 위쪽 안내와 그 블록으로 가는 단추.
     * 링크를 보내 준 상대는 이 사람이 두 사람 결과 링크를 다시 보내기 전에는 결과를 볼 수 없는데, 보내는 블록은 결과 맨 아래에 있다.
     */
    returnStepNote: "링크를 보내 준 상대는 아직 이 결과를 볼 수 없어요. 아래에서 링크를 보내면 볼 수 있어요.",
    returnStepButton: "상대에게 보내는 곳으로 가기",
    /** 누르면 지금 보던 두 사람 결과 화면이 닫힌다. 단추 이름이 그것을 숨기지 않게 아래 안내가 함께 있다. */
    startOwnButton: "내 웨딩코드 해 보기",
    startOwnNote: "누르면 이 결과 화면은 닫혀요. 다시 보려면 받은 링크를 다시 열어 주세요.",
    /** 두 사람이 같은 보기를 골랐을 때 한 줄로 말하는 주어: 「둘 다 총액부터 정해요」. */
    bothTopic: "둘 다",
  },

  // 이 결과를 상대에게도 보내기(두 사람 결과 화면에서만) -----------------------------
  // 이 묶음은 내가 이 화면에서 내 답을 마치고 두 사람 결과가 열린 경우에만 보인다. 이미 두 사람 답이 든 링크(a 와 b)를 그대로 연 화면에는
  // 보이지 않는다(그 사람에게는 「이걸 보내야 상대도 볼 수 있어요」가 거짓이다).
  coupleSend: {
    title: "이 결과를 상대에게도 보내기",
    /** 두 사람의 답이 링크에 든다는 말은 바로 아래 체크 문장이 하므로 여기서는 되풀이하지 않는다. */
    help: "이 링크를 보내야 상대도 두 사람 결과를 볼 수 있어요.",
    consentAllAnswers: "이 링크에 두 사람의 답이 모두 들어 있다는 걸 알아요.",
    /**
     * 이 화면의 사람은 다른 사람의 동의를 알 수 없어서 「먼저 답한 사람도 동의했어요」를 체크로 받지 않는다(받은 링크의 상대는
     * 자기 답을 읽게 해 준 것이지 다시 보내도 좋다고 한 것이 아니다). 자기가 지킬 수 있는 약속만 받는다. 첫 번째 링크의 체크와 같은 약속이다.
     */
    consentSelf: "이 링크는 상대에게만 보낼게요.",
    sensitiveInfo: "가족, 돈, 다툰 뒤와 지쳤을 때에 관한 답도 그대로 읽혀요.",
    anyoneCanReadInfo: "링크를 가진 누구나 읽고 다시 전달할 수 있고, 이미 보낸 링크는 되돌릴 수 없어요.",
    oldLinksRemainInfo: "답을 고쳐 새 링크를 만들어도 예전 링크는 남아요.",
    sendButton: "링크 보내기",
    disabledReason: "위 칸 두 개에 모두 체크하면 보낼 수 있어요.",
    messageLabel: "보낼 말 (고쳐 쓸 수 있어요)",
    message: "우리 둘의 웨딩코드 결과예요. 링크를 열면 나란히 볼 수 있어요.",
  },

  // 오류 화면 ---------------------------------------------------------------------
  error: {
    /**
     * title, notice, body, startButton. 입구도 이 문구를 쓰므로 실제 글은 entryCopy.ts 한 곳에 있다.
     * notice 를 이미 화면에 내보냈으면 같은 화면에 title 은 다시 보이지 않는다(둘이 같은 말로 시작한다).
     * notice 는 WeddingCodeV40ClientProps.initialNotice 로 넘기는 한 줄(문서 8절 그대로)이다.
     */
    brokenLink: V40_ENTRY_COPY.brokenLink,
    boundary: {
      title: "화면을 불러오지 못했어요",
      /** 상대가 보낸 링크로 연 화면은 주소의 뒷부분을 지웠기 때문에 새로고침만으로는 상대의 답이 돌아오지 않는다. 자동 저장은 넘긴 답까지만 남는다. */
      body: "새로고침해 보세요. 자동 저장을 켜 두었다면 넘긴 답까지는 이 브라우저에 남아 있어요. 상대가 보낸 링크로 열었다면 받은 링크를 다시 열어 주세요.",
      reloadButton: "새로고침",
    },
  },

  // 접근성 이름표 -------------------------------------------------------------------
  a11y: {
    legendDescription: "글자 읽는 법 표예요. 줄마다 주제, 앞 글자, 뒤 글자, 내 글자가 있어요.",
  },

  // 4.1 단계 2 (어두운 진입 뒤의 선택 화면 둘). 문구는 각 트랙 폴더의 파일에 있고 여기서는 묶음으로만 붙인다(copy.ts 를 가져오지 않는 파일들이라 순환이 없다).
  /** 서로 짐작해 보기: 진입 카드, 세트 화면, 받는 사람 한 줄, 보내기 직전 한 줄, 두 사람 결과 구역(guess/guessCopy.ts, 세트 문장은 생성 상수). */
  guess: V40_GUESS_COPY,
  /** 결과 전 글자 고르기: 결과 앞 화면, 결과 구역 「먼저 고른 글자와 나란히」, 두 사람 결과의 닫힌 카드(letterGuess/letterGuessCopy.ts). */
  letterGuess: V40_LETTER_GUESS_COPY,
} as const;

export type V40Copy = typeof V40_COPY;

/**
 * 화면별로 쓰는 문구 묶음. 「검증을 마친 심리검사가 아니」 고지는 이 목록의 화면 단위로 센다.
 * 시작, 받는 사람, 결과, 두 사람 결과는 고지가 정확히 한 번, 나머지 화면은 없어야 한다.
 * 묶음 이름은 V40_COPY 의 최상위 키다. 접근성 묶음(a11y)과 공통 묶음(common)은 모든 화면이 쓴다.
 *
 * 화면 빌더가 지켜야 하는 구성 규칙(묶음에 든 문구를 모두 그리라는 뜻이 아니다. 묶음은 그 화면이 고를 수 있는 후보다):
 * - 저장 상태 말은 사실대로만. rest.saved 와 leave.autosaveOnNote 는 마지막 저장 결과가 「저장됨」일 때만, 자동 저장이 꺼져 있으면
 *   rest.autosaveOff 와 leave.autosaveOffNote, 저장이 막혔거나(unavailable) 창끼리 어긋났으면(conflict) storageNotice 를 대신 보인다.
 * - 쉬는 카드에는 rest 묶음의 문구와 storageNotice 만 그린다. autosave.statusOn, statusOff 는 rest.saved, rest.autosaveOff 와 같은 말이라 쓰지 않는다.
 * - 결과 화면에서 autosave 묶음은 켜기, 끄기 단추와 켰다, 껐다 알림만 쓴다. statusOn, statusOff 는 질문을 넘기는 화면의 말이다.
 * - quality.rhythmHint 와 quality.skipHint 가 함께 걸려도 세기는 한 단계만 낮아지므로 rhythmHint 하나만 보인다.
 * - 글자를 못 정한 주제는 「답을 모아 보니」 문장(이유) 하나, 주제 블록의 block.unusableNote(다시 보기) 하나, 품질 안내의 quality.unusableAxis(코드의 「·」 설명) 하나씩만 보인다.
 * - error.brokenLink 는 notice 를 내보냈으면 title 을 같은 화면에 다시 그리지 않는다.
 * - send 묶음에서 withAnswersLinkInfo 는 「내 답과 함께 보내기」가 골라져 있을 때만 보인다(질문만 보내기의 링크에는 답이 없어서 되돌릴 수 없다는 말을 붙이지 않는다).
 * - 두 사람 결과 화면에서 legend 묶음은 mineColumn 을 쓰지 않는다(누가 나인지 모를 수 있다. 줄마다 personName 으로 이름을 붙인다).
 *   V40_SAME_LETTER_NOTE 는 같은 글자 줄 중 첫 줄 아래에 한 번만 붙이고, 다른 글자 안내는 다른 글자 줄마다 하나씩 붙인다.
 *   couple.viewpointNote 는 목록에 오른 답 글에 「상대」라는 말이 하나라도 있을 때 한 번만 붙인다(이럴 때 내 마음 질문뿐 아니라 다른 형식의 보기에도 「상대」가 나온다).
 *   두 사람이 같은 보기를 골랐으면 두 줄로 되풀이하지 않고 「둘 다」로 시작하는 한 줄로 적는다(couple.bothTopic).
 * - coupleSend 는 내가 이 화면에서 내 답을 마치고 두 사람 결과가 열렸을 때만 보인다(a 와 b 가 든 링크를 그대로 열었으면 보이지 않는다).
 * - 시작과 받는 사람 화면의 저장 문구(introBullets, introStorage, receiveStorage)는 저장 상태(V40StorageMode)를 따른다. 「저장돼요」는 저장이 정말
 *   되는 상태(on)에서만 말하고, 자동 저장이 꺼져 있으면(off) autosave.statusOff 가 토글 옆에서, 브라우저가 저장을 막았으면(blocked) storageNotice.unavailable 이
 *   사정을 말한다. 두 상태에서는 저장한다는 말도 저장 기간도 나오지 않는다.
 */
export const V40_COPY_SCREENS = {
  intro: ["intro", "autosave", "storageNotice", "error", "common", "a11y"],
  receive: ["receive", "guess", "autosave", "storageNotice", "error", "common", "a11y"],
  question: ["question", "inputs", "progress", "leave", "edit", "storageNotice", "common", "a11y"],
  rest: ["rest", "progress", "autosave", "storageNotice", "common", "a11y"],
  wrapUp: ["wrapUp", "progress", "common", "a11y"],
  result: [
    "result", "legend", "collected", "block", "quality", "gate", "history", "send", "copyCode", "taste", "manage",
    "autosave", "storageNotice", "progress", "guess", "letterGuess", "common", "a11y",
  ],
  couple: ["couple", "legend", "coupleSend", "guess", "letterGuess", "common", "a11y"],
  // 4.1 단계 2: 클라이언트가 결과 앞뒤에 얹는 단계 화면 둘. 고지 문장은 두 화면 모두 없다(화면당 한 번 규칙은 시작, 받는 사람, 결과, 두 사람 결과가 이미 맡는다).
  letterGuess: ["letterGuess", "common", "a11y"],
  pairGuess: ["guess", "common", "a11y"],
} as const satisfies Readonly<Record<string, readonly (keyof typeof V40_COPY)[]>>;

export type V40CopyScreen = keyof typeof V40_COPY_SCREENS;

// ---------------------------------------------------------------------------
// 도우미: 숫자와 날짜가 들어가는 문장
// ---------------------------------------------------------------------------

/**
 * 저장 상태에 따른 시작과 받는 사람 화면의 저장 문구. on = 저장됨, off = 자동 저장을 꺼 둠, blocked = 브라우저가 저장을 막음.
 * 「저장돼요」는 on 에서만 참이다.
 */
export type V40StorageMode = "on" | "off" | "blocked";

/**
 * 시작 화면의 네 줄. 둘째 줄의 질문 수는 문항 은행 상수에서 읽는다(기본 V40_COUNTS.items).
 * 「쉬고 싶을 때 멈춰도 저장돼요」는 저장이 되는 상태(on)에서만 참이라 나머지에서는 저장 이야기를 뺀다.
 * 자동 저장이 꺼져 있으면 토글 옆 상태 줄이, 저장이 막혔으면 위의 저장 문제 안내가 사정을 말한다.
 */
export function introBullets(
  mode: V40StorageMode = "on",
  count: number = V40_COUNTS.items,
): readonly [string, string, string, string] {
  return [
    "정답은 없어요. 어느 쪽도 다 괜찮은 준비 방식이에요.",
    mode === "on"
      ? `질문은 모두 ${count}개예요. 네 구간과 마지막 정리로 나눠 물어보고, 쉬고 싶을 때 멈춰도 이 브라우저에 저장돼요.`
      : `질문은 모두 ${count}개예요. 네 구간과 마지막 정리로 나눠 물어봐요.`,
    "끝나면 글자마다 뜻과 함께, 그 글자가 나온 내 답도 보여 줘요.",
    "링크를 보내면 상대도 답할 수 있어요. 상대가 두 사람 결과 링크를 다시 보내 주면 둘이 나란히 볼 수 있어요.",
  ];
}

export interface IntroStorage {
  /** 처리방침 링크 앞 글. */
  readonly before: string;
  /** 처리방침 링크에 걸 글자. */
  readonly linkLabel: string;
  /** 처리방침 링크 뒤 글. */
  readonly after: string;
  /** 세 조각을 이은 전체 문단. */
  readonly plain: string;
}

/**
 * 시작 화면의 저장 문단. 처리방침 링크를 문장 안에 걸 수 있게 세 조각으로 나눠 준다. 저장 상태와 같은 말을 하도록 세 갈래다.
 * - on: 답이 이 브라우저에만 저장된다는 것과, 카카오톡 같은 앱 안 브라우저로 열었으면 다음에도 같은 곳에서 열어야 이어 할 수 있다는 것
 *   (앱 안 브라우저와 사파리, 크롬은 저장소가 서로 다르다)을 밝힌다.
 * - off: 답이 저장되지 않는다고 말하고 저장 기간과 최근 기록 이야기는 하지 않는다.
 * - blocked: 저장 이야기를 하지 않는다(브라우저가 막았다는 사정은 위의 저장 문제 안내가 말한다).
 * days 는 보관일(기본 V40_STORAGE 에서 30), keep 은 지난번과 비교하려고 남기는 결과 수(기본 V40_STORAGE.historyMax).
 * 지난번과 비교하는 기록도 같은 기간이 지나면 지워지므로(storage.readHistory) 「같은 기간」이라고 밝힌다.
 */
export function introStorage(
  mode: V40StorageMode = "on",
  days: number = STORAGE_DAYS,
  keep: number = V40_STORAGE.historyMax,
): IntroStorage {
  const linkLabel = "개인정보 처리방침";
  let before: string;
  let after = "에서 볼 수 있어요.";
  if (mode === "on") {
    before = `답은 웨딩한방에 보내지 않고 이 브라우저에만 ${days}일 동안 저장돼요. 카카오톡 같은 앱 안에서 열었다면 다음에도 같은 곳에서 열어야 이어서 할 수 있어요. 결과 글자와 세기는 지난번과 비교하려고 같은 기간 최근 ${timesWord(keep)}까지 남아요. 로그인 없이 이용하는 공개 웨딩코드에서는 이용 통계를 기록하지 않아요. 자세한 내용은 `;
    after = "에서 볼 수 있어요. 공용 기기에서는 저장을 꺼 주세요.";
  } else if (mode === "off") {
    before = "자동 저장이 꺼져 있어서 답은 저장되지 않고, 웨딩한방에도 보내지 않아요. 로그인 없이 이용하는 공개 웨딩코드에서는 이용 통계를 기록하지 않아요. 자세한 내용은 ";
  } else {
    before = "답은 웨딩한방에 보내지 않아요. 로그인 없이 이용하는 공개 웨딩코드에서는 이용 통계를 기록하지 않아요. 자세한 내용은 ";
  }
  return { before, linkLabel, after, plain: `${before}${linkLabel}${after}` };
}

/**
 * 받는 사람 화면의 저장 문단. introStorage 와 같은 세 갈래이고, 웨딩코드가 상대의 답을 저장하지 않는다는 말은 세 갈래 모두에 들어간다.
 * 받은 링크 자체는 받은 곳(대화창 등)에 남으므로 그 사실도 함께 적어, 「상대의 답이 어디에도 남지 않는다」는 뜻으로 읽히지 않게 한다.
 */
export function receiveStorage(
  mode: V40StorageMode = "on",
  count: number = V40_COUNTS.items,
  days: number = STORAGE_DAYS,
): string {
  const lead = `질문은 모두 ${count}개예요.`;
  const partnerPart =
    "웨딩코드는 상대의 답을 이 브라우저에 저장하지 않아요. 받은 링크는 받은 곳에서 지우기 전까지 남아 있어요. 로그인 없이 이용하는 공개 웨딩코드에서는 이용 통계를 기록하지 않아요.";
  if (mode === "on") {
    return `${lead} 답은 웨딩한방에 보내지 않고 이 브라우저에 ${days}일 동안 저장돼요. 카카오톡 같은 앱 안에서 열었다면 다음에도 같은 곳에서 열어야 이어서 할 수 있어요. ${partnerPart}`;
  }
  if (mode === "off") {
    return `${lead} 자동 저장이 꺼져 있어서 내 답은 저장되지 않고 웨딩한방에도 보내지 않아요. ${partnerPart}`;
  }
  return `${lead} 내 답은 웨딩한방에 보내지 않아요. ${partnerPart}`;
}

/** 진행 저장을 30일이 지나 지웠을 때 시작 화면에 한 줄. */
export function storageExpiredNote(days: number = STORAGE_DAYS): string {
  return `저장한 지 ${days}일이 지나서 이전 답은 지워졌어요.`;
}

/**
 * 한국 시간 기준 날짜 글자(예: 9월 29일). 시각(밀리초)을 한국 표준시 +9시간으로 옮겨 날짜만 적는다.
 * 브라우저의 시간대나 UTC 자정과 상관없이 같은 값이 나온다. 잘못된 시각은 빈 문자열.
 */
export function koreanDateLabel(at: number): string {
  if (!Number.isFinite(at)) return "";
  const kst = new Date(at + 9 * 60 * 60 * 1000);
  if (Number.isNaN(kst.getTime())) return "";
  return `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일`;
}

/** 「9월 29일에 저장했어요.」 저장 시각을 모르면 null. */
export function savedOnLine(at: number | null): string | null {
  if (at === null) return null;
  const date = koreanDateLabel(at);
  return date === "" ? null : `${date}에 저장했어요.`;
}

/**
 * 다음을 눌렀는데 칸 나누기의 칸이 남았을 때(FlowNotice incomplete). remaining 은 아직 놓지 않은 칸 수.
 * 「6칸을 나눠 놓아 주세요」는 형식 안내(V40_FORMAT_GUIDES.split)가 이미 말해서 여기서는 남은 수와 다음으로 가는 조건만 말한다.
 */
export function splitRemainingNotice(remaining: number): string {
  return `다음으로 가려면 ${remaining}칸을 더 놓아 주세요.`;
}

/** 칸 나누기의 남은 칸 안내(aria-live). 모두 놓았으면 V40_COPY.inputs.splitAllPlacedAnnouncement. */
export function splitStatus(remaining: number): string {
  return remaining === 0 ? V40_COPY.inputs.splitAllPlacedAnnouncement : `${remaining}칸 남았어요`;
}

/** 칸 나누기 항목의 단추 이름: 「<항목>」에 한 칸 더 놓기. 항목 문장이 어떻게 끝나도 조사가 어색하지 않게 낫표로 감싼다. */
export function splitAddLabel(entryText: string): string {
  return `「${entryText}」에 한 칸 더 놓기`;
}

/** 칸 나누기 항목의 단추 이름: 「<항목>」에서 한 칸 빼기 */
export function splitRemoveLabel(entryText: string): string {
  return `「${entryText}」에서 한 칸 빼기`;
}

/** 칸 나누기 항목의 현재 값 이름: 「<항목>」: 3칸 */
export function splitCountLabel(entryText: string, chunks: number): string {
  return `「${entryText}」: ${chunks}칸`;
}

/**
 * 가장·가장 아닌 것에서 카드를 골랐을 때 낭독(aria-live). 카드 문장은 요로 끝나고 마침표가 없어서 조사는 항상 를이다.
 */
export function bestWorstPickedAnnouncement(kind: "best" | "worst", cardText: string): string {
  const group = kind === "best" ? V40_BESTWORST_LABELS.best : V40_BESTWORST_LABELS.worst;
  return `「${cardText}」를 ${group}으로 골랐어요`;
}

// ---------------------------------------------------------------------------
// 도우미: 결과 화면
// ---------------------------------------------------------------------------

/**
 * 형식 안내 한 줄이 문항 앞말이 이미 한 말을 되풀이하는가. 안내의 문장이 모두 앞말 안에 그대로 있으면(「6칸」은 앞말의 「여섯 칸」과 같은 말로 본다) true.
 * 칸 나누기 앞말은 「…여섯 칸을 나눠 놓아 주세요. 한 곳에 몰아도 괜찮아요.」로 끝나는 것이 있어서 그 아래에 같은 안내를 한 번 더 붙이면 같은 말을 두 번 읽게 된다.
 * 되풀이이면 화면이 안내를 그리지 않는다. 앞말이 그 말을 하지 않는 문항에서는 안내가 그대로 나온다.
 */
export function formatGuideRepeatsStem(guide: string, stem: string): boolean {
  const normalize = (text: string): string => text.replace(/6칸/gu, "여섯 칸").replace(/\s+/gu, " ").trim();
  const sentences = normalize(guide)
    .split(/(?<=[.!?])\s+/u)
    .filter((sentence) => sentence !== "");
  if (sentences.length === 0) return false;
  const body = normalize(stem);
  return sentences.every((sentence) => body.includes(sentence));
}

/** 코드 줄, 코드 복사, 낭독 이름에 쓰는 한 주제의 결과. 글자를 못 정한 주제는 letter 가 null. */
export interface CodeLineEntry {
  readonly axis: Axis;
  readonly letter: Letter | null;
  /** 화면에 적는 세기(힌트를 반영한 뒤). letter 가 null 이면 null. */
  readonly band: StrengthBand | null;
  readonly provisional: boolean;
  /**
   * 힌트(위치 반복, 건너뜀)가 세기를 기울어요에서 반반이에요로 낮춘 주제이면 true. 없으면 낮추지 않은 주제다.
   * 이런 주제는 낮추기 전에는 한쪽으로 기울어 있었으므로 「어느 쪽으로도 크게 기울지 않았어요」라고 하면 아래에 보여 주는 답과 어긋난다.
   */
  readonly lowered?: true;
}

function assertLetterOfAxis(axis: Axis, letter: Letter): void {
  if (letterInfo(letter).axis !== axis) {
    throw new RangeError(`글자 ${letter} 는 이 주제의 글자가 아니에요: ${axis}`);
  }
}

/** 「V 조건 먼저」처럼 글자와 이름을 함께 적은 칸(글자 읽는 법 표의 한 칸). */
export function legendLetterCell(letter: Letter): string {
  return `${letter} ${letterInfo(letter).name}`;
}

export interface LegendLetterRow {
  readonly letter: Letter;
  readonly name: string;
  /** 작은 영어 낱말(Verify, Scene ...). */
  readonly english: string;
  /** 「V 조건 먼저」. */
  readonly cell: string;
}

export interface LegendRow {
  readonly axis: Axis;
  /** 주제 이름(돈을 정할 때 ...). */
  readonly title: string;
  readonly front: LegendLetterRow;
  readonly back: LegendLetterRow;
}

function legendLetterRow(letter: Letter): LegendLetterRow {
  const info = letterInfo(letter);
  return { letter, name: info.name, english: info.english, cell: legendLetterCell(letter) };
}

function legendRow(axis: Axis): LegendRow {
  const info = axisInfo(axis);
  return { axis, title: info.title, front: legendLetterRow(info.front), back: legendLetterRow(info.back) };
}

/** 글자 읽는 법 표의 네 줄(주제 순서). 상수 한 곳에서만 만들어 글자 여덟 개가 표에 정확히 한 번씩 나온다. */
export function legendRows(): readonly [LegendRow, LegendRow, LegendRow, LegendRow] {
  return [legendRow("money"), legendRow("process"), legendRow("scope"), legendRow("support")];
}

/** 글자 읽는 법 표의 「내 글자 S · 기울어요」 칸(어느 글자가 내 글자인지 글로도 말한다). 임시 글자는 「내 글자 A · 반반이에요 · 임시」. */
export function myLetterCell(letter: Letter, band: StrengthBand, provisional: boolean = false): string {
  return `${V40_LABELS.myLetter} ${letter} · ${V40_STRENGTH[band].label}${provisional ? ` · ${V40_COPY.result.provisionalMark}` : ""}`;
}

function topicLabelsFromAxes(): Readonly<Record<Axis, string>> {
  return {
    money: axisInfo("money").topic,
    process: axisInfo("process").topic,
    scope: axisInfo("scope").topic,
    support: axisInfo("support").topic,
  };
}

function collectedFor(axis: Axis) {
  const info = axisInfo(axis);
  return { front: letterInfo(info.front).answerSentence, back: letterInfo(info.back).answerSentence, even: info.evenSentence };
}

function buildCollectedSentences() {
  return {
    money: { ...collectedFor("money"), unusable: "돈은 답할 수 있는 질문이 적어서 글자를 정하지 못했어요." },
    process: { ...collectedFor("process"), unusable: "준비는 답할 수 있는 질문이 적어서 글자를 정하지 못했어요." },
    scope: { ...collectedFor("scope"), unusable: "정하는 사람은 답할 수 있는 질문이 적어서 글자를 정하지 못했어요." },
    support: { ...collectedFor("support"), unusable: "지친 날에는 답할 수 있는 질문이 적어서 글자를 정하지 못했어요." },
  } as const;
}

/**
 * 「답을 모아 보니」의 한 주제 문장.
 * letter 가 null 이면 글자를 못 정한 주제, band 가 반반이에요이면 두 글자를 같은 무게로 적은 문장(letter 는 무엇이든 같다),
 * 그 밖에는 그 글자 쪽으로 답했다는 문장. 반반이에요 주제에는 한쪽으로 답했다는 말이 나오지 않는다.
 */
export function collectedSentence(axis: Axis, letter: Letter | null, band: StrengthBand | null, lowered: boolean = false): string {
  const sentences = V40_COPY.collected.sentences[axis];
  if (letter === null || band === null) return sentences.unusable;
  assertLetterOfAxis(axis, letter);
  // 힌트가 세기를 낮춰서 반반이에요가 된 주제: 크게 기울지 않았다고 하지 않고 세기를 낮췄다고만 말한다(고른 답은 주제 블록이 그대로 보여 준다).
  if (band === "even" && lowered) return `${TOPIC_SUBJECT[axis]} 세기를 한 단계 낮춰 「${V40_STRENGTH.even.label}」로 적었어요.`;
  if (band === "even") return sentences.even;
  return letterInfo(letter).side === "front" ? sentences.front : sentences.back;
}

/** 주제 블록의 글자 줄: 「S 장면 먼저 · 기울어요」. 임시 글자는 뒤에 「 · 임시」. */
export function letterHeading(letter: Letter, band: StrengthBand, provisional: boolean = false): string {
  return `${legendLetterCell(letter)} · ${V40_STRENGTH[band].label}${provisional ? ` · ${V40_COPY.block.provisionalBadge}` : ""}`;
}

/** 「S는 돈이 걸린 결정에서 ...」 글자의 뜻 한 줄. 글자 이름 뒤 조사는 여덟 글자 모두 는이다. */
export function meaningLine(letter: Letter): string {
  return `${letter}는 ${letterInfo(letter).meaning}`;
}

/** 「반대쪽 V는 돈이 걸린 결정에서 ...」 반대 글자의 뜻 한 줄(뚜렷해요, 기울어요 주제에서). */
export function oppositeMeaningLine(letter: Letter): string {
  const opposite = oppositeLetter(letter);
  return `반대쪽 ${opposite}는 ${letterInfo(opposite).meaning}`;
}

/**
 * 주제의 세기 문장. 반반이에요는 두 글자를 같은 무게로 적은 문장, 그 밖에는 세기 문장 그대로.
 * lowered 이면(힌트가 기울어요를 반반이에요로 낮춘 주제) 「크게 기울지 않았어요」 대신 세기를 낮췄다는 사실을 말한다.
 */
export function strengthSentence(axis: Axis, shownLetter: Letter, band: StrengthBand, lowered: boolean = false): string {
  assertLetterOfAxis(axis, shownLetter);
  if (band === "even" && lowered) return loweredStrengthSentence(shownLetter);
  if (band === "even") return evenStrengthSentence(axis, shownLetter);
  return V40_STRENGTH[band].sentence;
}

/**
 * 반반이에요 주제에서 한쪽 방향에만 고른 답이 있을 때 세기 문장 아래에 붙는 한 줄: 「고른 답은 「H 마음 먼저」 쪽에만 있었지만 …」.
 * 답이 한쪽에만 있어도 모인 정도가 약하면 반반이에요라서(기울어요 경계 아래), 한쪽 목록만 채워진 것을 보고 세기 문장과 어긋난다고 읽지 않게 한다.
 * 힌트가 세기를 낮춘 주제에는 붙이지 않는다(그쪽은 세기 문장이 세기를 낮췄다는 사실을 말한다).
 */
export function evenOneSidedLine(letter: Letter): string {
  return `고른 답은 「${legendLetterCell(letter)}」 쪽에만 있었지만 모인 정도가 약해서 한쪽으로 기울었다고 보지는 않았어요.`;
}

/** 반반이에요 주제에서 한 방향으로 고른 답의 제목: 「H 마음 먼저 쪽으로 고른 답」 */
export function evenSideAnswersHeading(letter: Letter): string {
  return `${legendLetterCell(letter)} 쪽으로 고른 답`;
}

/** 「둘이 이야기해 봐요: ...」 */
export function talkLine(letter: Letter): string {
  return `${V40_LABELS.talk}: ${letterInfo(letter).talk}`;
}

/** 「이렇게 해 봐요: ...」 */
export function tryLine(letter: Letter): string {
  return `${V40_LABELS.tryThis}: ${letterInfo(letter).tryThis}`;
}

/**
 * 직접 고른 쪽 대비 문장(문서 7절, 주제 블록 안). 뚜렷해요는 「뚜렷하게 모였어요」, 기울어요는 「대체로 모였어요」.
 * 글자는 이름과 함께 낫표로 감싸 적는다(「F 가족과 정하기」): 글자만 적으면 뜻을 알 수 없고, 이름만 적으면 조사가 이름에 붙어 읽기 어렵다.
 */
export function selfContrastSentence(input: {
  readonly selfLetter: Letter;
  readonly gatheredLetter: Letter;
  readonly gatheredBand: "clear" | "lean";
}): string {
  const gathered = input.gatheredBand === "clear" ? "뚜렷하게 모였어요" : "대체로 모였어요";
  return `마지막에 직접 고른 쪽은 「${legendLetterCell(input.selfLetter)}」였어요. 여러 질문에서 고른 답은 「${legendLetterCell(input.gatheredLetter)}」 쪽으로 ${gathered}. 어느 쪽이 지금 나에게 더 가까운지 둘이 이야기해 봐도 좋아요.`;
}

/**
 * 자기 선택 세기(1 조금, 2 꽤, 3 아주)를 「아주 가까워요」 꼴로 적는다. 고른 답 덧말(V40_QUOTE_TEMPLATES 의 「아주 가까워요」 「조금 가까워요」)과
 * 두 가지 중 고르기 칸 이름표(pairCellAccessibleName)가 쓰는 낱말과 같다.
 */
export function selfLevelPhrase(level: 1 | 2 | 3): string {
  const label = V40_PAIR_LEVEL_LABELS[level - 1];
  if (label === undefined) throw new RangeError(`자기 선택 세기는 1에서 3이에요: ${String(level)}`);
  return `${label} 가까워요`;
}

/**
 * 주제 블록의 「내가 마지막에 직접 고른 쪽」 줄을 세 덩어리로 낸다(4.1 단계 1). 화면은 두 번째와 세 번째 덩어리를 줄바꿈 없이 붙여 그려서
 * 좁은 폭에서도 「· 꽤」와 「가까워요」가 갈라지거나 「D 나눠」와 「하기」가 갈라지지 않는다. 덩어리 사이에는 공백 한 칸이 들어간다.
 */
export function selfChoiceParts(line: SelfLine): { readonly label: string; readonly pick: string; readonly level: string } {
  assertLetterOfAxis(line.axis, line.letter);
  return {
    label: `${V40_COPY.block.selfLineLeadLabel}:`,
    pick: `「${legendLetterCell(line.letter)}」 ·`,
    level: selfLevelPhrase(line.level),
  };
}

/**
 * 주제 블록의 「내가 마지막에 직접 고른 쪽」 줄(4.1 단계 1): 「내가 마지막에 직접 고른 쪽: 「D 나눠 하기」 · 아주 가까워요」.
 * 본인이 고른 방향의 글자와 이름, 고른 세기만 적는다. 모은 답과 견주지 않고 어느 쪽이 맞다고 말하지 않는다.
 */
export function selfChoiceLine(line: SelfLine): string {
  const parts = selfChoiceParts(line);
  return `${parts.label} ${parts.pick} ${parts.level}`;
}

/** 코드 줄 전체의 낭독 이름. 예: 「웨딩코드 네 글자예요. 돈은 S 장면 먼저, 기울어요. ...」 */
export function codeLineAccessibleName(entries: readonly CodeLineEntry[]): string {
  const parts = entries.map((entry) => {
    const subject = TOPIC_SUBJECT[entry.axis];
    if (entry.letter === null || entry.band === null) return `${subject} 글자를 정하지 못했어요.`;
    assertLetterOfAxis(entry.axis, entry.letter);
    const provisional = entry.provisional ? `, ${V40_COPY.result.provisionalMark} 글자예요` : "";
    return `${subject} ${legendLetterCell(entry.letter)}, ${V40_STRENGTH[entry.band].label}${provisional}.`;
  });
  return `웨딩코드 네 글자예요. ${parts.join(" ")}`;
}

/** 글자 하나의 낭독 이름: 「S 장면 먼저, 기울어요」. 임시 글자는 뒤에 「, 임시」. */
export function letterAriaLabel(letter: Letter, band: StrengthBand, provisional: boolean = false): string {
  return `${legendLetterCell(letter)}, ${V40_STRENGTH[band].label}${provisional ? `, ${V40_COPY.result.provisionalMark}` : ""}`;
}

/**
 * 코드 복사로 나가는 글. 글자와 뜻과 세기만 담고 답과 고지 문장은 담지 않는다.
 * 반반이에요에는 항상 「반반이에요」가 붙고 임시 글자에는 「임시」가 붙는다. 글자를 못 정한 주제는 코드에 「·」로 적고 뜻 자리에 「<주제> · 정하지 못했어요」.
 * 예: 웨딩코드 SWUA (S 장면 먼저 · 기울어요, W 같이 하기 · 뚜렷해요, U 둘이 정하기 · 기울어요, A 할 일 먼저 · 반반이에요)
 */
export function codeCopyText(entries: readonly CodeLineEntry[]): string {
  const code = entries.map((entry) => entry.letter ?? UNSET_MARK).join("");
  const parts = entries.map((entry) => {
    if (entry.letter === null || entry.band === null) return `${axisInfo(entry.axis).topic} · ${V40_COPY.legend.notSetLabel}`;
    assertLetterOfAxis(entry.axis, entry.letter);
    return `${legendLetterCell(entry.letter)} · ${V40_STRENGTH[entry.band].label}${entry.provisional ? ` · ${V40_COPY.result.provisionalMark}` : ""}`;
  });
  return `웨딩코드 ${code} (${parts.join(", ")})`;
}

// ---------------------------------------------------------------------------
// 도우미: 인용 문구 서식(present.answerText 의 형식별 서식과 같다)
// ---------------------------------------------------------------------------

/** 내가 고른 답 한 줄의 서식. present.answerText, answerLabel 이 같은 서식을 쓰도록 여기에 둔다. 해석을 덧붙이지 않는다. */
export const V40_QUOTE_TEMPLATES = {
  /** 두 가지 중 고르기에서 세기가 아주일 때 카드 원문 뒤에 붙인다. */
  pairStrongSuffix: " (아주 가까워요)",
  /** 이럴 때 내 마음에서 안쪽 칸(바깥 칸이 아닌)일 때 끝 이름 뒤에 붙인다. */
  reactNearSuffix: " (조금 가까워요)",
  /** 캡션과 원문을 잇는다: 「첫 주말의 대화: ...」 */
  label(caption: string, text: string): string {
    return `${caption}: ${text}`;
  },
  /** 이럴 때 내 마음: 작성 필드 recap 과 고른 쪽 끝 이름을 잇는다. */
  react(recap: string, endName: string, near: boolean): string {
    return `${recap} ${endName}${near ? V40_QUOTE_TEMPLATES.reactNearSuffix : ""}`;
  },
  /** 가장·가장 아닌 것: 가장 나 같은 것 카드 원문(요로 끝남)을 넣는다. 조사는 항상 를. */
  bestWorst(cardText: string): string {
    return `가장 나 같은 것으로 「${cardText}」를 골랐어요`;
  },
  /** 칸 나누기: 고른 쪽 항목 원문과 그 항목에 놓은 칸 수. */
  split(chunks: number, entryText: string): string {
    return `${V40_SPLIT_TOTAL}칸 중 ${chunks}칸을 「${entryText}」에 놓았어요`;
  },
} as const;

// ---------------------------------------------------------------------------
// 도우미: 지난번과 비교
// ---------------------------------------------------------------------------

/** 비교 표의 한 칸: 「S 장면 먼저 · 기울어요」(임시는 뒤에 「 · 임시」), 글자를 못 정했으면 「정하지 못했어요」. 글자에는 늘 이름이 붙는다. */
export function historyCell(letter: Letter | null, band: StrengthBand | null, provisional: boolean): string {
  if (letter === null) return V40_COPY.legend.notSetLabel;
  const strength = band === null ? "" : ` · ${V40_STRENGTH[band].label}`;
  return `${legendLetterCell(letter)}${strength}${provisional ? ` · ${V40_COPY.result.provisionalMark}` : ""}`;
}

/**
 * 비교 첫 줄. dateText 는 koreanDateLabel 의 결과(빈 문자열이면 날짜 없이).
 * anyChanged 는 「주제 중 하나라도 달라졌어요 꼬리표가 붙었다」이다(두 번 모두 기울어요 이상인데 글자가 다른 주제).
 * 글자가 겉으로만 다르게 보이는 경우(반반이에요가 낀 주제는 바뀌기 쉬운 주제예요 꼬리표만 붙는다)는 세지 않는다. 그래서 false 일 때
 * 「달라진 글자가 없어요」나 「글자가 같아요」라고 하면 표에 다른 글자가 보이는 경우와 어긋난다. 무엇을 기준으로 봤는지를 함께 말한다.
 */
export function historyLead(dateText: string, anyChanged: boolean): string {
  const when = dateText === "" ? "지난번" : `지난번(${dateText})`;
  return anyChanged
    ? `${when}과 달라진 글자가 있어요.`
    : `${when}과 비교했어요. 두 번 모두 뚜렷하거나 기울었는데 글자가 달라진 주제는 없어요.`;
}

/** 받침이 없으면 는, 있으면 은. 한글 음절이 아니면 는. */
function eunNeun(word: string): "은" | "는" {
  const code = word.trim().slice(-1).charCodeAt(0) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0 ? "은" : "는";
}

/**
 * 글자가 바뀐 주제 한 줄: 「돈을 정할 때는 「V 조건 먼저」에서 「S 장면 먼저」로 바뀌었어요.」 주제 이름 뒤에 은, 는을 붙여
 * 「함께 정하는 사람은 「U 둘이 정하기」에서 「F 가족과 정하기」로 바뀌었어요.」처럼도 읽히게 한다.
 * 글자는 이름과 함께 낫표로 감싼다(글자만 적으면 뜻을 알 수 없다). 낫표 뒤 조사는 에서, 로로 고정이다.
 */
export function historyChangedLine(axis: Axis, from: Letter, to: Letter): string {
  assertLetterOfAxis(axis, from);
  assertLetterOfAxis(axis, to);
  const title = axisInfo(axis).title;
  return `${title}${eunNeun(title)} 「${legendLetterCell(from)}」에서 「${legendLetterCell(to)}」로 바뀌었어요.`;
}

// ---------------------------------------------------------------------------
// 도우미: 두 사람 결과
// ---------------------------------------------------------------------------

export type CouplePerson = "first" | "second";

/**
 * 표 머리와 이름표에 쓰는 사람 이름. perspective 는 내가 누구인지(first 는 먼저 답한 사람이 나, second 는 나중에 답한 사람이 나),
 * null 이면 아직 모르므로 먼저 답한 사람 / 나중에 답한 사람.
 */
export function personName(perspective: Perspective | null, person: CouplePerson): string {
  if (perspective === null) return person === "first" ? V40_COPY.couple.perspective.firstLabel : V40_COPY.couple.perspective.secondLabel;
  return perspective === person ? V40_COPY.couple.perspective.meLabel : V40_COPY.couple.perspective.partnerLabel;
}

/**
 * 고른 답 글 끝에 붙는 덧말(「 (아주 가까워요)」 「 (조금 가까워요)」)을 뗀 글. 두 사람이 같은 보기를 다른 세기로 골랐는지 알아보고,
 * 그 보기 원문을 한 번만 적을 때 쓴다. 덧말이 없으면 그대로다.
 * 먼저 이야기해 볼 질문과 이미 비슷하게 고른 질문의 답은 이름표(personName) 아래에 보기 원문을 그대로 적는다. 이름표에 조사를 붙여 보기 앞에 잇지 않는다:
 * 보기 글이 「~하던 순간」처럼 명사로 끝나거나 남의 이야기(「둘 다 ~한 커플이에요」)이면 「나는 …」으로 이은 문장이 어색하거나 틀려진다.
 */
export function withoutQuoteQualifier(text: string): string {
  for (const suffix of [V40_QUOTE_TEMPLATES.pairStrongSuffix, V40_QUOTE_TEMPLATES.reactNearSuffix]) {
    if (text.endsWith(suffix)) return text.slice(0, text.length - suffix.length);
  }
  return text;
}

/**
 * 「나 기준으로 보기」에서 사람이 기준을 골랐을 때 낭독기에 알리는 한 줄. 고르면 아래 주제별 줄과 질문 목록의 나와 상대가 바뀌는데
 * 화면 글이 바뀌기만 해서는 낭독기 사용자가 무엇이 바뀌었는지 알 수 없다.
 */
export function perspectiveChangedAnnouncement(perspective: Perspective): string {
  const option = perspective === "first" ? V40_COPY.couple.perspective.iAmFirstOption : V40_COPY.couple.perspective.iAmSecondOption;
  return `「${option}」를 골랐어요. 아래 줄의 나와 상대를 바꿔 적었어요.`;
}

/** 두 사람 결과의 글자 칸: 「S 장면 먼저 · 기울어요」(임시는 뒤에 「 · 임시」), 글자를 못 정했으면 「정하지 못했어요」. */
export function letterBandCell(letter: Letter | null, band: StrengthBand | null, provisional: boolean): string {
  if (letter === null) return V40_COPY.legend.notSetLabel;
  const strength = band === null ? "" : ` · ${V40_STRENGTH[band].label}`;
  return `${legendLetterCell(letter)}${strength}${provisional ? ` · ${V40_COPY.result.provisionalMark}` : ""}`;
}

/**
 * 태그 아래 안내 한 줄. 같은 글자는 「같은 쪽이어도 이유는 다를 수 있어요」, 다른 글자는 그 주제의 다른 글자 안내,
 * 반반이에요는 같은지 다른지 말하지 않는다는 안내, 비교에서 뺀 주제(excluded)는 뺐다는 안내.
 * 같은 말이 줄마다 되풀이되지 않도록 화면 빌더는 같은 글자 안내를 같은 글자 줄 중 첫 줄에만 붙인다(V40_COPY_SCREENS 위의 구성 규칙).
 */
export function coupleTagNote(axis: Axis, tag: "same" | "different" | "even", excluded: boolean): string {
  if (excluded) return V40_COPY.couple.excludedTagNote;
  if (tag === "same") return `${V40_SAME_LETTER_NOTE}.`;
  if (tag === "different") return `${axisInfo(axis).differentNote}.`;
  return V40_COPY.couple.evenTagNote;
}

// ===========================================================================
// 추가 문구: 화면 빌더 C(두 사람 결과와 보내기). V40_COPY 에 없어서 여기에 따로 모았다.
// 리드가 원하면 V40_COPY.couple.axesHeading, V40_COPY.send.sharedSheet 로 옮기고 이 객체를 지운다.
// ===========================================================================

export const V40_COUPLE_SEND_EXTRA_COPY = {
  /** 두 사람 결과: 주제별 나란히 보기 목록의 제목. */
  axesHeading: "주제별로 나란히 보기",
  /** 링크 보내기: 공유 창을 끝까지 마쳤을 때 한 줄. 클립보드에 복사한 것이 아니라서 send.copied 와 다르게 말한다. */
  sharedSheet: "공유 창으로 링크를 보냈어요.",
} as const;

// ===========================================================================
// 추가 문구: 화면 빌더 Q(시작과 질문 흐름). V40_COPY 에 없어서 여기에 따로 모았다.
// 자동 저장을 끄면 저장된 답이 지워진다는 것을 끄기 전에 알린다(계약 문서 9.3절: 끄는 화면은 이전 판의 저장된 답도 지운다는 것을
// 화면에서 알리거나 지우기 전에 한 번 묻는다). 리드가 원하면 V40_COPY.autosave 로 옮기고 이 함수를 지운다.
// ===========================================================================

/**
 * 자동 저장이 켜져 있을 때 끄기 단추 옆에 붙이는 한 줄. 끄면 지워지는 것을 끄기 전에 알린다.
 * saved 는 이 브라우저에 하던 답이 남아 있음(끄면 그 답과 지난번 비교용 기록이 함께 지워진다), legacy 는 이전 웨딩코드의 저장된 답이 남아 있음.
 * 둘 다 아니어도 지난번 비교용 기록만 남아 있을 수 있다(처음부터 다시 하기는 그 기록을 남긴다). 끄면 그 기록도 지워지므로 늘 한 줄을 준다.
 */
export function autosaveTurnOffWarning(scope: { readonly saved: boolean; readonly legacy: boolean }): string {
  if (scope.saved && scope.legacy) {
    return "자동 저장을 끄면 이 브라우저에 저장된 답과 지난번 비교용 기록, 이전 웨딩코드에 남겨 둔 답이 함께 지워져요.";
  }
  if (scope.legacy) return "자동 저장을 끄면 이전 웨딩코드에 남겨 둔 답과 지난번 비교용 기록이 이 브라우저에서 지워져요.";
  return "자동 저장을 끄면 이 브라우저에 저장된 답과 지난번 비교용 기록이 지워져요.";
}

// ===========================================================================
// 추가 문구: 클라이언트 빌더(app/wedding-code/WeddingCodeV40Client.tsx). V40_COPY 에 없어서 여기에 따로 모았다.
// 두 사람 결과 링크를 연 화면은 주소의 뒷부분을 지우기 때문에 새로고침하면 결과가 사라진다. 받는 사람 묶음의 같은 안내(receive.reloadNote)는
// 「상대의 답」이라고 말해서 두 사람의 답이 함께 든 이 화면에는 맞지 않는다. 리드가 원하면 V40_COPY.couple 로 옮기고 이 객체를 지운다.
// ===========================================================================

export const V40_CLIENT_COPY = {
  /** 두 사람 결과 링크로 열었을 때 결과 위에 한 줄. */
  coupleReloadNote: "이 화면을 새로고침하면 두 사람의 결과가 화면에서 사라져요. 그럴 때는 받은 링크를 다시 열어 주세요.",
  /**
   * 받은 링크로 열었다가 새로고침한 화면에 주는 안내(주소의 # 뒤를 지웠기 때문에 새로고침하면 링크의 답이 화면에서 사라진다).
   * 미리 해 둔 경고(receive.reloadNote, coupleReloadNote)는 새로고침하기 전에만 읽히므로, 새로고침한 뒤에도 무슨 일이 있었는지 말한다.
   * intro = 시작 화면과 하던 답 카드 위, result = 하던 답을 이어서 혼자 보는 결과 위. 링크에는 답이 그대로 남아 있어서 다시 열면 돌아온다.
   */
  linkLost: {
    intro: {
      partner: "상대가 보낸 링크로 열었는데 화면을 새로고침해서 상대의 답이 화면에서 사라졌어요. 받은 링크를 다시 열면 돌아와요.",
      both: "두 사람 결과 링크로 열었는데 화면을 새로고침해서 결과가 화면에서 사라졌어요. 받은 링크를 다시 열면 돌아와요.",
    },
    result: {
      partner: "이 결과에는 상대의 답이 들어 있지 않아요. 받은 링크를 다시 열면 상대의 답이 돌아와요.",
      both: "두 사람 결과는 화면에서 사라졌어요. 받은 링크를 다시 열면 다시 볼 수 있어요.",
    },
  },
} as const;
