/**
 * 청첩장 디자인(2026-11-17)의 고정 문구. 파운더가 만든 디자인 아티팩트
 * "아모라 AI 웨딩비서 · 서비스 화면 예시"의 화면 글자를 그대로 옮겼다.
 * 파운더 원문: "이 디자인 완전 같아야해".
 *
 * 웹과 네이티브가 이 파일 하나를 읽는다. 커플마다 다른 값(이름·날짜·업체)은 함수 인자로 받는다.
 * 문구를 바꾸려면 여기서 바꾼다 — 화면 파일에 같은 글자를 다시 적지 않는다.
 */

export const START_COPY = {
  wordmark: "amora",
  tagline: "두 사람의 웨딩 비서",
  headingLines: ["청첩장을 보내는 날까지,", "준비는 제가 챙길게요"],
  // 파운더 확정(11-18): 공개 화면은 오늘 되는 것만 약속한다. 웨딩홀 비교와 상담 문의 보내기는 운영에
  // 아직 열리지 않아(홀 자료 0곳, 보내기 스위치 꺼짐) 아티팩트 원문 대신 오늘 되는 일(준비 순서, 두 분이
  // 정할 것)을 말한다. 줄 수를 원문과 맞췄다: 웹 시작 카드에서 390px 세 줄(마지막 줄 "요."), 440px 두 줄
  // (2026-11-18 같은 Chrome 으로 잼). 줄 수가 달라지면 카드 높이가 바뀌어 제목과 오브 사이가 달라진다.
  body: "원하는 시기와 지역만 알려주세요. 두 분에게 맞는 준비 순서를 세우고, 정할 것을 하나씩 챙겨 드릴게요.",
  start: "시작하기",
  example: "예시 커플로 둘러보기",
} as const;

export type PreparationStartStage = "start" | "researching" | "booked";

export const FIRST_CHAT_COPY = {
  back: "뒤로",
  listening: "듣고 있어요",
  greeting: "반가워요, 아모라예요. 지금까지 정해진 게 있나요?",
  stages: [
    { id: "start", label: "이제 시작해요", answer: "이제 시작이에요" },
    { id: "researching", label: "조금 알아봤어요", answer: "조금씩 알아보는 중이에요" },
    { id: "booked", label: "예약한 곳이 있어요", answer: "이미 예약한 곳이 있어요" },
  ] as const satisfies readonly { id: PreparationStartStage; label: string; answer: string }[],
  askWhen: "예식은 언제쯤 생각하세요? 대략적인 시기여도 괜찮아요.",
  monthsNote: "희망 시기로 저장돼요",
  months: [3, 4, 5, 6, 9, 10, 11, 12] as const,
  monthLabel: (month: number) => `${month}월`,
  draftIntro: "청첩장 초안에 이렇게 적어 둘게요. 빈칸은 하나씩 같이 채워요.",
  draftLine: (region: string, guests: number) => `${region} 어딘가에서, ${guests}명의 하객과 함께`,
  // 하객 칩의 마지막 칸은 "300명 이상"이라, 그 칸을 고르면 "정도"가 아니라 "이상"이라고 답한다.
  regionGuestsAnswer: (region: string, guests: number) =>
    guests >= 300 ? `${region}에서, 하객은 300명 이상이요` : `${region}에서, 하객은 ${guests}명 정도요`,
  confirm: "좋아요, 홀 찾아 주세요",
  edit: "고칠게요",
} as const;

export const HOME_COPY = {
  wordmark: "amora",
  blanksLeft: (count: number) => `청첩장 빈칸 ${count}개 남음`,
  whatDidYouDo: "무엇을 했나요?",
  fold: "접기",
  decisionsHeading: "두 분이 정할 것",
  together: "함께",
  nav: {
    label: "주요 메뉴",
    home: "청첩장 홈",
    chat: "아모라와 대화",
    journey: "준비 순서",
    schedule: "일정",
  },
} as const;

export const INVITATION_TEXT = {
  eyebrow: "우리 결혼합니다",
  joiner: "그리고",
  venuePending: "예식장을 고르고 있어요",
} as const;

export const JOURNEY_COPY = {
  back: "홈으로",
  title: "준비 순서",
  intro: "두 분에게 필요한 것만 남겨 두세요. 뺀 항목은 언제든 다시 넣을 수 있어요.",
  remove: "빼기",
  restore: "다시 넣기",
  removedSub: "이번 계획에서는 뺐어요",
  done: "완료",
  confirm: "이 순서로 할게요",
} as const;

export const COMPARE_COPY = {
  back: "홈으로",
  amora: "아모라",
  intro: (guests: number, month: number | null) =>
    month === null
      ? `${guests}명 기준으로 같은 조건에 맞춰 봤어요. 예약 가능일은 업체에 확인해야 해요.`
      : `${guests}명 기준으로 같은 조건에 맞춰 봤어요. ${month}월 예약 가능일은 업체에 확인해야 해요.`,
  rows: { meal: "식대 1인", rent: "대관료", minimum: "최소 보증", transit: "찾아가기" },
  manwon: "만 원",
  heartLabel: (name: string) => `${name} 상담 후보에 담기`,
  photoAlt: (name: string) => `${name} 분위기`,
  sorts: [
    { id: "total", label: "총액 순" },
    { id: "transit", label: "교통" },
    { id: "minimum", label: "보증 인원" },
    { id: "mood", label: "분위기" },
  ] as const,
  sourceNote: (dateLabel: string) => `업체가 공개한 가격으로 계산했어요. ${dateLabel} 기준이에요.`,
  // 파운더 결정 D-83(11-18): 1단계는 두 분이 자기 휴대폰으로 보낸다. 아티팩트 원문 "담은 N곳에 상담 문의하기"와
  // 일부러 다르다.
  inquire: (count: number) => `담은 ${count}곳에 문의 편지 쓰기`,
} as const;

export type CompareSortId = (typeof COMPARE_COPY.sorts)[number]["id"];

/**
 * 이름 뒤 "와/과". 마지막 글자에 받침이 있으면 "과"(지훈과), 없으면 "와"(민지와).
 * 한글 음절이 아니면(영문 이름 등) 받침을 알 수 없어 "와"를 쓴다.
 */
export function withAndParticle(name: string): string {
  const last = name.trim().slice(-1);
  const code = last.charCodeAt(0);
  const isHangulSyllable = code >= 0xac00 && code <= 0xd7a3;
  const hasFinalConsonant = isHangulSyllable && (code - 0xac00) % 28 !== 0;
  return `${name.trim()}${hasFinalConsonant ? "과" : "와"}`;
}

/**
 * 파운더 결정 D-83(11-18): 1단계는 아모라가 문의 편지를 쓰고 두 분이 자기 휴대폰으로 업체마다 보낸다.
 * dialogLabel·title·partnerRead·send 는 아티팩트 원문("상담 문의 보내기 전 확인", "이 편지를 N곳에 보낼까요?",
 * "…같은 편지를 두 번 보내지 않아요.", "N곳에 보내기")과 일부러 다르다. send 에는 숫자를 쓰지 않는다.
 * 지금 이 버튼은 승인 저장 흐름이고, 문자 앱을 여는 1단계 보내기는 아직 없다(PR #531 남은 일).
 */
export const LETTER_COPY = {
  dialogLabel: "상담 문의 편지 확인",
  title: (count: number) => `${count}곳에 보낼 편지예요`,
  to: (names: readonly string[]) => `${names.join(", ")}께`,
  signature: (first: string, second: string | null) =>
    second ? `${withAndParticle(first)} ${second} 드림` : `${first} 드림`,
  editText: "문구 고치기",
  sharesHeading: "편지와 함께 알려줄 정보",
  shares: {
    name: "이름",
    phone: "휴대폰 번호",
    budget: "예산",
  },
  budgetUnset: "아직 정하지 않았다고 알려요",
  notShared: "알려주지 않아요",
  switchLabel: (label: string) => `${label} 알려주기`,
  partnerRead: (partner: string) =>
    `${partner} 님도 읽고 좋다고 했어요. 업체에는 두 분 휴대폰으로 한 곳씩 보내요.`,
  send: "문자로 보내기",
  later: "나중에 할게요",
} as const;

export const STATUS_COPY = {
  back: "홈으로",
  eyebrow: "상담이 잡혔어요",
  inCalendar: "캘린더에 있어요",
  shareWith: (partner: string) => `${partner} 님과 공유`,
  requestThisTime: "이 시간으로 요청",
  askOtherTime: "다른 시간 묻기",
  questionsHeading: (venue: string) => `${venue}에서 물어볼 것`,
} as const;

export const WEB_COPY = {
  chatRegion: "아모라와 대화",
  spaceRegion: "두 사람의 준비 공간",
  tabsLabel: "준비 공간 보기",
  tabs: [
    { id: "today", label: "오늘" },
    { id: "halls", label: "웨딩홀 후보" },
    { id: "plan", label: "준비 순서" },
  ] as const,
  decisionsHeading: "두 분이 정할 것",
  activityHeading: "오늘 아모라가 한 일",
  inputLabel: "아모라에게 메시지",
  inputPlaceholder: "아모라에게 말하기",
  send: "보내기",
} as const;

export type WebSpaceTabId = (typeof WEB_COPY.tabs)[number]["id"];

/**
 * 예시 커플 화면 표시. 아티팩트 메모: "배경과 웨딩홀 사진은 직접 렌더링한 예시 이미지입니다.
 * 업체명과 가격도 예시입니다." 예시 화면은 실제 업체·가격처럼 읽히면 안 되므로 이 줄을 늘 함께 보인다.
 */
export const EXAMPLE_COPY = {
  banner: "예시 커플 화면이에요. 업체 이름과 가격, 사진은 예시예요.",
  leave: "나가기",
} as const;
