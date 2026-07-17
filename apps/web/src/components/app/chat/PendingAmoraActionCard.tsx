"use client";

import { Check, ShieldCheck, X } from "lucide-react";
import type {
  ChatMessage,
  PendingAmoraAction,
} from "@/types/database.types";

export type PendingActionDisabledReason = "busy" | "expired" | "not_latest" | null;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PENDING_ACTION_TTL_MS = 10 * 60 * 1_000;

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

/**
 * Treat assistant metadata as an untrusted persistence boundary. The UI never
 * infers a mutation from prose or renders the model-authored input payload.
 */
export function getPendingAmoraAction(message: ChatMessage): PendingAmoraAction | null {
  if (message.sender_role !== "ai" || message.visibility !== "shared") return null;
  const value = message.metadata?.pending_amora_action;
  if (!isPlainRecord(value)) return null;
  if (
    value.version !== 1
    || !isBoundedText(value.actionId, 36)
    || !UUID_PATTERN.test(value.actionId)
    || !isBoundedText(value.tool, 120)
    || !isPlainRecord(value.input)
    || !isBoundedText(value.confirmation, 2_000)
    || !validEpochMilliseconds(value.issuedAt)
    || !validEpochMilliseconds(value.expiresAt)
    || value.expiresAt - value.issuedAt !== PENDING_ACTION_TTL_MS
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
  disabledReason: PendingActionDisabledReason;
  isApplying: boolean;
  onApply: (actionId: string) => void;
  onDismiss: () => void;
}

export default function PendingAmoraActionCard({
  action,
  disabledReason,
  isApplying,
  onApply,
  onDismiss,
}: PendingAmoraActionCardProps) {
  const disabled = disabledReason !== null || isApplying;
  const titleId = `pending-amora-action-${action.actionId}-title`;
  const detailId = `pending-amora-action-${action.actionId}-detail`;
  const statusId = `pending-amora-action-${action.actionId}-status`;

  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={`${detailId}${disabledReason ? ` ${statusId}` : ""}`}
      className="ml-11 mt-2 max-w-[94%] rounded-2xl border border-[#D8C7BB] bg-[#FFFCF8] p-4 shadow-[0_6px_24px_rgba(82,57,45,0.07)] sm:ml-14 sm:max-w-[53.75rem]"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[#F2E8DE] text-[#795252]" aria-hidden="true">
          <ShieldCheck className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-sm font-semibold text-[#2B2525]">
            적용하기 전에 확인해 주세요
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

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => onApply(action.actionId)}
          disabled={disabled}
          aria-label="확인한 내용을 이대로 적용"
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[#2F5F51] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#274F44] disabled:cursor-not-allowed disabled:bg-[#B5ADA3] disabled:text-white"
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          {isApplying ? "적용 요청 중…" : "이대로 적용"}
        </button>
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
