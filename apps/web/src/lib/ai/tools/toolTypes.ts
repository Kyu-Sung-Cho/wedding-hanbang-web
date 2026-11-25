import type { ToolExecutionResult } from "@/types/database.types";
import type { AmoraWebLookupTurnState } from "@/lib/ai/webLookup/webLookupTurn";

export { formatWon } from "@/lib/formatWon";

export interface ToolExecutionContext {
  coupleId: string;
  /**
   * Supabase Auth에서 서버가 확인한 현재 구성원의 profile UUID.
   * 일정 취소 감사 정보처럼 행위자를 저장하는 변경은 이 값이 없으면 중단한다.
   */
  actorProfileId?: string;
  /**
   * Canonical durable chat claim key (`chat:<user uuid>:<request uuid>`).
   * executeTool fails closed for mutating tools when this is absent so a
   * model retry cannot bypass the database operation ledger.
   */
  requestKey?: string;
  /**
   * Attempt number returned by the durable chat-request claim. Mutating tool
   * claims bind to this value so a reclaimed/retried turn cannot invent a new
   * operation after an earlier attempt may already have changed state.
   */
  requestAttemptCount?: number;
  /**
   * 1-based index of the paid provider call that produced this automatic
   * tool call. It is not an authorization: executeTool never runs a mutating
   * tool on this alone. Mutating tools need pendingActionId.
   */
  providerCallIndex?: number;
  /**
   * Server-issued approval capability for a user-confirmed pending action.
   * executeTool refuses every mutating tool when this is absent, so a
   * mutating tool cannot run without a confirmed card. When present,
   * mutating-tool claims are additionally deduplicated for the whole couple
   * so either partner cannot apply the approval twice.
   */
  pendingActionId?: string;
  currentUserText?: string;
  /** 현재 인증 요청에만 결합된 개인 조회. 서비스 역할 클라이언트를 사용하지 않는다. */
  personalActions?: {
    visibility: "bride_private" | "groom_private";
    readCount: (status: "all" | "open" | "done") => Promise<number>;
  };
  weddingContext: {
    weddingDate: string | null;
    budget: number;
    venue: string | null;
    progress: Record<string, { category: string; status: string }>;
  };
  /** 찾아보기(search_web·read_page)를 연 턴에만 있다. `planAmoraWebLookupTurn` 이 만든다. */
  webLookup?: AmoraWebLookupTurnState;
}

export function requireDestructiveConfirmation(
  toolName: string,
  input: Record<string, unknown>,
  message: string
): ToolExecutionResult | null {
  if (input.confirmed === true) return null;
  return {
    toolName,
    toolInput: input,
    toolOutput: {
      requires_confirmation: true,
      confirmation_field: "confirmed",
    },
    success: false,
    displayMessage: message,
  };
}

export function hasFinalConsonant(value: string): boolean {
  const chars = [...value.trim()];
  const last = chars[chars.length - 1];
  if (!last) return false;
  const code = last.charCodeAt(0) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0;
}

export function subjectParticle(value: string) {
  return hasFinalConsonant(value) ? "이" : "가";
}

export function objectParticle(value: string) {
  return hasFinalConsonant(value) ? "을" : "를";
}
