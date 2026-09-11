"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  WalletCards,
} from "lucide-react";

import {
  parsePaymentLedgerApiEntry,
  type PaymentLedgerEntry,
  type PaymentLedgerStatus,
} from "@/lib/payments/paymentLedger";
import { useAuthStore } from "@/stores/authStore";
import { isRecord } from "@/utils/requestValidation";

import PaymentLedgerForm from "./PaymentLedgerForm";

const STATUS_LABELS: Record<PaymentLedgerStatus, string> = {
  planned: "검토 중",
  contracted: "계약함 · 지급 전",
  partially_paid: "일부 지급",
  paid: "지급 완료",
  cancelled: "취소됨",
  disputed: "금액 확인 중",
};

function formatWon(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

function formatDate(value: string): string {
  return value.replaceAll("-", ".");
}

function parsePaymentList(payload: unknown): PaymentLedgerEntry[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.payments)) return null;
  const parsed = payload.payments.map(parsePaymentLedgerApiEntry);
  if (parsed.some((entry) => entry === null)) return null;
  return parsed.filter((entry): entry is PaymentLedgerEntry => entry !== null);
}

export default function PaymentLedger() {
  const { user, couple, isDemo } = useAuthStore();
  const [payments, setPayments] = useState<PaymentLedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<PaymentLedgerEntry | null>(null);

  const loadPayments = useCallback(async () => {
    if (!user || !couple || isDemo) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/payments", {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.error === "string"
          ? payload.error
          : "계약·지급 기록을 불러오지 못했습니다.";
        throw new Error(message);
      }
      const nextPayments = parsePaymentList(payload);
      if (!nextPayments) {
        throw new Error("계약·지급 기록 형식을 확인하지 못했습니다.");
      }
      setPayments(nextPayments);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "계약·지급 기록을 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, [couple, isDemo, user]);

  useEffect(() => {
    void loadPayments();
  }, [loadPayments]);

  const totals = useMemo(() => {
    return payments
      .filter((payment) => payment.status !== "cancelled")
      .reduce(
        (sum, payment) => ({
          contract: sum.contract + payment.contractAmountWon,
          paid: sum.paid + payment.paidAmountWon,
          balance: sum.balance + payment.balanceAmountWon,
        }),
        { contract: 0, paid: 0, balance: 0 },
      );
  }, [payments]);
  const summaryItems: Array<{ label: string; value: number }> = [
    { label: "계약 총액", value: totals.contract },
    { label: "지급 기록", value: totals.paid },
    { label: "남은 금액", value: totals.balance },
  ];

  if (!user || !couple) return null;

  if (isDemo) {
    return (
      <section className="rounded-[6px] border border-[#E2D3C8] bg-white p-5">
        <h2 className="text-[var(--hb-text-strong)]">계약·지급 기록</h2>
        <p className="mt-2 text-sm leading-6 text-[#6F6760]">
          체험에서는 계약·지급 기록을 저장하지 않아요. 가입 후 두 사람이 함께
          계약 총액, 지급액과 잔금일을 기록할 수 있습니다.
        </p>
      </section>
    );
  }

  const handleSaved = (saved: PaymentLedgerEntry) => {
    setPayments((current) => {
      const exists = current.some((payment) => payment.id === saved.id);
      return exists
        ? current.map((payment) => payment.id === saved.id ? saved : payment)
        : [saved, ...current];
    });
    setShowCreate(false);
    setEditing(null);
    setNotice("공유 기록에 저장했어요. 실제 결제나 예약은 실행하지 않았습니다.");
  };

  return (
    <section
      className="overflow-hidden rounded-[6px] border border-[#E2D3C8] bg-white shadow-[var(--shadow-raised)]"
      aria-labelledby="payment-ledger-title"
    >
      <div className="border-b border-[var(--hb-hairline)] p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <WalletCards className="h-5 w-5 text-[var(--hb-text-strong)]" aria-hidden="true" />
              <h2
                id="payment-ledger-title"
                className="text-[var(--hb-text-strong)]"
              >
                계약·지급 기록
              </h2>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6F6760]">
              두 사람이 함께 보는 준비 기록입니다. 웨딩한방은 이 화면에서
              실제 결제, 예약, 전자계약을 실행하지 않습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setNotice("");
              setEditing(null);
              setShowCreate(true);
            }}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[6px] bg-[var(--hb-action)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--hb-action-hover)]"
          >
            <Plus className="h-4 w-4" />
            기록 추가
          </button>
        </div>

        {payments.length > 0 && (
          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {summaryItems.map((item) => (
              <div key={item.label} className="rounded-[6px] bg-[var(--hb-surface-page)] px-3.5 py-3">
                <p className="text-xs text-[#80766E]">{item.label}</p>
                <p className="mt-1 text-base font-semibold tabular-nums text-[var(--hb-text-strong)]">
                  {formatWon(item.value)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        {notice && (
          <p
            role="status"
            className="rounded-[6px] border border-[#B9D5C8] bg-[#F2F8F5] px-3.5 py-3 text-sm leading-5 text-[#315B49]"
          >
            {notice}
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-[6px] border border-[#E5B8B8] bg-[#FFF6F6] px-3.5 py-3 text-sm text-[#8C3E3E] sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="flex items-start gap-2 leading-5">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </span>
            <button
              type="button"
              onClick={() => void loadPayments()}
              className="inline-flex items-center gap-1.5 font-semibold"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              다시 불러오기
            </button>
          </div>
        )}

        {showCreate && (
          <PaymentLedgerForm
            key="new-payment"
            entry={null}
            onCancel={() => setShowCreate(false)}
            onSaved={handleSaved}
            onRevisionConflict={loadPayments}
          />
        )}

        {loading ? (
          <div
            role="status"
            className="rounded-[6px] bg-[var(--hb-surface-page)] px-4 py-8 text-center text-sm text-[#80766E]"
          >
            계약·지급 기록을 불러오는 중…
          </div>
        ) : payments.length === 0 && !showCreate && !error ? (
          <div className="rounded-[6px] border border-dashed border-[#D9CEC1] px-4 py-8 text-center">
            <FileText className="mx-auto h-6 w-6 text-[#A77B74]" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-[var(--hb-text-strong)]">
              아직 계약·지급 기록이 없어요
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-[#80766E]">
              계약서나 업체의 서면 안내를 보며 총액, 지급액과 잔금일을 직접
              옮겨 적어 두세요.
            </p>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-[6px] border border-[#A77B74] px-4 py-2.5 text-sm font-semibold text-[#8F6662]"
            >
              <Plus className="h-4 w-4" />
              첫 기록 추가
            </button>
          </div>
        ) : (
          <div className="divide-y divide-[var(--hb-hairline)]">
            {payments.map((payment) => (
              <div key={payment.id} className="py-4 first:pt-0 last:pb-0">
                {editing?.id === payment.id ? (
                  <PaymentLedgerForm
                    key={`${payment.id}:${payment.revision}`}
                    entry={payment}
                    onCancel={() => setEditing(null)}
                    onSaved={handleSaved}
                    onRevisionConflict={async () => {
                      await loadPayments();
                      setEditing(null);
                      setNotice(
                        "상대방이 먼저 수정한 내용이 있어 최신 목록을 불러왔어요.",
                      );
                    }}
                  />
                ) : (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[var(--hb-text-strong)]">
                          {payment.itemName}
                        </h3>
                        <span className="rounded-full bg-[var(--hb-surface-hover)] px-2.5 py-1 text-[11px] font-medium text-[#6F6760]">
                          {STATUS_LABELS[payment.status]}
                        </span>
                      </div>
                      {payment.vendorDisplayName && (
                        <p className="mt-1 text-sm text-[#6F6760]">
                          {payment.vendorDisplayName}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#80766E]">
                        <span>계약 {formatWon(payment.contractAmountWon)}</span>
                        <span>지급 {formatWon(payment.paidAmountWon)}</span>
                        <span className="font-semibold text-[var(--hb-text-strong)]">
                          잔액 {formatWon(payment.balanceAmountWon)}
                        </span>
                        {payment.balanceDueDate && (
                          <span className="inline-flex items-center gap-1">
                            <CalendarDays className="h-3.5 w-3.5" />
                            잔금일 {formatDate(payment.balanceDueDate)}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-[11px] leading-5 text-[#8E857C]">
                        {payment.evidenceStatus === "provider_written"
                          ? "업체 문서에서 직접 옮긴 값 · 웨딩한방이 검증한 금액은 아닙니다."
                          : "사용자가 직접 입력한 값"}
                        {payment.refundableAmountWon !== null
                          ? ` · 환불 가능 참고액 ${formatWon(payment.refundableAmountWon)}`
                          : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreate(false);
                        setEditing(payment);
                      }}
                      className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-[6px] border border-[#D9CEC1] px-3 py-2 text-sm font-medium text-[#5E5751] hover:bg-[var(--hb-surface-page)]"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      수정
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] leading-5 text-[#8E857C]">
          삭제 기능 대신 상태를 ‘취소됨’으로 바꿔 기록 자체를 남깁니다. 환불
          가능 참고액은 확정 환불액이나 법률상 권리를 뜻하지 않습니다.
        </p>
      </div>
    </section>
  );
}
