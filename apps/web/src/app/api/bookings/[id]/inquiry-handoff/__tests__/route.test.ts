import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { GET, PATCH } from "../route";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "booking:inquiry-handoff:user-1"),
}));

const BOOKING_ID = "12345678-1234-4234-9234-123456789abc";
const VENDOR_ID = "22345678-1234-4234-9234-123456789abc";
const HANDOFF_ID = "32345678-1234-4234-9234-123456789abc";
const USER_ID = "42345678-1234-4234-9234-123456789abc";

function mockAuthClient(userId = USER_ID) {
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
  } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
}

function atomicResult(overrides: Record<string, unknown> = {}) {
  return {
    accepted: true,
    bookingId: BOOKING_ID,
    bookingStatus: "pending",
    vendorId: VENDOR_ID,
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
    suggestedInquiryMessage:
      "안녕하세요. 테스트 스튜디오 상담 가능 여부를 문의드립니다.\n희망 일시: 2099-07-20 10:00",
    providerDeliveryStatus: "not_integrated",
    handoff: null,
    ...overrides,
  };
}

function mockAdmin(data = atomicResult(), error: unknown = null) {
  const admin = {
    rpc: vi.fn().mockResolvedValue({ data, error }),
  };
  vi.mocked(createAdminClient).mockReturnValue(
    admin as unknown as ReturnType<typeof createAdminClient>,
  );
  return admin;
}

function context(id = BOOKING_ID) {
  return { params: Promise.resolve({ id }) };
}

function mutationHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Hanbang-Mutation-Contract-Version": "2",
    "X-Hanbang-Expected-Actor-User-Id": USER_ID,
  };
}

describe("/api/bookings/[id]/inquiry-handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
    mockAuthClient();
  });

  it("requires the current mutation actor contract for a complete write", async () => {
    const admin = mockAdmin();

    const response = await PATCH(
      new Request(`http://localhost/api/bookings/${BOOKING_ID}/inquiry-handoff`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "prepare",
          contactChannel: "website",
          expectedRevision: 0,
        }),
      }),
      context(),
    );

    expect(response.status).toBe(426);
    expect(await response.json()).toMatchObject({ code: "CLIENT_UPDATE_REQUIRED" });
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("rejects a write captured by a different account before the service RPC", async () => {
    const admin = mockAdmin();
    const headers = mutationHeaders();
    headers["X-Hanbang-Expected-Actor-User-Id"] =
      "52345678-1234-4234-9234-123456789abc";

    const response = await PATCH(
      new Request(`http://localhost/api/bookings/${BOOKING_ID}/inquiry-handoff`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          action: "prepare",
          contactChannel: "website",
          expectedRevision: 0,
        }),
      }),
      context(),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "MUTATION_ACTOR_CHANGED" });
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("requires a captured expectedRevision for every mutation", async () => {
    const admin = mockAdmin();

    const response = await PATCH(
      new Request(`http://localhost/api/bookings/${BOOKING_ID}/inquiry-handoff`, {
        method: "PATCH",
        headers: mutationHeaders(),
        body: JSON.stringify({ action: "prepare", contactChannel: "website" }),
      }),
      context(),
    );

    expect(response.status).toBe(400);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("rejects an oversized streamed mutation body without Content-Length", async () => {
    const admin = mockAdmin();
    const encoder = new TextEncoder();
    const chunks = [
      JSON.stringify({
        action: "prepare",
        contactChannel: "website",
        expectedRevision: 0,
        padding: "x".repeat(5 * 1024),
      }),
    ];
    let index = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index];
        index += 1;
        if (chunk === undefined) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(chunk));
      },
    });
    const request = new Request(
      `http://localhost/api/bookings/${BOOKING_ID}/inquiry-handoff`,
      {
        method: "PATCH",
        headers: mutationHeaders(),
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    );
    expect(request.headers.get("content-length")).toBeNull();

    const response = await PATCH(request, context());

    expect(response.status).toBe(413);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("accepts a valid streamed mutation body exactly at the byte limit", async () => {
    const admin = mockAdmin(atomicResult({
      handoff: {
        id: HANDOFF_ID,
        status: "prepared",
        contactChannel: "website",
        contactTarget: "https://example.com/",
        inquiryMessage: "문의 초안",
        providerDeliveryStatus: "not_integrated",
        userReportedSentAt: null,
        userReportedReplyAt: null,
        userReportedOutcome: null,
        revision: 1,
        updatedAt: "2099-07-01T00:00:00.000Z",
      },
    }));
    const encoder = new TextEncoder();
    const base = JSON.stringify({
      action: "prepare",
      contactChannel: "website",
      expectedRevision: 0,
      padding: "",
    });
    const exactBody = JSON.stringify({
      action: "prepare",
      contactChannel: "website",
      expectedRevision: 0,
      padding: "x".repeat(4 * 1024 - encoder.encode(base).byteLength),
    });
    expect(encoder.encode(exactBody).byteLength).toBe(4 * 1024);
    let emitted = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted) {
          controller.close();
          return;
        }
        emitted = true;
        controller.enqueue(encoder.encode(exactBody));
      },
    });

    const response = await PATCH(
      new Request(`http://localhost/api/bookings/${BOOKING_ID}/inquiry-handoff`, {
        method: "PATCH",
        headers: mutationHeaders(),
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledOnce();
  });

  it("returns a deterministic 409 when a different write already won the revision", async () => {
    const winner = atomicResult({
      handoff: {
        id: HANDOFF_ID,
        status: "replied",
        contactChannel: "website",
        contactTarget: "https://example.com/",
        inquiryMessage: "문의 초안",
        providerDeliveryStatus: "not_integrated",
        userReportedSentAt: "2099-07-01T00:00:00.000Z",
        userReportedReplyAt: "2099-07-02T00:00:00.000Z",
        userReportedOutcome: "available",
        revision: 3,
        updatedAt: "2099-07-02T00:00:00.000Z",
      },
    });
    const admin = mockAdmin();
    admin.rpc
      .mockResolvedValueOnce({ data: winner, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "VENDOR_INQUIRY_HANDOFF_REVISION_CONFLICT" },
      });

    const mutate = (userReportedOutcome: "available" | "unavailable") => PATCH(
      new Request(`http://localhost/api/bookings/${BOOKING_ID}/inquiry-handoff`, {
        method: "PATCH",
        headers: mutationHeaders(),
        body: JSON.stringify({ action: "record_reply", userReportedOutcome, expectedRevision: 2 }),
      }),
      context(),
    );
    const responses = await Promise.all([mutate("available"), mutate("unavailable")]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const accepted = responses.find((response) => response.status === 200);
    const conflicted = responses.find((response) => response.status === 409);
    expect(await accepted?.json()).toMatchObject({
      handoff: { revision: 3, userReportedOutcome: "available" },
    });
    expect(await conflicted?.json()).toMatchObject({
      code: "VENDOR_INQUIRY_HANDOFF_REVISION_CONFLICT",
    });
  });

  it("returns an owned booking's direct-contact context without creating or sending anything", async () => {
    const admin = mockAdmin();

    const response = await GET(
      new Request(`http://localhost/api/bookings/${BOOKING_ID}/inquiry-handoff`),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      accepted: true,
      bookingId: BOOKING_ID,
      vendorName: "테스트 스튜디오",
      contactOptions: [
        { channel: "website", target: "https://example.com/" },
        { channel: "instagram", target: "https://www.instagram.com/hanbangstudio/" },
        { channel: "naver_place", target: "https://m.place.naver.com/place/123" },
      ],
      providerDeliveryStatus: "not_integrated",
      handoff: null,
    });
    expect(admin.rpc).toHaveBeenCalledWith(
      "resolve_vendor_inquiry_handoff_atomic",
      {
        p_booking_id: BOOKING_ID,
        p_actor_profile_id: USER_ID,
        p_action: "inspect",
        p_expected_revision: null,
        p_contact_channel: null,
        p_user_reported_outcome: null,
      },
    );
  });

  it("persists a prepared handoff only after a trusted explicit prepare action", async () => {
    const admin = mockAdmin(atomicResult({
      handoff: {
        id: HANDOFF_ID,
        status: "prepared",
        contactChannel: "website",
        contactTarget: "https://example.com/",
        inquiryMessage: "문의 초안",
        providerDeliveryStatus: "not_integrated",
        userReportedSentAt: null,
        userReportedReplyAt: null,
        userReportedOutcome: null,
        revision: 1,
        updatedAt: "2099-07-01T00:00:00.000Z",
      },
    }));

    const response = await PATCH(
      new Request(`http://localhost/api/bookings/${BOOKING_ID}/inquiry-handoff`, {
        method: "PATCH",
        headers: mutationHeaders(),
        body: JSON.stringify({
          action: "prepare",
          contactChannel: "website",
          expectedRevision: 0,
        }),
      }),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.handoff).toMatchObject({
      status: "prepared",
      providerDeliveryStatus: "not_integrated",
      userReportedSentAt: null,
    });
    expect(admin.rpc).toHaveBeenCalledWith(
      "resolve_vendor_inquiry_handoff_atomic",
      {
        p_booking_id: BOOKING_ID,
        p_actor_profile_id: USER_ID,
        p_action: "prepare",
        p_expected_revision: 0,
        p_contact_channel: "website",
        p_user_reported_outcome: null,
      },
    );
  });

  it("stores only explicit user-reported sent and reply states while provider delivery stays unintegrated", async () => {
    const sentAt = "2099-07-01T00:00:00.000Z";
    const admin = mockAdmin(atomicResult({
      handoff: {
        id: HANDOFF_ID,
        status: "sent",
        contactChannel: "instagram",
        contactTarget: "https://www.instagram.com/hanbangstudio/",
        inquiryMessage: "문의 초안",
        providerDeliveryStatus: "not_integrated",
        userReportedSentAt: sentAt,
        userReportedReplyAt: null,
        userReportedOutcome: null,
        revision: 2,
        updatedAt: sentAt,
      },
    }));

    const sentResponse = await PATCH(
      new Request(`http://localhost/api/bookings/${BOOKING_ID}/inquiry-handoff`, {
        method: "PATCH",
        headers: mutationHeaders(),
        body: JSON.stringify({ action: "mark_sent", expectedRevision: 1 }),
      }),
      context(),
    );
    expect(sentResponse.status).toBe(200);
    expect(await sentResponse.json()).toMatchObject({
      providerDeliveryStatus: "not_integrated",
      handoff: {
        status: "sent",
        userReportedSentAt: sentAt,
        userReportedOutcome: null,
      },
    });
    expect(admin.rpc).toHaveBeenLastCalledWith(
      "resolve_vendor_inquiry_handoff_atomic",
      expect.objectContaining({
        p_action: "mark_sent",
        p_expected_revision: 1,
        p_contact_channel: null,
        p_user_reported_outcome: null,
      }),
    );

    admin.rpc.mockResolvedValueOnce({
      data: atomicResult({
        handoff: {
          id: HANDOFF_ID,
          status: "replied",
          contactChannel: "instagram",
          contactTarget: "https://www.instagram.com/hanbangstudio/",
          inquiryMessage: "문의 초안",
          providerDeliveryStatus: "not_integrated",
          userReportedSentAt: sentAt,
          userReportedReplyAt: "2099-07-02T00:00:00.000Z",
          userReportedOutcome: "available",
          revision: 3,
          updatedAt: "2099-07-02T00:00:00.000Z",
        },
      }),
      error: null,
    });
    const replyResponse = await PATCH(
      new Request(`http://localhost/api/bookings/${BOOKING_ID}/inquiry-handoff`, {
        method: "PATCH",
        headers: mutationHeaders(),
        body: JSON.stringify({
          action: "record_reply",
          expectedRevision: 2,
          userReportedOutcome: "available",
        }),
      }),
      context(),
    );
    expect(replyResponse.status).toBe(200);
    expect(await replyResponse.json()).toMatchObject({
      providerDeliveryStatus: "not_integrated",
      handoff: { status: "replied", userReportedOutcome: "available" },
    });
    expect(admin.rpc).toHaveBeenLastCalledWith(
      "resolve_vendor_inquiry_handoff_atomic",
      expect.objectContaining({
        p_action: "record_reply",
        p_expected_revision: 2,
        p_user_reported_outcome: "available",
      }),
    );
  });

  it("fails closed on cross-site mutations and malformed provider-like responses", async () => {
    vi.mocked(isTrustedMutationRequest).mockReturnValueOnce(false);
    const untrusted = await PATCH(
      new Request(`http://localhost/api/bookings/${BOOKING_ID}/inquiry-handoff`, {
        method: "PATCH",
        body: JSON.stringify({ action: "mark_sent" }),
      }),
      context(),
    );
    expect(untrusted.status).toBe(403);
    expect(createClientFromRequest).not.toHaveBeenCalled();

    mockAdmin(atomicResult({ providerDeliveryStatus: "delivered" }));
    const malformed = await GET(
      new Request(`http://localhost/api/bookings/${BOOKING_ID}/inquiry-handoff`),
      context(),
    );
    expect(malformed.status).toBe(503);
    expect((await malformed.json()).error).toContain("중복 기록되지 않습니다");
  });
});
