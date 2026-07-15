export type UserRole = "bride" | "groom";
export type MessageSenderType = "bride" | "groom" | "ai";
export type MessageRole = "user" | "assistant" | "system";
// 하위 호환 alias
export type MessageSenderRole = MessageSenderType;

export interface Profile {
  id: string;
  name: string;
  role: UserRole | null;
  couple_id: string | null;
  onboarding_completed: boolean;
  onboarding_step: number;
  /** 원문 전화번호를 노출하지 않고 기존 값의 존재만 알려준다. */
  has_phone: boolean;
}

export type PublicPartnerProfile = Pick<Profile, "id" | "name" | "role">;

export interface Couple {
  id: string;
  /** Null for retired/blocked couples or legacy rows pending server regeneration. */
  invite_code: string | null;
  bride_id: string | null;
  groom_id: string | null;
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
}

export type PayerType = "couple" | "bride_parents" | "groom_parents" | "both_parents";

export interface ProgressItem {
  category?: string;
  label?: string;
  status: "not_started" | "in_progress" | "completed";
  /** 사용자가 계획한 항목별 예산. */
  budget?: number;
  /** 사용자가 계약서에서 확인해 직접 기록한 계약 총액. */
  contractedTotal?: number;
  /** 사용자가 직접 기록한 현재까지의 누적 납부액. */
  paidToDate?: number;
  /** 사용자가 직접 기록한 다음 납부 예정액. */
  nextPaymentAmount?: number;
  /** 사용자가 직접 기록한 다음 납부 예정일(YYYY-MM-DD). */
  nextPaymentDate?: string;
  /** @deprecated 과거 사용자 기록 조회·삭제 호환용. 신규 저장 금지. */
  spent?: number;
  /** @deprecated 과거 사용자 기록 조회·삭제 호환용. 신규 저장 금지. */
  cost?: number;
  vendor?: string;
  notes?: string;
  checklist?: ChecklistItem[];
  /** @deprecated 과거 사용자 기록 조회·삭제 호환용. 신규 저장 금지. */
  payer?: string;
}

export interface ScheduleEvent {
  id: string;
  date: string;
  title: string;
  time?: string;
  memo?: string;
  categoryKey?: string;
  sourceKey?: string;
  /** 모멘트 루프 트리거 — constants/moments.ts의 MomentType. 같은 타입 복수 이벤트 허용(예: 청첩장 모임 그룹별) */
  momentType?: string;
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

export interface ChatMessageMetadata {
  roomId?: string;
  suggestions?: string[];
  toolResults?: ToolExecutionResult[];
  imageUrls?: string[];
  imagePaths?: string[];
  target?: ChatMessageTarget; // "ai" = 아모라에게, "partner" = 상대방에게
  lifecycle?: {
    stage?: string;
    riskLevel?: string;
    riskScore?: number;
    primaryActionId?: string;
    href?: string;
  };
  // D3 — 서버가 계산한 stage/specialist를 SSE로 클라이언트에 전달
  stageTag?: import("./moat.types").StageTag;
  specialistType?: import("./moat.types").SpecialistType;
  // 커플 갈등 중재 — AI 응답에서 [mediation]...[/mediation] 마커가 추출되면 백엔드가 채움.
  // 클라이언트는 ChatBubble에서 MediationCard로 시각화.
  mediation?: {
    empathy?: string;
    translation?: string;
    data?: string;
    resolution?: string;
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
