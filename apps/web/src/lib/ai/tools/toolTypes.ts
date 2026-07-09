import type { ToolExecutionResult } from "@/types/database.types";

export interface ToolExecutionContext {
  coupleId: string;
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
