"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, RotateCcw, ShieldCheck, Users, X } from "lucide-react";
import { SHARED_PLAN_TOOLS } from "@hanbang/shared";
import {
  getAmoraActionApprovalPolicy,
  getAmoraPendingActionTtlMs,
} from "@/lib/ai/amoraActionApprovalPolicy";
import {
  parseBudgetImpactPreview,
  type BudgetImpactPreview,
  type BudgetImpactWarning,
} from "@hanbang/shared";
import { formatWon } from "@/lib/formatWon";
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

export function getPendingAmoraBudgetImpactPreview(
  message: ChatMessage,
  action: PendingAmoraAction,
): BudgetImpactPreview | null {
  const sourceRevision = message.metadata?.pending_amora_action_journey_revision;
  if (
    typeof sourceRevision !== "number"
    || !Number.isSafeInteger(sourceRevision)
    || sourceRevision < 0
  ) return null;
  return parseBudgetImpactPreview(
    message.metadata?.pending_amora_action_impact_preview,
    {
      tool: action.tool,
      inputDigest: action.inputDigest,
      sourceRevision,
    },
  );
}

/**
 * 서버가 찍은 만료 시각이 지났는지. **이 기기 시계를 믿을 수 있을 때만** 판정한다.
 *
 * 이 함수는 울타리가 아니라 화면 편의다. 진짜 만료는 서버가 막는다 —
 * `authorize_amora_shared_action_execution` 이 `AMORA_SHARED_ACTION_EXPIRED` 로 거절한다.
 * 그래서 시계를 못 믿는 동안 "만료됐다"고 단정할 이유가 없고, 단정하면 두 곳이 함께 죽는다.
 *
 *   1. 카드가 "안전을 위해 확인 시간이 지났어요. 아모라에게 다시 제안해 달라고 해주세요"를
 *      띄운다 — 방금 나온 제안인데 사용자에게 포기하고 다시 물으라고 말한다.
 *   2. 적용 핸들러(`ChatContent`·`ChatSidePanel`)가 아무 말 없이 `return` 한다 —
 *      버튼을 눌러도 아무 일도 일어나지 않는다.
 *
 * 예전 판정은 `action.issuedAt > nowMs`를 만료로 셌다. 그런데 그 조건이 참이라는 것은
 * 만료가 아니라 **이 기기 시계가 서버보다 느리다**는 뜻이다. 2026-08-22 운영 실측에서
 * 브라우저 시계가 서버보다 1.5초 느렸고, NTP가 어긋난 기기는 그보다 훨씬 크게 벌어진다.
 * 그런 기기의 사용자는 아모라가 제안한 어떤 변경도 확인할 수 없었다.
 *
 * 마운트 직후의 `nowMs === 0`(아직 시계를 읽기 전)도 같은 이유로 만료가 아니다.
 * 시계를 못 믿는 동안에는 버튼을 살려 두고, 정말 만료됐다면 서버가 거절한다.
 */
export function isPendingAmoraActionExpired(
  action: PendingAmoraAction,
  nowMs: number,
): boolean {
  if (!Number.isFinite(nowMs) || nowMs <= 0) return false;
  if (action.issuedAt > nowMs) return false;
  return nowMs >= action.expiresAt;
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
  impactPreview?: BudgetImpactPreview | null;
  messageId: string;
  disabledReason: PendingActionDisabledReason;
  isApplying: boolean;
  /**
   * 배우자가 합류했는가.
   *
   * 이 카드는 공유 계획을 바꿀 때 "상대에게 바뀐 내용이 알림으로 가요" 라고
   * 적는다. 혼자 쓰는 사람에게는 **없는 사람에 대한 약속**이다 — 베타에서
   * 처음 써 보는 사람은 대개 아직 혼자다.
   */
  partnerLinked?: boolean;
  onApply: (actionId: string) => void;
  onDismiss: () => void;
}

function formatSignedWon(value: number): string {
  if (value === 0) return "변동 없음";
  return `${value > 0 ? "+" : "-"}${formatWon(Math.abs(value))}`;
}

function formatPossiblyNegativeWon(value: number): string {
  return value < 0 ? `-${formatWon(Math.abs(value))}` : formatWon(value);
}

const BUDGET_WARNING_COPY: Record<BudgetImpactWarning, string> = {
  allocated_over_total: "변경 후 배분 합계가 총예산보다 커요.",
  recorded_spend_over_total: "기록 지출 합계가 변경 후 총예산보다 커요.",
  category_recorded_spend_over_budget:
    "일부 항목의 기록 지출이 해당 배정 예산보다 커요.",
};

function BudgetImpactDetails({ preview }: { preview: BudgetImpactPreview }) {
  // 총예산을 아직 안 정한 커플에게 "배분 후 남는 금액" 은 뜻이 없다.
  //
  // 신규 커플의 총예산은 0이라, 첫 항목 예산을 잡으면 이 줄이
  // "0원 → -2,200만원" 이 된다. 처음 저장해 보는 사람이 자기 첫 카드에서
  // 마이너스를 본다. 2026-08-25 적대적 검토.
  const totalBudgetIsSet =
    preview.current.totalBudget > 0 || preview.proposed.totalBudget > 0;
  const rows = [
    {
      label: "총예산",
      current: preview.current.totalBudget,
      proposed: preview.proposed.totalBudget,
      delta: preview.delta.totalBudget,
    },
    {
      label: "배분 합계",
      current: preview.current.allocatedBudget,
      proposed: preview.proposed.allocatedBudget,
      delta: preview.delta.allocatedBudget,
    },
    {
      label: "기록 지출",
      current: preview.current.recordedSpend,
      proposed: preview.proposed.recordedSpend,
      delta: preview.delta.recordedSpend,
    },
    ...(totalBudgetIsSet
      ? [{
          label: "배분 후 남는 금액",
          current: preview.current.unallocatedBudget,
          proposed: preview.proposed.unallocatedBudget,
          delta: preview.delta.unallocatedBudget,
        }]
      : []),
  ];

  return (
    <div className="mt-3 rounded-xl border border-[#E5D8CE] bg-white/80 p-3">
      <h4 className="text-xs font-semibold text-[#2B2525]">변경 영향</h4>
      {!totalBudgetIsSet && (
        <p className="mt-1 text-[11px] leading-4 text-[#746866]">
          총예산을 아직 정하지 않아 남는 금액은 계산하지 않았어요.
        </p>
      )}
      <dl className="mt-2 space-y-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[minmax(5.5rem,0.8fr)_minmax(0,1.7fr)] gap-2 text-xs leading-5"
          >
            <dt className="text-[#746866]">{row.label}</dt>
            <dd className="min-w-0 text-right font-medium text-[#3D3434]">
              {formatPossiblyNegativeWon(row.current)} → {formatPossiblyNegativeWon(row.proposed)}
              <span className="ml-1.5 whitespace-nowrap font-normal text-[#867976]">
                ({formatSignedWon(row.delta)})
              </span>
            </dd>
          </div>
        ))}
      </dl>

      {preview.categories.length > 0 && (
        <details className="mt-3 border-t border-[#EEE4DC] pt-2">
          <summary className="cursor-pointer text-xs font-medium text-[#2F5F51]">
            항목별 변경 {preview.categories.length}개 보기
          </summary>
          <ul className="mt-2 space-y-2">
            {preview.categories.map((category) => (
              <li key={category.key} className="rounded-lg bg-[#F8F4F0] px-2.5 py-2 text-xs leading-5 text-[#504444]">
                <p className="font-medium text-[#3D3434]">{category.label}</p>
                {category.currentBudget !== category.proposedBudget && (
                  <p>
                    배정 예산 {formatWon(category.currentBudget)} → {formatWon(category.proposedBudget)}
                  </p>
                )}
                {category.currentRecordedSpend !== category.proposedRecordedSpend && (
                  <p>
                    기록 지출 {formatWon(category.currentRecordedSpend)} → {formatWon(category.proposedRecordedSpend)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {preview.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg bg-[#FFF2EF] px-2.5 py-2 text-xs leading-5 text-[#8A3D31]">
          {preview.warnings.map((warning) => (
            <li key={warning}>• {BUDGET_WARNING_COPY[warning]}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] leading-4 text-[#746866]">
        기록 지출은 사용자가 명시적으로 입력한 금액이며, 결제 완료를 뜻하지 않아요.
      </p>
    </div>
  );
}

export default function PendingAmoraActionCard({
  action,
  impactPreview = null,
  messageId,
  disabledReason,
  isApplying,
  // 기본값은 false 다. 호출부가 빠뜨리면 **덜 약속하는** 쪽으로 틀린다 —
  // 없는 사람에게 알림이 간다고 말하는 것보다 낫다.
  partnerLinked = false,
  onApply,
  onDismiss,
}: PendingAmoraActionCardProps) {
  const approvalPolicy = getAmoraActionApprovalPolicy(action.tool, action.input);
  const requiresCoupleApproval = approvalPolicy === "couple";
  // 공유 계획을 건드리는 변경인가 — 상대에게 알림이 가는 것들이다.
  const notifiesPartner = SHARED_PLAN_TOOLS.has(action.tool) && partnerLinked;
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
  // 승인이 없어진 자리에 **알림**이 들어왔다(2026-08-23 파운더 결정). 그런데
  // 바꾸는 사람에게는 그 사실을 아무도 알려주지 않았다 — 혼자 총예산을 바꾸고,
  // 상대는 종 아이콘으로만 알게 되어 "상의 없이 바뀌었다" 로 읽힌다.
  //
  // 상대에게 알려야 하는 변경(공유 계획)일 때만 붙인다. 체크리스트 하나 체크할
  // 때마다 이 문장이 뜨면 아무도 안 읽는다.
  if (!approvalCopy && !requiresCoupleApproval && notifiesPartner) {
    approvalCopy = "확인하면 바로 반영되고, 상대에게 바뀐 내용이 알림으로 가요.";
  }
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

      {impactPreview && <BudgetImpactDetails preview={impactPreview} />}

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
        {/*
          보이는 글자와 접근성 이름을 같게 둔다. 예전에는 보이는 글자가 "이번 화면에서
          숨기기" 인데 이름은 "…에서**만** 숨기기" 라 이름이 보이는 글자를 담지 못했다
          (WCAG 2.5.3 Label in Name). 음성으로 보이는 대로 부르면 그 버튼이 안 잡힌다.

          문구는 모바일(`app/(tabs)/chat.tsx`)에 맞춘다. 같은 카드인데 웹은 "이번 화면에서
          숨기기", 모바일은 "지금은 적용하지 않기" 로 갈려 있었다. 모바일 쪽이 하는 일을
          더 정확히 말한다 — 이 버튼은 결정을 저장하지 않고 화면에서만 치우며, 다음
          답변에 같은 카드가 다시 붙는다(route.ts 의 캐리포워드).
        */}
        <button
          type="button"
          onClick={onDismiss}
          disabled={isApplying}
          aria-label="지금은 적용하지 않기"
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#D8C7BB] bg-white px-4 py-2.5 text-sm font-medium text-[#504444] transition-colors hover:bg-[#F8F4F0] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          지금은 적용하지 않기
        </button>
      </div>
    </section>
  );
}
