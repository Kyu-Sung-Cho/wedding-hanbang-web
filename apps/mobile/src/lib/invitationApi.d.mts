import type {
  CompareModel,
  CompareSortId,
  ConsultationPasteSchedulePost,
  ConsultationScheduleResult,
  HallShortlistResponse,
  HomeModel,
  InquiryApproverMode,
  InquiryApproverProposal,
  InquiryApproverResponse,
  InvitationConditionsPatch,
  InvitationConditionsResponse,
  InvitationConsultationResponse,
  InvitationHallsResponse,
  InvitationHomeResponse,
  InvitationJourneyResponse,
  InvitationLetterResponse,
  JourneyModel,
  JourneyPlanPatch,
  LetterApproveResult,
  LetterModel,
  LetterSavePut,
  LetterSelfSend,
  LetterState,
  PreparationStartStage,
} from "@hanbang/shared/invitation";

export const COMPARE_SORT_IDS: readonly CompareSortId[];
export const FIRST_CHAT_MIN_LEAD_MONTHS: number;

export type InvitationFailure = {
  ok: false;
  /** network: 요청이 닿지 않음. http: 서버가 오류로 답함. invalid: 답의 모양이 틀림. input: 보내지 않은 값. */
  reason: "network" | "http" | "invalid" | "input";
  status: number;
  code: string | null;
  /** 서버가 사람에게 쓴 문장(`error`). 없거나 쓸 수 없으면 null. */
  message: string | null;
};
export type InvitationResult<T> = { ok: true; data: T } | InvitationFailure;

export type InvitationFetcher = (path: string, init: RequestInit) => Promise<Response>;

export type LetterApproveResponse = { result: LetterApproveResult; letter: InvitationLetterResponse | null };

/** 승인 방식 응답. 확인을 기다리는 제안이 없으면 `pending` 은 null 이다(칸이 없는 옛 응답도 null). */
export type InvitationApproverView = Omit<InquiryApproverResponse, "pending"> & { pending: InquiryApproverProposal | null };

export type InvitationApi = {
  home(): Promise<InvitationResult<InvitationHomeResponse>>;
  conditions(): Promise<InvitationResult<InvitationConditionsResponse>>;
  saveConditions(patch: InvitationConditionsPatch): Promise<InvitationResult<InvitationConditionsResponse>>;
  journey(): Promise<InvitationResult<InvitationJourneyResponse>>;
  saveJourneyPlan(plan: JourneyPlanPatch): Promise<InvitationResult<InvitationJourneyResponse>>;
  halls(sort: CompareSortId): Promise<InvitationResult<InvitationHallsResponse>>;
  setHallPicked(hallId: string, picked: boolean): Promise<InvitationResult<HallShortlistResponse>>;
  approver(): Promise<InvitationResult<InvitationApproverView>>;
  saveApprover(choice: { mode: InquiryApproverMode; designatedUserId?: string | null }): Promise<InvitationResult<InvitationApproverView>>;
  confirmApprover(proposalId: string): Promise<InvitationResult<InvitationApproverView>>;
  declineApprover(proposalId: string): Promise<InvitationResult<InvitationApproverView>>;
  letter(): Promise<InvitationResult<InvitationLetterResponse>>;
  saveLetter(body: LetterSavePut): Promise<InvitationResult<InvitationLetterResponse>>;
  approveLetter(version: { versionId: string; fingerprint: string }): Promise<InvitationResult<LetterApproveResponse>>;
  consultation(): Promise<InvitationResult<InvitationConsultationResponse>>;
  addConsultationToSchedule(replyId: string): Promise<InvitationResult<ConsultationScheduleResult>>;
  /** 붙여 넣은 업체 답에서 사람이 고른 날짜(와 시간)로 상담 일정 하나를 넣는다(D-83 1단계). */
  addPastedConsultationToSchedule(input: ConsultationPasteSchedulePost): Promise<InvitationResult<ConsultationScheduleResult>>;
};

export function createInvitationApi(fetcher: InvitationFetcher): InvitationApi;

export function isUuid(value: unknown): value is string;
export function isHomeModel(value: unknown): value is HomeModel;
export function isJourneyModel(value: unknown): value is JourneyModel;
export function isCompareModel(value: unknown): value is CompareModel;
export function cleanConditionsPatch(patch: unknown): InvitationConditionsPatch | null;
export function isLetterVersionChanged(result: InvitationResult<unknown>): boolean;
export function isSelfSendRefusal(result: InvitationResult<unknown>): boolean;

export type JourneyPlanValue = { off: readonly string[]; addOns: readonly string[] };
export function toggledJourneyPlan(plan: JourneyPlanValue, kind: "stage" | "addOn", key: string): { off: string[]; addOns: string[] };
export function journeyWithPlan(journey: JourneyModel, plan: JourneyPlanValue): JourneyModel;

export function kstYearMonth(nowMs: number): { year: number; month: number };
export function firstChatYearForMonth(month: number, today: { year: number; month: number }): number;

export type FirstChatAnswers = {
  stage: PreparationStartStage | null;
  month: number | null;
  monthChosen: boolean;
  year: number;
  region: string | null;
  guests: number | null;
  weddingDateKnown: boolean;
};
export function firstChatConditionsPatch(answers: FirstChatAnswers): InvitationConditionsPatch;

export type LetterShareFlags = { name: boolean; phone: boolean; budget: boolean };
export function letterShareFlags(letter: LetterModel): LetterShareFlags;
export function isLetterDirty(letter: LetterModel, body: string, flags: LetterShareFlags): boolean;
export function letterSaveBody(state: LetterState, letter: LetterModel, body: string, flags: LetterShareFlags): LetterSavePut;
export function sameVisibleLetter(a: LetterModel, b: LetterModel): boolean;

export type LetterNotice =
  | { kind: "queued"; count: number }
  | { kind: "alreadySent" }
  | { kind: "approvedNotSent" }
  | { kind: "dailyCap" }
  | { kind: "approverUnavailable" }
  | { kind: "waiting"; userIds: string[] };
export function letterApprovalNotice(result: LetterApproveResult): LetterNotice;
export function letterStateNotice(state: LetterState): LetterNotice | null;

export function isScheduleYmd(value: unknown): value is string;
export function isScheduleTime(value: unknown): value is string;
export function pastedScheduleBody(input: unknown): ConsultationPasteSchedulePost | null;

/** 편지 시트의 직접 보내기 칸(D-83 1단계). 서버가 `selfSend` 칸을 주지 않으면 null 이다. */
export type LetterSelfSendView = {
  /** 화면의 편지가 저장된 판과 같고 그 판으로 만든 글일 때만 있다. */
  messages: LetterSelfSend | null;
  /** 고치는 중이다. 저장해야 보낼 글이 나온다. */
  saveFirst: boolean;
  /** 고친 것은 없지만 저장한 판이 없다(처음 쓰는 초안, 또는 담은 웨딩홀이 바뀌어 서버가 판을 내렸다). */
  beforeSave: boolean;
  /** 아직 저장한 편지가 없고 편지에 넣을 희망 시기나 하객 수를 모른다. 모르는 것만 말한다. 물을 것이 없으면 null. */
  askConditions: LetterConditionsToAsk | null;
  /** 편지를 저장한 적이 있다. 업체 답을 상담 화면에 붙여 넣으라는 줄과 상담 화면 단추를 둔다(고치는 중이어도). */
  afterSend: boolean;
};
/** 희망 시기만(month), 하객 수만(guests), 둘 다(both). */
export type LetterConditionsToAsk = "month" | "guests" | "both";
export function letterSelfSendView(response: InvitationLetterResponse, dirty: boolean): LetterSelfSendView | null;

export type ScheduleTimeParts = { meridiem: "am" | "pm"; hour12: number; minute: number };
export function scheduleTimeParts(time: string): ScheduleTimeParts | null;
export function withMeridiem(time: string, meridiem: "am" | "pm"): string | null;
export function kstTodayYmd(nowMs: number): string;
