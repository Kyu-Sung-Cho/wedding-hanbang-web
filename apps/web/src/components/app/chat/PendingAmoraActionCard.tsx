"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, RotateCcw, ShieldCheck, Users, X } from "lucide-react";
import {
  getAmoraActionApprovalPolicy,
  getAmoraPendingActionTtlMs,
} from "@/lib/ai/amoraActionApprovalPolicy";
import type {
  ChatMessage,
  PendingAmoraAction,
} from "@/types/database.types";

export type PendingActionDisabledReason = "busy" | "expired" | "not_latest" | null;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

type SharedActionApprovalStatus = {
  approvalMode: "couple";
  accepted: boolean;
  acceptedCount: number;
  requiredCount: 1 | 2;
  partnerLinked: boolean;
  ready: boolean;
};
type SharedActionApplicationClaim = {
  applicationGranted: boolean;
  retryAfterMs: number;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value === value.trim()
    && value.length > 0
    && value.length <= maxLength;
}

function validEpochMilliseconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseSharedActionApprovalStatus(value: unknown): SharedActionApprovalStatus | null {
  if (!isPlainRecord(value) || value.approvalMode !== "couple") return null;
  if (
    typeof value.accepted !== "boolean"
    || !Number.isInteger(value.acceptedCount)
    || (value.acceptedCount as number) < 0
    || (value.requiredCount !== 1 && value.requiredCount !== 2)
    || (value.acceptedCount as number) > value.requiredCount
    || typeof value.partnerLinked !== "boolean"
    || typeof value.ready !== "boolean"
  ) return null;
  return value as unknown as SharedActionApprovalStatus;
}

function parseSharedActionApplicationClaim(
  value: unknown,
): SharedActionApplicationClaim | null {
  if (
    !isPlainRecord(value)
    || typeof value.applicationGranted !== "boolean"
    || !Number.isInteger(value.retryAfterMs)
    || (value.retryAfterMs as number) < 0
    || (value.retryAfterMs as number) > 60_000
  ) return null;
  return value as unknown as SharedActionApplicationClaim;
}

/**
 * Treat assistant metadata as an untrusted persistence boundary. The UI never
 * infers a mutation from prose or renders the model-authored input payload.
 */
export function getPendingAmoraAction(message: ChatMessage): PendingAmoraAction | null {
  if (message.sender_role !== "ai" || message.visibility !== "shared") return null;
  const value = message.metadata?.pending_amora_action;
  if (!isPlainRecord(value)) return null;
  if (
    value.version !== 2
    || !isBoundedText(value.actionId, 36)
    || !UUID_PATTERN.test(value.actionId)
    || !isBoundedText(value.tool, 120)
    || !isPlainRecord(value.input)
    || typeof value.inputDigest !== "string"
    || !SHA256_HEX_PATTERN.test(value.inputDigest)
    || typeof value.operationKey !== "string"
    || !SHA256_HEX_PATTERN.test(value.operationKey)
    || !isBoundedText(value.confirmation, 2_000)
    || !validEpochMilliseconds(value.issuedAt)
    || !validEpochMilliseconds(value.expiresAt)
    || value.expiresAt - value.issuedAt
      !== getAmoraPendingActionTtlMs(value.tool, value.input)
  ) return null;

  return value as unknown as PendingAmoraAction;
}

export function isPendingAmoraActionExpired(
  action: PendingAmoraAction,
  nowMs: number,
): boolean {
  return !Number.isFinite(nowMs) || action.issuedAt > nowMs || nowMs >= action.expiresAt;
}

export function getPendingActionDisabledReason(
  action: PendingAmoraAction,
  nowMs: number,
  isLatest: boolean,
  busy: boolean,
): PendingActionDisabledReason {
  if (isPendingAmoraActionExpired(action, nowMs)) return "expired";
  if (!isLatest) return "not_latest";
  if (busy) return "busy";
  return null;
}

const DISABLED_COPY: Record<Exclude<PendingActionDisabledReason, null>, string> = {
  busy: "현재 답변이 끝나면 다시 확인할 수 있어요.",
  expired: "안전을 위해 확인 시간이 지났어요. 아모라에게 다시 제안해 달라고 해주세요.",
  not_latest: "새 대화가 이어져 이 제안은 적용할 수 없어요. 최신 내용으로 다시 확인해 주세요.",
};

interface PendingAmoraActionCardProps {
  action: PendingAmoraAction;
  messageId: string;
  disabledReason: PendingActionDisabledReason;
  isApplying: boolean;
  onApply: (actionId: string) => void;
  onDismiss: () => void;
}

export default function PendingAmoraActionCard({
  action,
  messageId,
  disabledReason,
  isApplying,
  onApply,
  onDismiss,
}: PendingAmoraActionCardProps) {
  const approvalPolicy = getAmoraActionApprovalPolicy(action.tool, action.input);
  const requiresCoupleApproval = approvalPolicy === "couple";
  const [approvalStatus, setApprovalStatus] =
    useState<SharedActionApprovalStatus | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [applicationNotice, setApplicationNotice] = useState<string | null>(
    null,
  );
  const [approvalMutation, setApprovalMutation] =
    useState<"confirm" | "withdraw" | null>(null);
  const isSavingApproval = approvalMutation !== null;
  const titleId = `pending-amora-action-${action.actionId}-title`;
  const detailId = `pending-amora-action-${action.actionId}-detail`;
  const statusId = `pending-amora-action-${action.actionId}-status`;
  const approvalStatusId = `pending-amora-action-${action.actionId}-approval`;

  const sharedActionUrl =
    `/api/amora/shared-actions/${encodeURIComponent(action.actionId)}`;

  const loadApprovalStatus = useCallback(async (signal?: AbortSignal) => {
    if (!requiresCoupleApproval || disabledReason !== null) return;
    try {
      const response = await fetch(
        `${sharedActionUrl}?messageId=${encodeURIComponent(messageId)}`,
        {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          signal,
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      const parsed = response.ok ? parseSharedActionApprovalStatus(payload) : null;
      if (!parsed) {
        const message = isPlainRecord(payload) && typeof payload.error === "string"
          ? payload.error
          : "공동 확인 상태를 불러오지 못했어요.";
        throw new Error(message);
      }
      setApprovalStatus(parsed);
      setApprovalError(null);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setApprovalError(
        error instanceof Error
          ? error.message
          : "공동 확인 상태를 불러오지 못했어요.",
      );
    }
  }, [disabledReason, messageId, requiresCoupleApproval, sharedActionUrl]);

  useEffect(() => {
    if (!requiresCoupleApproval || disabledReason !== null) return;
    const controller = new AbortController();
    void loadApprovalStatus(controller.signal);

    const refresh = () => {
      if (document.visibilityState === "visible") void loadApprovalStatus();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadApprovalStatus();
    }, 5_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [
    disabledReason,
    loadApprovalStatus,
    requiresCoupleApproval,
  ]);

  const confirmOrApply = async () => {
    if (isSavingApproval) return;
    setApprovalMutation("confirm");
    setApprovalError(null);
    setApplicationNotice(null);
    try {
      if (requiresCoupleApproval) {
        const response = await fetch(sharedActionUrl, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId }),
        });
        const payload: unknown = await response.json().catch(() => null);
        const parsed = response.ok
          ? parseSharedActionApprovalStatus(payload)
          : null;
        if (!parsed) {
          throw new Error(
            isPlainRecord(payload) && typeof payload.error === "string"
              ? payload.error
              : "내 확인을 안전하게 저장하지 못했어요.",
          );
        }
        setApprovalStatus(parsed);
        if (!parsed.ready) return;
      }

      const claimResponse = await fetch(sharedActionUrl, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      const claimPayload: unknown = await claimResponse.json().catch(
        () => null,
      );
      const claim = claimResponse.ok
        ? parseSharedActionApplicationClaim(claimPayload)
        : null;
      if (!claim) {
        throw new Error(
          isPlainRecord(claimPayload)
          && typeof claimPayload.error === "string"
            ? claimPayload.error
            : "변경 적용 순서를 안전하게 확인하지 못했어요.",
        );
      }
      if (!claim.applicationGranted) {
        const retrySeconds = Math.max(
          1,
          Math.ceil(claim.retryAfterMs / 1_000),
        );
        setApplicationNotice(
          `다른 화면에서 반영을 시작했어요. ${retrySeconds}초 뒤에도 반영되지 않으면 다시 눌러 주세요.`,
        );
        return;
      }
      onApply(action.actionId);
    } catch (error) {
      setApprovalError(
        error instanceof Error
          ? error.message
          : "내 확인을 안전하게 저장하지 못했어요.",
      );
    } finally {
      setApprovalMutation(null);
    }
  };

  const withdrawApproval = async () => {
    if (
      !requiresCoupleApproval
      || approvalStatus?.requiredCount !== 2
      || !approvalStatus.accepted
      || isSavingApproval
    ) return;
    setApprovalMutation("withdraw");
    setApprovalError(null);
    setApplicationNotice(null);
    try {
      const response = await fetch(sharedActionUrl, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const parsed = response.ok ? parseSharedActionApprovalStatus(payload) : null;
      if (!parsed) {
        throw new Error(
          isPlainRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "내 확인을 안전하게 취소하지 못했어요.",
        );
      }
      setApprovalStatus(parsed);
    } catch (error) {
      setApprovalError(
        error instanceof Error
          ? error.message
          : "내 확인을 안전하게 취소하지 못했어요.",
      );
    } finally {
      setApprovalMutation(null);
    }
  };

  const waitingForPartner = Boolean(
    requiresCoupleApproval
    && approvalStatus?.accepted
    && !approvalStatus.ready
    && approvalStatus.requiredCount === 2,
  );
  const loadingApproval = requiresCoupleApproval
    && approvalStatus === null
    && approvalError === null;
  const disabled =
    disabledReason !== null
    || isApplying
    || isSavingApproval
    || loadingApproval
    || waitingForPartner
    || approvalPolicy === "blocked";
  const canWithdrawApproval = Boolean(
    requiresCoupleApproval
    && disabledReason === null
    && !isApplying
    && approvalStatus?.requiredCount === 2
    && approvalStatus.accepted,
  );

  let approvalCopy: string | null = approvalError ?? applicationNotice;
  if (!approvalCopy && requiresCoupleApproval) {
    if (approvalError) {
      approvalCopy = approvalError;
    } else if (!approvalStatus) {
      approvalCopy = "누가 확인했는지 안전하게 불러오는 중이에요.";
    } else if (approvalStatus.requiredCount === 1) {
      approvalCopy = approvalStatus.ready
        ? "내 확인 완료 · 파트너 연결 전이라 바로 반영할 수 있어요."
        : "파트너 연결 전이라 내 확인으로 반영돼요.";
    } else if (approvalStatus.ready) {
      approvalCopy =
        "두 분 확인 완료 · 반영하기를 누르면 바로 적용 요청이 시작돼요.";
    } else if (approvalStatus.accepted) {
      approvalCopy =
        `내 확인 ${approvalStatus.acceptedCount}/${approvalStatus.requiredCount} · 아직 반영되지 않았어요. 적용 요청 전까지 취소할 수 있어요.`;
    } else if (approvalStatus.acceptedCount > 0) {
      approvalCopy =
        `상대방 확인 ${approvalStatus.acceptedCount}/${approvalStatus.requiredCount} · 내 확인을 누르면 바로 반영을 시작해요.`;
    } else {
      approvalCopy = "두 분이 각각 확인해야 반영돼요 · 현재 0/2";
    }
  }

  const applyLabel = isApplying
    ? "적용 요청 중…"
    : approvalMutation === "confirm"
      ? "내 확인 저장 중…"
      : approvalMutation === "withdraw"
        ? "내 확인 취소 중…"
      : loadingApproval
        ? "확인 상태 불러오는 중…"
        : waitingForPartner
          ? "상대방 확인 기다리는 중"
          : approvalStatus?.ready
             ? "두 분 확인 완료 · 반영하기"
             : requiresCoupleApproval
               ? approvalStatus?.requiredCount === 1
                 ? "확인하고 반영"
                 : approvalStatus
                   && !approvalStatus.accepted
                   && approvalStatus.acceptedCount > 0
                   ? "확인하고 바로 반영"
                 : "내 확인 남기기"
               : "이대로 적용";
  const applyAriaLabel = requiresCoupleApproval
    && approvalStatus
    && (
      approvalStatus.requiredCount === 1
      || approvalStatus.ready
      || (!approvalStatus.accepted && approvalStatus.acceptedCount > 0)
    )
    ? "이 공동 변경을 확인하고 바로 반영"
    : requiresCoupleApproval
      ? "이 공동 변경을 확인"
      : "확인한 내용을 이대로 적용";

  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={`${detailId}${disabledReason ? ` ${statusId}` : ""}${
        approvalCopy ? ` ${approvalStatusId}` : ""
      }`}
      className="ml-11 mt-2 max-w-[94%] rounded-2xl border border-[#D8C7BB] bg-[#FFFCF8] p-4 shadow-[0_6px_24px_rgba(82,57,45,0.07)] sm:ml-14 sm:max-w-[53.75rem]"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[#F2E8DE] text-[#795252]" aria-hidden="true">
          <ShieldCheck className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-sm font-semibold text-[#2B2525]">
            {requiresCoupleApproval
              ? "두 분 확인이 필요한 변경이에요"
              : "적용하기 전에 확인해 주세요"}
          </h3>
          <p id={detailId} className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[#504444]">
            {action.confirmation}
          </p>
        </div>
      </div>

      {disabledReason && (
        <p id={statusId} role="status" className="mt-3 text-xs leading-5 text-[#795252]">
          {DISABLED_COPY[disabledReason]}
        </p>
      )}

      {approvalCopy && (
        <div
          id={approvalStatusId}
          role="status"
          className={`mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs leading-5 ${
            approvalError
              ? "bg-[#FFF2EF] text-[#8A3D31]"
              : "bg-[#F2F7F4] text-[#2F5F51]"
          }`}
        >
          <Users className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
          <span>{approvalCopy}</span>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => void confirmOrApply()}
          disabled={disabled}
          aria-label={applyAriaLabel}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[#2F5F51] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#274F44] disabled:cursor-not-allowed disabled:bg-[#B5ADA3] disabled:text-white"
        >
          {approvalMutation === "confirm" || loadingApproval ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="h-4 w-4" aria-hidden="true" />
          )}
          {applyLabel}
        </button>
        {canWithdrawApproval && (
          <button
            type="button"
            onClick={() => void withdrawApproval()}
            disabled={isSavingApproval}
            aria-label="내 공동 변경 확인 취소"
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#D8C7BB] bg-white px-4 py-2.5 text-sm font-medium text-[#795252] transition-colors hover:bg-[#F8F4F0] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {approvalMutation === "withdraw" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            )}
            {approvalMutation === "withdraw" ? "취소 중…" : "내 확인 취소"}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          disabled={isApplying}
          aria-label="이 제안을 이번 화면에서만 숨기기"
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#D8C7BB] bg-white px-4 py-2.5 text-sm font-medium text-[#504444] transition-colors hover:bg-[#F8F4F0] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          이번 화면에서 숨기기
        </button>
      </div>
    </section>
  );
}
