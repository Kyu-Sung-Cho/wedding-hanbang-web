import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVendorInquiryDecisionPrompt,
  buildVendorInquiryMutationBody,
  buildVendorInquiryShareMessage,
  getVendorInquiryContactUrl,
  parseVendorInquiryHandoffResponse,
} from "../lib/vendorInquiryHandoff.mjs";
import {
  consumeCompanionChatHandoff,
  stagePrivateChatHandoff,
} from "../lib/companionChatHandoff.mjs";

const BOOKING_ID = "12345678-1234-4234-9234-123456789abc";

function response(overrides = {}) {
  return {
    accepted: true,
    bookingId: BOOKING_ID,
    bookingStatus: "pending",
    vendorId: "22345678-1234-4234-9234-123456789abc",
    vendorName: "테스트 스튜디오",
    productName: "기본 촬영",
    bookingDate: "2099-07-20",
    bookingTime: "10:00",
    contactOptions: [
      { channel: "website", label: "공식 웹사이트", target: "https://example.com/" },
      { channel: "instagram", label: "인스타그램", target: "https://www.instagram.com/hanbangstudio/" },
      { channel: "naver_place", label: "네이버 플레이스", target: "https://m.place.naver.com/place/123" },
    ],
    contactSource: "verified_public_vendor_view",
    suggestedInquiryMessage: "안녕하세요. 상담 가능 여부를 문의드립니다.",
    providerDeliveryStatus: "not_integrated",
    handoff: null,
    ...overrides,
  };
}

test("parses contact context without mistaking a prepared handoff for delivery", () => {
  const parsed = parseVendorInquiryHandoffResponse(response({
    handoff: {
      id: "32345678-1234-4234-9234-123456789abc",
      status: "prepared",
      contactChannel: "website",
      contactTarget: "https://example.com/",
      inquiryMessage: "안녕하세요. 상담 가능 여부를 문의드립니다.",
      providerDeliveryStatus: "not_integrated",
      userReportedSentAt: null,
      userReportedReplyAt: null,
      userReportedOutcome: null,
      revision: 1,
      updatedAt: "2099-07-01T00:00:00.000Z",
    },
  }), BOOKING_ID);

  assert.equal(parsed?.providerDeliveryStatus, "not_integrated");
  assert.equal(parsed?.handoff?.status, "prepared");
  assert.equal(parsed?.handoff?.userReportedSentAt, null);
  assert.equal(buildVendorInquiryShareMessage(parsed?.handoff ?? null), parsed?.handoff?.inquiryMessage);
});

test("rejects provider-delivered claims and impossible user-report state combinations", () => {
  assert.equal(parseVendorInquiryHandoffResponse(
    response({ providerDeliveryStatus: "delivered" }),
    BOOKING_ID,
  ), null);
  assert.equal(parseVendorInquiryHandoffResponse(response({
    handoff: {
      id: "32345678-1234-4234-9234-123456789abc",
      status: "replied",
      contactChannel: "website",
      contactTarget: "https://example.com/",
      inquiryMessage: "문의",
      providerDeliveryStatus: "not_integrated",
      userReportedSentAt: null,
      userReportedReplyAt: "2099-07-02T00:00:00.000Z",
      userReportedOutcome: "available",
      revision: 3,
      updatedAt: "2099-07-02T00:00:00.000Z",
    },
  }), BOOKING_ID), null);
});

test("builds only safe native contact URLs from server-validated public targets", () => {
  assert.equal(getVendorInquiryContactUrl({
    channel: "website",
    label: "공식 웹사이트",
    target: "https://example.com/",
  }), "https://example.com/");
  assert.equal(getVendorInquiryContactUrl({
    channel: "naver_place",
    label: "네이버 플레이스",
    target: "https://m.place.naver.com/place/123",
  }), "https://m.place.naver.com/place/123");
  assert.equal(getVendorInquiryContactUrl({
    channel: "website",
    label: "웹",
    target: "javascript:alert(1)",
  }), null);
});

test("captures revision zero for first prepare and the exact parsed revision thereafter", () => {
  assert.deepEqual(buildVendorInquiryMutationBody(null, "prepare", {
    contactChannel: "website",
  }), {
    action: "prepare",
    contactChannel: "website",
    expectedRevision: 0,
  });

  const parsed = parseVendorInquiryHandoffResponse(response({
    handoff: {
      id: "32345678-1234-4234-9234-123456789abc",
      status: "sent",
      contactChannel: "website",
      contactTarget: "https://example.com/",
      inquiryMessage: "문의",
      providerDeliveryStatus: "not_integrated",
      userReportedSentAt: "2099-07-01T00:00:00.000Z",
      userReportedReplyAt: null,
      userReportedOutcome: null,
      revision: 2,
      updatedAt: "2099-07-01T00:00:00.000Z",
    },
  }), BOOKING_ID);
  assert.deepEqual(buildVendorInquiryMutationBody(parsed?.handoff ?? null, "record_reply", {
    userReportedOutcome: "available",
  }), {
    action: "record_reply",
    userReportedOutcome: "available",
    expectedRevision: 2,
  });
  assert.equal(buildVendorInquiryMutationBody(null, "mark_sent"), null);
});

test("a user-reported vendor reply continues as a private owner-bound Amora draft", () => {
  const ownerUserId = "42345678-1234-4234-9234-123456789abc";
  const coupleId = "72345678-1234-4234-9234-123456789abc";
  const handoffId = "52345678-1234-4234-9234-123456789abc";
  const parsed = parseVendorInquiryHandoffResponse(response({
    handoff: {
      id: "32345678-1234-4234-9234-123456789abc",
      status: "replied",
      contactChannel: "website",
      contactTarget: "https://example.com/",
      inquiryMessage: "문의",
      providerDeliveryStatus: "not_integrated",
      userReportedSentAt: "2099-07-01T00:00:00.000Z",
      userReportedReplyAt: "2099-07-02T00:00:00.000Z",
      userReportedOutcome: "available",
      revision: 3,
      updatedAt: "2099-07-02T00:00:00.000Z",
    },
  }), BOOKING_ID);
  const prompt = buildVendorInquiryDecisionPrompt(parsed);

  assert.match(prompt ?? "", /테스트 스튜디오/);
  assert.match(prompt ?? "", /기본 촬영/);
  assert.match(prompt ?? "", /사용자가 직접 기록한 답변 결과: 가능/);
  assert.match(prompt ?? "", /업체 시스템 확인이 아님/);
  assert.match(prompt ?? "", /확인하기 전에는 저장하거나 공유하지/);
  assert.doesNotMatch(prompt ?? "", /아모라가 보냈|업체가 확정/);

  assert.equal(stagePrivateChatHandoff({
    handoffId,
    ownerUserId,
    coupleId,
    prompt,
  }), handoffId);
  assert.equal(
    consumeCompanionChatHandoff(
      handoffId,
      "62345678-1234-4234-9234-123456789abc",
      coupleId,
    ),
    null,
  );
  assert.equal(consumeCompanionChatHandoff(handoffId, ownerUserId, coupleId), null);

  stagePrivateChatHandoff({ handoffId, ownerUserId, coupleId, prompt });
  assert.equal(
    consumeCompanionChatHandoff(handoffId, ownerUserId, coupleId)?.prompt,
    prompt,
  );
  assert.equal(consumeCompanionChatHandoff(handoffId, ownerUserId, coupleId), null);
});

test("booking detail exposes the reply-to-private-Amora handoff without auto-sending", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new globalThis.URL("../../app/bookings/index.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /inquiry\.handoff\.status === "replied"/);
  assert.match(source, /buildVendorInquiryDecisionPrompt\(inquiry\)/);
  assert.match(source, /stagePrivateChatHandoff/);
  assert.match(source, /coupleId: expectedIdentity\.coupleId/);
  assert.match(source, /params: \{ companionHandoff \}/);
  assert.match(source, /아모라와 다음 결정 정리/);
  assert.doesNotMatch(
    source,
    /buildVendorInquiryDecisionPrompt[\s\S]{0,1200}(?:handleSend|requestChatStream)\(/,
  );
});
