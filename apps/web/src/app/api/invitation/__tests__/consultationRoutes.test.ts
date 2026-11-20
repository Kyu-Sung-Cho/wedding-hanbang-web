// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FINGERPRINT,
  IDS,
  coupleTables,
  createFakeClient,
  fail,
  filterValue,
  jsonRequest,
  listingRow,
  ok,
  type FakeClient,
  type QueryCall,
  type QueryResult,
} from "@/lib/invitation/__tests__/fakeSupabase";

const mocks = vi.hoisted(() => ({ client: null as unknown, admin: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn(async () => mocks.client) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => mocks.admin) }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "invitation:test"),
}));

import { GET as getConsultation } from "../consultation/route";
import { POST as addToSchedule } from "../consultation/schedule/route";
import { GET as getActivity } from "../activity/route";

const URL_BASE = "http://localhost/api/invitation";

const dispatches = [
  { id: IDS.dispatchA, letter_id: IDS.letter, version_id: IDS.version, hall_id: IDS.hallA, recipient_name: "소담 하우스", status: "sent", queued_at: "2026-11-16T00:00:00Z", sent_at: "2026-11-16T00:12:00Z" },
  { id: IDS.dispatchB, letter_id: IDS.letter, version_id: IDS.version, hall_id: IDS.hallB, recipient_name: "가온 웨딩홀", status: "sent", queued_at: "2026-11-16T00:00:00Z", sent_at: "2026-11-16T00:12:00Z" },
];
const confirmedReply = { id: IDS.replyA, dispatch_id: IDS.dispatchA, hall_id: IDS.hallA, raw_text: "22일 11시 가능합니다", outcome: "confirmed_time", event_at: "2026-11-22T02:00:00Z", place_note: "2층 상담실", price_note: null, recorded_at: "2026-11-16T02:05:00Z" };
const proposedReply = { id: IDS.replyB, dispatch_id: IDS.dispatchB, hall_id: IDS.hallB, raw_text: "21일 4시는 어떠세요", outcome: "proposed_time", event_at: "2026-11-21T07:00:00Z", place_note: null, price_note: null, recorded_at: "2026-11-16T04:40:00Z" };

function tables(progress: Record<string, unknown> = {}, replies: unknown[] = [confirmedReply, proposedReply]) {
  return {
    ...coupleTables({ progress }),
    hall_inquiry_dispatches: ok(dispatches),
    hall_inquiry_replies: ok(replies),
    hall_inquiry_letter_versions: ok([]),
    hall_listings: ok([listingRow(IDS.hallA, "소담 하우스", { photo_url: "https://example.com/sodam.jpg" }), listingRow(IDS.hallB, "가온 웨딩홀")]),
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

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.HALL_INQUIRY_SELF_SEND_ENABLED;
  delete process.env.HALL_INQUIRY_SENDING_ENABLED;
});
afterEach(() => {
  delete process.env.HALL_INQUIRY_SELF_SEND_ENABLED;
  delete process.env.HALL_INQUIRY_SENDING_ENABLED;
});

describe("consultation (W5)", () => {
  it("requires sign-in", async () => {
    useClient(tables(), null);
    expect((await getConsultation(jsonRequest(`${URL_BASE}/consultation`, "GET"))).status).toBe(401);
    expect((await addToSchedule(jsonRequest(`${URL_BASE}/consultation/schedule`, "POST", { replyId: IDS.replyA }))).status).toBe(401);
    expect((await getActivity(jsonRequest(`${URL_BASE}/activity`, "GET"))).status).toBe(401);
  });

  it("builds the consultation from the operator's confirmed reply without adding it to the calendar", async () => {
    useClient(tables());
    const response = await getConsultation(jsonRequest(`${URL_BASE}/consultation`, "GET"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      replyId: IDS.replyA,
      inCalendar: false,
      startsAt: "2026-11-22T02:00:00Z",
      consultation: { dateLabel: "11. 22", timeLabel: "일요일 오전 11시", venue: "소담 하우스", place: "2층 상담실", partnerName: "준호", photo: "https://example.com/sodam.jpg" },
    });
    expect(body.consultation.update.text).toContain("가온 웨딩홀은 21일 토요일 오후 4시를 제안했어요.");
  });

  it("returns no consultation until a time is confirmed", async () => {
    useClient(tables({}, [proposedReply]));
    await expect((await getConsultation(jsonRequest(`${URL_BASE}/consultation`, "GET"))).json())
      .resolves.toEqual({ consultation: null, replyId: null, inCalendar: false, startsAt: null });
  });

  it("adds the confirmed consultation through the existing schedule path only when the couple asks", async () => {
    const existing = { id: "evt_old", date: "2026-11-01", title: "드레스 투어", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" };
    useClient({ ...tables({ __events: [existing] }), wedding_journeys: ok({ couple_id: IDS.couple, state_revision: 8, progress: { __events: [existing] }, wedding_date: null, venue: null, total_budget: 0 }) });
    const admin = useAdmin((name, args) => {
      expect(name).toBe("submit_couple_plan_change");
      const events = (args.p_changes as { progress_patch: { __events: unknown[] } }).progress_patch.__events;
      return ok({ requestId: IDS.version, status: "applied", requiredCount: 1, acceptedCount: 1,
        journey: { couple_id: IDS.couple, state_revision: 9, progress: { __events: events } } });
    });
    const response = await addToSchedule(jsonRequest(`${URL_BASE}/consultation/schedule`, "POST", { replyId: IDS.replyA }));
    expect(response.status).toBe(200);
    const args = admin.rpc.mock.calls[0][1] as { p_surface: string; p_summary: string; p_expected_revision: number; p_changes: { progress_patch: Record<string, unknown> } };
    expect(args.p_surface).toBe("/schedule");
    expect(args.p_summary).toBe("일정: 소담 하우스 상담");
    expect(args.p_expected_revision).toBe(8);
    expect(Object.keys(args.p_changes.progress_patch)).toEqual(["__events"]);
    const events = args.p_changes.progress_patch.__events as Record<string, unknown>[];
    expect(events[0]).toEqual(existing);
    expect(events[1]).toMatchObject({
      date: "2026-11-22", time: "11:00", title: "소담 하우스 상담", memo: "2층 상담실", categoryKey: "venue",
      sourceKey: `hall-consultation:${IDS.replyA}`, status: "planned", assignee: { kind: "couple" },
    });
    await expect(response.json()).resolves.toMatchObject({ added: true, alreadyInCalendar: false });
  });

  it("never adds the same reply twice", async () => {
    const already = {
      id: "evt_1", date: "2026-11-22", time: "11:00", title: "소담 하우스 상담", sourceKey: `hall-consultation:${IDS.replyA}`,
      createdAt: "2026-11-16T03:00:00.000Z", updatedAt: "2026-11-16T03:00:00.000Z",
    };
    useClient({ ...tables(), wedding_journeys: ok({ couple_id: IDS.couple, state_revision: 8, progress: { __events: [already] }, wedding_date: null, venue: null, total_budget: 0 }) });
    const admin = useAdmin(() => ok(null));
    const response = await addToSchedule(jsonRequest(`${URL_BASE}/consultation/schedule`, "POST", { replyId: IDS.replyA }));
    expect(response.status).toBe(200);
    expect(admin.rpc).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ added: false, alreadyInCalendar: true, eventId: "evt_1" });
  });

  it("refuses proposals, unknown replies and bad bodies", async () => {
    useClient(tables());
    const admin = useAdmin(() => ok(null));
    expect((await addToSchedule(jsonRequest(`${URL_BASE}/consultation/schedule`, "POST", { replyId: IDS.replyB }))).status).toBe(409);
    expect((await addToSchedule(jsonRequest(`${URL_BASE}/consultation/schedule`, "POST", { replyId: IDS.hallC }))).status).toBe(404);
    expect((await addToSchedule(jsonRequest(`${URL_BASE}/consultation/schedule`, "POST", { replyId: "x" }))).status).toBe(400);
    expect((await addToSchedule(jsonRequest(`${URL_BASE}/consultation/schedule`, "POST", { replyId: IDS.replyA }, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});

describe("halls for a pasted reply (D-83 stage 1)", () => {
  const HALL_UNKNOWN = "dededede-dede-4ded-8ded-dededededede";
  const OFF = { on: false, value: null };
  const LISTINGS = [
    listingRow(IDS.hallA, "소담 하우스", { photo_url: "https://example.com/sodam.jpg" }),
    listingRow(IDS.hallB, "가온 웨딩홀"),
    listingRow(IDS.hallC, "루체 컨벤션"),
  ];

  function pasteTables(options: { replies?: unknown[]; recipients?: string[] | null; shortlist?: string[] } = {}) {
    const recipients = options.recipients === undefined ? [IDS.hallB, IDS.hallA] : options.recipients;
    const shortlist = options.shortlist ?? [IDS.hallA, IDS.hallC, HALL_UNKNOWN];
    const openVersion = recipients && {
      id: IDS.version, letter_id: IDS.letter, version: 1,
      recipient_hall_ids: recipients, recipient_names: recipients.map((_, index) => `판에 남은 이름 ${index}`),
      body: "본문", signature: "결혼을 준비하는 두 사람 드림", shares: { name: OFF, phone: OFF, budget: OFF },
      fingerprint: FINGERPRINT, created_at: "2026-11-15T01:00:00Z", approval_completed_at: null, queued_at: null,
    };
    return {
      ...tables({}, options.replies ?? [confirmedReply, proposedReply]),
      hall_inquiry_letters: ok(recipients ? { id: IDS.letter, created_at: "2026-11-15T01:00:00Z" } : null),
      // 같은 표를 문의 기록(id 목록)과 열린 편지(편지 ID) 두 길로 읽는다.
      hall_inquiry_letter_versions: (calls: QueryCall[]) => (calls.some((call) => call.method === "in") ? ok([]) : ok(openVersion || null)),
      hall_inquiry_approvals: ok([]),
      hall_shortlists: ok(shortlist.map((hall_id, index) => ({ hall_id, created_at: `2026-11-16T00:0${index}:00Z` }))),
      hall_listings: (calls: QueryCall[]) => {
        const ids = (filterValue(calls, "in", "id") as string[] | undefined) ?? [];
        return ok(LISTINGS.filter((row) => ids.includes(row.id)));
      },
    };
  }

  // 한 시험에서 여러 번 부르므로 hook 처럼 보이는 이름(use…)을 피한다.
  function installClient(t: Record<string, unknown>): FakeClient {
    const client = createFakeClient({ user: { id: IDS.bride }, tables: t as never });
    mocks.client = client;
    return client;
  }

  async function consultationBody(t: Record<string, unknown>) {
    const client = installClient(t);
    const response = await getConsultation(jsonRequest(`${URL_BASE}/consultation`, "GET"));
    return { status: response.status, body: await response.json(), client };
  }

  it("adds nothing and reads nothing extra while the switch is off", async () => {
    for (const value of [undefined, "false", "TRUE"]) {
      if (value === undefined) delete process.env.HALL_INQUIRY_SELF_SEND_ENABLED;
      else process.env.HALL_INQUIRY_SELF_SEND_ENABLED = value;
      const confirmed = await consultationBody(pasteTables());
      expect(Object.keys(confirmed.body), String(value)).toEqual(["consultation", "replyId", "inCalendar", "startsAt"]);
      expect(confirmed.client.calls.some((call) => ["hall_shortlists", "hall_inquiry_letters"].includes(call.table)), String(value)).toBe(false);
      const empty = await consultationBody(pasteTables({ replies: [proposedReply] }));
      expect(empty.body, String(value)).toEqual({ consultation: null, replyId: null, inCalendar: false, startsAt: null });
    }
  });

  it("lists the open letter's recipients, then the picked halls, named from the hall records", async () => {
    const off = await consultationBody(pasteTables());
    process.env.HALL_INQUIRY_SELF_SEND_ENABLED = "true";
    const on = await consultationBody(pasteTables());
    expect(on.status).toBe(200);
    const { replyPaste, ...rest } = on.body;
    expect(rest).toEqual(off.body);
    // 같은 홀은 한 번만, 읽히지 않는 홀은 뺀다. 이름은 판에 남은 이름이 아니라 홀 자료의 이름이다.
    expect(replyPaste).toEqual({
      halls: [
        { hallId: IDS.hallB, name: "가온 웨딩홀" },
        { hallId: IDS.hallA, name: "소담 하우스" },
        { hallId: IDS.hallC, name: "루체 컨벤션" },
      ],
      addedCount: 0,
    });
  });

  it("counts the consultations added from pasted replies, leaving out cancelled ones and other events", async () => {
    process.env.HALL_INQUIRY_SELF_SEND_ENABLED = "true";
    const at = "2026-11-18T03:00:00.000Z";
    const stamped = { createdAt: at, updatedAt: at, assignee: { kind: "couple" } };
    const pasted = (id: string, date: string, extra: Record<string, unknown> = {}) => ({
      id, date, title: "소담 하우스 상담", categoryKey: "venue", status: "planned", ...stamped,
      sourceKey: `hall-consultation-pasted:${IDS.hallA}:${date}`, ...extra,
    });
    const events = [
      pasted("evt_1", "2026-12-03"),
      pasted("evt_2", "2026-12-05", { time: "14:00", sourceKey: `hall-consultation-pasted:${IDS.hallA}:2026-12-05T14:00` }),
      pasted("evt_3", "2026-12-07", { status: "cancelled", cancellation: { cancelledAt: at, cancelledByProfileId: IDS.bride } }),
      // 운영자가 적은 답장으로 넣은 상담과 다른 일정은 세지 않는다.
      { id: "evt_4", date: "2026-12-09", title: "드레스 피팅", categoryKey: "dress", status: "planned", ...stamped },
      { id: "evt_5", date: "2026-11-22", title: "소담 하우스 상담", sourceKey: `hall-consultation:${IDS.replyA}`, status: "planned", ...stamped },
    ];
    const withEvents = {
      ...pasteTables({ replies: [] }),
      wedding_journeys: ok({ couple_id: IDS.couple, state_revision: 8, progress: { __events: events }, wedding_date: null, venue: null, total_budget: 0 }),
    };
    const { body } = await consultationBody(withEvents);
    expect(body.consultation).toBeNull();
    expect(body.replyPaste.addedCount).toBe(2);
  });

  it("adds the halls to the answer without a confirmed consultation too", async () => {
    process.env.HALL_INQUIRY_SELF_SEND_ENABLED = "true";
    const { body } = await consultationBody(pasteTables({ replies: [proposedReply], recipients: null, shortlist: [IDS.hallC] }));
    expect(body).toEqual({
      consultation: null, replyId: null, inCalendar: false, startsAt: null,
      replyPaste: { halls: [{ hallId: IDS.hallC, name: "루체 컨벤션" }], addedCount: 0 },
    });
    const none = await consultationBody(pasteTables({ replies: [], recipients: null, shortlist: [] }));
    expect(none.body.replyPaste).toEqual({ halls: [], addedCount: 0 });
  });

  it("fails closed when the halls cannot be read", async () => {
    process.env.HALL_INQUIRY_SELF_SEND_ENABLED = "true";
    const shortlistDown = await consultationBody({ ...pasteTables(), hall_shortlists: fail() });
    expect(shortlistDown.status).toBe(503);
    expect(shortlistDown.body).toMatchObject({ code: "CONSULTATION_UNAVAILABLE" });
    const letterDown = await consultationBody({ ...pasteTables(), hall_inquiry_letters: fail() });
    expect(letterDown.status).toBe(503);
  });

  it("stays off while the operator queue is on", async () => {
    process.env.HALL_INQUIRY_SELF_SEND_ENABLED = "true";
    process.env.HALL_INQUIRY_SENDING_ENABLED = "true";
    const { body } = await consultationBody(pasteTables());
    expect(Object.keys(body)).toEqual(["consultation", "replyId", "inCalendar", "startsAt"]);
  });
});

describe("activity", () => {
  it("lists only timestamps that exist in the records", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T05:00:00Z"));
    try {
      useClient(tables());
      const body = await (await getActivity(jsonRequest(`${URL_BASE}/activity`, "GET"))).json();
      expect(body).toEqual({
        activity: [
          { timeLabel: "13:40", actor: "operator", text: "담당자가 가온 웨딩홀 답장을 정리했어요" },
          { timeLabel: "11:05", actor: "operator", text: "담당자가 소담 하우스 답장을 정리했어요" },
          { timeLabel: "09:12", actor: "operator", text: "담당자가 승인한 편지를 2곳에 보냈어요" },
        ],
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
