import type { ToolExecutionResult } from "@/types/database.types";
import { simulateGuestGuarantee } from "@/lib/amora/guestGuarantee";

function parseMealPriceManwon(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  if (amount > 1000) return Math.round(amount) / 10000;
  return Math.round(amount * 10000) / 10000;
}

function parsePositiveInteger(value: unknown): number | undefined {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return Math.round(num);
}

export function executeSimulateGuestGuarantee(input: Record<string, unknown>): ToolExecutionResult {
  const result = simulateGuestGuarantee({
    estimatedGuests: parsePositiveInteger(input.estimated_guests),
    guaranteedGuests: parsePositiveInteger(input.guaranteed_guests),
    mealPriceManwon: parseMealPriceManwon(input.meal_price),
    confirmedRsvpGuests: parsePositiveInteger(input.confirmed_rsvp_guests),
    noShowRatePercent: typeof input.no_show_rate_percent === "number" && Number.isFinite(input.no_show_rate_percent)
      ? input.no_show_rate_percent
      : undefined,
    noticeDeadlineYmd: typeof input.notice_deadline === "string" ? input.notice_deadline : undefined,
    venueName: typeof input.venue_name === "string" ? input.venue_name : undefined,
    memo: typeof input.memo === "string" ? input.memo : undefined,
  });

  return {
    toolName: "simulate_guest_guarantee",
    toolInput: input,
    toolOutput: { ...result },
    success: true,
    displayMessage:
      result.mode === "input_needed"
        ? result.summaryText
        : `${result.summaryTitle} (입력값으로 계산한 식사비 ${result.expectedMealTotalManwon}만원)`,
  };
}
