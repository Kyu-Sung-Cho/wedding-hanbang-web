export type UserRole = "bride" | "groom";
export type MessageSenderType = "bride" | "groom" | "ai";
export type MessageRole = "user" | "assistant" | "system";
// 하위 호환 alias
export type MessageSenderRole = MessageSenderType;

export interface Profile {
  id: string;
  name: string;
  email?: string;
  role: UserRole | null;
  couple_id: string | null;
  avatar_url: string | null;
  onboarding_completed: boolean;
  onboarding_step: number;
  is_admin: boolean;
  /** 아모라 선제 케어 명시적 수신 동의 — 기본 false이며 동의 시각도 함께 있어야 유효 */
  care_notifications_enabled?: boolean;
  /** 서버가 기록한 아모라 선제 케어 동의 시각 — null=미동의 */
  care_notifications_consented_at?: string | null;
  /** 휴대폰 번호(숫자만) — 알림톡/문자 케어 채널용 */
  phone?: string | null;
  /** 카톡·문자 케어 수신 동의 시각 — null=미동의 */
  phone_care_consented_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Couple {
  id: string;
  invite_code: string | null;
  bride_id: string | null;
  groom_id: string | null;
  /** 첫 2인 roster가 성립한 시각. 값이 있으면 빈 슬롯에 새 멤버를 초대할 수 없다. */
  membership_sealed_at: string | null;
  /**
   * 2면 중립 준비 공간이다 — bride/groom은 저장 슬롯일 뿐 사용자가 고른 역할이
   * 아니므로 화면에 역할로 표시하지 않는다. 컬럼이 없는 DB에서는 1로 본다.
   */
  member_model_version?: 1 | 2;
  created_at: string;
  updated_at: string;
}

export interface WeddingJourney {
  id: string;
  couple_id: string;
  wedding_date: string | null;
  venue: string | null;
  total_budget: number;
  progress: Record<string, ProgressItem>;
  /** Monotonic database-owned token used to reject stale Amora proposals. */
  state_revision?: number;
  created_at: string;
  updated_at: string;
}

export type AmoraActionPriority = "high" | "medium" | "low";
export type AmoraActionStatus = "open" | "done" | "dismissed";
export type AmoraActionSource = "chat" | "quote" | "schedule" | "budget" | "guardrail" | "manual";

export interface AmoraAction {
  id: string;
  couple_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  category_key: string | null;
  priority: AmoraActionPriority;
  status: AmoraActionStatus;
  source: AmoraActionSource;
  href: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  dismissed_at: string | null;
}

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  /**
   * 항목을 열었을 때 붙는 한 줄 안내. **템플릿이 소유하고 DB에는 저장하지 않는다.**
   * 저장 직전에 떼어 내므로(`CategoryChecklistModal`의 `forStorage`) 사용자 행의 모양은
   * 이 필드가 없던 때와 같고, 문구를 고치면 다음 화면부터 바로 반영된다.
   * 문구 규칙은 `@hanbang/shared` `ChecklistItem.note`의 주석이 정본이다.
   */
  note?: string;
}

export type PayerType = "couple" | "bride_parents" | "groom_parents" | "both_parents";

export interface ProgressItem {
  category?: string;
  label?: string;
  /**
   * not_applicable = 이 커플에게 해당 없는 항목(작은결혼식·재혼 등에서 함·폐백·예단 생략).
   * 진행률 분모와 마감 알림에서 제외되며, "영구 미완료"로 남지 않는다.
   */
  status: "not_started" | "in_progress" | "completed" | "not_applicable";
  budget?: number;
  spent?: number;
  cost?: number;
  vendor?: string;
  notes?: string;
  checklist?: ChecklistItem[];
  payer?: PayerType;
}

export type ScheduleEventStatus = "planned" | "completed" | "cancelled";

export interface ScheduleEventCancellation {
  cancelledAt: string;
  cancelledByProfileId: string;
  reason?: string;
}

/**
 * 일정 담당자는 보는 사람 기준의 "나/상대방"을 저장하지 않는다.
 * 커플 구성원은 프로필 UUID, 공동 담당은 couple, 외부 담당은 사용자가
 * 직접 입력한 짧은 역할명만 저장해 다른 구성원이 보아도 의미가 바뀌지 않는다.
 */
export type ScheduleEventAssignee =
  | {
      kind: "member";
      profileId: string;
    }
  | {
      kind: "couple";
    }
  | {
      kind: "external";
      label: string;
    };

export interface ScheduleEvent {
  id: string;
  date: string;
  /** 사용자가 입력한 현지 시각. 시간대 변환 없이 HH:mm으로 표시한다. */
  time?: string;
  title: string;
  memo?: string;
  categoryKey?: string;
  sourceKey?: string;
  /** 모멘트 루프 트리거 — constants/moments.ts의 MomentType. 같은 타입 복수 이벤트 허용(예: 청첩장 모임 그룹별) */
  momentType?: string;
  /** 기존 일정에 값이 없으면 planned로 해석한다. */
  status?: ScheduleEventStatus;
  /** status가 cancelled일 때만 존재하는 감사 정보. 일반 삭제를 대신한다. */
  cancellation?: ScheduleEventCancellation;
  /** 일을 끝냈다고 판단할 수 있는 사용자가 입력한 기준. */
  completionCriteria?: string;
  /** 값이 없으면 담당 미정. 구성원 이름은 이 JSON에 복사하지 않는다. */
  assignee?: ScheduleEventAssignee;
  createdAt: string;
  updatedAt: string;
}

export interface ToolExecutionResult {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput: Record<string, unknown>;
  success: boolean;
  displayMessage: string;
}

export type ChatMessageTarget = "ai" | "partner";
// 메시지 가시성: shared = 둘 다 볼 수 있음 / bride_private = 신부 단독 / groom_private = 신랑 단독
export type ChatMessageVisibility = "shared" | "bride_private" | "groom_private";

export interface PendingAmoraAction {
  version: 2;
  actionId: string;
  tool: string;
  input: Record<string, unknown>;
  /** Server-computed SHA-256 of the canonical exact tool input. */
  inputDigest: string;
  /** Server-computed SHA-256 of the exact tool name and canonical input. */
  operationKey: string;
  /** Canonical, server-authored Korean description of the exact mutation. */
  confirmation: string;
  /** Server epoch milliseconds. */
  issuedAt: number;
  /** Server epoch milliseconds. */
  expiresAt: number;
}

export interface ChatMessageMetadata {
  roomId?: string;
  /** Browser/server idempotency key, protected by a per-couple unique index. */
  client_request_id?: string;
  /** Provider attachment cardinality bound by server ingest for cold-start recovery. */
  provider_attachment_count?: number;
  /** Versioned server-authored contract for interrupted-turn recovery. */
  amora_ingest_contract_version?: 1 | 2;
  /** Whether this durable user row intentionally requested an Amora answer. */
  ai_response_requested?: boolean;
  /** Whether provider-only attachment bytes are needed to resume this turn. */
  provider_attachment_state?:
    | "none"
    | "present"
    | "discarded_by_safety_policy";
  /** Ordered exact-byte bindings for v2 provider attachments; never raw bytes or file names. */
  provider_attachment_manifest?: Array<{
    media_type: string;
    byte_length: number;
    sha256: string;
  }>;
  /** Exact opposite roster member for a partner-directed user message. */
  partner_recipient_id?: string;
  suggestions?: string[];
  toolResults?: ToolExecutionResult[];
  imageUrls?: string[];
  imagePaths?: string[];
  target?: ChatMessageTarget; // "ai" = 아모라에게, "partner" = 상대방에게
  /** Durable user message this AI row answers; used for exact UI correlation. */
  in_reply_to_user_message_id?: string;
  /** Fixed server boundary or client-only recovery origin; never raw user text. */
  response_origin?:
    | "deterministic_crisis_safety"
    | "client_deterministic_crisis_preflight"
    | "client_deterministic_safety_privacy_preflight"
    | "client_deterministic_crisis_recovery";
  safety_classification?: import("@hanbang/shared/amora-crisis-classifier").AmoraCrisisKind;
  safety_contact_policy?: string;
  question_scope?: string;
  memory_eligible?: boolean;
  /** Private mediation draft lifecycle; server-owned and roster-bound. */
  mediation_draft_state?: "draft" | "sent";
  mediation_draft_sendable?: boolean;
  mediation_draft_roster_fingerprint?: string;
  mediation_shared_message_id?: string;
  persistence_status?: string;
  pinned_safety_card?: boolean;
  /** Whether this safety delivery persisted the raw disclosure anywhere. */
  raw_disclosure_persisted?: boolean;
  /** Whether the raw disclosure was made visible to the linked partner. */
  raw_disclosure_shared?: boolean;
  /** Durable scope used for the raw disclosure, if any. */
  raw_disclosure_persistence?: "none" | "private_only" | "shared" | "unknown";
  /**
   * Whether the opaque durable safety seal was confirmed for this deterministic
   * safety card. Boolean only — never a reason, classification, summary, or
   * partner state. The server splits 200/503 on this value and the client uses it
   * to decide follow-up eligibility; guidance itself must render regardless.
   */
  durable_safety_fence_confirmed?: boolean;
  /** Client echo consumed by the DB application lease trigger. */
  confirmed_amora_action_id?: string;
  /** Proposal-time wedding_journeys state token enforced by the database. */
  pending_amora_action_journey_revision?: number;
  /** Server-computed current→proposed budget effect, bound to action + revision. */
  pending_amora_action_impact_preview?: import("@hanbang/shared").BudgetImpactPreview;
  lifecycle?: {
    stage?: string;
    severity?: string;
    primaryActionId?: string;
    href?: string;
  };
  // D3 — 서버가 계산한 stage/specialist를 SSE로 클라이언트에 전달
  stageTag?: import("./moat.types").StageTag;
  specialistType?: import("./moat.types").SpecialistType;
  /** Requires an explicit button confirmation; chat prose alone never confirms it. */
  pending_amora_action?: PendingAmoraAction;
  // 커플 갈등 중재 — AI 응답에서 [mediation]...[/mediation] 마커가 추출되면 백엔드가 채움.
  // 클라이언트는 ChatBubble에서 MediationCard로 시각화.
  mediation?: {
    empathy?: string;
    translation?: string;
    data?: string;
    resolution?: string;
    /** Server-owned source contract for a user-requested mediation draft. */
    origin?: "user_requested";
    /** Only the requester's explicit summary was used as fresh evidence. */
    evidenceScope?: "requester_summary_only";
    /** Confirmation is available only for the complete v2 contract. */
    schemaVersion?: 2;
    /** DB-issued consent revision; clients must echo it when confirming. */
    proposalVersion?: string;
    /** DB-issued fingerprint of the couple roster at proposal creation. */
    rosterFingerprint?: string;
  };
  // 함께 대화 새로 시작 — 상호 동의 요청. 한 사용자가 "둘 다 새로시작"을 누르면
  // chat_messages 에 메시지가 인서트되고 metadata.clearRequest 로 식별.
  // 상대방이 [동의] 누르면 양쪽 cleared_at 갱신, [거절] 누르면 status 만 변경.
  clearRequest?: {
    type: "shared";
    requestedBy: string;          // user id
    requestedByRole?: "bride" | "groom";
    requestedAt: string;          // ISO
    status: "pending" | "accepted" | "declined";
    respondedBy?: string;
    respondedAt?: string;
    /** 승인 RPC가 양쪽 프로필에 실제로 적용한 단조 증가 clear cursor */
    clearedAt?: string;
  };
}

export interface ChatMessage {
  id: string;
  couple_id: string;
  sender_id: string | null;
  sender_role: MessageSenderType;  // 내부용: "bride" | "groom" | "ai" (DB의 sender_type에서 매핑)
  content: string;
  metadata: ChatMessageMetadata | null;
  visibility: ChatMessageVisibility;
  created_at: string;
}

export interface ChatSummary {
  id: string;
  couple_id: string;
  summary: string;
  message_count: number;
  created_at: string;
}
