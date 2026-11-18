import type { InvitationConditionKey, InvitationConditions } from "./conditions";
import type { JourneyPlan } from "./journey";
import type { InvitationRegion } from "./regions";
import type {
  ActivityItem,
  CompareModel,
  ConsultationModel,
  HomeModel,
  JourneyModel,
  LetterModel,
} from "./types";
import type { CompareSortId, PreparationStartStage } from "./copy";

/**
 * `/api/invitation/*` 의 요청·응답 모양. 웹과 앱이 같은 서버를 부른다.
 * 오류는 모든 경로가 `{ error: 사람이 읽는 문장, code: 기계가 읽는 코드 }` 로 준다.
 */

export type InvitationApiError = { error: string; code: string };

/**
 * 화면의 한 줄을 누가 했는지. 화면은 이 값으로 주어 꼬리표를 그린다.
 *   - amora: 아모라 코드가 한 일(홀 비교 계산, 편지 초안 같은 것).
 *   - operator: 담당자(사람)가 한 일. 파일럿 동안 업체에 보내기와 답장 정리는 담당자가 한다.
 *   - couple: 두 분 중 한 사람이 한 일(편지 승인, 상담을 일정에 넣기).
 * 문장도 주어가 드러나게 쓴다. 꼬리표를 그리지 않는 화면에서도 담당자의 일이 아모라의 일로 읽히지 않게 하기 위해서다.
 */
export type InvitationActor = "amora" | "operator" | "couple";

/** 누가 했는지 붙인 한 줄. */
export type InvitationActorLine = { actor: InvitationActor; text: string };

// ── 조건(W1) ────────────────────────────────────────────────────────────────

/** PATCH 본문. 보낸 칸만 바꾸고 null 은 지운다. 희망 연도와 달은 함께 보낸다. */
export type InvitationConditionsPatch = {
  hopedYear?: number | null;
  hopedMonth?: number | null;
  /** `INVITATION_REGIONS` 의 짧은 이름. 공식 이름("서울특별시")도 받아 짧은 이름으로 저장한다. */
  region?: InvitationRegion | string | null;
  /** 숫자, 또는 "200명"처럼 숫자 하나로 된 글(`parseGuestCount`). */
  guestCount?: number | string | null;
  timeLabel?: string | null;
  startStage?: PreparationStartStage | null;
};

export type InvitationConditionsResponse = {
  conditions: InvitationConditions;
  /** 준비 순서 조건 칸에 쓰는 요약. 모자라면 null. */
  summary: string | null;
  missing: readonly InvitationConditionKey[];
  /** 정한 예식일(YYYY-MM-DD). 없으면 null. */
  weddingDate: string | null;
};

// ── 홈·준비 순서 ────────────────────────────────────────────────────────────

export type InvitationHomeResponse = {
  home: HomeModel;
  /** 읽지 못한 부분. 화면은 빈 목록 대신 다시 불러오기를 보여 준다. */
  degraded: readonly "decisions"[];
  /** `home.update.steps` 와 같은 줄, 같은 순서에 누가 했는지 붙인 것. 소식이 없으면 빈 목록. */
  updateSteps: readonly InvitationActorLine[];
};

export type InvitationJourneyResponse = { journey: JourneyModel; plan: JourneyPlan };

/** PATCH `/api/invitation/journey-plan` 본문. 뺄 수 있는 단계와 넣을 수 있는 갈래만 받는다. */
export type JourneyPlanPatch = { off: readonly string[]; addOns: readonly string[] };

// ── 웨딩홀(W2) ──────────────────────────────────────────────────────────────

export type HallSource = { hallId: string; sourceUrl: string; checkedOn: string };

export type InvitationHallsResponse = {
  /** 하객 수나 지역이 없으면 null. `missing` 이 무엇을 물어야 하는지 알려 준다. */
  compare: CompareModel | null;
  missing: readonly InvitationConditionKey[];
  sort: CompareSortId;
  pickedCount: number;
  /** 칸마다의 출처. 화면이 출처 링크를 그릴 때 쓴다. */
  sources: readonly HallSource[];
};

export type HallShortlistResponse = { hallId: string; picked: boolean; pickedCount: number };

// ── 문의 승인 방식(D-76) ────────────────────────────────────────────────────

/** unset: 아직 고르지 않음(둘 중 누구든 승인, 둘 다 알림). designated: 정한 한 사람. both: 두 사람 모두. */
export type InquiryApproverMode = "unset" | "designated" | "both";

export type InquiryApproverSetting = {
  mode: InquiryApproverMode;
  designatedUserId: string | null;
  /** 바꿀 때마다 오른다. 앞 판에서 받은 승인은 새 판에서 세지 않는다. */
  revision: number;
};

/**
 * 상대의 승인 권한을 줄이는 변경(both → 다른 것, 상대를 정한 방식 → 다른 것, unset → 나만 승인)은
 * 상대가 확인할 때까지 제안으로만 남는다. 그동안은 `setting` 이 그대로 쓰이고, 제안한 방식으로는
 * 어떤 편지도 승인되지 않는다. 화면은 "상대가 확인하면 바뀌어요"와 확인·거절 버튼을 그린다.
 */
export type InquiryApproverProposal = {
  /** 확인·거절할 때 그대로 돌려보낸다. 그 사이 제안이 바뀌었으면 409 `APPROVER_PROPOSAL_CHANGED`. */
  proposalId: string;
  mode: InquiryApproverMode;
  designatedUserId: string | null;
  proposedBy: string;
  proposedAt: string;
  /** 지금 보는 사람이 확인하거나 거절할 수 있다(제안한 사람이 아닌 다른 회원). */
  viewerCanRespond: boolean;
};

/** PUT·확인·거절이 한 일. GET 에는 없다. */
export type InquiryApproverOutcome =
  | "unchanged"
  | "applied"
  | "proposed"
  | "withdrawn"
  | "confirmed"
  | "declined";

export type InquiryApproverResponse = {
  setting: InquiryApproverSetting;
  /**
   * 확인을 기다리는 제안. 없으면 null. 제안한 사람이 더는 회원이 아니면 null 로 준다.
   * 서버는 늘 채운다. 칸이 없는 응답(이 칸보다 먼저 나간 서버)은 제안이 없는 것으로 읽는다.
   */
  pending?: InquiryApproverProposal | null;
  members: readonly { id: string; name: string | null; isViewer: boolean }[];
  outcome?: InquiryApproverOutcome;
};

export type InquiryApproverPut = { mode: InquiryApproverMode; designatedUserId?: string | null };

/** POST `/api/invitation/approver/confirm` 와 `/api/invitation/approver/decline` 본문. */
export type InquiryApproverRespondPost = { proposalId: string };

// ── 편지(W3·WS1·WS2·WS5) ────────────────────────────────────────────────────

export type LetterShareKey = "name" | "phone" | "budget";

/**
 * PUT `/api/invitation/letter` 본문. 받는 곳·글·알려줄 정보 가운데 하나라도 바뀌면 새 판이 생기고
 * 새 승인이 필요하다. 휴대폰 번호는 켜면서 값을 비우면 앞 판의 값을 그대로 쓴다(화면은 가린 번호만 받는다).
 */
export type LetterSavePut = {
  letterId?: string | null;
  recipientHallIds: readonly string[];
  body: string;
  shares: {
    name: { on: boolean; value?: string | null };
    phone: { on: boolean; value?: string | null };
    budget: { on: boolean };
  };
};

export type LetterApprovalStatus =
  | "draft"
  | "awaiting_approval"
  | "approved_not_queued"
  | "queued";

/** global_daily_cap: 서비스 전체의 하루 상한. 화면에는 daily_cap 과 같은 말로 보여도 된다. */
export type LetterNotQueuedReason = "sending_disabled" | "daily_cap" | "global_daily_cap" | "approver_unavailable";

export type LetterState = {
  letterId: string | null;
  versionId: string | null;
  version: number | null;
  /** 이 판의 내용 지문. 승인할 때 그대로 돌려보낸다. */
  fingerprint: string | null;
  status: LetterApprovalStatus;
  approver: InquiryApproverSetting;
  /** 지금 판·지금 승인 방식에서 승인한 사람. 문의 보내기가 켜져 있으면 켜진 동안 승인한 사람만 센다. */
  approvedBy: readonly string[];
  /**
   * 문의 보내기가 꺼진 동안 승인했지만, 켜진 지금은 다시 승인해야 하는 사람. 꺼진 동안의 승인은 저장된
   * 선택으로 보여 주되 대기열로 이어지지 않는다. 꺼져 있을 때는 빈 목록이다. 서버는 늘 채우고,
   * 칸이 없는 응답(이 칸보다 먼저 나간 서버)은 빈 목록으로 읽는다.
   */
  approvedWhilePaused?: readonly string[];
  /** 아직 승인해야 하는 사람. unset 이면 둘 중 누구든 되므로 두 사람이 다 들어 있다. */
  waitingFor: readonly string[];
  /** 지금 보는 사람이 이 판을 아직 승인하지 않았고 지금 방식에서 승인할 수 있는 사람이다. */
  viewerCanApprove: boolean;
  /** 지금 보는 사람의 승인이 보내기를 끝낼 수 있는 승인이다(정한 사람이 따로 있으면 그 사람만). */
  viewerIsApprover: boolean;
  sendingEnabled: boolean;
  notQueuedReason: LetterNotQueuedReason | null;
  recipients: readonly { hallId: string; name: string }[];
};

export type InvitationLetterResponse = {
  /** 담은 홀이 없으면 null. */
  letter: LetterModel | null;
  state: LetterState | null;
  missing: readonly ("shortlist" | InvitationConditionKey)[];
};

export type LetterApprovePost = { versionId: string; fingerprint: string };

export type LetterApproveResult = {
  status: "awaiting_approval" | "approved_not_queued" | "queued";
  notQueuedReason: LetterNotQueuedReason | null;
  queuedCount: number;
  /** 같은 내용이 이미 그 홀로 나가서 다시 넣지 않은 곳. */
  duplicateHallIds: readonly string[];
  waitingFor: readonly string[];
};

// ── 상담(W5)·오늘 한 일 ─────────────────────────────────────────────────────

export type InvitationConsultationResponse = {
  consultation: ConsultationModel | null;
  replyId: string | null;
  /** 이 상담이 이미 일정에 있으면 true. 넣는 것은 커플이 누를 때만이다. */
  inCalendar: boolean;
  /** 상담 시각(ISO). */
  startsAt: string | null;
};

export type ConsultationSchedulePost = { replyId: string };

export type ConsultationScheduleResult = { added: boolean; alreadyInCalendar: boolean; eventId: string };

/** 오늘 한 일 한 줄. `ActivityItem` 에 누가 했는지를 더한 꼴이다. */
export type InvitationActivityEntry = ActivityItem & { actor: InvitationActor };

export type InvitationActivityResponse = { activity: readonly InvitationActivityEntry[] };
