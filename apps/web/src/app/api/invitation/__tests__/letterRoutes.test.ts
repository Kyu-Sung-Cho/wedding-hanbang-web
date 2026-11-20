// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FINGERPRINT,
  IDS,
  coupleTables,
  createFakeClient,
  fail,
  jsonRequest,
  listingRow,
  ok,
  type FakeClient,
  type QueryResult,
} from "@/lib/invitation/__tests__/fakeSupabase";

const mocks = vi.hoisted(() => ({ client: null as unknown, admin: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn(async () => mocks.client) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => mocks.admin) }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "invitation:test"),
}));

import { GET as getLetter, PUT as putLetter } from "../letter/route";
import { POST as approve } from "../letter/approve/route";

const URL_BASE = "http://localhost/api/invitation";
const CONDITIONS = { hopedYear: 2027, hopedMonth: 5, region: "서울", guestCount: 200, timeLabel: "토요일 낮", startStage: "start" };
const OFF = { on: false, value: null };

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: IDS.version,
    letter_id: IDS.letter,
    version: 1,
    recipient_hall_ids: [IDS.hallA, IDS.hallB],
    recipient_names: ["소담 하우스", "가온 웨딩홀"],
    body: "2027년 5월 토요일 낮에 예식을 생각하고 있는 커플입니다.",
    signature: "결혼을 준비하는 두 사람 드림",
    shares: { name: OFF, phone: { on: true, value: "010-1234-5678" }, budget: OFF },
    fingerprint: FINGERPRINT,
    created_at: "2026-11-15T01:00:00Z",
    approval_completed_at: null,
    queued_at: null,
    ...overrides,
  };
}

function tables(options: { open?: boolean; approvals?: unknown[]; settings?: unknown; version?: Record<string, unknown> } = {}) {
  return {
    ...coupleTables({ progress: { __invitationConditions: CONDITIONS }, totalBudget: 30_000_000 }),
    hall_inquiry_settings: ok(options.settings ?? null),
    hall_inquiry_letters: ok(options.open ? { id: IDS.letter, created_at: "2026-11-15T01:00:00Z" } : null),
    hall_inquiry_letter_versions: ok(versionRow(options.version)),
    hall_inquiry_approvals: ok(options.approvals ?? []),
    hall_inquiry_dispatches: ok([]),
    hall_inquiry_replies: ok([]),
    hall_shortlists: ok([
      { hall_id: IDS.hallA, created_at: "2026-11-16T00:00:00Z" },
      { hall_id: IDS.hallB, created_at: "2026-11-16T00:01:00Z" },
    ]),
    hall_listings: ok([
      listingRow(IDS.hallA, "소담 하우스", { photo_url: "https://example.com/sodam.jpg" }),
      listingRow(IDS.hallB, "가온 웨딩홀"),
    ]),
  };
}

function useClient(t: Record<string, unknown>, user: { id: string } | null = { id: IDS.bride }): FakeClient {
  const client = createFakeClient({ user, tables: t as never });
  mocks.client = client;
  return client;
}

function useAdmin(rpc: (name: string, args: Record<string, unknown>) => QueryResult): FakeClient {
  const admin = createFakeClient({ rpc });
  mocks.admin = admin;
  return admin;
}

const shares = (overrides: Record<string, unknown> = {}) => ({ name: { on: false }, phone: { on: false }, budget: { on: false }, ...overrides });

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.HALL_INQUIRY_SENDING_ENABLED;
  delete process.env.HALL_INQUIRY_DAILY_CAP;
  delete process.env.HALL_INQUIRY_GLOBAL_DAILY_CAP;
});
afterEach(() => {
  delete process.env.HALL_INQUIRY_SENDING_ENABLED;
  delete process.env.HALL_INQUIRY_DAILY_CAP;
  delete process.env.HALL_INQUIRY_GLOBAL_DAILY_CAP;
});

describe("letter GET", () => {
  it("requires sign-in and couple membership", async () => {
    useClient(tables(), null);
    expect((await getLetter(jsonRequest(`${URL_BASE}/letter`, "GET"))).status).toBe(401);
    // RLS 가 다른 커플 줄을 보여 주지 않는 경우.
    useClient({ ...tables(), couples: ok(null) });
    expect((await getLetter(jsonRequest(`${URL_BASE}/letter`, "GET"))).status).toBe(403);
  });

  it("drafts an unsaved letter from stored conditions and picked halls with every share off", async () => {
    useClient(tables());
    const response = await getLetter(jsonRequest(`${URL_BASE}/letter`, "GET"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.letter).toMatchObject({
      recipients: ["소담 하우스", "가온 웨딩홀"],
      body: "2027년 5월 토요일 낮에 예식을 생각하고 있는 커플입니다. 하객은 200명 정도예요. 상담 가능한 시간을 알려 주시면 두 사람이 맞춰 가겠습니다.",
      signature: "결혼을 준비하는 두 사람 드림",
      partnerApprovedName: null,
      backdropPhoto: "https://example.com/sodam.jpg",
    });
    expect(body.letter.shares).toEqual([
      { key: "name", label: "이름", value: "민지", on: false },
      { key: "phone", label: "휴대폰 번호", value: "", on: false },
      { key: "budget", label: "예산", value: "3,000만 원이라고 알려요", on: false },
    ]);
    expect(body.state).toMatchObject({ versionId: null, fingerprint: null, status: "draft", sendingEnabled: false });
    expect(body.missing).toEqual([]);
  });

  it("shows the saved version with a masked phone and the partner's approval", async () => {
    useClient(tables({ open: true, settings: { approver_mode: "both", designated_user_id: null, revision: 1 }, approvals: [{ approver_user_id: IDS.groom, settings_revision: 1, fingerprint: FINGERPRINT, sending_enabled: false }] }));
    const body = await (await getLetter(jsonRequest(`${URL_BASE}/letter`, "GET"))).json();
    expect(body.letter.shares[1]).toEqual({ key: "phone", label: "휴대폰 번호", value: "010-****-5678", on: true });
    expect(JSON.stringify(body)).not.toContain("1234");
    expect(body.letter.partnerApprovedName).toBe("준호");
    expect(body.state).toMatchObject({ status: "awaiting_approval", waitingFor: [IDS.bride], versionId: IDS.version, fingerprint: FINGERPRINT });
  });

  it("leaves halls that were already contacted out of a new draft", async () => {
    useClient({
      ...tables(),
      hall_inquiry_dispatches: ok([{ id: IDS.dispatchA, letter_id: IDS.letter, version_id: IDS.version, hall_id: IDS.hallA, recipient_name: "소담 하우스", status: "sent", queued_at: "2026-11-16T00:00:00Z", sent_at: "2026-11-16T01:00:00Z" }]),
      hall_inquiry_letter_versions: ok([]),
    });
    const body = await (await getLetter(jsonRequest(`${URL_BASE}/letter`, "GET"))).json();
    expect(body.letter.recipients).toEqual(["가온 웨딩홀"]);
    expect(body.state.recipients).toEqual([{ hallId: IDS.hallB, name: "가온 웨딩홀" }]);
  });

  it("asks for a shortlist when nothing is picked", async () => {
    useClient({ ...tables(), hall_shortlists: ok([]) });
    const body = await (await getLetter(jsonRequest(`${URL_BASE}/letter`, "GET"))).json();
    expect(body).toMatchObject({ letter: null, state: null, missing: ["shortlist"] });
  });
});

describe("letter PUT (versions)", () => {
  it("refuses untrusted origins and invalid bodies before saving", async () => {
    useClient(tables());
    const admin = useAdmin(() => ok(null));
    const valid = { recipientHallIds: [IDS.hallA], body: "본문", shares: shares() };
    expect((await putLetter(jsonRequest(`${URL_BASE}/letter`, "PUT", valid, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    for (const body of [
      { ...valid, recipientHallIds: [] },
      { ...valid, body: "‮" },
      { ...valid, shares: shares({ phone: { on: true } }) },
      { ...valid, shares: shares({ phone: { on: true, value: "02-123-4567" } }) },
      { ...valid, extra: 1 },
    ]) {
      expect((await putLetter(jsonRequest(`${URL_BASE}/letter`, "PUT", body))).status, JSON.stringify(body)).toBe(400);
    }
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("saves exactly the displayed content with server-made signature and budget, and reports the new version", async () => {
    useClient(tables({ open: true }));
    const admin = useAdmin(() => ok({ letterId: IDS.letter, versionId: IDS.version, version: 2, fingerprint: "b".repeat(64), created: true }));
    const response = await putLetter(jsonRequest(`${URL_BASE}/letter`, "PUT", {
      letterId: IDS.letter,
      recipientHallIds: [IDS.hallA, IDS.hallB],
      body: "  고친 글이에요.\r\n두 사람이 함께 갈게요.  ",
      shares: shares({ name: { on: true, value: "김민지" }, phone: { on: true }, budget: { on: true } }),
    }));
    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("hall_inquiry_save_letter_version", {
      p_couple_id: IDS.couple,
      p_actor_user_id: IDS.bride,
      p_letter_id: IDS.letter,
      p_recipient_hall_ids: [IDS.hallA, IDS.hallB],
      p_body: "고친 글이에요.\n두 사람이 함께 갈게요.",
      p_signature: "민지와 준호 드림",
      p_shares: {
        name: { on: true, value: "김민지" },
        phone: { on: true, value: "010-1234-5678" },
        budget: { on: true, value: "3,000만 원" },
      },
    });
    await expect(response.json()).resolves.toMatchObject({ saved: { version: 2, created: true } });
  });

  it("keeps no values for switched-off shares", async () => {
    useClient(tables({ open: true }));
    const admin = useAdmin(() => ok({ letterId: IDS.letter, versionId: IDS.version, version: 3, fingerprint: "c".repeat(64), created: true }));
    await putLetter(jsonRequest(`${URL_BASE}/letter`, "PUT", {
      recipientHallIds: [IDS.hallA], body: "본문", shares: shares({ name: { on: false, value: "김민지" } }),
    }));
    expect((admin.rpc.mock.calls[0][1] as { p_shares: unknown }).p_shares).toEqual({ name: OFF, phone: OFF, budget: OFF });
    expect((admin.rpc.mock.calls[0][1] as { p_signature: unknown }).p_signature).toBe("결혼을 준비하는 두 사람 드림");
  });

  it("refuses editing a letter that is no longer open", async () => {
    useClient(tables({ open: false }));
    const admin = useAdmin(() => ok(null));
    const response = await putLetter(jsonRequest(`${URL_BASE}/letter`, "PUT", { letterId: IDS.letter, recipientHallIds: [IDS.hallA], body: "본문", shares: shares() }));
    expect(response.status).toBe(409);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("maps a locked letter from the database to a conflict", async () => {
    useClient(tables({ open: true }));
    useAdmin(() => fail("55000", "HALL_INQUIRY_LETTER_LOCKED"));
    const response = await putLetter(jsonRequest(`${URL_BASE}/letter`, "PUT", { recipientHallIds: [IDS.hallA], body: "본문", shares: shares() }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "LETTER_LOCKED" });
  });
});

describe("letter approve (WS1, WS2, WS5)", () => {
  const body = { versionId: IDS.version, fingerprint: FINGERPRINT };

  it("validates the bound version and fingerprint at the boundary", async () => {
    useClient(tables({ open: true }));
    const admin = useAdmin(() => ok(null));
    for (const bad of [{ versionId: IDS.version }, { ...body, fingerprint: "XYZ" }, { ...body, versionId: "v1" }, { ...body, extra: 1 }]) {
      expect((await approve(jsonRequest(`${URL_BASE}/letter/approve`, "POST", bad))).status, JSON.stringify(bad)).toBe(400);
    }
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("passes the switch as off by default, stores the approval and says nothing was queued", async () => {
    useClient(tables({ open: true }));
    const admin = useAdmin(() => ok({ status: "approved_not_queued", notQueuedReason: "sending_disabled", queuedCount: 0, duplicateHallIds: [], waitingFor: [] }));
    const response = await approve(jsonRequest(`${URL_BASE}/letter/approve`, "POST", body));
    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("hall_inquiry_approve_letter", {
      p_couple_id: IDS.couple, p_actor_user_id: IDS.bride, p_version_id: IDS.version, p_fingerprint: FINGERPRINT,
      p_sending_enabled: false, p_daily_cap: 5, p_global_daily_cap: 0,
    });
    await expect(response.json()).resolves.toMatchObject({ result: { status: "approved_not_queued", notQueuedReason: "sending_disabled", queuedCount: 0 } });
  });

  it("queues when the switch is on and passes the configured cap", async () => {
    process.env.HALL_INQUIRY_SENDING_ENABLED = "true";
    process.env.HALL_INQUIRY_DAILY_CAP = "3";
    process.env.HALL_INQUIRY_GLOBAL_DAILY_CAP = "40";
    useClient(tables({ open: true }));
    const admin = useAdmin(() => ok({ status: "queued", notQueuedReason: null, queuedCount: 1, duplicateHallIds: [IDS.hallB], waitingFor: [] }));
    const response = await approve(jsonRequest(`${URL_BASE}/letter/approve`, "POST", body));
    expect((admin.rpc.mock.calls[0][1] as Record<string, unknown>)).toMatchObject({ p_sending_enabled: true, p_daily_cap: 3, p_global_daily_cap: 40 });
    await expect(response.json()).resolves.toMatchObject({ result: { status: "queued", queuedCount: 1, duplicateHallIds: [IDS.hallB] } });
  });

  it("fails closed with a zero cap when the cap is misconfigured", async () => {
    process.env.HALL_INQUIRY_SENDING_ENABLED = "true";
    process.env.HALL_INQUIRY_DAILY_CAP = "lots";
    process.env.HALL_INQUIRY_GLOBAL_DAILY_CAP = "many";
    useClient(tables({ open: true }));
    const admin = useAdmin(() => ok({ status: "approved_not_queued", notQueuedReason: "global_daily_cap", queuedCount: 0, duplicateHallIds: [], waitingFor: [] }));
    const response = await approve(jsonRequest(`${URL_BASE}/letter/approve`, "POST", body));
    expect((admin.rpc.mock.calls[0][1] as Record<string, unknown>)).toMatchObject({ p_daily_cap: 0, p_global_daily_cap: 0 });
    await expect(response.json()).resolves.toMatchObject({ result: { notQueuedReason: "global_daily_cap" } });
  });

  it("reports a changed version or fingerprint as a conflict", async () => {
    useClient(tables({ open: true }));
    useAdmin(() => fail("55000", "HALL_INQUIRY_VERSION_CHANGED"));
    const response = await approve(jsonRequest(`${URL_BASE}/letter/approve`, "POST", body));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "LETTER_VERSION_CHANGED" });
  });

  it("refuses a non-member before calling the database", async () => {
    useClient({ ...tables({ open: true }), couples: ok({ id: IDS.couple, bride_id: IDS.outsider, groom_id: IDS.groom, membership_sealed_at: null }) });
    const admin = useAdmin(() => ok(null));
    expect((await approve(jsonRequest(`${URL_BASE}/letter/approve`, "POST", body))).status).toBe(403);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed database result instead of guessing", async () => {
    useClient(tables({ open: true }));
    useAdmin(() => ok({ status: "sent", queuedCount: 1 }));
    expect((await approve(jsonRequest(`${URL_BASE}/letter/approve`, "POST", body))).status).toBe(503);
  });
});
