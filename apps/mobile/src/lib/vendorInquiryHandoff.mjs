const CONTACT_CHANNELS = ["website", "instagram", "naver_place"];
const USER_REPORTED_OUTCOMES = [
  "available",
  "unavailable",
  "needs_follow_up",
  "other",
];
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeText(value, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const hasUnsafeCodePoint = Array.from(trimmed).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (codePoint >= 0 && codePoint <= 8)
      || codePoint === 11
      || codePoint === 12
      || (codePoint >= 14 && codePoint <= 31)
      || codePoint === 127
      || codePoint === 8232
      || codePoint === 8233;
  });
  if (!trimmed || Array.from(trimmed).length > max || hasUnsafeCodePoint) {
    return null;
  }
  return trimmed;
}

function optionalSafeText(value, max) {
  if (value === null) return null;
  return safeText(value, max) ?? undefined;
}

function safeTimestamp(value) {
  if (value === null) return null;
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : undefined;
}

function safeContactTarget(channel, value) {
  const target = safeText(value, 500);
  if (!target) return null;
  try {
    const url = new globalThis.URL(target);
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

export function parseVendorInquiryHandoffResponse(value, expectedBookingId) {
  if (
    !isRecord(value)
    || value.accepted !== true
    || value.bookingId !== expectedBookingId
    || !UUID_RE.test(String(value.vendorId ?? ""))
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

  const channels = new Set();
  const contactOptions = [];
  for (const option of value.contactOptions) {
    if (
      !isRecord(option)
      || !CONTACT_CHANNELS.includes(option.channel)
      || channels.has(option.channel)
    ) return null;
    const label = safeText(option.label, 40);
    const target = safeContactTarget(option.channel, option.target);
    if (!label || !target) return null;
    channels.add(option.channel);
    contactOptions.push({ channel: option.channel, label, target });
  }

  let handoff = null;
  if (value.handoff !== null) {
    if (
      !isRecord(value.handoff)
      || !UUID_RE.test(String(value.handoff.id ?? ""))
      || !["prepared", "sent", "replied"].includes(value.handoff.status)
      || !CONTACT_CHANNELS.includes(value.handoff.contactChannel)
      || value.handoff.providerDeliveryStatus !== "not_integrated"
      || !Number.isSafeInteger(value.handoff.revision)
      || value.handoff.revision < 1
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
      : USER_REPORTED_OUTCOMES.includes(value.handoff.userReportedOutcome)
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
      revision: value.handoff.revision,
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

export function buildVendorInquiryMutationBody(handoff, action, values = {}) {
  const revision = handoff === null
    ? 0
    : Number.isSafeInteger(handoff?.revision) && handoff.revision >= 1
      ? handoff.revision
      : null;
  if (revision === null) return null;

  if (action === "prepare") {
    if (!CONTACT_CHANNELS.includes(values.contactChannel)) return null;
    return {
      action,
      contactChannel: values.contactChannel,
      expectedRevision: revision,
    };
  }
  if (!handoff) return null;
  if (action === "mark_sent") {
    return { action, expectedRevision: revision };
  }
  if (
    action === "record_reply"
    && USER_REPORTED_OUTCOMES.includes(values.userReportedOutcome)
  ) {
    return {
      action,
      userReportedOutcome: values.userReportedOutcome,
      expectedRevision: revision,
    };
  }
  return null;
}

export function buildVendorInquiryShareMessage(handoff) {
  if (
    !handoff
    || !CONTACT_CHANNELS.includes(handoff.contactChannel)
    || handoff.providerDeliveryStatus !== "not_integrated"
  ) return null;
  const message = safeText(handoff.inquiryMessage, 2000);
  const target = safeContactTarget(handoff.contactChannel, handoff.contactTarget);
  if (!message || !target) return null;
  return message;
}

export function getVendorInquiryContactUrl(option) {
  if (!option || !CONTACT_CHANNELS.includes(option.channel)) return null;
  const target = safeContactTarget(option.channel, option.target);
  if (!target) return null;
  return target;
}

export function buildVendorInquiryDecisionPrompt(value) {
  if (
    !isRecord(value)
    || value.accepted !== true
    || value.providerDeliveryStatus !== "not_integrated"
    || !isRecord(value.handoff)
    || value.handoff.status !== "replied"
    || !USER_REPORTED_OUTCOMES.includes(value.handoff.userReportedOutcome)
  ) return null;

  const vendorName = safeText(value.vendorName, 200);
  const productName = value.productName === null
    ? "상품 미정"
    : safeText(value.productName, 200);
  const bookingDate = typeof value.bookingDate === "string"
    && /^\d{4}-\d{2}-\d{2}$/u.test(value.bookingDate)
    ? value.bookingDate
    : null;
  const bookingTime = typeof value.bookingTime === "string"
    && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value.bookingTime)
    ? value.bookingTime
    : null;
  if (!vendorName || !productName || !bookingDate || !bookingTime) return null;

  const outcomeLabel = {
    available: "가능",
    unavailable: "불가",
    needs_follow_up: "추가 확인 필요",
    other: "기타",
  }[value.handoff.userReportedOutcome];

  return [
    "업체 문의 뒤 다음 결정을 같이 정리하고 싶어.",
    `업체: ${vendorName}`,
    `상품: ${productName}`,
    `저장된 요청 일정: ${bookingDate} ${bookingTime}`,
    `사용자가 직접 기록한 답변 결과: ${outcomeLabel}`,
    "이 기록은 업체 시스템 확인이 아님. 예약·계약 확정도 아니야.",
    "확인된 것, 아직 확인할 것, 지금 할 한 가지를 구분해줘.",
    "예산·일정·체크리스트 변경이 필요하면 변경 전후와 공유 범위를 먼저 보여주고, 내가 확인하기 전에는 저장하거나 공유하지 말아줘.",
  ].join("\n");
}
