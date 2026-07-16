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
  /** 아모라 케어 아웃바운드(모멘트 이메일 등) 수신 여부 — 기본 true */
  care_notifications_enabled?: boolean;
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
  invite_code: string;
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
  budget?: number;
  spent?: number;
  cost?: number;
  vendor?: string;
  notes?: string;
  checklist?: ChecklistItem[];
  payer?: PayerType;
}

export interface ScheduleEvent {
  id: string;
  date: string;
  title: string;
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
