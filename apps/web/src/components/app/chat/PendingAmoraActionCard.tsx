"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, RotateCcw, ShieldCheck, Users, X } from "lucide-react";
import { AMORA_SHARED_PLAN_PARTNER_NOTICE, SHARED_PLAN_TOOLS } from "@hanbang/shared";
import {
  getAmoraActionApprovalPolicy,
  getAmoraPendingActionTtlMs,
} from "@/lib/ai/amoraActionApprovalPolicy";
import {
  parseBudgetImpactPreview,
  type BudgetImpactPreview,
  type BudgetImpactWarning,
} from "@hanbang/shared";
import { todayYmdInKst } from "@hanbang/shared/utils";
import { formatWon } from "@/lib/formatWon";
import AmoraSaveSheet from "./AmoraSaveSheet";
import type {
  ChatMessage,
  PendingAmoraAction,
} from "@/types/database.types";

export type PendingActionDisabledReason =
  | "busy"
  | "expired"
  | "not_latest"
  | "applied"
  | null;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const SCHEDULE_DATE_TOOLS = new Set(["add_schedule_event", "update_schedule_event"]);
const SCHEDULE_YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 이 카드가 지난 날짜를 저장하려 하는가 (2026-09-03).
 *
 * 연도를 말하지 않은 날짜가 지난 해로 해석돼 저장되거나, 사용자가 지난 날짜를 그대로
 * 말해도 카드가 아무 말도 하지 않아 "지난 일정"이 조용히 들어갔다. 지난 일을 기록하려는
 * 요청도 정당하므로 **버튼을 막지 않는다** — 한 줄만 덧붙여 연도를 다시 보게 한다.
 *
 * 오늘은 `todayYmdInKst` 로만 정한다. UTC 로 자르면 한국 새벽 0~9시에 오늘이 어제가
 * 되어, KST 자정 직후에 잡는 "오늘" 일정이 지난 날짜로 잡힌다.
 *
 * 같은 판정이 앱에도 있다(`apps/mobile/src/lib/pendingAmoraAction.ts`). 한쪽만 고치면
 * 두 화면이 같은 카드에 다른 말을 한다 — 두 구현을 같이 재는 검사가 붙어 있다.
 */
export function isPendingActionPastDated(
  action: { tool: string; input: Record<string, unknown> },
  nowMs: number,
): boolean {
  if (!SCHEDULE_DATE_TOOLS.has(action.tool)) return false;
  if (!Number.isFinite(nowMs) || nowMs <= 0) return false;
  const date = action.input.date;
  if (typeof date !== "string" || !SCHEDULE_YMD_PATTERN.test(date)) return false;
  return date < todayYmdInKst(nowMs);
}

export const PAST_SCHEDULE_DATE_NOTICE =
  "지난 날짜예요 · 연도가 맞는지 확인해 주세요. 이대로 적용하면 지난 일정으로 저장돼요.";

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

/**
 * **이월된 카드에 붙는 머리 라벨** (2026-09-04).
 *
 * 확인하지 않은 카드는 다음 답변으로 따라간다(`route.ts` 의 캐리포워드). 그래서
 * "9월 10일 일정을 등록할까요?" 라는 **새 문장 아래에 직전 턴의 다른 카드**가
 * 붙어 있을 수 있다 — 사용자는 방금 읽은 문장이 곧 이 버튼이라고 읽고 누른다.
 *
 * 라벨은 그 오해를 끊는다. 이월 자체는 그대로 둔다(파운더 결정) — 무엇이
 * 바뀌는지를 눈에 먼저 두고, 이것이 **이 턴의 문장이 아니라는 것**만 말한다.
 *
 * 같은 문구를 앱도 쓴다(`apps/mobile/src/lib/pendingAmoraAction.ts`).
 */
export const CARRIED_PENDING_ACTION_LABEL = "이전 제안 · 아직 확인하지 않았어요";

/**
 * 이 카드가 원본 턴 이후 몇 번 옮겨졌는가. 없으면 0(이 답변에서 처음 나온 카드).
 *
 * **서버가 찍은 값으로만 정한다.** 화면이 "직전 턴에도 같은 actionId 가 있었나"
 * 로 추측하면, 화면에 없는 행(정리·필터로 걸러진 행) 때문에 같은 카드가 기기마다
 * 다르게 보인다. 값이 없거나 형태가 다르면 **이월이 아닌 쪽**으로 틀린다.
 */
export function getPendingAmoraActionCarryCount(message: ChatMessage): number {
  if (message.sender_role !== "ai" || message.visibility !== "shared") return 0;
  // metadata 는 신뢰 경계다. 계약 타입을 넓히는 대신 읽는 쪽에서 검증한다.
  const value = (message.metadata as
    | { pending_amora_action_carry_count?: unknown }
    | null
    | undefined)?.pending_amora_action_carry_count;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return 0;
  return value;
}

/**
 * **최신 답변으로 옮겨진 뒤 원래 자리에 남은 카드의 안내** (2026-09-15).
 *
 * 확인하지 않은 카드는 다음 답변으로 같은 `actionId` 그대로 옮겨진다(`route.ts` 의
 * 캐리포워드). 사용자가 버튼 대신 "응 적용해줘" 라고 치면 아모라는 "아래 카드에서
 * 확인해 주세요" 라고 답하는데, 원래 자리의 카드에는 "새 대화가 이어져 이 제안은 적용할
 * 수 없어요" 가 떠 있었다 — 같은 제안이 한쪽에서는 된다고, 다른 쪽에서는 안 된다고 했다.
 *
 * 옮겨진 것이 확인될 때만 이 문장을 쓰고 버튼을 거둔다. 누를 곳은 한 군데여야 한다.
 */
export const CONTINUED_PENDING_ACTION_COPY =
  "같은 제안이 아래 최신 답변으로 옮겨졌어요. 그 카드에서 확인할 수 있어요.";

/**
 * 최신 공유 메시지가 **이 카드와 같은 제안**을 들고 있는가.
 *
 * 서버가 옮긴 카드는 `actionId`·`inputDigest` 가 원본과 같다. 둘 다 같을 때만 참이다 —
 * 다르면 옮겨진 것이 아니라 다른 제안이므로, 원래의 "적용할 수 없어요" 가 맞다.
 * 메시지 경계는 `getPendingAmoraAction` 이 그대로 검증한다(공유 AI 메시지만).
 */
export function isPendingAmoraActionContinuedInMessage(
  latestSharedMessage: ChatMessage | null | undefined,
  action: PendingAmoraAction,
): boolean {
  if (!latestSharedMessage) return false;
  const latestAction = getPendingAmoraAction(latestSharedMessage);
  return latestAction !== null
    && latestAction.actionId === action.actionId
    && latestAction.inputDigest === action.inputDigest;
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
  /**
   * 이 카드가 이미 적용됐는가. 서버가 사용자 확인 행에 남긴
   * `confirmed_amora_action_id` 로 판정한다.
   *
   * **이것이 다른 어떤 이유보다 먼저다.** 카드를 누르면 새 메시지가 생기고, 그
   * 순간 이 카드는 `not_latest` 가 된다 — 방금 성공시킨 카드에 "새 대화가 이어져
   * 이 제안은 적용할 수 없어요" 가 붙는다(2026-08-31 운영에서 재현). 사용자는
   * 성공 문장과 실패 문장을 나란히 보고 실패했다고 읽는다.
   *
   * 시간이 지나 만료돼도 마찬가지다. 이미 적용된 것은 만료될 것이 없다.
   */
  applied = false,
): PendingActionDisabledReason {
  if (applied) return "applied";
  if (isPendingAmoraActionExpired(action, nowMs)) return "expired";
  if (!isLatest) return "not_latest";
  if (busy) return "busy";
  return null;
}

const DISABLED_COPY: Record<Exclude<PendingActionDisabledReason, null>, string> = {
  busy: "현재 답변이 끝나면 다시 확인할 수 있어요.",
  expired: "안전을 위해 확인 시간이 지났어요. 아모라에게 다시 제안해 달라고 해주세요.",
  not_latest: "새 대화가 이어져 이 제안은 적용할 수 없어요. 최신 내용으로 다시 확인해 주세요.",
  applied: "이 제안은 적용됐어요.",
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
  /**
   * 이 카드가 원본 턴 이후 몇 번 옮겨졌는가(`getPendingAmoraActionCarryCount`).
   * 1 이상이면 **이 답변에서 처음 나온 카드가 아니다** — 라벨과 모양으로 가른다.
   * 기본값 0 은 안전한 쪽이 아니라 **오늘까지의 모양**이다.
   */
  carryCount?: number;
  /**
   * 최신 공유 메시지가 이 카드와 같은 제안을 들고 있는가
   * (`isPendingAmoraActionContinuedInMessage`). `not_latest` 일 때만 쓰인다 —
   * 그때 "적용할 수 없어요" 대신 옮겨진 카드를 가리키고 버튼을 거둔다.
   * 기본값 false 는 오늘까지의 모양이다.
   */
  continuesInLatestReply?: boolean;
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
    <div className="mt-3 rounded-[6px] border border-[#E5D8CE] bg-white/80 p-3">
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
              <span className="ml-1.5 whitespace-nowrap font-normal text-[var(--hb-text-muted)]">
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
              <li key={category.key} className="rounded-[6px] bg-[#F8F4F0] px-2.5 py-2 text-xs leading-5 text-[var(--hb-text-body)]">
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
        <ul className="mt-3 space-y-1 rounded-[6px] bg-[#FFF2EF] px-2.5 py-2 text-xs leading-5 text-[#8A3D31]">
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
  carryCount = 0,
  continuesInLatestReply = false,
  onApply,
  onDismiss,
}: PendingAmoraActionCardProps) {
  const [reviewedActionKey, setReviewedActionKey] = useState<string | null>(null);
  const actionKey = `${messageId}:${action.actionId}:${action.inputDigest}`;
  // 같은 제안이 최신 답변으로 옮겨졌는가. 적용됨·만료는 옮겨졌어도 그 말이 먼저다.
  const movedToLatestReply = continuesInLatestReply && disabledReason === "not_latest";
  const statusCopy = movedToLatestReply
    ? CONTINUED_PENDING_ACTION_COPY
    : disabledReason
      ? DISABLED_COPY[disabledReason]
      : null;
  const reviewOpen = reviewedActionKey === actionKey
    && disabledReason !== "applied"
    && !movedToLatestReply;
  const mutationInFlight = useRef(false);
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
  // 이 카드는 만료 판정과 달리 부모에게서 시계를 받지 않는다. 서버 렌더에서 읽으면
  // 하이드레이션이 어긋나므로, 시계를 읽기 전(0)에는 아무 말도 하지 않는다.
  const [clockMs, setClockMs] = useState(0);
  useEffect(() => {
    setClockMs(Date.now());
  }, []);
  const showsPastDateNotice = isPendingActionPastDated(action, clockMs);
  const isSavingApproval = approvalMutation !== null;
  const titleId = `pending-amora-action-${action.actionId}-title`;
  const detailId = `pending-amora-action-${action.actionId}-detail`;
  const statusId = `pending-amora-action-${action.actionId}-status`;
  const pastDateId = `pending-amora-action-${action.actionId}-past-date`;
  const approvalStatusId = `pending-amora-action-${action.actionId}-approval`;
  // 이월된 카드인가. 서버 metadata 값만 본다 — 화면은 추측하지 않는다.
  const isCarriedForward = Number.isSafeInteger(carryCount) && carryCount >= 1;
  // 이월이면 접근성 이름을 라벨부터 읽게 한다 — 화면을 못 보는 사용자도
  // "지금 문장의 카드가 아니다" 를 버튼보다 먼저 듣는다.
  const carryLabelId = `pending-amora-action-${action.actionId}-carry`;
  const purposeCopy = requiresCoupleApproval
    ? "두 분 확인이 필요한 변경이에요"
    : "적용하기 전에 확인해 주세요";

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
    if (disabled || !reviewOpen || mutationInFlight.current) return;
    mutationInFlight.current = true;
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
      // 적용 결과는 기존 채팅 흐름이 알린다. 리스 획득을 저장 성공으로 말하지 않는다.
      setReviewedActionKey(null);
    } catch (error) {
      setApprovalError(
        error instanceof Error
          ? error.message
          : "내 확인을 안전하게 저장하지 못했어요.",
      );
    } finally {
      mutationInFlight.current = false;
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
  // 문장은 앱 확인 시트와 같은 것을 쓴다(`@hanbang/shared`, 2026-09-18).
  if (!approvalCopy && !requiresCoupleApproval && notifiesPartner) {
    approvalCopy = AMORA_SHARED_PLAN_PARTNER_NOTICE;
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
    <>
    <section
      data-pending-action-carried={isCarriedForward ? "true" : "false"}
      data-pending-action-continued={movedToLatestReply ? "true" : undefined}
      aria-labelledby={isCarriedForward ? `${carryLabelId} ${titleId}` : titleId}
      aria-describedby={`${detailId}${
        showsPastDateNotice ? ` ${pastDateId}` : ""
      }${statusCopy ? ` ${statusId}` : ""}${
        approvalCopy ? ` ${approvalStatusId}` : ""
      }`}
      className={`amora-workspace ml-11 mt-2 max-w-[94%] rounded-[14px] p-4 shadow-[var(--shadow-raised)] sm:ml-14 sm:max-w-[53.75rem] ${
        isCarriedForward
          ? "border border-dashed border-[#B99A7E] bg-[#FBF5EE]"
          : "border border-[var(--amora-line)] bg-[var(--amora-surface)]"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[#F2E8DE] text-[var(--hb-accent-hover)]" aria-hidden="true">
          <ShieldCheck className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          {/*
            이월된 카드는 **무엇을 바꾸는지가 먼저**다(2026-09-04). 이 자리의 제목은
            원래 "적용하기 전에 확인해 주세요" 라는 일반 문장이었는데, 새 답변 문장
            바로 아래에 그 문장이 붙으면 사용자는 방금 읽은 내용을 확인하는 것으로
            읽는다. 그래서 이월일 때만 서버가 발급한 확인문(canonical)을 제목 자리에
            그대로 올리고, 일반 문장은 아래 줄로 내린다. 확인 버튼 문구는 그대로다.
          */}
          {isCarriedForward && (
            <p
              id={carryLabelId}
              className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-[#B99A7E] bg-[#F2E8DE] px-2.5 py-1 text-xs font-semibold text-[#795252]"
            >
              <RotateCcw className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
              {CARRIED_PENDING_ACTION_LABEL}
            </p>
          )}
          <h3
            id={titleId}
            className={`text-sm font-semibold text-[#2B2525]${
              isCarriedForward ? " whitespace-pre-wrap break-words leading-6" : ""
            }`}
          >
            {isCarriedForward ? action.confirmation : purposeCopy}
          </h3>
          <p
            id={detailId}
            className={
              isCarriedForward
                ? "mt-1 text-xs leading-5 text-[var(--hb-text-muted)]"
                : "mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--hb-text-body)]"
            }
          >
            {isCarriedForward ? purposeCopy : action.confirmation}
          </p>
        </div>
      </div>

      {impactPreview && <BudgetImpactDetails preview={impactPreview} />}

      {showsPastDateNotice && (
        <p
          id={pastDateId}
          role="status"
          className="mt-3 rounded-[6px] bg-[#FFF2EF] px-3 py-2.5 text-xs leading-5 text-[#8A3D31]"
        >
          {PAST_SCHEDULE_DATE_NOTICE}
        </p>
      )}

      {statusCopy && (
        <p id={statusId} role="status" className="mt-3 text-xs leading-5 text-[var(--hb-accent-hover)]">
          {statusCopy}
        </p>
      )}

      {approvalCopy && (
        <div
          id={approvalStatusId}
          role="status"
          className={`mt-3 flex items-start gap-2 rounded-[6px] px-3 py-2.5 text-xs leading-5 ${
            approvalError
              ? "bg-[#FFF2EF] text-[#8A3D31]"
              : "bg-[#F2F7F4] text-[#2F5F51]"
          }`}
        >
          <Users className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
          <span>{approvalCopy}</span>
        </div>
      )}

      {/*
        옮겨진 카드에는 버튼을 두지 않는다. 누를 곳은 최신 답변의 카드 한 군데다 —
        여기서 "지금은 적용하지 않기" 를 누르면 아래 카드까지 함께 치워져, 방금 아모라가
        가리킨 버튼이 사라진다.
      */}
      {!movedToLatestReply && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => setReviewedActionKey(actionKey)}
            disabled={disabled}
            aria-label="변경 내용 확인하기"
            aria-haspopup="dialog"
            aria-expanded={reviewOpen}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[var(--amora-action)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--amora-action-hover)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {approvalMutation === "confirm" || loadingApproval ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="h-4 w-4" aria-hidden="true" />
            )}
            {isApplying || isSavingApproval || loadingApproval || waitingForPartner ? applyLabel : "내용 확인하기"}
          </button>
          {canWithdrawApproval && (
            <button
              type="button"
              onClick={() => void withdrawApproval()}
              disabled={isSavingApproval}
              aria-label="내 공동 변경 확인 취소"
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[6px] border border-[#D8C7BB] bg-white px-4 py-2.5 text-sm font-medium text-[var(--hb-accent-hover)] transition-colors hover:bg-[#F8F4F0] disabled:cursor-not-allowed disabled:opacity-50"
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
            disabled={disabledReason === "applied" || isApplying || isSavingApproval}
            aria-label="지금은 적용하지 않기"
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[6px] border border-[#D8C7BB] bg-white px-4 py-2.5 text-sm font-medium text-[var(--hb-text-body)] transition-colors hover:bg-[#F8F4F0] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            지금은 적용하지 않기
          </button>
        </div>
      )}
    </section>
    {reviewOpen && (
      <AmoraSaveSheet
        confirmation={action.confirmation}
        tool={action.tool}
        inputDigest={action.inputDigest}
        impactPreview={impactPreview}
        carriedLabel={isCarriedForward ? CARRIED_PENDING_ACTION_LABEL : undefined}
        disabled={disabled}
        busy={isApplying || isSavingApproval}
        applyLabel={applyLabel}
        applyAriaLabel={applyAriaLabel}
        error={approvalError}
        notice={statusCopy ?? approvalCopy}
        onConfirm={() => void confirmOrApply()}
        onClose={() => {
          if (!mutationInFlight.current && !isApplying) setReviewedActionKey(null);
        }}
        onDefer={() => {
          if (mutationInFlight.current || isApplying) return;
          setReviewedActionKey(null);
          onDismiss();
        }}
      >
        {impactPreview && <div className="mb-4"><BudgetImpactDetails preview={impactPreview} /></div>}
        {showsPastDateNotice && (
          <p role="status" className="mb-4 rounded-xl bg-[#FFF2EF] px-3.5 py-3 text-xs leading-5 text-[#8A3D31]">
            {PAST_SCHEDULE_DATE_NOTICE}
          </p>
        )}
      </AmoraSaveSheet>
    )}
    </>
  );
}
