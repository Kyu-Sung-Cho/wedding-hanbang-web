"use client";

import { useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";

import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import {
  isPaymentEvidenceStatus,
  isPaymentLedgerStatus,
  parsePaymentLedgerApiEntry,
  type PaymentEvidenceStatus,
  type PaymentLedgerEntry,
  type PaymentLedgerStatus,
} from "@/lib/payments/paymentLedger";
import { isRecord } from "@/utils/requestValidation";

type PaymentLedgerFormProps = {
  entry: PaymentLedgerEntry | null;
  onCancel: () => void;
  onSaved: (entry: PaymentLedgerEntry) => void;
  onRevisionConflict: () => Promise<void>;
};

const STATUS_OPTIONS: Array<{
  value: PaymentLedgerStatus;
  label: string;
}> = [
  { value: "planned", label: "검토 중" },
  { value: "contracted", label: "계약함 · 아직 지급 전" },
  { value: "partially_paid", label: "일부 지급" },
  { value: "paid", label: "지급 완료" },
  { value: "cancelled", label: "취소됨" },
  { value: "disputed", label: "금액 확인 중" },
];

const CATEGORY_OPTIONS = Object.entries(PLANNING_CATEGORY_LABELS);

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").slice(0, 10);
}

function integerFromInput(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= 1_000_000_000
    ? parsed
    : null;
}

function optionalIntegerFromInput(value: string): number | null | undefined {
  return value === "" ? null : integerFromInput(value) ?? undefined;
}

function reconciledStatus(
  current: PaymentLedgerStatus,
  contract: number,
  paid: number,
): PaymentLedgerStatus {
  if (current === "cancelled" || current === "disputed") return current;
  if (contract === 0) return "planned";
  if (paid === 0) return current === "planned" ? "planned" : "contracted";
  if (paid === contract) return "paid";
  return "partially_paid";
}

function wonPreview(value: string): string | null {
  const amount = integerFromInput(value);
  return amount === null ? null : `${amount.toLocaleString("ko-KR")}원`;
}

export default function PaymentLedgerForm({
  entry,
  onCancel,
  onSaved,
  onRevisionConflict,
}: PaymentLedgerFormProps) {
  const [clientRequestId] = useState<string | null>(() => {
    try {
      return globalThis.crypto.randomUUID();
    } catch {
      return null;
    }
  });
  const [itemName, setItemName] = useState(entry?.itemName ?? "");
  const [vendorDisplayName, setVendorDisplayName] = useState(
    entry?.vendorDisplayName ?? "",
  );
  const [categoryKey, setCategoryKey] = useState(
    entry?.categoryKey ?? "venue",
  );
  const [contractAmount, setContractAmount] = useState(
    String(entry?.contractAmountWon ?? 0),
  );
  const [paidAmount, setPaidAmount] = useState(
    String(entry?.paidAmountWon ?? 0),
  );
  const [balanceDueDate, setBalanceDueDate] = useState(
    entry?.balanceDueDate ?? "",
  );
  const [refundableAmount, setRefundableAmount] = useState(
    entry?.refundableAmountWon === null
      || entry?.refundableAmountWon === undefined
      ? ""
      : String(entry.refundableAmountWon),
  );
  const [status, setStatus] = useState<PaymentLedgerStatus>(
    entry?.status ?? "planned",
  );
  const [evidenceStatus, setEvidenceStatus] =
    useState<PaymentEvidenceStatus>(
      entry?.evidenceStatus ?? "user_stated",
    );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const contractPreview = wonPreview(contractAmount);
  const paidPreview = wonPreview(paidAmount);

  const submit = async () => {
    setError("");
    const contractAmountWon = integerFromInput(contractAmount);
    const paidAmountWon = integerFromInput(paidAmount);
    const refundableAmountWon = optionalIntegerFromInput(refundableAmount);
    if (
      !itemName.trim()
      || contractAmountWon === null
      || paidAmountWon === null
      || refundableAmountWon === undefined
    ) {
      setError("항목과 금액을 다시 확인해 주세요. 금액은 원 단위 정수로 적어 주세요.");
      return;
    }
    if (!entry && !clientRequestId) {
      setError("안전한 저장 요청을 만들지 못했습니다. 화면을 새로고침해 주세요.");
      return;
    }
    if (paidAmountWon > contractAmountWon) {
      setError("기지급액은 계약 총액보다 클 수 없습니다.");
      return;
    }
    if (
      refundableAmountWon !== null
      && refundableAmountWon > paidAmountWon
    ) {
      setError("환불 가능 참고액은 기지급액보다 클 수 없습니다.");
      return;
    }

    const body = {
      itemName: itemName.trim(),
      vendorDisplayName: vendorDisplayName.trim() || null,
      categoryKey,
      contractAmountWon,
      paidAmountWon,
      balanceDueDate: balanceDueDate || null,
      refundableAmountWon,
      status: reconciledStatus(status, contractAmountWon, paidAmountWon),
      evidenceStatus,
      ...(entry
        ? { revision: entry.revision }
        : { clientRequestId }),
    };

    setSaving(true);
    try {
      const response = await fetch(
        entry ? `/api/payments/${encodeURIComponent(entry.id)}` : "/api/payments",
        {
          method: entry ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        if (
          response.status === 409
          && isRecord(payload)
          && payload.code === "PAYMENT_LEDGER_REVISION_CONFLICT"
        ) {
          await onRevisionConflict();
        }
        const message = isRecord(payload) && typeof payload.error === "string"
          ? payload.error
          : "기록을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
        throw new Error(message);
      }
      const saved = isRecord(payload)
        ? parsePaymentLedgerApiEntry(payload.payment)
        : null;
      if (!saved) {
        throw new Error("저장 결과를 확인하지 못했습니다. 목록을 다시 불러와 주세요.");
      }
      onSaved(saved);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "기록을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="rounded-2xl border border-[#D9CEC1] bg-[#FBF8F2] p-4 sm:p-5"
      data-testid="payment-ledger-form"
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-[#243832]">
            {entry ? "계약·지급 기록 수정" : "계약·지급 기록 추가"}
          </h3>
          <p className="mt-1 text-xs leading-5 text-[#6F6760]">
            커플 공유 기록이에요. 저장하면 연결된 상대도 볼 수 있습니다.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg p-2 text-[#8E857C] hover:bg-white disabled:opacity-50"
          aria-label="입력 닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-1.5 block text-sm font-medium text-[#243832]">
            무엇에 대한 기록인가요?
          </span>
          <input
            value={itemName}
            onChange={(event) => setItemName(event.target.value)}
            maxLength={100}
            placeholder="예: 예식장 계약, 사진 촬영 계약금"
            className="w-full rounded-xl border border-[#D9CEC1] bg-white px-3.5 py-3 text-sm text-[#243832] outline-none focus:border-[#A77B74] focus:ring-2 focus:ring-[#A77B74]/15"
          />
        </label>

        <label>
          <span className="mb-1.5 block text-sm font-medium text-[#243832]">
            카테고리
          </span>
          <select
            value={categoryKey}
            onChange={(event) => setCategoryKey(event.target.value)}
            className="w-full rounded-xl border border-[#D9CEC1] bg-white px-3.5 py-3 text-sm text-[#243832] outline-none focus:border-[#A77B74]"
          >
            {CATEGORY_OPTIONS.map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>

        <label>
          <span className="mb-1.5 block text-sm font-medium text-[#243832]">
            업체 표시명 <span className="font-normal text-[#8E857C]">(선택)</span>
          </span>
          <input
            value={vendorDisplayName}
            onChange={(event) => setVendorDisplayName(event.target.value)}
            maxLength={120}
            placeholder="내가 알아볼 이름"
            className="w-full rounded-xl border border-[#D9CEC1] bg-white px-3.5 py-3 text-sm text-[#243832] outline-none focus:border-[#A77B74]"
          />
        </label>

        <label>
          <span className="mb-1.5 block text-sm font-medium text-[#243832]">
            계약 총액 · 원
          </span>
          <input
            value={contractAmount}
            onChange={(event) => setContractAmount(digitsOnly(event.target.value))}
            inputMode="numeric"
            aria-label="계약 총액 원"
            className="w-full rounded-xl border border-[#D9CEC1] bg-white px-3.5 py-3 text-sm tabular-nums text-[#243832] outline-none focus:border-[#A77B74]"
          />
          {contractPreview && (
            <span className="mt-1 block text-xs text-[#8E857C]">{contractPreview}</span>
          )}
        </label>

        <label>
          <span className="mb-1.5 block text-sm font-medium text-[#243832]">
            지금까지 지급한 금액 · 원
          </span>
          <input
            value={paidAmount}
            onChange={(event) => setPaidAmount(digitsOnly(event.target.value))}
            inputMode="numeric"
            aria-label="기지급액 원"
            className="w-full rounded-xl border border-[#D9CEC1] bg-white px-3.5 py-3 text-sm tabular-nums text-[#243832] outline-none focus:border-[#A77B74]"
          />
          {paidPreview && (
            <span className="mt-1 block text-xs text-[#8E857C]">{paidPreview}</span>
          )}
        </label>

        <label>
          <span className="mb-1.5 block text-sm font-medium text-[#243832]">
            잔금일 <span className="font-normal text-[#8E857C]">(선택)</span>
          </span>
          <input
            type="date"
            value={balanceDueDate}
            onChange={(event) => setBalanceDueDate(event.target.value)}
            className="w-full rounded-xl border border-[#D9CEC1] bg-white px-3.5 py-3 text-sm text-[#243832] outline-none focus:border-[#A77B74]"
          />
        </label>

        <label>
          <span className="mb-1.5 block text-sm font-medium text-[#243832]">
            환불 가능 참고액 · 원 <span className="font-normal text-[#8E857C]">(선택)</span>
          </span>
          <input
            value={refundableAmount}
            onChange={(event) => setRefundableAmount(digitsOnly(event.target.value))}
            inputMode="numeric"
            aria-label="환불 가능 참고액 원"
            placeholder="확인하지 않았다면 비워 두기"
            className="w-full rounded-xl border border-[#D9CEC1] bg-white px-3.5 py-3 text-sm tabular-nums text-[#243832] outline-none focus:border-[#A77B74]"
          />
        </label>

        <label>
          <span className="mb-1.5 block text-sm font-medium text-[#243832]">진행 상태</span>
          <select
            value={status}
            onChange={(event) => {
              if (isPaymentLedgerStatus(event.target.value)) {
                setStatus(event.target.value);
              }
            }}
            className="w-full rounded-xl border border-[#D9CEC1] bg-white px-3.5 py-3 text-sm text-[#243832] outline-none focus:border-[#A77B74]"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="mb-1.5 block text-sm font-medium text-[#243832]">금액을 옮긴 근거</span>
          <select
            value={evidenceStatus}
            onChange={(event) => {
              if (isPaymentEvidenceStatus(event.target.value)) {
                setEvidenceStatus(event.target.value);
              }
            }}
            className="w-full rounded-xl border border-[#D9CEC1] bg-white px-3.5 py-3 text-sm text-[#243832] outline-none focus:border-[#A77B74]"
          >
            <option value="user_stated">내가 직접 입력</option>
            <option value="provider_written">업체 문서에서 직접 옮김</option>
          </select>
        </label>
      </div>

      <div className="mt-4 flex gap-2 rounded-xl bg-[#FFF7EA] px-3 py-2.5 text-xs leading-5 text-[#755D3F]">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          환불 가능 참고액은 확정된 환불 권리나 법률 판단이 아닙니다.
          계약서와 업체의 최신 서면 안내를 직접 확인해 주세요.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-[#E5B8B8] bg-[#FFF6F6] px-3 py-2.5 text-sm leading-5 text-[#8C3E3E]"
        >
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-xl border border-[#D9CEC1] bg-white px-4 py-3 text-sm font-medium text-[#5E5751] disabled:opacity-50"
        >
          닫기
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#36534E] px-5 py-3 text-sm font-semibold text-white hover:bg-[#243832] disabled:opacity-50"
        >
          <Check className="h-4 w-4" />
          {saving ? "저장 중…" : "공유 기록 저장"}
        </button>
      </div>
    </div>
  );
}
