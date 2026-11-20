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

/**
 * D-83 1단계(2026-11-18): 편지를 두 분 폰에서 직접 보낸다. 아모라는 보내지 않는다.
 * 그래서 이 문장들은 "보냈어요"라고 말하지 않는다. 공유 창이나 문자 앱이 열린 것까지만 안다.
 * 모든 문장은 파운더 확인 전 제안이다(D-12).
 */
export const SELF_SEND_COPY = {
  title: (count: number) => (count > 1 ? `${count}곳에 직접 보내 주세요` : "직접 보내 주세요"),
  intro: "아모라가 쓴 편지를 두 분 폰에서 보내요. 업체마다 복사하거나 문자로 열어 주세요.",
  save: "이 편지로 할게요",
  saving: "저장하고 있어요",
  saveFirst: "고친 내용을 저장하면 보낼 글이 나와요.",
  /** 아직 저장한 판이 없거나 담은 웨딩홀이 바뀌어 다시 저장해야 할 때. 저장 단추 위에 보인다. */
  beforeSave: "편지를 저장하면 업체마다 보낼 글이 나와요.",
  messageFor: (name: string) => `${name}에 보낼 글`,
  copy: "복사",
  copied: "복사했어요. 문자나 카톡에 붙여 넣어 주세요.",
  /** 컴퓨터에서도 읽히므로 "길게 눌러"가 아니라 고르는 것으로 말한다(폰에서는 길게 눌러 고른다). */
  copyFailed: "복사하지 못했어요. 글을 직접 골라 복사해 주세요.",
  /** 공유 창이나 문자 앱이 열리지 않아 대신 글을 복사했을 때. */
  copiedInstead: "앱을 열지 못해 글을 복사했어요. 문자나 카톡에 붙여 넣어 주세요.",
  share: "공유",
  /** 공유 창이 닫힌 뒤에 읽히기도 하므로(아이폰·웹) 지난 일로 말한다. */
  shareOpened: "공유 창을 열었어요.",
  sms: "문자로 열기",
  smsOpened: "문자 앱을 열었어요. 받는 번호를 넣어 보내 주세요.",
  findHall: "네이버에서 찾아보기",
  findHallFailed: "네이버를 열지 못했어요.",
  phoneOmitted: "휴대폰 번호는 글에 넣지 않았어요. 필요하면 보내기 전에 적어 주세요.",
  /** 일정에 넣는 것은 사람이 누를 때만이다. 저절로 넣는 것처럼 말하지 않는다. */
  afterSend: "업체 답이 오면 상담 화면에 붙여 넣어 주세요. 찾은 날짜를 누르면 일정에 넣을 수 있어요.",
  openConsultation: "상담 화면 열기",
  /**
   * 직접 보내기가 켜진 서버에 옛 앱이 승인(또는 승인 방식 바꾸기)을 보내면 이 말로 돌려보낸다. 옛 앱은 편지 화면을
   * 다시 열어도 같은 승인 단추를 보이므로 업데이트를 말한다.
   */
  approveRefused: "지금은 두 분이 편지를 직접 보내요. 앱을 업데이트하거나 화면을 새로 고친 뒤 다시 열어 주세요.",
  missingConditions: "희망 시기와 하객 수를 알려 주시면 편지에 넣을게요.",
  /** 하나만 비었을 때. 이미 알려 준 것을 다시 묻지 않는다. */
  missingMonth: "희망 시기를 알려 주시면 편지에 넣을게요.",
  missingGuests: "하객 수를 알려 주시면 편지에 넣을게요.",
  missingConditionsAction: "조건 알려 주기",
  /** 업체에 가는 글의 첫 줄과 덧붙이는 줄. 글은 저장된 판으로만 엮는다. */
  greeting: "안녕하세요.",
  budgetLine: (amount: string) => `예산은 ${amount} 정도예요.`,
  budgetUnsetLine: "예산은 아직 정하지 않았어요.",
  aiNote: "AI 웨딩 비서의 도움을 받아 쓴 문의예요.",
} as const;

/**
 * D-83 1단계: 업체에게 받은 답을 붙여 넣으면 이 기기 안에서만 읽어 날짜·시간·금액을 보여 준다.
 * 붙여 넣은 글은 서버로도 아모라에게도 가지 않는다. 일정에 넣는 것은 사람이 누를 때만이다.
 * 칩은 업체가 쓴 값을 옮길 뿐 좋고 나쁨을 말하지 않는다.
 */
export const VENDOR_REPLY_COPY = {
  open: "받은 답 붙여 넣기",
  helper: "업체에서 받은 문자나 카톡을 붙여 넣으면 날짜와 금액을 찾아 드려요. 붙여 넣은 글은 이 기기에서만 읽고 저장하지 않아요.",
  inputLabel: "업체에게 받은 답",
  placeholder: "업체 답을 여기에 붙여 넣어 주세요",
  read: "날짜와 금액 찾기",
  again: "다시 붙여 넣기",
  close: "닫기",
  foundHeading: "업체 답에 적힌 것",
  none: "날짜나 금액을 찾지 못했어요. 날짜를 직접 골라 일정에 넣을 수 있어요.",
  quoteLabel: "업체가 쓴 말",
  masked: (count: number) => `연락처와 링크, 번호 ${count}곳은 가리고 보여 드려요.`,
  maskLabels: {
    link: "[링크]",
    email: "[메일]",
    code: "[인증번호]",
    resident: "[주민번호]",
    card: "[카드번호]",
    account: "[계좌번호]",
    phone: "[전화번호]",
  },
  caution: "계좌나 결제 이야기가 있어요. 돈을 보내기 전에 알고 있는 업체 번호로 직접 확인해 보세요.",
  truncated: "글이 길어서 앞부분만 읽었어요.",
  hallLabel: "어느 웨딩홀 답인가요?",
  noHalls: "담은 웨딩홀이 없어요. 웨딩홀을 먼저 담아 주세요.",
  /** 담은 웨딩홀이 없을 때 웨딩홀 비교 화면으로 가는 단추. */
  noHallsAction: "웨딩홀 보러 가기",
  /** 고를 웨딩홀이 없어 날짜 칸도 없을 때는 `none` 의 뒤 문장(직접 골라 넣을 수 있어요)을 말하지 않는다. */
  noneOnly: "날짜나 금액을 찾지 못했어요.",
  /** 붙여 넣은 답으로 넣은 상담이 있을 때 "아직 잡힌 상담이 없어요" 대신. 그 상담은 일정 화면에 있다. */
  addedSoFar: (count: number) => `일정에 넣은 상담이 ${count}개 있어요.`,
  dateLabel: "상담 날짜",
  timeLabel: "상담 시간",
  noTime: "시간 없이 넣기",
  meridiemQuestion: "오전인가요, 오후인가요?",
  am: "오전",
  pm: "오후",
  add: "이 날짜로 일정에 넣기",
  adding: "넣고 있어요",
  added: "일정에 넣었어요.",
  alreadyAdded: "이미 일정에 있어요.",
  failed: "일정에 넣지 못했어요. 다시 눌러 주세요.",
  pickHall: "웨딩홀을 먼저 골라 주세요.",
  pickDate: "날짜를 골라 주세요.",
  /** 웹의 시간 칸에 시만 고르고 분을 비운 것처럼 덜 고른 시간이 남았을 때. */
  timeIncomplete: "시간을 끝까지 골라 주세요.",
  /** 시간을 손으로 적는 칸(앱)에 "HH:MM" 이 아닌 값을 적었을 때. */
  timeInvalid: "시간을 14:00처럼 적어 주세요.",
  /** 일정에 넣을 수 있는 날짜(한국 날짜 기준 지난 30일부터 3년 뒤까지) 밖을 골랐을 때. */
  dateOutOfRange: "지난 30일부터 3년 뒤까지의 날짜만 넣을 수 있어요.",
  /** 상담 화면에 아직 잡힌 상담이 없을 때, 직접 보내기에서 그 아래 한 줄(업체 답은 두 분 폰으로 온다). */
  emptySub: "업체에 편지를 보내고 답이 오면 아래에 붙여 넣어 주세요.",
  /** 업체가 적은 요일이 그 날짜의 달력 요일과 다를 때(칩은 달력 요일을 보인다). */
  weekdayMismatch: "업체가 적은 요일과 달력의 요일이 달라요. 날짜를 한 번 더 확인해 주세요.",
  weekdays: ["일", "월", "화", "수", "목", "금", "토"] as const,
  /** 올해가 아닌 날짜는 해를 함께 적는다(해가 없는 "11월 16일"을 내년으로 읽었을 때 보이게). */
  dateChip: (month: number, day: number, weekday: string, year?: number) =>
    `${year ? `${year}년 ` : ""}${month}월 ${day}일 (${weekday})`,
  /** 업체가 오전·오후를 적지 않았으면 meridiem 은 null 이고, 칩에도 적지 않는다(누를 때 묻는다). */
  timeChip: (meridiem: string | null, hour: number, minute: number) =>
    `${meridiem ? `${meridiem} ` : ""}${hour}시${minute === 0 ? "" : ` ${minute}분`}`,
  countChip: (count: number) => `보증 인원 ${count}명`,
  priceChip: (subject: string | null, amount: string) => (subject ? `${subject} ${amount}` : amount),
  /** 업체가 범위로 적은 금액("300~400만원")은 두 끝을 함께 적는다. 위쪽 끝만 적으면 그것이 업체가 말한 값처럼 읽힌다. */
  priceRangeChip: (from: string, to: string) => `${from} ~ ${to}`,
} as const;
