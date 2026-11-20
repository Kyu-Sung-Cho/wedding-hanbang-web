import type {
  InquiryApproverMode,
  InquiryApproverOutcome,
  InquiryApproverSetting,
  LetterApproveResult,
  LetterNotQueuedReason,
} from "@hanbang/shared/invitation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isRecord, isUuid } from "@/utils/requestValidation";
import { log } from "@/utils/log";
import type { StoredApproverProposal, StoredShares } from "./inquiryRepository";

/**
 * 문의 DB 함수 부르기(service_role 전용). DB 가 회원, 판, 지문, 승인 방식, 스위치, 상한을 다시 판정한다.
 * 오류는 DB 가 낸 고정 코드로만 가른다. 내부 오류 원문은 응답에 싣지 않는다.
 */

export type RpcFailure = { ok: false; status: number; code: string; error: string };
export type RpcResult<T> = { ok: true; value: T } | RpcFailure;

const KNOWN: readonly [RegExp, number, string, string][] = [
  [/HALL_INQUIRY_NOT_COUPLE_MEMBER/, 403, "NOT_COUPLE_MEMBER", "이 커플의 편지를 다룰 수 없어요."],
  [/HALL_INQUIRY_OPERATOR_REQUIRED/, 403, "OPERATOR_REQUIRED", "운영자만 할 수 있어요."],
  [/HALL_INQUIRY_VERSION_CHANGED/, 409, "LETTER_VERSION_CHANGED", "편지 내용이 바뀌었어요. 바뀐 편지를 다시 확인해 주세요."],
  [/HALL_INQUIRY_LETTER_LOCKED/, 409, "LETTER_LOCKED", "이미 보낼 준비를 마친 편지예요. 새 편지로 써 주세요."],
  [/HALL_INQUIRY_RECIPIENTS_UNAVAILABLE/, 409, "RECIPIENTS_UNAVAILABLE", "받는 홀이 바뀌었어요. 담은 홀을 다시 확인해 주세요."],
  [/HALL_INQUIRY_RECIPIENTS_INVALID/, 400, "RECIPIENTS_INVALID", "받는 곳을 다시 골라 주세요."],
  [/HALL_INQUIRY_BODY_INVALID/, 400, "LETTER_BODY_INVALID", "편지 글을 다시 확인해 주세요."],
  [/HALL_INQUIRY_SHARES_INVALID/, 400, "LETTER_SHARES_INVALID", "알려줄 정보를 다시 확인해 주세요."],
  [/HALL_INQUIRY_LETTER_NOT_FOUND/, 404, "LETTER_NOT_FOUND", "편지를 찾지 못했어요. 다시 불러와 주세요."],
  [/HALL_INQUIRY_TOO_MANY_VERSIONS/, 409, "LETTER_TOO_MANY_VERSIONS", "편지를 너무 여러 번 고쳤어요. 새 편지로 써 주세요."],
  [/HALL_INQUIRY_APPROVER_PARTNER_REQUIRED/, 409, "APPROVER_PARTNER_REQUIRED", "두 사람이 모두 함께해야 고를 수 있어요."],
  [/HALL_INQUIRY_APPROVER_NOT_MEMBER/, 400, "APPROVER_NOT_MEMBER", "승인할 사람을 다시 골라 주세요."],
  [/HALL_INQUIRY_APPROVER_INVALID/, 400, "APPROVER_INVALID", "승인 방식을 다시 골라 주세요."],
  [/HALL_INQUIRY_APPROVER_PROPOSAL_CHANGED/, 409, "APPROVER_PROPOSAL_CHANGED", "승인 방식 제안이 바뀌었어요. 다시 확인해 주세요."],
  [/HALL_INQUIRY_APPROVER_PROPOSAL_OWN/, 409, "APPROVER_PROPOSAL_OWN", "내가 낸 제안은 상대가 확인해요."],
  [/HALL_INQUIRY_DISPATCH_NOT_FOUND/, 404, "DISPATCH_NOT_FOUND", "대기열에서 찾지 못했어요."],
  [/HALL_INQUIRY_REPLY_BEFORE_SENT/, 409, "REPLY_BEFORE_SENT", "보냈다고 표시한 뒤에 답장을 적어 주세요."],
  [/HALL_INQUIRY_ACCOUNT_UNAVAILABLE/, 409, "ACCOUNT_UNAVAILABLE", "탈퇴를 정리하는 중이라 지금은 상담 문의를 다룰 수 없어요. 잠시 뒤에 다시 해 주세요."],
  [/HALL_INQUIRY_DISPATCH_WITHDRAWN/, 409, "DISPATCH_WITHDRAWN", "커플 한 사람이 탈퇴해서 편지를 지운 문의예요. 더는 보내거나 답장을 적지 않아요."],
  [/HALL_INQUIRY_INPUT_INVALID|hall_inquiry_replies_\w+_check/, 400, "INPUT_INVALID", "입력을 다시 확인해 주세요."],
];

export function mapInquiryRpcError(error: unknown, scope: string): RpcFailure {
  const text = isRecord(error) ? `${String(error.code ?? "")} ${String(error.message ?? "")}` : String(error ?? "");
  for (const [pattern, status, code, message] of KNOWN) {
    if (pattern.test(text)) return { ok: false, status, code, error: message };
  }
  const sqlstate = isRecord(error) && typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : "unknown";
  log.error(`[invitation] ${scope} rpc failed`, new Error(`hall inquiry rpc failed (${sqlstate})`));
  return { ok: false, status: 503, code: "INQUIRY_UNAVAILABLE", error: "잠시 후 다시 시도해 주세요." };
}

const invalidResult = (scope: string): RpcFailure => {
  log.error(`[invitation] ${scope} rpc returned an invalid result`);
  return { ok: false, status: 503, code: "INQUIRY_UNAVAILABLE", error: "잠시 후 다시 시도해 주세요." };
};

export type SavedVersion = { letterId: string; versionId: string; version: number; fingerprint: string; created: boolean };

export async function saveLetterVersion(admin: SupabaseClient, input: {
  coupleId: string;
  actorUserId: string;
  letterId: string | null;
  recipientHallIds: readonly string[];
  body: string;
  signature: string;
  shares: StoredShares;
}): Promise<RpcResult<SavedVersion>> {
  const { data, error } = await admin.rpc("hall_inquiry_save_letter_version", {
    p_couple_id: input.coupleId,
    p_actor_user_id: input.actorUserId,
    p_letter_id: input.letterId,
    p_recipient_hall_ids: [...input.recipientHallIds],
    p_body: input.body,
    p_signature: input.signature,
    p_shares: input.shares,
  });
  if (error) return mapInquiryRpcError(error, "save letter");
  if (
    !isRecord(data) || !isUuid(data.letterId) || !isUuid(data.versionId) || typeof data.version !== "number"
    || typeof data.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(data.fingerprint) || typeof data.created !== "boolean"
  ) {
    return invalidResult("save letter");
  }
  return {
    ok: true,
    value: {
      letterId: data.letterId,
      versionId: data.versionId,
      version: data.version,
      fingerprint: data.fingerprint,
      created: data.created,
    },
  };
}

const STATUSES = ["awaiting_approval", "approved_not_queued", "queued"] as const;
const REASONS: readonly LetterNotQueuedReason[] = ["sending_disabled", "daily_cap", "global_daily_cap", "approver_unavailable"];
const uuidList = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every(isUuid) ? value.map((id) => (id as string).toLowerCase()) : null;

export async function approveLetter(admin: SupabaseClient, input: {
  coupleId: string;
  actorUserId: string;
  versionId: string;
  fingerprint: string;
  sendingEnabled: boolean;
  dailyCap: number;
  globalDailyCap: number;
}): Promise<RpcResult<LetterApproveResult>> {
  const { data, error } = await admin.rpc("hall_inquiry_approve_letter", {
    p_couple_id: input.coupleId,
    p_actor_user_id: input.actorUserId,
    p_version_id: input.versionId,
    p_fingerprint: input.fingerprint,
    p_sending_enabled: input.sendingEnabled,
    p_daily_cap: input.dailyCap,
    p_global_daily_cap: input.globalDailyCap,
  });
  if (error) return mapInquiryRpcError(error, "approve letter");
  const status = isRecord(data) ? STATUSES.find((item) => item === data.status) : undefined;
  const duplicates = isRecord(data) ? uuidList(data.duplicateHallIds) : null;
  const waiting = isRecord(data) ? uuidList(data.waitingFor) : null;
  const reason = isRecord(data) ? data.notQueuedReason : undefined;
  if (
    !isRecord(data) || !status || !duplicates || !waiting
    || typeof data.queuedCount !== "number"
    || !(reason === null || reason === undefined || REASONS.includes(reason as LetterNotQueuedReason))
  ) {
    return invalidResult("approve letter");
  }
  return {
    ok: true,
    value: {
      status,
      notQueuedReason: (reason ?? null) as LetterNotQueuedReason | null,
      queuedCount: data.queuedCount,
      duplicateHallIds: duplicates,
      waitingFor: waiting,
    },
  };
}

export type ApproverRpcState = {
  setting: InquiryApproverSetting;
  proposal: StoredApproverProposal | null;
  outcome: InquiryApproverOutcome;
  changed: boolean;
};

const APPROVER_MODES: readonly InquiryApproverMode[] = ["unset", "designated", "both"];
const APPROVER_OUTCOMES: readonly InquiryApproverOutcome[] = ["unchanged", "applied", "proposed", "withdrawn", "confirmed", "declined"];

/** 승인 방식 함수들이 돌려주는 모양(지금 방식, 기다리는 제안, 한 일)을 경계에서 검사한다. */
function parseApproverState(data: unknown): ApproverRpcState | null {
  if (!isRecord(data)) return null;
  const mode = APPROVER_MODES.find((item) => item === data.mode);
  const outcome = APPROVER_OUTCOMES.find((item) => item === data.outcome);
  if (
    !mode || !outcome || typeof data.revision !== "number" || typeof data.changed !== "boolean"
    || !(data.designatedUserId === null || isUuid(data.designatedUserId))
  ) {
    return null;
  }
  let proposal: StoredApproverProposal | null = null;
  if (data.pending !== null) {
    const pending = data.pending;
    const proposedMode = isRecord(pending) ? APPROVER_MODES.find((item) => item === pending.mode) : undefined;
    if (
      !isRecord(pending) || !proposedMode || !isUuid(pending.proposalId) || !isUuid(pending.proposedBy)
      || typeof pending.proposedAt !== "string" || !Number.isFinite(Date.parse(pending.proposedAt))
      || !(pending.designatedUserId === null || isUuid(pending.designatedUserId))
    ) {
      return null;
    }
    proposal = {
      proposalId: pending.proposalId.toLowerCase(),
      mode: proposedMode,
      designatedUserId: isUuid(pending.designatedUserId) ? pending.designatedUserId.toLowerCase() : null,
      proposedBy: pending.proposedBy.toLowerCase(),
      proposedAt: pending.proposedAt,
    };
  }
  return {
    setting: {
      mode,
      designatedUserId: isUuid(data.designatedUserId) ? data.designatedUserId.toLowerCase() : null,
      revision: data.revision,
    },
    proposal,
    outcome,
    changed: data.changed,
  };
}

/**
 * 승인 방식을 고른다. 상대의 승인 권한을 줄이는 변경은 DB 가 제안으로만 남기고(outcome "proposed"),
 * 지금 방식은 상대가 확인할 때까지 그대로다. 상대가 낸 제안과 같은 방식을 고르면 확인한 것이다.
 */
export async function setApprover(admin: SupabaseClient, input: {
  coupleId: string;
  actorUserId: string;
  mode: InquiryApproverMode;
  designatedUserId: string | null;
}): Promise<RpcResult<ApproverRpcState>> {
  const { data, error } = await admin.rpc("hall_inquiry_set_approver", {
    p_couple_id: input.coupleId,
    p_actor_user_id: input.actorUserId,
    p_mode: input.mode,
    p_designated_user_id: input.designatedUserId,
  });
  if (error) return mapInquiryRpcError(error, "set approver");
  const state = parseApproverState(data);
  return state ? { ok: true, value: state } : invalidResult("set approver");
}

/** 상대가 낸 승인 방식 제안에 답한다. 화면이 본 제안 번호와 지금 제안이 다르면 DB 가 거절한다. */
export async function respondApprover(admin: SupabaseClient, input: {
  coupleId: string;
  actorUserId: string;
  proposalId: string;
  accept: boolean;
}): Promise<RpcResult<ApproverRpcState>> {
  const { data, error } = await admin.rpc("hall_inquiry_respond_approver", {
    p_couple_id: input.coupleId,
    p_actor_user_id: input.actorUserId,
    p_proposal_id: input.proposalId,
    p_accept: input.accept,
  });
  if (error) return mapInquiryRpcError(error, "respond approver");
  const state = parseApproverState(data);
  return state ? { ok: true, value: state } : invalidResult("respond approver");
}

export async function markDispatchSent(admin: SupabaseClient, input: {
  dispatchId: string;
  operatorUserId: string;
  channelNote: string | null;
}): Promise<RpcResult<{ alreadySent: boolean; sentAt: string }>> {
  const { data, error } = await admin.rpc("hall_inquiry_mark_sent", {
    p_dispatch_id: input.dispatchId,
    p_operator_user_id: input.operatorUserId,
    p_channel_note: input.channelNote,
  });
  if (error) return mapInquiryRpcError(error, "mark sent");
  if (!isRecord(data) || typeof data.alreadySent !== "boolean" || typeof data.sentAt !== "string") return invalidResult("mark sent");
  return { ok: true, value: { alreadySent: data.alreadySent, sentAt: data.sentAt } };
}

export async function recordReply(admin: SupabaseClient, input: {
  dispatchId: string;
  operatorUserId: string;
  rawText: string;
  outcome: string;
  eventAt: string | null;
  placeNote: string | null;
  priceNote: string | null;
}): Promise<RpcResult<{ replyId: string; created: boolean }>> {
  const { data, error } = await admin.rpc("hall_inquiry_record_reply", {
    p_dispatch_id: input.dispatchId,
    p_operator_user_id: input.operatorUserId,
    p_raw_text: input.rawText,
    p_outcome: input.outcome,
    p_event_at: input.eventAt,
    p_place_note: input.placeNote,
    p_price_note: input.priceNote,
  });
  if (error) return mapInquiryRpcError(error, "record reply");
  if (!isRecord(data) || !isUuid(data.replyId) || typeof data.created !== "boolean") return invalidResult("record reply");
  return { ok: true, value: { replyId: data.replyId, created: data.created } };
}
