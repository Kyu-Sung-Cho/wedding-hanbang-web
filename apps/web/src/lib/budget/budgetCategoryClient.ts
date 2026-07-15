import type { PayerType } from "@/types/database.types";
import { parseLocalDateOnly } from "@hanbang/shared";

const MAX_AMOUNT_WON = 10_000_000_000;
const AMOUNT_FIELDS = [
  "budget",
  "contractedTotal",
  "paidToDate",
  "nextPaymentAmount",
] as const;
const RETIRED_SET_FIELDS = ["spent", "cost", "payer"] as const;
const SET_FIELDS = new Set([
  ...AMOUNT_FIELDS,
  "nextPaymentDate",
  "label",
  ...RETIRED_SET_FIELDS,
]);
const REMOVE_FIELDS = new Set([
  ...AMOUNT_FIELDS,
  "nextPaymentDate",
  "spent",
  "cost",
  "payer",
  "label",
]);

export type BudgetCategoryRemoveField =
  | "budget"
  | "spent"
  | "cost"
  | "payer"
  | "contractedTotal"
  | "paidToDate"
  | "nextPaymentAmount"
  | "nextPaymentDate"
  | "label";

export interface BudgetCategoryMutation {
  categoryKey: string;
  set?: {
    budget?: number;
    contractedTotal?: number;
    paidToDate?: number;
    nextPaymentAmount?: number;
    nextPaymentDate?: string;
    /** @deprecated Read compatibility only. New writes are rejected. */
    spent?: number;
    /** @deprecated Read compatibility only. New writes are rejected. */
    cost?: number;
    /** @deprecated Read compatibility only. New writes are rejected. */
    payer?: PayerType;
    label?: string;
  };
  remove?: BudgetCategoryRemoveField[];
  visibility?: "visible" | "hidden";
}

export interface BudgetCategoryMutationResult {
  progress: Record<string, unknown>;
  categoryKey: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isSafeAmount(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_AMOUNT_WON;
}

function validateMutationBeforeRequest(mutation: BudgetCategoryMutation): void {
  const setFields = mutation.set;
  if (setFields !== undefined) {
    if (!isRecord(setFields) || Object.keys(setFields).some((field) => !SET_FIELDS.has(field))) {
      throw new Error("예산 항목 입력값을 확인해 주세요.");
    }
    if (RETIRED_SET_FIELDS.some((field) => hasOwn(setFields, field))) {
      throw new Error(
        "spent·cost·payer 기록은 더 이상 새로 저장할 수 없습니다. 기존 기록 삭제만 지원합니다.",
      );
    }
    for (const field of AMOUNT_FIELDS) {
      if (hasOwn(setFields, field) && !isSafeAmount(setFields[field])) {
        throw new Error("금액은 0원 이상 100억원 이하의 정수로 입력해 주세요.");
      }
    }
    if (
      hasOwn(setFields, "nextPaymentDate") &&
      (
        typeof setFields.nextPaymentDate !== "string" ||
        parseLocalDateOnly(setFields.nextPaymentDate) === null
      )
    ) {
      throw new Error("다음 결제일은 YYYY-MM-DD 형식의 실제 날짜로 입력해 주세요.");
    }
    if (
      typeof setFields.contractedTotal === "number" &&
      typeof setFields.paidToDate === "number" &&
      setFields.paidToDate > setFields.contractedTotal
    ) {
      throw new Error("누적 납부액은 계약 총액보다 클 수 없습니다.");
    }
  }
  if (
    mutation.remove !== undefined &&
    (
      !Array.isArray(mutation.remove) ||
      mutation.remove.some((field) => !REMOVE_FIELDS.has(field)) ||
      new Set(mutation.remove).size !== mutation.remove.length ||
      (setFields !== undefined && mutation.remove.some((field) => hasOwn(setFields, field)))
    )
  ) {
    throw new Error("예산 항목 입력값을 확인해 주세요.");
  }
}

function isValidManualRecordState(category: Record<string, unknown>): boolean {
  for (const field of AMOUNT_FIELDS) {
    if (hasOwn(category, field) && !isSafeAmount(category[field])) return false;
  }
  if (
    hasOwn(category, "nextPaymentDate") &&
    (
      typeof category.nextPaymentDate !== "string" ||
      parseLocalDateOnly(category.nextPaymentDate) === null
    )
  ) {
    return false;
  }
  return !(
    typeof category.contractedTotal === "number" &&
    typeof category.paidToDate === "number" &&
    category.paidToDate > category.contractedTotal
  );
}

function confirmsMutation(
  progress: Record<string, unknown>,
  mutation: BudgetCategoryMutation,
): boolean {
  const category = progress[mutation.categoryKey];
  if (
    (mutation.set || mutation.remove) &&
    (!isRecord(category) || category.category !== mutation.categoryKey)
  ) return false;

  if (isRecord(category) && !isValidManualRecordState(category)) return false;

  if (mutation.set && isRecord(category)) {
    for (const [field, expected] of Object.entries(mutation.set)) {
      if (category[field] !== expected) return false;
    }
  }

  if (mutation.remove && isRecord(category)) {
    if (mutation.remove.some((field) => Object.hasOwn(category, field))) return false;
  }

  if (mutation.visibility) {
    const hidden = progress.__hidden;
    if (hidden !== undefined && (
      !Array.isArray(hidden) ||
      !hidden.every((key) => typeof key === "string") ||
      new Set(hidden).size !== hidden.length
    )) {
      return false;
    }
    const isHidden = Array.isArray(hidden) && hidden.includes(mutation.categoryKey);
    if ((mutation.visibility === "hidden") !== isHidden) return false;
  }

  return true;
}

export async function mutateBudgetCategory(
  mutation: BudgetCategoryMutation,
  fetcher: typeof fetch = fetch,
): Promise<BudgetCategoryMutationResult> {
  validateMutationBeforeRequest(mutation);
  const response = await fetcher("/api/journey/budget-categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mutation),
  });
  const body = await response.json().catch(() => null) as unknown;

  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string"
      ? body.error
      : "예산 항목을 저장하지 못했습니다.";
    throw new Error(message);
  }

  if (
    !isRecord(body) ||
    !isRecord(body.progress) ||
    body.categoryKey !== mutation.categoryKey ||
    !confirmsMutation(body.progress, mutation)
  ) {
    throw new Error("저장된 예산 상태를 확인하지 못했습니다. 화면을 새로고침해 주세요.");
  }

  return {
    progress: body.progress,
    categoryKey: body.categoryKey,
  };
}
