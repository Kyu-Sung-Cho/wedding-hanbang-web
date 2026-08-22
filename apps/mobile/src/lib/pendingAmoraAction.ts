import {
  getAmoraPendingActionTtlMs,
  parseBudgetImpactPreview,
  type BudgetImpactPreview,
} from "@hanbang/shared";

export {
  COUPLE_APPROVAL_PENDING_ACTION_TTL_MS,
  getAmoraActionApprovalPolicy,
  getAmoraPendingActionTtlMs,
  SINGLE_APPROVAL_PENDING_ACTION_TTL_MS,
} from "@hanbang/shared";

export type { AmoraActionApprovalPolicy } from "@hanbang/shared";

export interface PendingAmoraAction {
  version: 2;
  actionId: string;
  tool: string;
  input: Record<string, unknown>;
  inputDigest: string;
  operationKey: string;
  confirmation: string;
  issuedAt: number;
  expiresAt: number;
}

export type PendingActionDisabledReason = "busy" | "expired" | "not_latest" | null;
interface PendingActionMessageBoundary {
  sender_type?: unknown;
  visibility?: unknown;
  metadata?: unknown;
}

export interface SharedActionApprovalStatus {
  approvalMode: "couple";
  accepted: boolean;
  acceptedCount: number;
  requiredCount: 1 | 2;
  partnerLinked: boolean;
  ready: boolean;
}

export interface SharedActionApplicationClaim {
  applicationGranted: boolean;
  retryAfterMs: number;
}

export interface SharedActionApprovalPresentation {
  copy: string;
  applyLabel: string;
  waitingForPartner: boolean;
  canWithdraw: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
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

export function parseSharedActionApprovalStatus(
  value: unknown,
): SharedActionApprovalStatus | null {
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
  const acceptedCount = value.acceptedCount as number;
  const requiredCount = value.requiredCount;
  if (
    value.partnerLinked !== (requiredCount === 2)
    || value.ready !== (acceptedCount === requiredCount)
    || (value.accepted && acceptedCount === 0)
    || (!value.accepted && acceptedCount === requiredCount)
  ) return null;
  return value as unknown as SharedActionApprovalStatus;
}

export function parseSharedActionApplicationClaim(
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

export function getSharedActionApprovalPresentation(
  status: SharedActionApprovalStatus | null,
): SharedActionApprovalPresentation {
  if (!status) {
    return {
      copy: "누가 확인했는지 안전하게 불러오는 중이에요.",
      applyLabel: "확인 상태 불러오는 중…",
      waitingForPartner: false,
      canWithdraw: false,
    };
  }
  if (status.requiredCount === 1) {
    return {
      copy: status.ready
        ? "내 확인 완료 · 파트너 연결 전이라 바로 반영할 수 있어요."
        : "파트너 연결 전이라 내 확인으로 반영돼요.",
      applyLabel: status.ready ? "확인 완료 · 반영하기" : "확인하고 반영",
      waitingForPartner: false,
      canWithdraw: false,
    };
  }
  if (status.ready) {
    return {
      copy: "두 분 확인 완료 · 반영하기를 누르면 바로 적용 요청이 시작돼요.",
      applyLabel: "두 분 확인 완료 · 반영하기",
      waitingForPartner: false,
      canWithdraw: status.accepted,
    };
  }
  if (status.accepted) {
    return {
      copy: `내 확인 ${status.acceptedCount}/${status.requiredCount} · 아직 반영되지 않았어요. 적용 요청 전까지 취소할 수 있어요.`,
      applyLabel: "상대방 확인 기다리는 중",
      waitingForPartner: true,
      canWithdraw: true,
    };
  }
  if (status.acceptedCount > 0) {
    return {
      copy: `상대방 확인 ${status.acceptedCount}/${status.requiredCount} · 내 확인을 누르면 바로 반영을 시작해요.`,
      applyLabel: "확인하고 바로 반영",
      waitingForPartner: false,
      canWithdraw: false,
    };
  }
  return {
    copy: "두 분이 각각 확인해야 반영돼요 · 현재 0/2",
    applyLabel: "내 확인 남기기",
    waitingForPartner: false,
    canWithdraw: false,
  };
}

/** Fails closed at the persisted-message boundary; visible prose is never authority. */
export function getPendingAmoraAction(
  message: PendingActionMessageBoundary,
): PendingAmoraAction | null {
  if (message.sender_type !== "ai" || message.visibility !== "shared") return null;
  if (!isPlainRecord(message.metadata)) return null;
  const value = message.metadata.pending_amora_action;
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
  message: PendingActionMessageBoundary,
  action: PendingAmoraAction,
): BudgetImpactPreview | null {
  if (message.sender_type !== "ai" || message.visibility !== "shared") return null;
  if (!isPlainRecord(message.metadata)) return null;
  const persistedAction = getPendingAmoraAction(message);
  if (
    !persistedAction
    || persistedAction.actionId !== action.actionId
    || persistedAction.tool !== action.tool
    || persistedAction.inputDigest !== action.inputDigest
    || persistedAction.operationKey !== action.operationKey
  ) return null;
  const sourceRevision = message.metadata.pending_amora_action_journey_revision;
  if (
    typeof sourceRevision !== "number"
    || !Number.isSafeInteger(sourceRevision)
    || sourceRevision < 0
  ) return null;
  return parseBudgetImpactPreview(
    message.metadata.pending_amora_action_impact_preview,
    {
      tool: persistedAction.tool,
      inputDigest: persistedAction.inputDigest,
      sourceRevision,
    },
  );
}

/**
 * 서버가 찍은 만료 시각이 지났는지. **이 기기 시계를 믿을 수 있을 때만** 판정한다.
 *
 * 진짜 만료는 서버가 막는다 — `authorize_amora_shared_action_execution` 이
 * `AMORA_SHARED_ACTION_EXPIRED` 로 거절한다. 여기 판정은 울타리가 아니라 버튼을
 * 보여줄지 정하는 화면 편의다. 그래서 시계를 못 믿는 동안 만료라고 단정하지 않는다.
 *
 * `action.issuedAt > nowMs` 가 참이라는 것은 만료가 아니라 **이 기기 시계가 서버보다
 * 느리다**는 뜻이다. 그렇게 단정하면 방금 받은 제안에 "확인 시간이 지났어요" 가 뜨고
 * (chat.tsx:3399·3528) 적용 경로가 조용히 막혀 버튼이 죽는다. 휴대폰은 시계가 어긋나
 * 있는 일이 흔하고, 그 사람은 아모라가 제안한 어떤 변경도 확인할 수 없다.
 *
 * 웹도 같은 한 줄을 갖고 있었고 함께 고쳤다(PendingAmoraActionCard.tsx).
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
