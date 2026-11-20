/**
 * 실제 커플 화면에만 필요한 문장(2026-11-17). 아티팩트는 예시 커플의 꽉 찬 화면만 그렸으므로,
 * 빈 상태·승인 상태·조건 묻기처럼 아티팩트에 없는 순간의 글자를 여기에 모은다.
 * 아티팩트 문구와 같은 말투로 쓴다(짧은 해요체, 줄표·겹친 부정·시스템 말투·명사형 끝 없음).
 * 웹과 앱이 이 파일을 함께 읽는다. 화면 파일에 같은 글자를 다시 적지 않는다.
 */

export const FIRST_CHAT_INPUT_COPY = {
  /** 달 고르기 다음, 지역과 하객 수를 묻는 아모라의 말. */
  askWhereAndGuests: "어느 지역에서, 하객은 몇 명쯤 생각하세요?",
  regionLabel: "지역",
  guestsLabel: "하객 수",
  guestChoices: [100, 150, 200, 250, 300] as const,
  guestChoiceLabel: (guests: number) => (guests >= 300 ? "300명 이상" : `${guests}명`),
  answerDone: "이대로 할게요",
  saving: "저장하고 있어요",
  saveFailed: "저장하지 못했어요. 다시 눌러 주세요.",
  /** 첫 대화를 건너뛰고 청첩장 홈으로 간다. 이미 쓰던 커플이 새 질문에 갇히지 않게 한다. */
  later: "나중에 할게요",
} as const;

/**
 * 첫 대화를 건너뛴 커플의 홈에 "두 분이 정할 것" 한 줄로 조건을 다시 묻는다.
 * 누르면 첫 대화로 간다.
 */
export const ASK_CONDITIONS_COPY = {
  title: "희망 시기와 지역 알려 주기",
  sub: "알려 주시면 웨딩홀을 같은 기준으로 맞춰 볼게요.",
} as const;

export const COMPARE_STATE_COPY = {
  needConditions: "희망 시기와 지역, 하객 수를 알려 주시면 같은 기준으로 맞춰 볼게요.",
  needConditionsAction: "조건 알려 주기",
  noHalls: "아직 조건에 맞춰 확인한 웨딩홀이 없어요.",
  noHallsSub: "담당자가 출처와 확인 날짜를 확인한 곳만 여기에 보여 드려요.",
  pickFirst: "상담받고 싶은 곳에 하트를 눌러 담아 주세요.",
  loadFailed: "웨딩홀을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.",
} as const;

export const LETTER_STATE_COPY = {
  approverHeading: "누가 승인할까요?",
  approverBoth: "두 사람 모두",
  approverPerson: (name: string) => name,
  approverUnset: "아직 승인할 사람을 정하지 않았어요. 한 분이 승인하면 두 분 모두에게 알려 드려요.",
  approverDesignated: (name: string) => `${name} 님이 승인하면 보낼 수 있어요.`,
  approverNeedsBoth: "두 분 모두 승인해야 보낼 수 있어요.",
  waitingFor: (name: string) => `${name} 님의 승인을 기다리고 있어요.`,
  approvedNotSent: "승인을 저장했어요. 지금은 문의를 보내지 않고 있어서, 편지는 아직 업체에 가지 않았어요.",
  dailyCap: "오늘 보낼 수 있는 문의를 다 썼어요. 내일 다시 보낼게요.",
  queued: (count: number) => `승인한 편지를 ${count}곳에 보낼 준비를 마쳤어요.`,
  alreadySent: "이 편지는 이미 보냈어요. 같은 편지를 두 번 보내지 않아요.",
  versionChanged: "편지 내용이 바뀌었어요. 바뀐 편지를 다시 확인해 주세요.",
  needShortlist: "편지를 쓰려면 먼저 상담받고 싶은 웨딩홀을 담아 주세요.",
  saveFailed: "편지를 저장하지 못했어요. 다시 눌러 주세요.",
  loadFailed: "편지를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.",
  approverUnavailable: "지금은 승인할 사람을 고를 수 없어요. 두 분이 연결돼 있으면 고를 수 있어요.",
  /** 상대의 승인 권한을 줄이는 변경은 상대가 확인해야 바뀐다(2026-11-17 보안 검토, D-76). */
  approverPending: "상대가 확인하면 바뀌어요.",
  /** `choice` 는 "두 사람 모두" 또는 승인할 사람의 이름. */
  approverProposedBy: (name: string, choice: string) =>
    `${name} 님이 승인할 사람을 ${withToParticle(choice)} 바꾸자고 했어요.`,
  approverConfirm: "이대로 바꿀게요",
  approverDecline: "지금대로 둘게요",
} as const;

/**
 * 낱말 뒤 "로/으로". 마지막 글자에 받침이 있고 그 받침이 ㄹ 이 아니면 "으로"(지훈으로),
 * 받침이 없거나 ㄹ 이면 "로"(민지로, 두 사람 모두로, 서울로). 한글이 아니면 "로".
 */
export function withToParticle(word: string): string {
  const trimmed = word.trim();
  const code = trimmed.slice(-1).charCodeAt(0);
  const isHangulSyllable = code >= 0xac00 && code <= 0xd7a3;
  const finalConsonant = isHangulSyllable ? (code - 0xac00) % 28 : 0;
  const needsEuro = finalConsonant !== 0 && finalConsonant !== 8;
  return `${trimmed}${needsEuro ? "으로" : "로"}`;
}

export const CONSULTATION_STATE_COPY = {
  none: "아직 잡힌 상담이 없어요.",
  noneSub: "업체 답장이 오면 날짜와 시간을 여기에 보여 드려요.",
  addToCalendar: "일정에 넣기",
  added: "일정에 넣었어요",
  loadFailed: "상담 일정을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.",
  fullSchedule: "전체 일정 보기",
} as const;

export const JOURNEY_STATE_COPY = {
  loadFailed: "준비 순서를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.",
  saveFailed: "바꾼 순서를 저장하지 못했어요. 다시 눌러 주세요.",
} as const;

export const HOME_STATE_COPY = {
  noDecisions: "지금 두 분이 정할 것은 없어요.",
  loadFailed: "청첩장 홈을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.",
  decisionsUnavailable: "정할 것 목록을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.",
} as const;

export const COMMON_STATE_COPY = {
  saveFailed: "저장하지 못했어요. 다시 눌러 주세요.",
} as const;

export const ACTIVITY_COPY = {
  empty: "오늘은 아직 한 일이 없어요.",
  /** 활동의 주체 표시. 운영 담당자가 한 일을 아모라가 한 것처럼 보이지 않게 한다. */
  actorLabel: { amora: "아모라", operator: "담당자", couple: "두 분" } as const,
} as const;
