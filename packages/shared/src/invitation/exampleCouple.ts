import { buildJourneyModel } from "./journey";
import type {
  CompareModel,
  ConsultationModel,
  FirstChatModel,
  HallCard,
  HomeModel,
  InvitationFacts,
  JourneyModel,
  LetterModel,
  WebSpaceModel,
} from "./types";

/**
 * 예시 커플 "민지와 준호". 파운더 디자인 아티팩트의 화면 값을 한 글자도 바꾸지 않고 옮겼다
 * (`Home`·`Journey`·`Compare`·`Approve`·`Status`·`Web`·`Chat` 화면).
 *
 * 아티팩트 메모: "배경과 웨딩홀 사진은 직접 렌더링한 예시 이미지입니다. 업체명과 가격도 예시입니다."
 * 그래서 이 데이터는 "예시 커플로 둘러보기" 화면에서만 쓰고, 그 화면은 예시라는 줄을 함께 보인다.
 * 실제 커플 화면에 이 값이 섞이면 안 된다 — 업체 이름과 가격이 실제처럼 읽힌다.
 *
 * 사진은 플랫폼마다 자산 경로가 달라 이름(`ExamplePhotoKey`)만 둔다.
 */

export type ExamplePhotoKey = "bokeh-blush" | "hall-sample-garden" | "hall-sample-chapel" | "hall-sample-convention";

export const EXAMPLE_PHOTO_KEYS: readonly ExamplePhotoKey[] = [
  "bokeh-blush",
  "hall-sample-garden",
  "hall-sample-chapel",
  "hall-sample-convention",
];

const PEOPLE = [
  { initial: "민", name: "민지" },
  { initial: "준", name: "준호" },
] as const;

const INVITATION: InvitationFacts = {
  firstName: "민지",
  secondName: "준호",
  year: 2027,
  month: 5,
  day: null,
  timeLabel: "토요일 낮",
  venueName: null,
};

const HALLS: readonly HallCard[] = [
  {
    id: "b",
    name: "소담 하우스",
    area: "마포구 하우스웨딩",
    totalManwon: "1,360",
    meal: "6.8만 원",
    rent: "식대에 포함",
    minimum: "180명",
    minimumWarn: false,
    transit: "역에서 8분",
    photo: "hall-sample-garden",
    badge: "가장 합리적이에요",
    picked: true,
    status: "11월 22일 상담 확정",
  },
  {
    id: "a",
    name: "가온 웨딩홀",
    area: "강남구 단독홀",
    totalManwon: "1,800",
    meal: "7.5만 원",
    rent: "300만 원",
    minimum: "200명",
    minimumWarn: false,
    transit: "역에서 5분",
    photo: "hall-sample-chapel",
    badge: "교통이 가장 편해요",
    picked: true,
    status: "다른 시간을 제안했어요",
  },
  {
    id: "c",
    name: "루체 컨벤션",
    area: "영등포구 컨벤션",
    totalManwon: "2,725",
    meal: "8.9만 원",
    rent: "500만 원",
    minimum: "250명 (50명 많음)",
    minimumWarn: true,
    transit: "주차 400대",
    photo: "hall-sample-convention",
    badge: "보증 인원 확인 필요",
    picked: false,
    status: "보증 인원이 50명 많아요",
  },
];

export const EXAMPLE_HOME: HomeModel = {
  people: PEOPLE,
  invitation: INVITATION,
  update: {
    timeLabel: "오늘 아침 7:40",
    mood: "working",
    text: "비어 있는 예식장 칸을 채우려고, 조건에 맞는 웨딩홀 3곳을 200명 기준으로 비교해 뒀어요.",
    steps: [
      "5월 토요일 예식이 가능한 서울 홀 14곳 확인",
      "식대와 대관료를 200명 기준으로 다시 계산",
      "보증 인원이 250명인 1곳은 따로 표시",
      "예약 가능일은 업체 확인 전이라 비워 둠",
    ],
    primary: { label: "3곳 비교하기", target: "compare" },
  },
  decisions: [
    {
      id: "consult-time",
      title: "상담 갈 시간 고르기",
      sub: "준호 님은 토요일 오후가 좋대요",
      owner: { kind: "together" },
      target: "letter",
    },
    {
      id: "family-date",
      title: "양가에 상견례 날짜 묻기",
      sub: "이번 주 안에",
      owner: { kind: "person", name: "민지" },
      target: null,
    },
  ],
};

export const EXAMPLE_JOURNEY: JourneyModel = buildJourneyModel({
  conditionsSummary: "2027년 5월, 서울, 200명",
  partnerName: "준호",
  venueSummary: "지금 하고 있어요. 후보 3곳",
  venueChosen: false,
});

export const EXAMPLE_COMPARE: CompareModel = {
  guests: 200,
  month: 5,
  halls: HALLS,
  sourceDateLabel: "11월 14일",
};

export const EXAMPLE_LETTER: LetterModel = {
  recipients: ["소담 하우스", "가온 웨딩홀"],
  dateLabel: "11. 15",
  body:
    "2027년 5월 토요일 낮에 예식을 생각하고 있는 커플입니다. 하객은 200명 정도예요. "
    + "11월 21일 토요일 오후 1시에서 5시 사이, 또는 22일 일요일 오전에 두 사람이 함께 상담받고 싶습니다.",
  signature: "민지와 준호 드림",
  shares: [
    { key: "name", label: "이름", value: "김민지", on: true },
    { key: "phone", label: "휴대폰 번호", value: "010-****-1234", on: true },
    { key: "budget", label: "예산", value: "아직 정하지 않았다고 알려요", on: false },
  ],
  partnerApprovedName: "준호",
  backdropPhoto: "hall-sample-garden",
};

export const EXAMPLE_CONSULTATION: ConsultationModel = {
  dateLabel: "11. 22",
  timeLabel: "일요일 오전 11시",
  venue: "소담 하우스",
  place: "서울 마포구, 2층 상담실",
  partnerName: "준호",
  photo: "hall-sample-garden",
  update: {
    timeLabel: "오후 1:40",
    mood: "happy",
    text: "가온 웨딩홀은 21일 토요일 오후 4시를 제안했어요. 두 분이 고른 시간 안이라 겹치는 일정은 없어요.",
    steps: [],
    primary: null,
  },
  updateActions: [
    { label: "이 시간으로 요청", tone: "ink" },
    { label: "다른 시간 묻기", tone: "outline" },
  ],
  questions: [
    "보증 인원 180명을 줄일 수 있는지",
    "식대에 음료와 주류가 포함되는지",
    "꽃장식과 포토테이블 추가 비용",
    "계약금, 잔금 날짜와 취소 조건",
  ],
};

export const EXAMPLE_WEB_SPACE: WebSpaceModel = {
  people: PEOPLE,
  orbCaption: "답장이 두 곳에서 왔어요",
  chat: [
    { kind: "amora", text: "아침에 비교한 홀 중 두 분이 담은 2곳에 상담 문의를 보냈어요." },
    { kind: "person", text: "답장 왔어?" },
    {
      kind: "amora",
      text: "소담 하우스는 11월 22일 일요일 오전 11시로 확정됐어요. 가온 웨딩홀은 21일 토요일 오후 4시를 제안했는데, 정해 주시면 바로 답할게요.",
    },
    {
      kind: "actions",
      actions: [
        { label: "토요일 4시로 요청", tone: "ink" },
        { label: "다른 시간 묻기", tone: "outline" },
      ],
    },
  ],
  suggestions: ["예산 범위 같이 정하기", "상견례 날짜 모으기"],
  invitation: INVITATION,
  decisions: [
    { id: "gaon-time", title: "가온 웨딩홀 대체 시간", sub: "토요일 오후 4시 제안", owner: { kind: "together" }, target: "status" },
    { id: "family-date", title: "양가 상견례 날짜", sub: "이번 주 안에", owner: { kind: "person", name: "민지" }, target: null },
    { id: "budget-range", title: "예산 범위", sub: "견적 받기 전에 정하면 좋아요", owner: { kind: "together" }, target: null },
  ],
  activity: [
    { timeLabel: "13:40", text: "가온 웨딩홀 답장을 정리했어요" },
    { timeLabel: "11:05", text: "소담 하우스 상담을 일정에 넣었어요" },
    { timeLabel: "09:12", text: "승인한 편지를 2곳에 보냈어요" },
    { timeLabel: "07:40", text: "웨딩홀 3곳을 비교했어요" },
  ],
  halls: HALLS,
  plan: [
    { number: "01", title: "조건과 파트너", sub: "마쳤어요", now: false },
    { number: "02", title: "웨딩홀", sub: "상담 진행 중", now: true },
    { number: "03", title: "상견례", sub: "날짜 모으는 중", now: false },
    { number: "04", title: "촬영과 업체", sub: "홀 정한 뒤", now: false },
    { number: "05", title: "하객과 본식", sub: "예식일 확정 후", now: false },
  ],
};

export const EXAMPLE_FIRST_CHAT: FirstChatModel = {
  year: 2027,
  region: "서울",
  guests: 200,
  names: { first: "민지", second: "준호" },
};
