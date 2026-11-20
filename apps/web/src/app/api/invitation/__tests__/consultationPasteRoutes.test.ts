// @vitest-environment node
import { VENDOR_REPLY_COPY } from "@hanbang/shared/invitation";
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
  rateLimitKey: vi.fn((key: string) => key),
}));

import { createClientFromRequest } from "@/lib/supabase/server";
import { parsePastedScheduleInput, pastedScheduleDateWindow } from "@/lib/invitation/replyPaste";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { log } from "@/utils/log";
import { POST as pasteSchedule } from "../consultation/paste-schedule/route";

/**
 * 받은 답 붙여 넣기에서 고른 날짜로 상담 일정 하나 넣기(D-83 1단계). 받는 것은 홀·날짜·시간 세 칸뿐이고,
 * 스위치가 꺼져 있으면 이 길은 없다. 일정은 W5 와 같은 공동 계획 쓰기 길로만 들어간다.
 */

const URL = "http://localhost/api/invitation/consultation/paste-schedule";
const NOW = new Date("2026-11-18T03:00:00Z"); // 한국 시간 11월 18일 12:00
const OFF = { on: false, value: null };
const UNKNOWN_HALL = "dededede-dede-4ded-8ded-dededededede";
const LISTINGS = [listingRow(IDS.hallA, "소담 하우스"), listingRow(IDS.hallB, "가온 웨딩홀"), listingRow(IDS.hallC, "루체 컨벤션")];
const EXISTING = { id: "evt_old", date: "2026-11-01", title: "드레스 투어", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" };
const PICK = { hallId: IDS.hallA, date: "2026-11-30", time: "14:00" };
const PICK_KEY = `hall-consultation-pasted:${IDS.hallA}:2026-11-30T14:00`;

type PlanArgs = {
  p_couple_id: string;
  p_actor_user_id: string;
  p_expected_revision: number;
  p_surface: string;
  p_summary: string;
  p_changes: { progress_patch: { __events: Record<string, unknown>[] } };
};

function tables(options: { progress?: Record<string, unknown>; shortlist?: string[]; recipients?: string[] | null } = {}) {
  const progress = options.progress ?? { __events: [EXISTING] };
  const shortlist = options.shortlist ?? [IDS.hallA];
  const recipients = options.recipients ?? null;
  return {
    ...coupleTables({ progress }),
    wedding_journeys: ok({ couple_id: IDS.couple, state_revision: 8, progress, wedding_date: null, venue: null, total_budget: 0 }),
    hall_inquiry_letters: ok(recipients ? { id: IDS.letter, created_at: "2026-11-15T01:00:00Z" } : null),
    hall_inquiry_letter_versions: ok(recipients ? {
      id: IDS.version, letter_id: IDS.letter, version: 1, recipient_hall_ids: recipients,
      recipient_names: recipients.map((_, index) => `판에 남은 이름 ${index}`), body: "본문", signature: "결혼을 준비하는 두 사람 드림",
      shares: { name: OFF, phone: OFF, budget: OFF }, fingerprint: FINGERPRINT, created_at: "2026-11-15T01:00:00Z",
      approval_completed_at: null, queued_at: null,
    } : null),
    hall_inquiry_approvals: ok([]),
    hall_shortlists: ok(shortlist.map((hall_id, index) => ({ hall_id, created_at: `2026-11-16T00:0${index}:00Z` }))),
    hall_listings: (calls: QueryCall[]) => {
      const ids = (filterValue(calls, "in", "id") as string[] | undefined) ?? [];
      return ok(LISTINGS.filter((row) => ids.includes(row.id)));
    },
  };
}

function installClient(t: Record<string, unknown>, user: { id: string } | null = { id: IDS.bride }): FakeClient {
  const client = createFakeClient({ user, tables: t as never });
  mocks.client = client;
  return client;
}

/** 공동 계획 쓰기가 받은 일정을 그대로 반영했다고 답한다. */
function applied(args: Record<string, unknown>): QueryResult {
  const events = (args as PlanArgs).p_changes.progress_patch.__events;
  return ok({
    requestId: IDS.version, status: "applied", requiredCount: 1, acceptedCount: 1,
    journey: { couple_id: IDS.couple, state_revision: 9, progress: { __events: events } },
  });
}

function installAdmin(rpc: (name: string, args: Record<string, unknown>) => QueryResult = (_name, args) => applied(args)): FakeClient {
  const admin = createFakeClient({ rpc });
  mocks.admin = admin;
  return admin;
}

const post = (body: unknown, headers: Record<string, string> = {}) => pasteSchedule(jsonRequest(URL, "POST", body, headers));
const planArgs = (admin: FakeClient, call = 0) => admin.rpc.mock.calls[call][1] as PlanArgs;
const addedEvent = (admin: FakeClient) => planArgs(admin).p_changes.progress_patch.__events.at(-1) as Record<string, unknown>;

function setSwitches(selfSend: string | undefined, sending?: string) {
  if (selfSend === undefined) delete process.env.HALL_INQUIRY_SELF_SEND_ENABLED;
  else process.env.HALL_INQUIRY_SELF_SEND_ENABLED = selfSend;
  if (sending === undefined) delete process.env.HALL_INQUIRY_SENDING_ENABLED;
  else process.env.HALL_INQUIRY_SENDING_ENABLED = sending;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  setSwitches("true");
});
afterEach(() => {
  vi.useRealTimers();
  setSwitches(undefined);
});

describe("paste-schedule switch", () => {
  it("does not exist while self-send is off, before sign-in, the rate limit or any read", async () => {
    for (const [selfSend, sending] of [[undefined, undefined], ["false", undefined], ["TRUE", undefined], ["true", "true"]] as const) {
      setSwitches(selfSend, sending);
      const client = installClient(tables());
      const admin = installAdmin();
      const response = await post(PICK);
      expect(response.status, `${selfSend}/${sending}`).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ code: "NOT_FOUND" });
      expect(client.calls).toEqual([]);
      expect(admin.rpc).not.toHaveBeenCalled();
    }
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
  });
});

describe("paste-schedule boundary", () => {
  it("needs a trusted origin and a signed-in couple member", async () => {
    installClient(tables());
    const admin = installAdmin();
    expect((await post(PICK, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    installClient(tables(), null);
    expect((await post(PICK)).status).toBe(401);
    installClient({ ...tables(), couples: ok({ id: IDS.couple, bride_id: IDS.outsider, groom_id: IDS.groom, membership_sealed_at: null }) });
    expect((await post(PICK)).status).toBe(403);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("counts requests in its own bucket, ten a minute, failing closed", async () => {
    installClient(tables());
    installAdmin();
    await post(PICK);
    expect(rateLimitKey).toHaveBeenCalledWith("invitation:consultation-paste-schedule", expect.any(Request), IDS.bride);
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "invitation:consultation-paste-schedule",
      { maxRequests: 10, windowMs: 60_000 },
      { failClosed: true },
    );
  });

  it("takes only hallId, date and time, so no pasted text can arrive", async () => {
    installClient(tables());
    const admin = installAdmin();
    for (const bad of [
      null,
      [],
      {},
      { hallId: IDS.hallA },
      { date: "2026-11-30" },
      { ...PICK, text: "11월 30일 오후 2시 가능합니다" },
      { ...PICK, memo: "2층 상담실" },
      { ...PICK, hallId: "hall-a" },
      { ...PICK, hallId: 7 },
      { ...PICK, date: "2026/11/30" },
      { ...PICK, date: "2026-11-31" },
      { ...PICK, date: "2027-02-29" },
      { ...PICK, time: "2:00" },
      { ...PICK, time: "24:00" },
      { ...PICK, time: "14:00:00" },
      { ...PICK, time: 1400 },
      { ...PICK, time: "" },
    ]) {
      const response = await post(bad);
      expect(response.status, JSON.stringify(bad)).toBe(400);
      await expect(response.json(), JSON.stringify(bad)).resolves.toMatchObject({ code: "PASTE_SCHEDULE_INVALID" });
    }
    expect((await post("not json")).status).toBe(400);
    await expect((await post({ ...PICK, hallId: "hall-a" })).json()).resolves.toMatchObject({ error: VENDOR_REPLY_COPY.pickHall });
    await expect((await post({ ...PICK, date: "2026-13-01" })).json()).resolves.toMatchObject({ error: VENDOR_REPLY_COPY.pickDate });
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("refuses a body over 512 bytes", async () => {
    installClient(tables());
    const admin = installAdmin();
    expect((await post({ ...PICK, padding: "가".repeat(200) })).status).toBe(413);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("accepts Korean days from 30 days ago up to three years ahead", async () => {
    expect(pastedScheduleDateWindow(NOW)).toEqual({ min: "2026-10-19", max: "2029-11-18" });
    // 한국 자정을 막 넘긴 때(UTC 로는 아직 전날)에도 한국 날짜로 센다.
    expect(pastedScheduleDateWindow(new Date("2026-11-17T15:30:00Z"))).toEqual({ min: "2026-10-19", max: "2029-11-18" });
    expect(pastedScheduleDateWindow(new Date("2026-11-17T14:30:00Z"))).toEqual({ min: "2026-10-18", max: "2029-11-17" });
    for (const [date, accepted] of [["2026-10-18", false], ["2026-10-19", true], ["2029-11-18", true], ["2029-11-19", false]] as const) {
      expect(parsePastedScheduleInput({ hallId: IDS.hallA, date }, NOW).ok, date).toBe(accepted);
    }
    expect(parsePastedScheduleInput({ hallId: IDS.hallA.toUpperCase(), date: "2026-11-30", time: null }, NOW))
      .toEqual({ ok: true, value: { hallId: IDS.hallA, date: "2026-11-30", time: null } });

    installClient(tables());
    installAdmin();
    expect((await post({ hallId: IDS.hallA, date: "2026-10-18" })).status).toBe(400);
    expect((await post({ hallId: IDS.hallA, date: "2029-11-19" })).status).toBe(400);
    // 날짜를 골랐지만 기간 밖이면 "골라 주세요"가 아니라 넣을 수 있는 기간을 말한다. 날짜 꼴이 틀리면 골라 달라고 한다.
    for (const date of ["2026-10-18", "2029-11-19"]) {
      await expect((await post({ hallId: IDS.hallA, date })).json(), date)
        .resolves.toEqual({ code: "PASTE_SCHEDULE_INVALID", error: VENDOR_REPLY_COPY.dateOutOfRange });
    }
    expect(parsePastedScheduleInput({ hallId: IDS.hallA, date: "2029-11-19" }, NOW)).toEqual({ ok: false, field: "dateRange" });
    expect(parsePastedScheduleInput({ hallId: IDS.hallA, date: "2026-02-30" }, NOW)).toEqual({ ok: false, field: "date" });
    expect((await post({ hallId: IDS.hallA, date: "2026-10-19" })).status).toBe(200);
  });

  it("takes only halls the couple picked or wrote to", async () => {
    installClient(tables({ shortlist: [IDS.hallA] }));
    const admin = installAdmin();
    const response = await post({ ...PICK, hallId: IDS.hallC });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ code: "HALL_NOT_FOUND", error: VENDOR_REPLY_COPY.pickHall });
    // 담았지만 홀 자료가 보이지 않는 홀도 받지 않는다(상담 화면 목록에도 없다).
    installClient(tables({ shortlist: [UNKNOWN_HALL] }));
    expect((await post({ ...PICK, hallId: UNKNOWN_HALL })).status).toBe(404);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("answers 503 when the halls cannot be read", async () => {
    installClient({ ...tables(), hall_shortlists: fail() });
    const admin = installAdmin();
    const response = await post(PICK);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "CONSULTATION_UNAVAILABLE" });
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});

describe("paste-schedule write", () => {
  it("adds one consultation through the shared schedule path with the picked date and time only", async () => {
    installClient(tables());
    const admin = installAdmin();
    const response = await post(PICK);
    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.rpc.mock.calls[0][0]).toBe("submit_couple_plan_change");
    expect(planArgs(admin)).toMatchObject({
      p_couple_id: IDS.couple, p_actor_user_id: IDS.bride, p_expected_revision: 8, p_surface: "/schedule", p_summary: "일정: 소담 하우스 상담",
    });
    expect(Object.keys(planArgs(admin).p_changes.progress_patch)).toEqual(["__events"]);
    const events = planArgs(admin).p_changes.progress_patch.__events;
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(EXISTING);
    const { id, createdAt, updatedAt, ...added } = events[1];
    expect(typeof id).toBe("string");
    expect(createdAt).toBe(updatedAt);
    expect(added).toEqual({
      date: "2026-11-30", time: "14:00", title: "소담 하우스 상담", categoryKey: "venue", sourceKey: PICK_KEY,
      status: "planned", assignee: { kind: "couple" },
    });
    // 붙여 넣은 글은 메모로도 들어가지 않는다(상대에게 가는 변경 알림이 메모를 옮겨 적는다).
    expect(events[1].memo).toBeUndefined();
    await expect(response.json()).resolves.toEqual({ added: true, alreadyInCalendar: false, eventId: id });
  });

  it("adds a day-only consultation when no time was picked", async () => {
    for (const body of [{ hallId: IDS.hallA, date: "2026-11-30" }, { hallId: IDS.hallA, date: "2026-11-30", time: null }]) {
      installClient(tables());
      const admin = installAdmin();
      expect((await post(body)).status, JSON.stringify(body)).toBe(200);
      expect(addedEvent(admin).time).toBeUndefined();
      expect(addedEvent(admin).sourceKey).toBe(`hall-consultation-pasted:${IDS.hallA}:2026-11-30`);
    }
  });

  it("accepts a hall the open letter was written to even when it is no longer picked", async () => {
    installClient(tables({ shortlist: [], recipients: [IDS.hallB] }));
    const admin = installAdmin();
    expect((await post({ hallId: IDS.hallB, date: "2026-12-01", time: "11:00" })).status).toBe(200);
    expect(planArgs(admin).p_summary).toBe("일정: 가온 웨딩홀 상담");
    expect(addedEvent(admin)).toMatchObject({ title: "가온 웨딩홀 상담", sourceKey: `hall-consultation-pasted:${IDS.hallB}:2026-12-01T11:00` });
  });

  it("reads an upper-case hall id as the same hall", async () => {
    installClient(tables());
    const admin = installAdmin();
    expect((await post({ ...PICK, hallId: IDS.hallA.toUpperCase() })).status).toBe(200);
    expect(addedEvent(admin).sourceKey).toBe(PICK_KEY);
  });

  it("never adds the same hall, day and time twice, but adds again after a cancel or at another time", async () => {
    const already = {
      id: "evt_paste", date: "2026-11-30", time: "14:00", title: "소담 하우스 상담", sourceKey: PICK_KEY,
      createdAt: "2026-11-16T03:00:00.000Z", updatedAt: "2026-11-16T03:00:00.000Z",
    };
    installClient(tables({ progress: { __events: [already] } }));
    const admin = installAdmin();
    const response = await post(PICK);
    expect(response.status).toBe(200);
    expect(admin.rpc).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ added: false, alreadyInCalendar: true, eventId: "evt_paste" });

    const cancelled = {
      ...already, status: "cancelled", updatedAt: "2026-11-17T03:00:00.000Z",
      cancellation: { cancelledAt: "2026-11-17T03:00:00.000Z", cancelledByProfileId: IDS.bride },
    };
    installClient(tables({ progress: { __events: [cancelled] } }));
    const again = installAdmin();
    expect((await post(PICK)).status).toBe(200);
    expect(again.rpc).toHaveBeenCalledTimes(1);

    installClient(tables({ progress: { __events: [already] } }));
    const otherTime = installAdmin();
    expect((await post({ ...PICK, time: "15:00" })).status).toBe(200);
    expect(addedEvent(otherTime).sourceKey).toBe(`hall-consultation-pasted:${IDS.hallA}:2026-11-30T15:00`);
  });

  it("keeps a consultation from an operator-recorded reply apart from a pasted one", async () => {
    const fromReply = {
      id: "evt_reply", date: "2026-11-30", time: "14:00", title: "소담 하우스 상담", sourceKey: `hall-consultation:${IDS.replyA}`,
      createdAt: "2026-11-16T03:00:00.000Z", updatedAt: "2026-11-16T03:00:00.000Z",
    };
    installClient(tables({ progress: { __events: [fromReply] } }));
    const admin = installAdmin();
    expect((await post(PICK)).status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });

  it("says when the schedule is full", async () => {
    const full = Array.from({ length: 500 }, (_, index) => ({
      id: `evt_${index}`, date: "2026-12-01", title: `일정 ${index}`, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    }));
    installClient(tables({ progress: { __events: full } }));
    const admin = installAdmin();
    const response = await post(PICK);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "SCHEDULE_FULL" });
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("passes the shared path's refusals through", async () => {
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => undefined);
    try {
      installClient(tables());
      installAdmin(() => fail("P0001", "COUPLE_PLAN_CHANGE_INVALID"));
      const response = await post(PICK);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: "PLAN_CHANGE_INVALID" });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("reports an unexpected failure and answers 500", async () => {
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => undefined);
    try {
      installClient(tables());
      installAdmin(() => {
        throw new Error("connection reset");
      });
      const response = await post(PICK);
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({ code: "SERVER_ERROR" });
      expect(errorSpy).toHaveBeenCalledWith("[invitation consultation paste-schedule POST]", expect.any(Error));
    } finally {
      errorSpy.mockRestore();
    }
  });
});
