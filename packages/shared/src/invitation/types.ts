/**
 * 청첩장 디자인(2026-11-17) 화면 모델. 웹과 네이티브, 실제 커플과 예시 커플이 같은 모양을 그린다.
 *
 * 화면은 이 모델만 읽는다. 실제 데이터에서 모델을 만드는 곳(서버·훅)과 예시 커플 모델
 * (`exampleCouple.ts`)이 같은 타입을 내므로, 두 경로가 같은 화면을 그린다.
 * 모델에는 확인된 사실만 넣는다 — 모르는 칸은 null 로 두고 화면이 빈칸으로 그린다.
 */

import type { AmoraOrbMoodName } from "./orbMood";

export type { AmoraOrbMoodName };

/**
 * 화면끼리 잇는 이름. 웹과 앱, 실제와 예시가 주소를 따로 가지므로 모델은 이름만 들고,
 * 각 플랫폼이 이름을 주소로 바꾼다.
 */
export type InvitationRouteKey = "home" | "chat" | "journey" | "compare" | "letter" | "status";

/** 머리글자 동그라미. 첫 사람은 분홍(blush), 둘째 사람은 흰색(웹은 돌빛). */
export type PersonChip = { initial: string; name: string };

export type InvitationFacts = {
  firstName: string | null;
  secondName: string | null;
  year: number | null;
  month: number | null;
  day: number | null;
  /** "토요일 낮"처럼 두 사람이 말한 시간대. */
  timeLabel: string | null;
  /** 정한 예식장 이름. 아직이면 null. */
  venueName: string | null;
};

/** 할 일 꼬리표. "함께"는 분홍, 사람 이름은 돌빛. */
export type DecisionOwner = { kind: "together" } | { kind: "person"; name: string };

export type DecisionItem = {
  id: string;
  title: string;
  sub: string | null;
  owner: DecisionOwner;
  /** 누르면 갈 화면. 없으면 누를 수 없는 줄. */
  target: InvitationRouteKey | null;
};

/** 아모라 소식 한 단락. 홈과 상담 화면이 쓴다. */
export type AmoraUpdate = {
  /** "오늘 아침 7:40", "오후 1:40" 처럼 이미 사람이 읽는 꼴. */
  timeLabel: string;
  mood: AmoraOrbMoodName;
  text: string;
  /** "무엇을 했나요?"를 누르면 펼치는 목록. 없으면 그 버튼을 그리지 않는다. */
  steps: readonly string[];
  primary: { label: string; target: InvitationRouteKey } | null;
};

export type HomeModel = {
  people: readonly PersonChip[];
  invitation: InvitationFacts;
  update: AmoraUpdate | null;
  decisions: readonly DecisionItem[];
};

export type JourneyRowState = "done" | "now" | "next";

export type JourneyRow = {
  key: string;
  number: string;
  title: string;
  /** 단계 설명. 뺀 단계는 화면이 "이번 계획에서는 뺐어요"로 바꿔 그린다. */
  sub: string;
  state: JourneyRowState;
  optional: boolean;
  off: boolean;
};

export type JourneyModel = {
  rows: readonly JourneyRow[];
  addOns: readonly { key: string; button: string; added: boolean }[];
};

export type HallCard = {
  id: string;
  name: string;
  area: string;
  /** 하객 수 기준 예상 총액(만 원, 쉼표 포함 글자). 모르면 null. */
  totalManwon: string | null;
  meal: string;
  rent: string;
  minimum: string;
  /** 보증 인원이 하객 수보다 많을 때 경고색으로 그린다. */
  minimumWarn: boolean;
  transit: string;
  photo: string | null;
  badge: string | null;
  picked: boolean;
  /** 웹 "웨딩홀 후보" 칸의 한 줄 상태(예: "11월 22일 상담 확정"). */
  status: string | null;
};

export type CompareModel = {
  guests: number;
  month: number | null;
  halls: readonly HallCard[];
  /** "11월 14일" 처럼 가격을 확인한 날. */
  sourceDateLabel: string | null;
};

export type LetterShare = { key: "name" | "phone" | "budget"; label: string; value: string; on: boolean };

export type LetterModel = {
  recipients: readonly string[];
  /** 편지 위 오른쪽의 날짜("11. 15"). */
  dateLabel: string;
  body: string;
  signature: string;
  shares: readonly LetterShare[];
  /** 상대가 읽고 좋다고 했으면 그 사람 이름. 아니면 null. */
  partnerApprovedName: string | null;
  backdropPhoto: string | null;
};

export type ConsultationModel = {
  dateLabel: string;
  timeLabel: string;
  venue: string;
  place: string;
  partnerName: string | null;
  photo: string | null;
  update: AmoraUpdate | null;
  updateActions: readonly { label: string; tone: "ink" | "outline" }[];
  questions: readonly string[];
};

export type ActivityItem = { timeLabel: string; text: string };

export type PlanCard = { number: string; title: string; sub: string; now: boolean };

export type WebChatLine =
  | { kind: "amora"; text: string }
  | { kind: "person"; text: string }
  | { kind: "actions"; actions: readonly { label: string; tone: "ink" | "outline" }[] };

export type WebSpaceModel = {
  people: readonly PersonChip[];
  orbCaption: string | null;
  chat: readonly WebChatLine[];
  suggestions: readonly string[];
  invitation: InvitationFacts;
  decisions: readonly DecisionItem[];
  activity: readonly ActivityItem[];
  halls: readonly HallCard[];
  plan: readonly PlanCard[];
};

export type FirstChatModel = {
  year: number;
  region: string;
  guests: number;
  names: { first: string | null; second: string | null };
};
