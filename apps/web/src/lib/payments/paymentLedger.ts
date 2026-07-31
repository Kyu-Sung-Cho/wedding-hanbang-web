import { isRecord } from "@/utils/requestValidation";

export const PAYMENT_LEDGER_STATUSES = [
  "planned",
  "contracted",
  "partially_paid",
  "paid",
  "cancelled",
  "disputed",
] as const;

export const PAYMENT_EVIDENCE_STATUSES = [
  "user_stated",
  "provider_written",
] as const;

export type PaymentLedgerStatus = (typeof PAYMENT_LEDGER_STATUSES)[number];
export type PaymentEvidenceStatus =
  (typeof PAYMENT_EVIDENCE_STATUSES)[number];

export type PaymentLedgerValues = {
  itemName: string;
  vendorDisplayName: string | null;
  categoryKey: string;
  contractAmountWon: number;
  paidAmountWon: number;
  balanceDueDate: string | null;
  refundableAmountWon: number | null;
  status: PaymentLedgerStatus;
  evidenceStatus: PaymentEvidenceStatus;
};

export type PaymentLedgerEntry = PaymentLedgerValues & {
  id: string;
  balanceAmountWon: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  createdByMe: boolean;
  updatedByMe: boolean;
};

export type PaymentLedgerValidationResult =
  | { ok: true; value: PaymentLedgerValues }
  | { ok: false; error: string };

export type PaymentLedgerUpdateValidationResult =
  | { ok: true; value: PaymentLedgerValues & { revision: number } }
  | { ok: false; error: string };

export type PaymentLedgerCreateRequestValidationResult =
  | {
      ok: true;
      value: PaymentLedgerValues & { clientRequestId: string };
    }
  | { ok: false; error: string };

export const PAYMENT_LEDGER_SELECT =
  "id, item_name, vendor_display_name, category_key, contract_amount_won, paid_amount_won, balance_amount_won, balance_due_date, refundable_amount_won, status, evidence_status, created_by, updated_by, revision, created_at, updated_at";

const MAX_WON = 1_000_000_000;
const MAX_REVISION = Number.MAX_SAFE_INTEGER;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORY_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

const VALUE_KEYS = new Set([
  "itemName",
  "vendorDisplayName",
  "categoryKey",
  "contractAmountWon",
  "paidAmountWon",
  "balanceDueDate",
  "refundableAmountWon",
  "status",
  "evidenceStatus",
]);

function requiredText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    trimmed.length === 0
    || Array.from(trimmed).length > maxLength
    || CONTROL_CHARACTER_PATTERN.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function optionalText(
  value: unknown,
  maxLength: number,
): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (
    trimmed.length === 0
    || Array.from(trimmed).length > maxLength
    || CONTROL_CHARACTER_PATTERN.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed;
}

function integerWon(value: unknown): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_WON
    ? value
    : null;
}

function optionalIntegerWon(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  return integerWon(value) ?? undefined;
}

function isActualIsoDate(value: unknown): value is string {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

function optionalIsoDate(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  return isActualIsoDate(value) ? value : undefined;
}

export function isPaymentLedgerStatus(
  value: unknown,
): value is PaymentLedgerStatus {
  return typeof value === "string"
    && PAYMENT_LEDGER_STATUSES.some((status) => status === value);
}

export function isPaymentEvidenceStatus(
  value: unknown,
): value is PaymentEvidenceStatus {
  return typeof value === "string"
    && PAYMENT_EVIDENCE_STATUSES.some((status) => status === value);
}

function validateStatusAmounts(values: PaymentLedgerValues): string | null {
  if (values.paidAmountWon > values.contractAmountWon) {
    return "기지급액은 계약 총액보다 클 수 없습니다.";
  }
  if (
    values.refundableAmountWon !== null
    && values.refundableAmountWon > values.paidAmountWon
  ) {
    return "환불 가능 참고액은 기지급액보다 클 수 없습니다.";
  }

  if (values.status === "planned" && values.paidAmountWon !== 0) {
    return "지급액이 있으면 상태를 일부 지급 또는 지급 완료로 바꿔 주세요.";
  }
  if (
    values.status === "contracted"
    && (values.contractAmountWon === 0 || values.paidAmountWon !== 0)
  ) {
    return "계약 상태에는 0원보다 큰 계약 총액과 0원의 기지급액이 필요합니다.";
  }
  if (
    values.status === "partially_paid"
    && !(
      values.paidAmountWon > 0
      && values.paidAmountWon < values.contractAmountWon
    )
  ) {
    return "일부 지급 상태에는 계약 총액보다 작은 기지급액이 필요합니다.";
  }
  if (
    values.status === "paid"
    && (
      values.contractAmountWon === 0
      || values.paidAmountWon !== values.contractAmountWon
    )
  ) {
    return "지급 완료 상태에서는 계약 총액과 기지급액이 같아야 합니다.";
  }
  return null;
}

function parseValues(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
): PaymentLedgerValidationResult {
  if (!isRecord(value)) {
    return { ok: false, error: "요청 형식이 올바르지 않습니다." };
  }
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return { ok: false, error: "허용되지 않은 요청 항목이 있습니다." };
  }

  const itemName = requiredText(value.itemName, 100);
  if (!itemName) {
    return { ok: false, error: "항목은 100자 이내로 입력해 주세요." };
  }
  const vendorDisplayName = optionalText(value.vendorDisplayName, 120);
  if (vendorDisplayName === undefined) {
    return { ok: false, error: "업체 표시명은 120자 이내로 입력해 주세요." };
  }
  if (
    typeof value.categoryKey !== "string"
    || !CATEGORY_KEY_PATTERN.test(value.categoryKey)
  ) {
    return { ok: false, error: "카테고리 형식이 올바르지 않습니다." };
  }
  const contractAmountWon = integerWon(value.contractAmountWon);
  if (contractAmountWon === null) {
    return {
      ok: false,
      error: "계약 총액은 0원부터 10억원 사이의 정수로 입력해 주세요.",
    };
  }
  const paidAmountWon = integerWon(value.paidAmountWon);
  if (paidAmountWon === null) {
    return {
      ok: false,
      error: "기지급액은 0원부터 10억원 사이의 정수로 입력해 주세요.",
    };
  }
  const balanceDueDate = optionalIsoDate(value.balanceDueDate);
  if (balanceDueDate === undefined) {
    return { ok: false, error: "잔금일은 실제 날짜로 입력해 주세요." };
  }
  const refundableAmountWon = optionalIntegerWon(value.refundableAmountWon);
  if (refundableAmountWon === undefined) {
    return {
      ok: false,
      error: "환불 가능 참고액은 0원부터 10억원 사이의 정수로 입력해 주세요.",
    };
  }
  if (!isPaymentLedgerStatus(value.status)) {
    return { ok: false, error: "진행 상태가 올바르지 않습니다." };
  }
  if (!isPaymentEvidenceStatus(value.evidenceStatus)) {
    return { ok: false, error: "금액 근거 상태가 올바르지 않습니다." };
  }

  const parsed: PaymentLedgerValues = {
    itemName,
    vendorDisplayName,
    categoryKey: value.categoryKey,
    contractAmountWon,
    paidAmountWon,
    balanceDueDate,
    refundableAmountWon,
    status: value.status,
    evidenceStatus: value.evidenceStatus,
  };
  const invariantError = validateStatusAmounts(parsed);
  return invariantError
    ? { ok: false, error: invariantError }
    : { ok: true, value: parsed };
}

export function parsePaymentLedgerCreate(
  value: unknown,
): PaymentLedgerValidationResult {
  return parseValues(value, VALUE_KEYS);
}

export function parsePaymentLedgerCreateRequest(
  value: unknown,
): PaymentLedgerCreateRequestValidationResult {
  const requestKeys = new Set(VALUE_KEYS);
  requestKeys.add("clientRequestId");
  const values = parseValues(value, requestKeys);
  if (!values.ok) return values;
  if (!isRecord(value) || !isUuidString(value.clientRequestId)) {
    return { ok: false, error: "저장 요청 식별자가 올바르지 않습니다." };
  }
  return {
    ok: true,
    value: {
      ...values.value,
      clientRequestId: value.clientRequestId.toLowerCase(),
    },
  };
}

export function parsePaymentLedgerUpdate(
  value: unknown,
): PaymentLedgerUpdateValidationResult {
  const updateKeys = new Set(VALUE_KEYS);
  updateKeys.add("revision");
  const values = parseValues(value, updateKeys);
  if (!values.ok) return values;
  if (
    !isRecord(value)
    || typeof value.revision !== "number"
    || !Number.isSafeInteger(value.revision)
    || value.revision < 1
    || value.revision > MAX_REVISION
  ) {
    return { ok: false, error: "수정 버전이 올바르지 않습니다." };
  }
  return { ok: true, value: { ...values.value, revision: value.revision } };
}

function finiteInteger(value: unknown, min: number, max: number): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= min
    && value <= max
    ? value
    : null;
}

function isUuidString(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * Service-role 결과도 API 응답 전에 다시 확인한다. 스키마 드리프트나 예상 밖
 * 직렬화가 있으면 잘못된 금액을 사용자에게 보여주지 않고 닫힌 상태로 끝낸다.
 */
export function mapPaymentLedgerRow(
  row: unknown,
  actorUserId: string,
): PaymentLedgerEntry | null {
  if (!isRecord(row)) return null;
  const contractAmountWon = finiteInteger(
    row.contract_amount_won,
    0,
    MAX_WON,
  );
  const paidAmountWon = finiteInteger(row.paid_amount_won, 0, MAX_WON);
  const balanceAmountWon = finiteInteger(row.balance_amount_won, 0, MAX_WON);
  const refundableAmountWon = row.refundable_amount_won === null
    ? null
    : finiteInteger(row.refundable_amount_won, 0, MAX_WON);
  const revision = finiteInteger(row.revision, 1, MAX_REVISION);
  const itemName = requiredText(row.item_name, 100);
  const vendorDisplayName = optionalText(row.vendor_display_name, 120);

  if (
    typeof row.id !== "string"
    || !UUID_PATTERN.test(row.id)
    || !itemName
    || vendorDisplayName === undefined
    || typeof row.category_key !== "string"
    || !CATEGORY_KEY_PATTERN.test(row.category_key)
    || contractAmountWon === null
    || paidAmountWon === null
    || balanceAmountWon === null
    || refundableAmountWon === undefined
    || paidAmountWon > contractAmountWon
    || balanceAmountWon !== contractAmountWon - paidAmountWon
    || (
      refundableAmountWon !== null
      && refundableAmountWon > paidAmountWon
    )
    || (
      row.balance_due_date !== null
      && !isActualIsoDate(row.balance_due_date)
    )
    || !isPaymentLedgerStatus(row.status)
    || !isPaymentEvidenceStatus(row.evidence_status)
    || revision === null
    || typeof row.created_at !== "string"
    || typeof row.updated_at !== "string"
  ) {
    return null;
  }

  return {
    id: row.id,
    itemName,
    vendorDisplayName,
    categoryKey: row.category_key,
    contractAmountWon,
    paidAmountWon,
    balanceAmountWon,
    balanceDueDate: row.balance_due_date,
    refundableAmountWon,
    status: row.status,
    evidenceStatus: row.evidence_status,
    revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByMe: row.created_by === actorUserId,
    updatedByMe: row.updated_by === actorUserId,
  };
}

export function paymentLedgerWritePayload(
  values: PaymentLedgerValues,
): Record<string, string | number | null> {
  return {
    item_name: values.itemName,
    vendor_display_name: values.vendorDisplayName,
    category_key: values.categoryKey,
    contract_amount_won: values.contractAmountWon,
    paid_amount_won: values.paidAmountWon,
    balance_due_date: values.balanceDueDate,
    refundable_amount_won: values.refundableAmountWon,
    status: values.status,
    evidence_status: values.evidenceStatus,
  };
}

export function parsePaymentLedgerApiEntry(
  value: unknown,
): PaymentLedgerEntry | null {
  if (!isRecord(value)) return null;
  const parsed = parsePaymentLedgerCreate({
    itemName: value.itemName,
    vendorDisplayName: value.vendorDisplayName,
    categoryKey: value.categoryKey,
    contractAmountWon: value.contractAmountWon,
    paidAmountWon: value.paidAmountWon,
    balanceDueDate: value.balanceDueDate,
    refundableAmountWon: value.refundableAmountWon,
    status: value.status,
    evidenceStatus: value.evidenceStatus,
  });
  if (!parsed.ok) return null;
  const balanceAmountWon = finiteInteger(value.balanceAmountWon, 0, MAX_WON);
  const revision = finiteInteger(value.revision, 1, MAX_REVISION);
  if (
    typeof value.id !== "string"
    || !UUID_PATTERN.test(value.id)
    || balanceAmountWon === null
    || (
      balanceAmountWon
      !== parsed.value.contractAmountWon - parsed.value.paidAmountWon
    )
    || revision === null
    || typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string"
    || typeof value.createdByMe !== "boolean"
    || typeof value.updatedByMe !== "boolean"
  ) {
    return null;
  }
  return {
    id: value.id,
    ...parsed.value,
    balanceAmountWon,
    revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    createdByMe: value.createdByMe,
    updatedByMe: value.updatedByMe,
  };
}
