import type { ToolExecutionResult } from "@/types/database.types";
import {
  analyzeContractReadiness,
  type ContractEvidenceType,
  type ContractShieldCategory,
} from "@/lib/amora/contractShield";
import { simulateGuestGuarantee } from "@/lib/amora/guestGuarantee";

const CONTRACT_CATEGORY_SET = new Set<ContractShieldCategory>([
  "venue",
  "sdm_package",
  "studio",
  "dress",
  "makeup",
  "snap",
  "other",
]);

const EVIDENCE_TYPE_SET = new Set<ContractEvidenceType>([
  "quote",
  "contract",
  "deposit",
  "message_capture",
  "receipt",
  "schedule",
  "vendor_policy",
]);

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function parseEvidenceTypes(value: unknown): ContractEvidenceType[] {
  return parseStringArray(value).filter((item): item is ContractEvidenceType =>
    EVIDENCE_TYPE_SET.has(item as ContractEvidenceType)
  );
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function parseManwonAmount(value: unknown): number | undefined {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  return amount > 100000 ? Math.round(amount / 10000) : Math.round(amount * 10) / 10;
}

function parseMealPriceManwon(value: unknown): number | undefined {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  if (amount > 1000) return Math.round((amount / 10000) * 10) / 10;
  return Math.round(amount * 10) / 10;
}

function parsePositiveInteger(value: unknown): number | undefined {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return Math.round(num);
}

function parseContractCategory(value: unknown): ContractShieldCategory {
  const raw = typeof value === "string" ? value : "other";
  return CONTRACT_CATEGORY_SET.has(raw as ContractShieldCategory)
    ? (raw as ContractShieldCategory)
    : "other";
}

export function executeAnalyzeContractReadiness(input: Record<string, unknown>): ToolExecutionResult {
  const result = analyzeContractReadiness({
    category: parseContractCategory(input.category),
    vendorName: typeof input.vendor_name === "string" ? input.vendor_name : undefined,
    contractAmountManwon: parseManwonAmount(input.contract_amount),
    depositAmountManwon: parseManwonAmount(input.deposit_amount),
    hasWrittenContract: parseOptionalBoolean(input.has_written_contract),
    usesStandardContract: parseOptionalBoolean(input.uses_standard_contract),
    includedItems: parseStringArray(input.included_items),
    checkedClauseIds: parseStringArray(input.checked_clauses),
    missingClauseIds: parseStringArray(input.missing_clauses),
    evidenceTypes: parseEvidenceTypes(input.evidence_types),
    oralPromises: parseStringArray(input.oral_promises),
    cancellationPolicyText: typeof input.cancellation_policy === "string" ? input.cancellation_policy : undefined,
    changePolicyText: typeof input.change_policy === "string" ? input.change_policy : undefined,
    paymentScheduleText: typeof input.payment_schedule === "string" ? input.payment_schedule : undefined,
    extraFeePolicyText: typeof input.extra_fee_policy === "string" ? input.extra_fee_policy : undefined,
    memo: typeof input.memo === "string" ? input.memo : undefined,
  });

  return {
    toolName: "analyze_contract_readiness",
    toolInput: input,
    toolOutput: { ...result },
    success: true,
    displayMessage: result.summaryTitle,
  };
}

export function executeSimulateGuestGuarantee(input: Record<string, unknown>): ToolExecutionResult {
  const result = simulateGuestGuarantee({
    estimatedGuests: parsePositiveInteger(input.estimated_guests),
    guaranteedGuests: parsePositiveInteger(input.guaranteed_guests),
    mealPriceManwon: parseMealPriceManwon(input.meal_price),
    confirmedRsvpGuests: parsePositiveInteger(input.confirmed_rsvp_guests),
    noShowRatePercent: Number.isFinite(Number(input.no_show_rate_percent))
      ? Number(input.no_show_rate_percent)
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
