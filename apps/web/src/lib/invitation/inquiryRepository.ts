import type { InquiryApproverMode, InquiryApproverSetting } from "@hanbang/shared/invitation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isRecord, isUuid } from "@/utils/requestValidation";
import type { ReadResult } from "./hallRepository";

/**
 * 편지, 승인, 대기열, 답장 읽기. 모두 사용자 권한(RLS)으로 읽어 자기 커플 줄만 보인다.
 * DB 줄은 경계에서 검사하고 모양이 틀린 줄은 버린다.
 */

export type StoredShare = { on: boolean; value: string | null };
export type StoredShares = { name: StoredShare; phone: StoredShare; budget: StoredShare };

export type LetterVersionRow = {
  id: string;
  letterId: string;
  version: number;
  recipientHallIds: string[];
  recipientNames: string[];
  body: string;
  signature: string;
  shares: StoredShares;
  fingerprint: string;
  createdAt: string;
  approvalCompletedAt: string | null;
  queuedAt: string | null;
};

/** sendingEnabled: 승인한 때 문의 보내기가 켜져 있었는지. 켜진 뒤에는 켜진 동안의 승인만 센다. */
export type ApprovalRow = { approverUserId: string | null; settingsRevision: number; fingerprint: string; sendingEnabled: boolean };

/** 상대의 확인을 기다리는 승인 방식 제안. */
export type StoredApproverProposal = {
  proposalId: string;
  mode: InquiryApproverMode;
  designatedUserId: string | null;
  proposedBy: string;
  proposedAt: string;
};

export type DispatchRow = {
  id: string;
  letterId: string;
  versionId: string;
  hallId: string;
  recipientName: string;
  /** withdrawn: 한 사람이 탈퇴해서 보내기 전에 거둬들인 문의. */
  status: "queued" | "sent" | "withdrawn";
  queuedAt: string;
  sentAt: string | null;
  /** 탈퇴로 편지를 지운 문의. 보낸 사실과 시각만 남고 더는 다룰 수 없다. */
  redacted: boolean;
};

export type ReplyOutcome = "confirmed_time" | "proposed_time" | "declined" | "question" | "conditions_note";

export type ReplyRow = {
  id: string;
  dispatchId: string;
  hallId: string;
  /** 탈퇴로 지운 답장은 원문이 없다(null). 정해진 칸은 남는다. */
  rawText: string | null;
  outcome: ReplyOutcome;
  eventAt: string | null;
  placeNote: string | null;
  priceNote: string | null;
  recordedAt: string;
};

const REPLY_OUTCOMES: readonly ReplyOutcome[] = ["confirmed_time", "proposed_time", "declined", "question", "conditions_note"];
const DISPATCH_STATUSES: readonly DispatchRow["status"][] = ["queued", "sent", "withdrawn"];
const MODES: readonly InquiryApproverMode[] = ["unset", "designated", "both"];

const iso = (value: unknown): string | null =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
const str = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

function parseShare(value: unknown): StoredShare | null {
  if (!isRecord(value) || typeof value.on !== "boolean") return null;
  if (value.value !== null && typeof value.value !== "string") return null;
  return { on: value.on, value: value.on ? (value.value as string | null) : null };
}

export function parseStoredShares(value: unknown): StoredShares | null {
  if (!isRecord(value)) return null;
  const name = parseShare(value.name);
  const phone = parseShare(value.phone);
  const budget = parseShare(value.budget);
  return name && phone && budget ? { name, phone, budget } : null;
}

export function parseVersionRow(value: unknown): LetterVersionRow | null {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.letter_id)) return null;
  const ids = Array.isArray(value.recipient_hall_ids) ? value.recipient_hall_ids : null;
  const names = Array.isArray(value.recipient_names) ? value.recipient_names : null;
  const shares = parseStoredShares(value.shares);
  const createdAt = iso(value.created_at);
  if (
    !ids || !names || ids.length !== names.length || ids.length === 0
    || !ids.every(isUuid) || !names.every((name) => typeof name === "string")
    || typeof value.version !== "number" || typeof value.body !== "string" || typeof value.signature !== "string"
    || typeof value.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(value.fingerprint)
    || !shares || !createdAt
  ) {
    return null;
  }
  return {
    id: value.id.toLowerCase(),
    letterId: value.letter_id.toLowerCase(),
    version: value.version,
    recipientHallIds: ids.map((id) => (id as string).toLowerCase()),
    recipientNames: names as string[],
    body: value.body,
    signature: value.signature,
    shares,
    fingerprint: value.fingerprint,
    createdAt,
    approvalCompletedAt: iso(value.approval_completed_at),
    queuedAt: iso(value.queued_at),
  };
}

export function parseDispatchRow(value: unknown): DispatchRow | null {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.letter_id) || !isUuid(value.version_id) || !isUuid(value.hall_id)) {
    return null;
  }
  const queuedAt = iso(value.queued_at);
  const recipientName = str(value.recipient_name);
  const status = DISPATCH_STATUSES.find((item) => item === value.status);
  if (!queuedAt || !recipientName || !status) return null;
  return {
    id: value.id.toLowerCase(),
    letterId: value.letter_id.toLowerCase(),
    versionId: value.version_id.toLowerCase(),
    hallId: value.hall_id.toLowerCase(),
    recipientName,
    status,
    queuedAt,
    sentAt: iso(value.sent_at),
    redacted: iso(value.redacted_at) !== null,
  };
}

export function parseReplyRow(value: unknown): ReplyRow | null {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.dispatch_id) || !isUuid(value.hall_id)) return null;
  const outcome = REPLY_OUTCOMES.find((item) => item === value.outcome);
  const recordedAt = iso(value.recorded_at);
  const redacted = iso(value.redacted_at) !== null;
  const rawText = str(value.raw_text);
  // 원문은 지운 답장에서만 빈다.
  if (!outcome || !recordedAt || (redacted ? rawText !== null : !rawText)) return null;
  const eventAt = iso(value.event_at);
  if ((outcome === "confirmed_time" || outcome === "proposed_time") && !eventAt) return null;
  return {
    id: value.id.toLowerCase(),
    dispatchId: value.dispatch_id.toLowerCase(),
    hallId: value.hall_id.toLowerCase(),
    rawText,
    outcome,
    eventAt,
    placeNote: str(value.place_note),
    priceNote: str(value.price_note),
    recordedAt,
  };
}

export type ApproverState = { setting: InquiryApproverSetting; proposal: StoredApproverProposal | null };

/** 지금 쓰이는 승인 방식과 확인을 기다리는 제안. 줄이 없으면 아직 고르지 않은 것(revision 0)이다. */
export async function readApproverState(
  supabase: SupabaseClient,
  coupleId: string,
): Promise<ReadResult<ApproverState>> {
  const { data, error } = await supabase
    .from("hall_inquiry_settings")
    .select("approver_mode, designated_user_id, revision, proposal_id, proposed_mode, proposed_designated_user_id, proposed_by, proposed_at")
    .eq("couple_id", coupleId)
    .maybeSingle();
  if (error) return { ok: false };
  if (!isRecord(data)) {
    return { ok: true, value: { setting: { mode: "unset", designatedUserId: null, revision: 0 }, proposal: null } };
  }
  const mode = MODES.find((item) => item === data.approver_mode);
  if (!mode || typeof data.revision !== "number") return { ok: false };
  const proposedMode = MODES.find((item) => item === data.proposed_mode);
  const proposedAt = iso(data.proposed_at);
  const proposal: StoredApproverProposal | null = isUuid(data.proposal_id) && proposedMode && isUuid(data.proposed_by) && proposedAt
    ? {
      proposalId: data.proposal_id.toLowerCase(),
      mode: proposedMode,
      designatedUserId: isUuid(data.proposed_designated_user_id) ? data.proposed_designated_user_id.toLowerCase() : null,
      proposedBy: data.proposed_by.toLowerCase(),
      proposedAt,
    }
    : null;
  return {
    ok: true,
    value: {
      setting: {
        mode,
        designatedUserId: isUuid(data.designated_user_id) ? data.designated_user_id.toLowerCase() : null,
        revision: data.revision,
      },
      proposal,
    },
  };
}

export async function readApproverSetting(
  supabase: SupabaseClient,
  coupleId: string,
): Promise<ReadResult<InquiryApproverSetting>> {
  const state = await readApproverState(supabase, coupleId);
  return state.ok ? { ok: true, value: state.value.setting } : state;
}

export type OpenLetter = { letterId: string; version: LetterVersionRow; approvals: ApprovalRow[] } | null;

/** 열려 있는 편지(아직 대기열에 넣지 않은 편지)의 마지막 판과 그 판의 승인. */
export async function readOpenLetter(supabase: SupabaseClient, coupleId: string): Promise<ReadResult<OpenLetter>> {
  const { data: letter, error: letterError } = await supabase
    .from("hall_inquiry_letters")
    .select("id, created_at")
    .eq("couple_id", coupleId)
    .is("locked_at", null)
    .maybeSingle();
  if (letterError) return { ok: false };
  if (!isRecord(letter) || !isUuid(letter.id)) return { ok: true, value: null };

  const { data: versionRow, error: versionError } = await supabase
    .from("hall_inquiry_letter_versions")
    .select("id, letter_id, version, recipient_hall_ids, recipient_names, body, signature, shares, fingerprint, created_at, approval_completed_at, queued_at")
    .eq("letter_id", letter.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (versionError) return { ok: false };
  const version = parseVersionRow(versionRow);
  if (!version) return { ok: true, value: null };

  const { data: approvalRows, error: approvalError } = await supabase
    .from("hall_inquiry_approvals")
    .select("approver_user_id, settings_revision, fingerprint, sending_enabled")
    .eq("version_id", version.id)
    .limit(40);
  if (approvalError) return { ok: false };
  const approvals = Array.isArray(approvalRows)
    ? approvalRows.flatMap((row): ApprovalRow[] => (
      isRecord(row) && typeof row.settings_revision === "number" && typeof row.fingerprint === "string"
        && typeof row.sending_enabled === "boolean"
        ? [{
          approverUserId: isUuid(row.approver_user_id) ? row.approver_user_id.toLowerCase() : null,
          settingsRevision: row.settings_revision,
          fingerprint: row.fingerprint,
          sendingEnabled: row.sending_enabled,
        }]
        : []
    ))
    : [];
  return { ok: true, value: { letterId: version.letterId, version, approvals } };
}

/** versions 에는 탈퇴로 지운 판이 없다(내용이 없어 읽기에서 뺀다). */
export type InquiryTimeline = { dispatches: DispatchRow[]; replies: ReplyRow[]; versions: LetterVersionRow[] };

/** 최근 문의 기록. 홈, 비교, 상담, 오늘 한 일이 같은 기록을 읽는다. */
export async function readInquiryTimeline(supabase: SupabaseClient, coupleId: string): Promise<ReadResult<InquiryTimeline>> {
  const [dispatchResult, replyResult] = await Promise.all([
    supabase
      .from("hall_inquiry_dispatches")
      .select("id, letter_id, version_id, hall_id, recipient_name, status, queued_at, sent_at, redacted_at")
      .eq("couple_id", coupleId)
      .order("queued_at", { ascending: false })
      .limit(50),
    supabase
      .from("hall_inquiry_replies")
      .select("id, dispatch_id, hall_id, raw_text, outcome, event_at, place_note, price_note, recorded_at, redacted_at")
      .eq("couple_id", coupleId)
      .order("recorded_at", { ascending: false })
      .limit(50),
  ]);
  if (dispatchResult.error || replyResult.error) return { ok: false };
  const dispatches = (dispatchResult.data ?? []).map(parseDispatchRow).filter((row): row is DispatchRow => row !== null);
  const replies = (replyResult.data ?? []).map(parseReplyRow).filter((row): row is ReplyRow => row !== null);

  const versionIds = [...new Set(dispatches.map((row) => row.versionId))];
  let versions: LetterVersionRow[] = [];
  if (versionIds.length > 0) {
    const { data, error } = await supabase
      .from("hall_inquiry_letter_versions")
      .select("id, letter_id, version, recipient_hall_ids, recipient_names, body, signature, shares, fingerprint, created_at, approval_completed_at, queued_at")
      .in("id", versionIds)
      .limit(versionIds.length);
    if (error) return { ok: false };
    versions = (data ?? []).map(parseVersionRow).filter((row): row is LetterVersionRow => row !== null);
  }
  return { ok: true, value: { dispatches, replies, versions } };
}
