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

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface ProgressItem {
  category?: string;
  status: "not_started" | "in_progress" | "completed";
  budget?: number;
  spent?: number;
  vendor?: string;
  notes?: string;
  checklist?: ChecklistItem[];
}

export interface ScheduleEvent {
  id: string;
  date: string;
  title: string;
  memo?: string;
  categoryKey?: string;
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

export interface ChatMessageMetadata {
  roomId?: string;
  suggestions?: string[];
  toolResults?: ToolExecutionResult[];
}

export interface ChatMessage {
  id: string;
  couple_id: string;
  sender_id: string | null;
  sender_role: MessageSenderType;  // 내부용: "bride" | "groom" | "ai" (DB의 sender_type에서 매핑)
  content: string;
  metadata: ChatMessageMetadata | null;
  created_at: string;
}

export interface ChatSummary {
  id: string;
  couple_id: string;
  summary: string;
  message_count: number;
  created_at: string;
}
