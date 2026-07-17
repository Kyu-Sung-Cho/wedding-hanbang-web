import type { ToolExecutionResult } from "@/types/database.types";

export interface ToolExecutionContext {
  coupleId: string;
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
   * Paid provider call whose durable journal authorized this automatic tool
   * call. User-confirmed pending actions use pendingActionId instead.
   */
  providerCallIndex?: number;
  /**
   * Server-issued approval capability for a user-confirmed pending action.
   * When present, mutating-tool claims are additionally deduplicated for the
   * whole couple so either partner cannot apply the approval twice.
   */
  pendingActionId?: string;
  currentUserText?: string;
  weddingContext: {
    weddingDate: string | null;
    budget: number;
    venue: string | null;
    progress: Record<string, { category: string; status: string }>;
  };
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

export function formatWon(amount: number): string {
  return `${Math.round(amount / 10000).toLocaleString()}만원`;
}
