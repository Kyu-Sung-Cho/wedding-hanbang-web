import {
  EXAMPLE_CONSULTATION,
  EXAMPLE_HOME,
  EXAMPLE_LETTER,
  LETTER_COPY,
  SELF_SEND_COPY,
  buildJourneyModel,
  type CompareModel,
  type ConsultationReplyPaste,
  type InquiryApproverResponse,
  type InvitationActivityResponse,
  type InvitationConditionsResponse,
  type InvitationConsultationResponse,
  type InvitationHallsResponse,
  type InvitationHomeResponse,
  type InvitationJourneyResponse,
  type InvitationLetterResponse,
  type JourneyPlan,
  type LetterSelfSend,
  type LetterState,
} from "@hanbang/shared/invitation";

/** 시험용 서버 응답. 모양은 `@hanbang/shared/invitation` 의 API 타입 그대로이고 사람·업체는 지어낸 값이다. */

export const VIEWER = "11111111-1111-4111-8111-111111111111";
export const PARTNER = "22222222-2222-4222-8222-222222222222";
export const HALL_A = "33333333-3333-4333-8333-333333333333";
export const HALL_B = "44444444-4444-4444-8444-444444444444";
export const VERSION = "55555555-5555-4555-8555-555555555555";
export const NEXT_VERSION = "66666666-6666-4666-8666-666666666666";
export const LETTER_ID = "77777777-7777-4777-8777-777777777777";
export const REPLY = "88888888-8888-4888-8888-888888888888";
export const FINGERPRINT = "a".repeat(64);
export const NEXT_FINGERPRINT = "b".repeat(64);

export function homeResponse(overrides: Partial<InvitationHomeResponse> = {}): InvitationHomeResponse {
  return {
    home: {
      ...EXAMPLE_HOME,
      update: EXAMPLE_HOME.update
        ? { ...EXAMPLE_HOME.update, steps: ["승인한 편지를 2곳에 보냈어요", "가온 웨딩홀 답장을 정리했어요"] }
        : null,
    },
    degraded: [],
    updateSteps: [
      { actor: "operator", text: "승인한 편지를 2곳에 보냈어요" },
      { actor: "operator", text: "가온 웨딩홀 답장을 정리했어요" },
    ],
    ...overrides,
  };
}

export function conditionsResponse(overrides: Partial<InvitationConditionsResponse> = {}): InvitationConditionsResponse {
  return {
    conditions: { hopedYear: 2027, hopedMonth: 5, region: "서울", guestCount: 200, timeLabel: null, startStage: "start" },
    summary: "2027년 5월, 서울, 200명",
    missing: [],
    weddingDate: null,
    ...overrides,
  };
}

export const MISSING_CONDITIONS = conditionsResponse({
  conditions: { hopedYear: null, hopedMonth: null, region: null, guestCount: null, timeLabel: null, startStage: null },
  summary: null,
  missing: ["month", "region", "guests"],
});

export function journeyResponse(plan: JourneyPlan = { off: [], addOns: [] }): InvitationJourneyResponse {
  return {
    journey: buildJourneyModel(
      { conditionsSummary: "2027년 5월, 서울, 200명", partnerName: "준호", venueSummary: null, venueChosen: false },
      plan,
    ),
    plan,
  };
}

export function compareModel(picked = false): CompareModel {
  return {
    guests: 200,
    month: 5,
    sourceDateLabel: "11월 14일",
    halls: [
      {
        id: HALL_A,
        name: "하나 웨딩홀",
        area: "마포구 하우스웨딩",
        totalManwon: "1,360",
        meal: "6.8만 원",
        rent: "300만 원",
        minimum: "150명",
        minimumWarn: false,
        transit: "역에서 5분",
        photo: "https://images.example.test/hall-a.webp",
        badge: null,
        picked,
        status: null,
      },
    ],
  };
}

export function hallsResponse(overrides: Partial<InvitationHallsResponse> = {}): InvitationHallsResponse {
  return { compare: compareModel(), missing: [], sort: "total", pickedCount: 0, sources: [], ...overrides };
}

export function letterState(overrides: Partial<LetterState> = {}): LetterState {
  return {
    letterId: null,
    versionId: null,
    version: null,
    fingerprint: null,
    status: "draft",
    approver: { mode: "unset", designatedUserId: null, revision: 1 },
    approvedBy: [],
    waitingFor: [VIEWER, PARTNER],
    viewerCanApprove: true,
    viewerIsApprover: true,
    sendingEnabled: false,
    notQueuedReason: null,
    recipients: [
      { hallId: HALL_A, name: "하나 웨딩홀" },
      { hallId: HALL_B, name: "둘 컨벤션" },
    ],
    ...overrides,
  };
}

export function letterResponse(state: Partial<LetterState> = {}, overrides: Partial<InvitationLetterResponse> = {}): InvitationLetterResponse {
  return {
    letter: {
      ...EXAMPLE_LETTER,
      recipients: ["하나 웨딩홀", "둘 컨벤션"],
      backdropPhoto: "https://images.example.test/hall-a.webp",
      partnerApprovedName: null,
    },
    state: letterState(state),
    missing: [],
    ...overrides,
  };
}

/** 서버가 저장한 판으로 엮는 보낼 글의 꼴(받는 곳, 인사와 본문, 맺음말). */
function selfSendText(name: string): string {
  return `${LETTER_COPY.to([name])}\n\n${SELF_SEND_COPY.greeting} ${EXAMPLE_LETTER.body}\n\n${EXAMPLE_LETTER.signature}`;
}

/** 직접 보내기(D-83 1단계)가 켜진 서버가 판 하나로 엮어 주는 보낼 글. 받는 곳은 `letterState` 와 같은 두 곳이다. */
export function selfSendFor(
  versionId: string = VERSION,
  fingerprint: string = FINGERPRINT,
  overrides: Partial<LetterSelfSend> = {},
): LetterSelfSend {
  return {
    versionId,
    fingerprint,
    messages: [
      { hallId: HALL_A, name: "하나 웨딩홀", text: selfSendText("하나 웨딩홀") },
      { hallId: HALL_B, name: "둘 컨벤션", text: selfSendText("둘 컨벤션") },
    ],
    phoneOmitted: false,
    ...overrides,
  };
}

/**
 * 직접 보내기(D-83 1단계)가 켜진 서버의 편지 응답. 그 서버는 `selfSend` 칸을 싣고(저장한 판이 없으면 null) 휴대폰 번호
 * 알려주기 줄을 뺀다(`letterService.ts`, 글에 번호가 들어가지 않는다). 꺼진 서버의 응답은 `letterResponse` 그대로다.
 */
export function selfSendLetterResponse(
  state: Partial<LetterState> = {},
  overrides: Partial<InvitationLetterResponse> = {},
): InvitationLetterResponse {
  const response = letterResponse(state, { selfSend: null, ...overrides });
  if (!response.letter) return response;
  return { ...response, letter: { ...response.letter, shares: response.letter.shares.filter((share) => share.key !== "phone") } };
}

/** 받은 답 붙여 넣기(D-83 1단계)에서 고를 수 있는 웨딩홀. 아직 붙여 넣은 답으로 넣은 상담은 없다. */
export const REPLY_PASTE: ConsultationReplyPaste = {
  halls: [
    { hallId: HALL_A, name: "하나 웨딩홀" },
    { hallId: HALL_B, name: "둘 컨벤션" },
  ],
  addedCount: 0,
};

/** 받은 답 붙여 넣기의 칸. 고를 웨딩홀과 넣은 상담 수만 바꿔 쓴다. */
export function replyPaste(overrides: Partial<ConsultationReplyPaste> = {}): ConsultationReplyPaste {
  return { ...REPLY_PASTE, ...overrides };
}

export function approverResponse(overrides: Partial<InquiryApproverResponse> = {}): InquiryApproverResponse {
  return {
    setting: { mode: "unset", designatedUserId: null, revision: 1 },
    pending: null,
    members: [
      { id: VIEWER, name: "민지", isViewer: true },
      { id: PARTNER, name: "준호", isViewer: false },
    ],
    ...overrides,
  };
}

export function consultationResponse(overrides: Partial<InvitationConsultationResponse> = {}): InvitationConsultationResponse {
  return {
    consultation: { ...EXAMPLE_CONSULTATION, photo: "https://images.example.test/hall-a.webp" },
    replyId: REPLY,
    inCalendar: false,
    startsAt: "2026-11-22T02:00:00.000Z",
    ...overrides,
  };
}

export const ACTIVITY: InvitationActivityResponse = {
  activity: [
    { timeLabel: "13:40", text: "가온 웨딩홀 답장을 정리했어요", actor: "operator" },
    { timeLabel: "11:05", text: "소담 하우스 상담을 일정에 넣었어요", actor: "couple" },
  ],
};
