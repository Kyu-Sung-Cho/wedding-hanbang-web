// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDS,
  createFakeClient,
  fail,
  jsonRequest,
  ok,
  type FakeClient,
  type QueryResult,
  type TableHandler,
} from "@/lib/invitation/__tests__/fakeSupabase";

const mocks = vi.hoisted(() => ({
  service: null as unknown,
  admin: null as unknown,
  verify: vi.fn(),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verify,
  getServiceClient: vi.fn(() => mocks.service),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => mocks.admin) }));

import { GET as listHalls, POST as createHall } from "../admin/halls/route";
import { PATCH as updateHall } from "../admin/halls/[hallId]/route";
import { GET as listQueue } from "../admin/inquiries/route";
import { POST as markSent } from "../admin/inquiries/[dispatchId]/sent/route";
import { POST as recordReply } from "../admin/inquiries/[dispatchId]/replies/route";

const URL_BASE = "http://localhost/api/invitation/admin";
const OPERATOR = "44444444-4444-4444-8444-444444444444";

const HALL = {
  name: "소담 하우스", region: "서울", areaLabel: "마포구 하우스웨딩", kindLabel: "하우스웨딩", mealPriceWon: 68_000,
  rentalIncluded: true, rentalFeeWon: null, minimumGuarantee: 180, stationWalkMinutes: 8, transitNote: null,
  photoUrl: null, sourceUrl: "https://example.com/price", checkedOn: "2026-11-14", active: false,
};

function useService(tables: Record<string, TableHandler>): FakeClient {
  const client = createFakeClient({ tables });
  mocks.service = client;
  return client;
}

function useAdmin(rpc: (name: string, args: Record<string, unknown>) => QueryResult): FakeClient {
  const admin = createFakeClient({ rpc });
  mocks.admin = admin;
  return admin;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue({ authorized: true, userId: OPERATOR });
  delete process.env.HALL_INQUIRY_SENDING_ENABLED;
});
afterEach(() => {
  delete process.env.HALL_INQUIRY_SENDING_ENABLED;
});

describe("admin hall listings", () => {
  it("is closed to non-admins", async () => {
    mocks.verify.mockResolvedValue({ authorized: false });
    const service = useService({ hall_listings: ok([]) });
    expect((await listHalls(jsonRequest(`${URL_BASE}/halls`, "GET"))).status).toBe(401);
    expect((await createHall(jsonRequest(`${URL_BASE}/halls`, "POST", HALL))).status).toBe(401);
    expect(service.calls).toEqual([]);
  });

  it.each([
    [{ ...HALL, sourceUrl: "http://example.com" }],
    [{ ...HALL, rentalIncluded: true, rentalFeeWon: 3_000_000 }],
    [{ ...HALL, rentalIncluded: false, rentalFeeWon: null }],
    [{ ...HALL, checkedOn: "2099-01-01" }],
    [{ ...HALL, name: "숨은​이름" }],
    [{ ...HALL, mealPriceWon: 500 }],
    [{ ...HALL, score: 5 }],
    [{ ...HALL, region: "서울특별시" }],
    [{ ...HALL, region: "마포구" }],
  ])("refuses %j", async (body) => {
    const service = useService({ hall_listings: ok({ id: IDS.hallA }) });
    expect((await createHall(jsonRequest(`${URL_BASE}/halls`, "POST", body))).status).toBe(400);
    expect(service.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("creates a hidden listing with the operator recorded", async () => {
    const service = useService({ hall_listings: ok({ id: IDS.hallA }) });
    const response = await createHall(jsonRequest(`${URL_BASE}/halls`, "POST", HALL));
    expect(response.status).toBe(201);
    const insert = service.calls.find((call) => call.method === "insert");
    expect(insert?.args[0]).toMatchObject({
      name: "소담 하우스", region: "서울", area_label: "마포구 하우스웨딩", meal_price_won: 68_000, rental_included: true,
      rental_fee_won: null, source_url: "https://example.com/price", checked_on: "2026-11-14", active: false,
      created_by: OPERATOR, updated_by: OPERATOR,
    });
  });

  it("updates only the sent fields and keeps the rental rule across the stored row", async () => {
    const service = useService({ hall_listings: ok({ rental_included: true, rental_fee_won: null, checked_on: "2026-11-14" }) });
    const params = { params: Promise.resolve({ hallId: IDS.hallA }) };
    expect((await updateHall(jsonRequest(`${URL_BASE}/halls/${IDS.hallA}`, "PATCH", { rentalFeeWon: 1_000_000 }), params)).status).toBe(400);
    const response = await updateHall(jsonRequest(`${URL_BASE}/halls/${IDS.hallA}`, "PATCH", { active: true }), { params: Promise.resolve({ hallId: IDS.hallA }) });
    expect(response.status).toBe(200);
    const update = service.calls.find((call) => call.method === "update");
    expect(update?.args[0]).toMatchObject({ active: true, updated_by: OPERATOR });
    expect(Object.keys(update?.args[0] as object)).not.toContain("name");
  });
});

describe("admin inquiry queue (W4 pilot)", () => {
  const queued = { id: IDS.dispatchA, couple_id: IDS.couple, letter_id: IDS.letter, version_id: IDS.version, hall_id: IDS.hallA, recipient_name: "소담 하우스", status: "queued", queued_at: "2026-11-17T00:00:00Z", sent_at: null };
  const version = {
    id: IDS.version, body: "상담받고 싶습니다.", signature: "민지와 준호 드림",
    shares: { name: { on: true, value: "김민지" }, phone: { on: false, value: null }, budget: { on: false, value: null } },
  };
  const queueTables = (): Record<string, TableHandler> => ({
    hall_inquiry_dispatches: (calls) => (calls.some((call) => call.method === "eq" && call.args[1] === "queued") ? ok([queued]) : ok([])),
    hall_inquiry_letter_versions: ok([version]),
    hall_listings: ok([{ id: IDS.hallA, source_url: "https://example.com/contact" }]),
    hall_inquiry_replies: ok([]),
  });

  it("hides letters and shared fields while the inquiry switch is off", async () => {
    const service = useService(queueTables());
    const body = await (await listQueue(jsonRequest(`${URL_BASE}/inquiries`, "GET"))).json();
    // 서비스 전체 상한은 값이 없으면 0 이고 설정을 확인하라고 알린다(닫힌 채 실패).
    expect(body).toMatchObject({ sendingEnabled: false, dailyCap: 5, globalDailyCap: 0, globalDailyCapMisconfigured: true });
    expect(body.queued[0]).toMatchObject({ recipientName: "소담 하우스", coupleRef: IDS.couple.slice(0, 8), letter: null });
    expect(JSON.stringify(body)).not.toContain("김민지");
    expect(service.calls.some((call) => call.table === "hall_inquiry_letter_versions")).toBe(false);
  });

  it("shows only shared fields that the couple switched on once sending is on", async () => {
    process.env.HALL_INQUIRY_SENDING_ENABLED = "true";
    useService(queueTables());
    const body = await (await listQueue(jsonRequest(`${URL_BASE}/inquiries`, "GET"))).json();
    expect(body.queued[0].letter).toEqual({
      body: "상담받고 싶습니다.", signature: "민지와 준호 드림", shares: { name: "김민지", phone: null, budget: null },
    });
    expect(body.queued[0].sourceUrl).toBe("https://example.com/contact");
  });

  it("closes sent rows whose letter was erased by an account deletion and maps the refusal", async () => {
    const sent = { ...queued, status: "sent", sent_at: "2026-11-17T01:00:00Z", channel_note: null };
    useService({
      ...queueTables(),
      hall_inquiry_dispatches: (calls) => (calls.some((call) => call.method === "eq" && call.args[1] === "sent")
        ? ok([{ ...sent, redacted_at: "2026-11-17T02:00:00Z" }, { ...sent, id: IDS.dispatchB, redacted_at: null }])
        : ok([])),
    });
    const body = await (await listQueue(jsonRequest(`${URL_BASE}/inquiries`, "GET"))).json();
    expect(body.sent.map((row: { dispatchId: string; closed: boolean }) => [row.dispatchId, row.closed]))
      .toEqual([[IDS.dispatchA, true], [IDS.dispatchB, false]]);

    useAdmin(() => fail("55000", "HALL_INQUIRY_DISPATCH_WITHDRAWN"));
    const refused = await markSent(jsonRequest(`${URL_BASE}/inquiries/${IDS.dispatchA}/sent`, "POST", {}), { params: Promise.resolve({ dispatchId: IDS.dispatchA }) });
    expect(refused.status).toBe(409);
    await expect(refused.json()).resolves.toMatchObject({ code: "DISPATCH_WITHDRAWN" });
  });

  it("marks a dispatch sent through the service function with the operator id", async () => {
    const admin = useAdmin(() => ok({ alreadySent: false, sentAt: "2026-11-17T01:00:00Z" }));
    const response = await markSent(jsonRequest(`${URL_BASE}/inquiries/${IDS.dispatchA}/sent`, "POST", { channelNote: "공식 홈페이지 문의 양식" }), { params: Promise.resolve({ dispatchId: IDS.dispatchA }) });
    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("hall_inquiry_mark_sent", {
      p_dispatch_id: IDS.dispatchA, p_operator_user_id: OPERATOR, p_channel_note: "공식 홈페이지 문의 양식",
    });
  });

  it("validates replies and maps an unsent dispatch to a conflict", async () => {
    const params = { params: Promise.resolve({ dispatchId: IDS.dispatchA }) };
    const admin = useAdmin(() => fail("55000", "HALL_INQUIRY_REPLY_BEFORE_SENT"));
    for (const bad of [
      { rawText: "가능합니다", outcome: "confirmed_time" },
      { rawText: "가능합니다", outcome: "declined", eventAt: "2026-11-22T11:00:00+09:00" },
      { rawText: "", outcome: "question" },
      { rawText: "가능합니다", outcome: "booked" },
      { rawText: "가능합니다", outcome: "question", extra: 1 },
    ]) {
      expect((await recordReply(jsonRequest(`${URL_BASE}/inquiries/${IDS.dispatchA}/replies`, "POST", bad), params)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(admin.rpc).not.toHaveBeenCalled();
    const conflict = await recordReply(
      jsonRequest(`${URL_BASE}/inquiries/${IDS.dispatchA}/replies`, "POST", { rawText: "가능합니다", outcome: "confirmed_time", eventAt: new Date(Date.now() + 86_400_000).toISOString() }),
      { params: Promise.resolve({ dispatchId: IDS.dispatchA }) },
    );
    expect(conflict.status).toBe(409);
  });

  it("records a confirmed reply with the time in UTC", async () => {
    const admin = useAdmin(() => ok({ replyId: IDS.replyA, created: true }));
    const when = new Date(Date.now() + 5 * 86_400_000);
    when.setUTCSeconds(0, 0);
    const response = await recordReply(
      jsonRequest(`${URL_BASE}/inquiries/${IDS.dispatchA}/replies`, "POST", { rawText: " 가능합니다 \r\n감사합니다 ", outcome: "confirmed_time", eventAt: when.toISOString(), placeNote: "2층 상담실" }),
      { params: Promise.resolve({ dispatchId: IDS.dispatchA }) },
    );
    expect(response.status).toBe(201);
    expect(admin.rpc).toHaveBeenCalledWith("hall_inquiry_record_reply", {
      p_dispatch_id: IDS.dispatchA, p_operator_user_id: OPERATOR, p_raw_text: "가능합니다 \n감사합니다", p_outcome: "confirmed_time",
      p_event_at: when.toISOString(), p_place_note: "2층 상담실", p_price_note: null,
    });
  });

  it("is closed to non-admins for every operator action", async () => {
    mocks.verify.mockResolvedValue({ authorized: false });
    const admin = useAdmin(() => ok(null));
    useService(queueTables());
    expect((await listQueue(jsonRequest(`${URL_BASE}/inquiries`, "GET"))).status).toBe(401);
    expect((await markSent(jsonRequest(`${URL_BASE}/inquiries/${IDS.dispatchA}/sent`, "POST", {}), { params: Promise.resolve({ dispatchId: IDS.dispatchA }) })).status).toBe(401);
    expect((await recordReply(jsonRequest(`${URL_BASE}/inquiries/${IDS.dispatchA}/replies`, "POST", { rawText: "x", outcome: "question" }), { params: Promise.resolve({ dispatchId: IDS.dispatchA }) })).status).toBe(401);
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});
