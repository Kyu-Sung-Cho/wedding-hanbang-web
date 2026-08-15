import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import {
  isBodyTooLarge,
  isRecord,
  isUuid,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { verifyMutationActorFence } from "@/lib/auth/mutationActorFence";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;
const UNSAFE_TEXT_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/u;
const CONTACT_CHANNELS = ["website", "instagram", "naver_place"] as const;
const OUTCOMES = ["available", "unavailable", "needs_follow_up", "other"] as const;

type ContactChannel = (typeof CONTACT_CHANNELS)[number];
type UserReportedOutcome = (typeof OUTCOMES)[number];
type HandoffAction = "inspect" | "prepare" | "mark_sent" | "record_reply";

interface MutationBody {
  action: Exclude<HandoffAction, "inspect">;
  expectedRevision: number;
  contactChannel: ContactChannel | null;
  userReportedOutcome: UserReportedOutcome | null;
}

interface HandoffResponse {
  accepted: true;
  bookingId: string;
  bookingStatus: string;
  vendorId: string;
  vendorName: string;
  productName: string | null;
  bookingDate: string;
  bookingTime: string;
  contactOptions: Array<{
    channel: ContactChannel;
    label: string;
    target: string;
  }>;
  contactSource: "verified_public_vendor_view";
  suggestedInquiryMessage: string;
  providerDeliveryStatus: "not_integrated";
  handoff: null | {
    id: string;
    status: "prepared" | "sent" | "replied";
    contactChannel: ContactChannel;
    contactTarget: string;
    inquiryMessage: string;
    providerDeliveryStatus: "not_integrated";
    userReportedSentAt: string | null;
    userReportedReplyAt: string | null;
    userReportedOutcome: UserReportedOutcome | null;
    revision: number;
    updatedAt: string;
  };
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && options.includes(value as T);
}

function safeText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || Array.from(trimmed).length > max || UNSAFE_TEXT_RE.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function optionalSafeText(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  const parsed = safeText(value, max);
  return parsed ?? undefined;
}

function safeTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
  return value;
}

function safeContactTarget(channel: ContactChannel, value: unknown): string | null {
  const target = safeText(value, 500);
  if (!target) return null;
  try {
    const url = new URL(target);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (
      channel === "instagram"
      && url.hostname !== "instagram.com"
      && url.hostname !== "www.instagram.com"
    ) return null;
    if (
      channel === "naver_place"
      && url.hostname !== "m.place.naver.com"
      && url.hostname !== "place.naver.com"
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function parseMutationBody(value: unknown): MutationBody | null {
  if (!isRecord(value)) return null;
  if (
    value.action !== "prepare"
    && value.action !== "mark_sent"
    && value.action !== "record_reply"
  ) return null;
  if (
    !Number.isSafeInteger(value.expectedRevision)
    || (value.expectedRevision as number) < 0
  ) return null;

  if (value.action === "prepare") {
    if (!isOneOf(value.contactChannel, CONTACT_CHANNELS)) return null;
    if (value.userReportedOutcome !== undefined && value.userReportedOutcome !== null) {
      return null;
    }
    return {
      action: "prepare",
      expectedRevision: value.expectedRevision as number,
      contactChannel: value.contactChannel,
      userReportedOutcome: null,
    };
  }

  if (value.contactChannel !== undefined && value.contactChannel !== null) return null;
  if (value.action === "record_reply") {
    if (!isOneOf(value.userReportedOutcome, OUTCOMES)) return null;
    return {
      action: "record_reply",
      expectedRevision: value.expectedRevision as number,
      contactChannel: null,
      userReportedOutcome: value.userReportedOutcome,
    };
  }
  if (value.userReportedOutcome !== undefined && value.userReportedOutcome !== null) {
    return null;
  }
  return {
    action: "mark_sent",
    expectedRevision: value.expectedRevision as number,
    contactChannel: null,
    userReportedOutcome: null,
  };
}

function parseAtomicResponse(value: unknown, expectedBookingId: string): HandoffResponse | null {
  if (
    !isRecord(value)
    || value.accepted !== true
    || value.bookingId !== expectedBookingId
    || !isUuid(value.vendorId)
    || value.providerDeliveryStatus !== "not_integrated"
    || value.contactSource !== "verified_public_vendor_view"
    || !Array.isArray(value.contactOptions)
    || value.contactOptions.length > CONTACT_CHANNELS.length
  ) return null;

  const bookingStatus = safeText(value.bookingStatus, 40);
  const vendorName = safeText(value.vendorName, 200);
  const productName = optionalSafeText(value.productName, 200);
  const suggestedInquiryMessage = safeText(value.suggestedInquiryMessage, 2000);
  if (
    !bookingStatus
    || !vendorName
    || productName === undefined
    || !suggestedInquiryMessage
    || typeof value.bookingDate !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.bookingDate)
    || typeof value.bookingTime !== "string"
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.bookingTime)
  ) return null;

  const seenChannels = new Set<ContactChannel>();
  const contactOptions: HandoffResponse["contactOptions"] = [];
  for (const option of value.contactOptions) {
    if (!isRecord(option) || !isOneOf(option.channel, CONTACT_CHANNELS)) return null;
    if (seenChannels.has(option.channel)) return null;
    const label = safeText(option.label, 40);
    const target = safeContactTarget(option.channel, option.target);
    if (!label || !target) return null;
    seenChannels.add(option.channel);
    contactOptions.push({ channel: option.channel, label, target });
  }

  let handoff: HandoffResponse["handoff"] = null;
  if (value.handoff !== null) {
    if (
      !isRecord(value.handoff)
      || !isUuid(value.handoff.id)
      || (
        value.handoff.status !== "prepared"
        && value.handoff.status !== "sent"
        && value.handoff.status !== "replied"
      )
      || !isOneOf(value.handoff.contactChannel, CONTACT_CHANNELS)
      || value.handoff.providerDeliveryStatus !== "not_integrated"
      || !Number.isSafeInteger(value.handoff.revision)
      || (value.handoff.revision as number) < 1
    ) return null;

    const contactTarget = safeContactTarget(
      value.handoff.contactChannel,
      value.handoff.contactTarget,
    );
    const inquiryMessage = safeText(value.handoff.inquiryMessage, 2000);
    const sentAt = safeTimestamp(value.handoff.userReportedSentAt);
    const replyAt = safeTimestamp(value.handoff.userReportedReplyAt);
    const updatedAt = safeTimestamp(value.handoff.updatedAt);
    const outcome = value.handoff.userReportedOutcome === null
      ? null
      : isOneOf(value.handoff.userReportedOutcome, OUTCOMES)
        ? value.handoff.userReportedOutcome
        : undefined;
    if (
      !contactTarget
      || !inquiryMessage
      || sentAt === undefined
      || replyAt === undefined
      || updatedAt === null
      || updatedAt === undefined
      || outcome === undefined
      || (value.handoff.status === "prepared" && (sentAt !== null || replyAt !== null || outcome !== null))
      || (value.handoff.status === "sent" && (sentAt === null || replyAt !== null || outcome !== null))
      || (value.handoff.status === "replied" && (sentAt === null || replyAt === null || outcome === null))
    ) return null;

    handoff = {
      id: value.handoff.id,
      status: value.handoff.status,
      contactChannel: value.handoff.contactChannel,
      contactTarget,
      inquiryMessage,
      providerDeliveryStatus: "not_integrated",
      userReportedSentAt: sentAt,
      userReportedReplyAt: replyAt,
      userReportedOutcome: outcome,
      revision: value.handoff.revision as number,
      updatedAt,
    };
  }

  return {
    accepted: true,
    bookingId: expectedBookingId,
    bookingStatus,
    vendorId: value.vendorId,
    vendorName,
    productName,
    bookingDate: value.bookingDate,
    bookingTime: value.bookingTime,
    contactOptions,
    contactSource: "verified_public_vendor_view",
    suggestedInquiryMessage,
    providerDeliveryStatus: "not_integrated",
    handoff,
  };
}

function rpcErrorResponse(error: { message?: string } | null) {
  const message = error?.message?.toUpperCase() ?? "";
  if (message.includes("VENDOR_INQUIRY_HANDOFF_REVISION_CONFLICT")) {
    return NextResponse.json(
      {
        error: "문의 상태가 다른 기기에서 변경됐어요. 최신 상태를 다시 확인해 주세요.",
        code: "VENDOR_INQUIRY_HANDOFF_REVISION_CONFLICT",
      },
      { status: 409 },
    );
  }
  if (message.includes("VENDOR_INQUIRY_HANDOFF_NOT_FOUND")) {
    return NextResponse.json({ error: "문의할 예약 요청 기록을 찾을 수 없습니다." }, { status: 404 });
  }
  if (message.includes("VENDOR_INQUIRY_HANDOFF_INVALID_ARGS")) {
    return NextResponse.json({ error: "문의 인계 입력값이 올바르지 않습니다." }, { status: 400 });
  }
  if (message.includes("VENDOR_INQUIRY_HANDOFF_CONTACT_UNAVAILABLE")) {
    return NextResponse.json({ error: "이 업체의 공개 연락 경로를 확인할 수 없습니다." }, { status: 409 });
  }
  if (message.includes("VENDOR_INQUIRY_HANDOFF_VENDOR_UNAVAILABLE")) {
    return NextResponse.json({ error: "현재 공개된 업체 정보를 확인할 수 없습니다." }, { status: 409 });
  }
  if (message.includes("VENDOR_INQUIRY_HANDOFF_BOOKING_CANCELLED")) {
    return NextResponse.json({ error: "취소 표시한 기록에서는 새 문의를 준비할 수 없습니다." }, { status: 409 });
  }
  if (message.includes("VENDOR_INQUIRY_HANDOFF_LOCKED_AFTER_SENT")) {
    return NextResponse.json(
      { error: "보냈다고 기록한 문의의 연락 경로와 문구는 바꾸지 않았습니다." },
      { status: 409 },
    );
  }
  if (message.includes("VENDOR_INQUIRY_HANDOFF_NOT_PREPARED")) {
    return NextResponse.json({ error: "문의문을 먼저 준비해 주세요." }, { status: 409 });
  }
  if (message.includes("VENDOR_INQUIRY_HANDOFF_SENT_REPORT_REQUIRED")) {
    return NextResponse.json({ error: "직접 보냈다고 기록한 뒤 답변 결과를 남길 수 있습니다." }, { status: 409 });
  }
  return NextResponse.json(
    {
      error: "문의 인계 기록 여부를 확인하지 못했습니다. 같은 동작을 다시 해도 중복 기록되지 않습니다.",
    },
    { status: 503 },
  );
}

async function resolveHandoff(
  bookingId: string,
  actorProfileId: string,
  action: HandoffAction,
  expectedRevision: number | null,
  contactChannel: ContactChannel | null,
  userReportedOutcome: UserReportedOutcome | null,
) {
  const { data, error } = await createAdminClient().rpc(
    "resolve_vendor_inquiry_handoff_atomic",
    {
      p_booking_id: bookingId,
      p_actor_profile_id: actorProfileId,
      p_action: action,
      p_expected_revision: expectedRevision,
      p_contact_channel: contactChannel,
      p_user_reported_outcome: userReportedOutcome,
    },
  );
  if (error) return { response: rpcErrorResponse(error), value: null };
  const value = parseAtomicResponse(data, bookingId);
  if (!value) return { response: rpcErrorResponse(null), value: null };
  return { response: null, value };
}

async function authenticate(request: Request) {
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "잘못된 예약 요청 기록 ID입니다." }, { status: 400 });
  }
  const user = await authenticate(request);
  if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const limited = checkRateLimit(
    rateLimitKey("booking:inquiry-handoff:read", request, user.id),
    { maxRequests: 60, windowMs: 60 * 1000 },
  );
  if (limited) return limited;

  const resolved = await resolveHandoff(id, user.id, "inspect", null, null, null);
  return resolved.response ?? NextResponse.json(resolved.value);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json({ error: "잘못된 요청 출처입니다." }, { status: 403 });
  }
  if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
    return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "잘못된 예약 요청 기록 ID입니다." }, { status: 400 });
  }
  const user = await authenticate(request);
  if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const actorFence = verifyMutationActorFence(request.headers, user.id, {
    allowLegacy: false,
  });
  if (!actorFence.ok) {
    return NextResponse.json({
      error: actorFence.message,
      code: actorFence.code,
    }, { status: actorFence.status });
  }

  const limited = checkRateLimit(
    rateLimitKey("booking:inquiry-handoff:write", request, user.id),
    { maxRequests: 30, windowMs: 60 * 60 * 1000 },
  );
  if (limited) return limited;

  const rawBody = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
  if (!rawBody.ok) {
    return NextResponse.json(
      {
        error: rawBody.reason === "too_large"
          ? "요청 데이터가 너무 큽니다."
          : "문의 결과 입력을 읽지 못했습니다.",
      },
      { status: rawBody.reason === "too_large" ? 413 : 400 },
    );
  }

  let parsedBody: unknown = null;
  try {
    parsedBody = JSON.parse(rawBody.text);
  } catch {
    // 잘못된 JSON은 아래 입력 검증에서 동일하게 거절한다.
  }
  const body = parseMutationBody(parsedBody);
  if (!body) {
    return NextResponse.json({ error: "문의 인계 입력값이 올바르지 않습니다." }, { status: 400 });
  }

  const resolved = await resolveHandoff(
    id,
    user.id,
    body.action,
    body.expectedRevision,
    body.contactChannel,
    body.userReportedOutcome,
  );
  return resolved.response ?? NextResponse.json(resolved.value);
}
