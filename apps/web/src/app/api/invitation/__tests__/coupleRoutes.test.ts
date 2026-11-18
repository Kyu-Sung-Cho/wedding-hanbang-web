// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDS,
  coupleTables,
  createFakeClient,
  fail,
  filterValue,
  jsonRequest,
  listingRow,
  ok,
  type FakeClient,
  type QueryResult,
  type TableHandler,
} from "@/lib/invitation/__tests__/fakeSupabase";

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  admin: null as unknown,
  limited: null as Response | null,
  actions: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn(async () => mocks.client) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => mocks.admin) }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => mocks.limited),
  rateLimitKey: vi.fn(() => "invitation:test"),
}));
vi.mock("@/lib/amora/actionRepository", () => ({ readAmoraActionSnapshot: mocks.actions }));

import { GET as getConditions, PATCH as patchConditions } from "../conditions/route";
import { GET as getHome } from "../home/route";
import { GET as getJourney } from "../journey/route";
import { PATCH as patchJourneyPlan } from "../journey-plan/route";
import { GET as getHalls } from "../halls/route";
import { DELETE as unpick, POST as pick } from "../halls/[hallId]/shortlist/route";
import { GET as getApprover, PUT as putApprover } from "../approver/route";
import { POST as confirmApprover } from "../approver/confirm/route";
import { POST as declineApprover } from "../approver/decline/route";

const URL_BASE = "http://localhost/api/invitation";
const CONDITIONS = { hopedYear: 2027, hopedMonth: 5, region: "서울", guestCount: 200, timeLabel: "토요일 낮", startStage: "start" };

function journey(progress: Record<string, unknown>, revision = 8) {
  return { couple_id: IDS.couple, state_revision: revision, progress };
}

function useClient(tables: Record<string, TableHandler> = {}, user: { id: string } | null = { id: IDS.bride }): FakeClient {
  const client = createFakeClient({ user, tables: { ...coupleTables(), ...tables } });
  mocks.client = client;
  return client;
}

function useAdmin(rpc: (name: string, args: Record<string, unknown>) => QueryResult): FakeClient {
  const admin = createFakeClient({ rpc });
  mocks.admin = admin;
  return admin;
}

const emptyInquiryTables = {
  hall_inquiry_settings: ok(null),
  hall_inquiry_letters: ok(null),
  hall_inquiry_dispatches: ok([]),
  hall_inquiry_replies: ok([]),
  hall_shortlists: ok([]),
  hall_listings: ok([]),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limited = null;
  mocks.admin = null;
  mocks.actions.mockResolvedValue({ actions: [], count: 0, openCount: 0, source: "table" });
});

describe("auth and couple membership on every couple route", () => {
  const routes: [string, () => Promise<Response>][] = [
    ["conditions GET", () => getConditions(jsonRequest(`${URL_BASE}/conditions`, "GET"))],
    ["home GET", () => getHome(jsonRequest(`${URL_BASE}/home`, "GET"))],
    ["journey GET", () => getJourney(jsonRequest(`${URL_BASE}/journey`, "GET"))],
    ["halls GET", () => getHalls(jsonRequest(`${URL_BASE}/halls`, "GET"))],
    ["approver GET", () => getApprover(jsonRequest(`${URL_BASE}/approver`, "GET"))],
  ];

  it.each(routes)("%s requires a signed-in user", async (_name, call) => {
    useClient({}, null);
    const response = await call();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it.each(routes)("%s refuses someone whose seat does not match the couple", async (_name, call) => {
    useClient({
      profiles: ok({ id: IDS.bride, name: "민지", role: "groom", couple_id: IDS.couple }),
    });
    const response = await call();
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "NOT_COUPLE_MEMBER" });
  });

  it("asks for a couple connection before anything else", async () => {
    useClient({ profiles: ok({ id: IDS.bride, name: "민지", role: "bride", couple_id: null }) });
    const response = await getConditions(jsonRequest(`${URL_BASE}/conditions`, "GET"));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "COUPLE_REQUIRED" });
  });

  it("does not read couple data when the profile read fails", async () => {
    const client = useClient({ profiles: fail() });
    const response = await getConditions(jsonRequest(`${URL_BASE}/conditions`, "GET"));
    expect(response.status).toBe(503);
    expect(client.calls.some((call) => call.table === "couples")).toBe(false);
  });
});

describe("conditions (W1)", () => {
  it("returns stored conditions with summary and what is missing", async () => {
    useClient(coupleTables({ progress: { __invitationConditions: { ...CONDITIONS, guestCount: null } } }));
    const response = await getConditions(jsonRequest(`${URL_BASE}/conditions`, "GET"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      conditions: { ...CONDITIONS, guestCount: null },
      summary: null,
      missing: ["guests"],
      weddingDate: null,
    });
  });

  it("refuses untrusted origins, rate-limited callers and invalid bodies before writing", async () => {
    useClient();
    const admin = useAdmin(() => ok(null));
    expect((await patchConditions(jsonRequest(`${URL_BASE}/conditions`, "PATCH", { region: "서울" }, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    mocks.limited = new Response("{}", { status: 429 });
    expect((await patchConditions(jsonRequest(`${URL_BASE}/conditions`, "PATCH", { region: "서울" }))).status).toBe(429);
    mocks.limited = null;
    for (const body of [{ hopedYear: 2027 }, { region: "서울", extra: 1 }, { guestCount: -1 }, "not json"]) {
      const response = await patchConditions(jsonRequest(`${URL_BASE}/conditions`, "PATCH", body));
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("writes only the conditions key through the shared plan path, retrying once when stale", async () => {
    const before = { __invitationConditions: { ...CONDITIONS, region: "부산" }, budget: { keep: 1 } };
    useClient({ wedding_journeys: ok(journey(before)) });
    let attempt = 0;
    const admin = useAdmin((name, args) => {
      expect(name).toBe("submit_couple_plan_change");
      attempt += 1;
      if (attempt === 1) return fail("40001", "COUPLE_PLAN_CHANGE_STALE");
      return ok({ requestId: IDS.version, status: "applied", requiredCount: 1, acceptedCount: 1,
        journey: journey({ ...before, ...(args.p_changes as { progress_patch: Record<string, unknown> }).progress_patch }, 9) });
    });
    const response = await patchConditions(jsonRequest(`${URL_BASE}/conditions`, "PATCH", { region: "서울", guestCount: 180 }));
    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledTimes(2);
    const args = admin.rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(args).toMatchObject({
      p_couple_id: IDS.couple,
      p_actor_user_id: IDS.bride,
      p_expected_revision: 8,
      p_surface: "/dashboard",
      p_summary: "결혼 조건: 2027년 5월, 서울, 하객 180명, 토요일 낮",
      p_changes: { progress_patch: { __invitationConditions: { ...CONDITIONS, guestCount: 180 } } },
    });
    expect(Object.keys((args.p_changes as { progress_patch: object }).progress_patch)).toEqual(["__invitationConditions"]);
    await expect(response.json()).resolves.toMatchObject({ summary: "2027년 5월, 서울, 180명", missing: [] });
  });

  it("does not write when nothing changes", async () => {
    useClient({ wedding_journeys: ok(journey({ __invitationConditions: CONDITIONS })) });
    const admin = useAdmin(() => ok(null));
    const response = await patchConditions(jsonRequest(`${URL_BASE}/conditions`, "PATCH", { region: "서울" }));
    expect(response.status).toBe(200);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("hides internal database errors behind a fixed message", async () => {
    useClient({ wedding_journeys: ok(journey({})) });
    useAdmin(() => fail("XX000", "relation secret_table does not exist"));
    const response = await patchConditions(jsonRequest(`${URL_BASE}/conditions`, "PATCH", { region: "서울" }));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).not.toContain("secret_table");
  });
});

describe("journey and journey plan", () => {
  it("derives stage states from stored facts only", async () => {
    useClient({
      ...coupleTables({ progress: { __invitationConditions: CONDITIONS, __journeyPlan: { off: ["honeymoon"], addOns: ["rings"] } } }),
      hall_shortlists: ok([{ hall_id: IDS.hallA, created_at: "2026-11-16T00:00:00Z" }, { hall_id: IDS.hallB, created_at: "2026-11-16T00:01:00Z" }]),
    });
    const response = await getJourney(jsonRequest(`${URL_BASE}/journey`, "GET"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.journey.rows.slice(0, 3).map((row: { state: string; sub: string }) => [row.state, row.sub])).toEqual([
      ["done", "2027년 5월, 서울, 200명"],
      ["done", "준호 님이 합류했어요"],
      ["now", "지금 하고 있어요. 후보 2곳"],
    ]);
    expect(body.journey.rows.find((row: { key: string }) => row.key === "honeymoon")).toMatchObject({ off: true });
    expect(body.journey.addOns).toEqual([
      { key: "rings", button: "반지와 예물 넣기", added: true },
      { key: "home", button: "신혼집 준비 넣기", added: false },
    ]);
  });

  it("does not mark the partner stage done before the partner joins", async () => {
    useClient({ ...coupleTables({ sealed: false }), hall_shortlists: ok([]) });
    const body = await (await getJourney(jsonRequest(`${URL_BASE}/journey`, "GET"))).json();
    expect(body.journey.rows[1]).toMatchObject({ key: "partner", state: "next" });
    expect(body.journey.rows[0]).toMatchObject({ key: "conditions", state: "now" });
  });

  it("refuses removing a required stage and stores a valid plan", async () => {
    useClient({ wedding_journeys: ok(journey({})), hall_shortlists: ok([]) });
    const admin = useAdmin((_name, args) => ok({
      requestId: IDS.version, status: "applied", requiredCount: 1, acceptedCount: 1,
      journey: journey((args.p_changes as { progress_patch: Record<string, unknown> }).progress_patch, 9),
    }));
    expect((await patchJourneyPlan(jsonRequest(`${URL_BASE}/journey-plan`, "PATCH", { off: ["venue"], addOns: [] }))).status).toBe(400);
    expect(admin.rpc).not.toHaveBeenCalled();
    const response = await patchJourneyPlan(jsonRequest(`${URL_BASE}/journey-plan`, "PATCH", { off: ["families"], addOns: ["home"] }));
    expect(response.status).toBe(200);
    expect(admin.rpc.mock.calls[0][1]).toMatchObject({
      p_changes: { progress_patch: { __journeyPlan: { off: ["families"], addOns: ["home"] } } },
      p_summary: "준비 순서: 첫인사와 상견례 뺌, 신혼집 준비 넣음",
    });
    await expect(response.json()).resolves.toMatchObject({ plan: { off: ["families"], addOns: ["home"] } });
  });
});

describe("home", () => {
  it("builds the invitation from stored facts, never inventing a day or venue", async () => {
    useClient({ ...coupleTables({ progress: { __invitationConditions: CONDITIONS } }), ...emptyInquiryTables });
    mocks.actions.mockResolvedValue({
      actions: [{ id: "act-1", title: "양가에 상견례 날짜 묻기", description: "이번 주 안에", priority: "medium", status: "open", source: "manual", createdAt: "2026-11-16T00:00:00Z", updatedAt: "2026-11-16T00:00:00Z" }],
      count: 1, openCount: 1, source: "table",
    });
    const response = await getHome(jsonRequest(`${URL_BASE}/home`, "GET"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      home: {
        people: [{ initial: "민", name: "민지" }, { initial: "준", name: "준호" }],
        invitation: { firstName: "민지", secondName: "준호", year: 2027, month: 5, day: null, timeLabel: "토요일 낮", venueName: null },
        update: null,
        decisions: [{ id: "action-act-1", title: "양가에 상견례 날짜 묻기", sub: "이번 주 안에", owner: { kind: "together" }, target: null }],
      },
      degraded: [],
      updateSteps: [],
    });
  });

  it("says when shared to-dos could not be read instead of showing an empty list", async () => {
    useClient({ ...coupleTables(), ...emptyInquiryTables });
    mocks.actions.mockRejectedValue(new Error("boom"));
    const body = await (await getHome(jsonRequest(`${URL_BASE}/home`, "GET"))).json();
    expect(body.degraded).toEqual(["decisions"]);
  });

  it("keeps a solo member's invitation to one name", async () => {
    useClient({ ...coupleTables({ sealed: false, partnerName: null }), ...emptyInquiryTables });
    const body = await (await getHome(jsonRequest(`${URL_BASE}/home`, "GET"))).json();
    expect(body.home.people).toEqual([{ initial: "민", name: "민지" }]);
    expect(body.home.invitation).toMatchObject({ firstName: "민지", secondName: null, year: null, month: null });
  });
});

describe("halls (W2)", () => {
  it("asks for guests and region before comparing", async () => {
    useClient({ ...coupleTables({ progress: { __invitationConditions: { ...CONDITIONS, guestCount: null, region: null } } }), hall_shortlists: ok([]) });
    const response = await getHalls(jsonRequest(`${URL_BASE}/halls`, "GET"));
    await expect(response.json()).resolves.toEqual({ compare: null, missing: ["guests", "region"], sort: "total", pickedCount: 0, sources: [] });
  });

  it("compares only operator listings in the couple's region plus picked halls", async () => {
    const client = useClient({
      ...coupleTables({ progress: { __invitationConditions: CONDITIONS } }),
      hall_shortlists: ok([{ hall_id: IDS.hallC, created_at: "2026-11-16T00:00:00Z" }]),
      hall_listings: (calls) => (filterValue(calls, "eq", "region") === "서울"
        ? ok([listingRow(IDS.hallA, "소담 하우스"), listingRow(IDS.hallB, "가온 웨딩홀", { rental_included: false, rental_fee_won: 3_000_000, meal_price_won: 75_000, minimum_guarantee: 200, station_walk_minutes: 5 })])
        : ok([listingRow(IDS.hallC, "루체 컨벤션", { region: "경기", rental_included: false, rental_fee_won: 5_000_000, meal_price_won: 89_000, minimum_guarantee: 250, station_walk_minutes: null })])),
      hall_inquiry_dispatches: ok([]),
      hall_inquiry_replies: ok([]),
    });
    const response = await getHalls(jsonRequest(`${URL_BASE}/halls?sort=total`, "GET"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.compare.halls.map((hall: { name: string; totalManwon: string; picked: boolean }) => [hall.name, hall.totalManwon, hall.picked])).toEqual([
      ["소담 하우스", "1,360", false],
      ["가온 웨딩홀", "1,800", false],
      ["루체 컨벤션", "2,725", true],
    ]);
    expect(body.compare).toMatchObject({ guests: 200, month: 5, sourceDateLabel: expect.any(String) });
    expect(body.sources).toHaveLength(3);
    expect(client.calls.filter((call) => call.table === "hall_listings").every((call) => call.method !== "insert")).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/추천|최고|가성비|저렴|1위|합리적/);
  });

  it("leaves out a picked hall whose listing the operator switched off", async () => {
    useClient({
      ...coupleTables({ progress: { __invitationConditions: CONDITIONS } }),
      hall_shortlists: ok([{ hall_id: IDS.hallC, created_at: "2026-11-16T00:00:00Z" }]),
      hall_listings: (calls) => (filterValue(calls, "eq", "region") === "서울"
        ? ok([listingRow(IDS.hallA, "소담 하우스")])
        : ok([listingRow(IDS.hallC, "루체 컨벤션", { region: "경기", active: false })])),
      hall_inquiry_dispatches: ok([]),
      hall_inquiry_replies: ok([]),
    });
    const body = await (await getHalls(jsonRequest(`${URL_BASE}/halls`, "GET"))).json();
    expect(body.compare.halls.map((hall: { name: string }) => hall.name)).toEqual(["소담 하우스"]);
    expect(body.pickedCount).toBe(1);
  });

  it("refuses an unknown sort", async () => {
    useClient();
    expect((await getHalls(jsonRequest(`${URL_BASE}/halls?sort=rank`, "GET"))).status).toBe(400);
  });
});

describe("shortlist", () => {
  const url = `${URL_BASE}/halls/${IDS.hallA}/shortlist`;
  const params = (hallId: string = IDS.hallA) => ({ params: Promise.resolve({ hallId }) });

  it("requires a trusted origin and a valid hall id", async () => {
    useClient({ hall_shortlists: ok([]) });
    expect((await pick(jsonRequest(url, "POST", undefined, { "sec-fetch-site": "cross-site" }), params())).status).toBe(403);
    expect((await pick(jsonRequest(url, "POST"), params("not-a-uuid"))).status).toBe(400);
  });

  it("adds through member RLS with the caller as the one who added it", async () => {
    let inserted: unknown = null;
    const client = useClient({
      hall_shortlists: (calls) => {
        const insert = calls.find((call) => call.method === "insert");
        if (insert) {
          inserted = insert.args[0];
          return ok(null);
        }
        return ok(inserted ? [{ hall_id: IDS.hallA, created_at: "2026-11-17T00:00:00Z" }] : []);
      },
    });
    const response = await pick(jsonRequest(url, "POST"), params());
    expect(response.status).toBe(200);
    expect(inserted).toEqual({ couple_id: IDS.couple, hall_id: IDS.hallA, added_by: IDS.bride });
    await expect(response.json()).resolves.toEqual({ hallId: IDS.hallA, picked: true, pickedCount: 1 });
    expect(client.calls.some((call) => call.table === "wedding_journeys")).toBe(false);
  });

  it("maps RLS refusal to an unavailable hall and stops at ten picks", async () => {
    useClient({ hall_shortlists: (calls) => (calls.some((call) => call.method === "insert") ? fail("42501", "new row violates row-level security policy") : ok([])) });
    expect((await pick(jsonRequest(url, "POST"), params())).status).toBe(404);
    const ten = Array.from({ length: 10 }, (_, index) => ({ hall_id: `0000000${index}-0000-4000-8000-000000000000`, created_at: "2026-11-17T00:00:00Z" }));
    useClient({ hall_shortlists: ok(ten) });
    const full = await pick(jsonRequest(url, "POST"), params());
    expect(full.status).toBe(409);
    await expect(full.json()).resolves.toMatchObject({ code: "SHORTLIST_FULL" });
    // 동시에 담아 DB 의 상한에 걸린 경우도 같은 답이다.
    useClient({ hall_shortlists: (calls) => (calls.some((call) => call.method === "insert") ? fail("23514", "HALL_SHORTLIST_FULL") : ok([])) });
    const raced = await pick(jsonRequest(url, "POST"), params());
    expect(raced.status).toBe(409);
    await expect(raced.json()).resolves.toMatchObject({ code: "SHORTLIST_FULL" });
  });

  it("removes only the caller's couple row", async () => {
    const client = useClient({ hall_shortlists: ok([]) });
    const response = await unpick(jsonRequest(url, "DELETE"), params());
    expect(response.status).toBe(200);
    const deleteCalls = client.calls.filter((call) => call.table === "hall_shortlists" && call.method === "eq");
    expect(deleteCalls.map((call) => call.args)).toContainEqual(["couple_id", IDS.couple]);
  });
});

describe("approver setting (D-76)", () => {
  const PROPOSAL = "9a9a9a9a-9a9a-49a9-89a9-9a9a9a9a9a9a";
  const proposedState = (proposedBy: string) => ({
    mode: "both", designatedUserId: null, revision: 1, changed: false, outcome: "proposed",
    pending: { proposalId: PROPOSAL, mode: "unset", designatedUserId: null, proposedBy, proposedAt: "2026-11-17T03:00:00+00:00" },
  });

  it("returns the unset default with both members", async () => {
    useClient({ hall_inquiry_settings: ok(null) });
    await expect((await getApprover(jsonRequest(`${URL_BASE}/approver`, "GET"))).json()).resolves.toEqual({
      setting: { mode: "unset", designatedUserId: null, revision: 0 },
      pending: null,
      members: [{ id: IDS.bride, name: "민지", isViewer: true }, { id: IDS.groom, name: "준호", isViewer: false }],
    });
  });

  it("shows a pending proposal that the viewer can answer, and hides one from a member who left", async () => {
    const row = {
      approver_mode: "both", designated_user_id: null, revision: 1, proposal_id: PROPOSAL, proposed_mode: "unset",
      proposed_designated_user_id: null, proposed_by: IDS.groom, proposed_at: "2026-11-17T03:00:00+00:00",
    };
    useClient({ hall_inquiry_settings: ok(row) });
    const body = await (await getApprover(jsonRequest(`${URL_BASE}/approver`, "GET"))).json();
    expect(body).toMatchObject({
      setting: { mode: "both", designatedUserId: null, revision: 1 },
      pending: { proposalId: PROPOSAL, mode: "unset", designatedUserId: null, proposedBy: IDS.groom, viewerCanRespond: true },
    });
    useClient({ hall_inquiry_settings: ok({ ...row, proposed_by: IDS.outsider }) });
    expect((await (await getApprover(jsonRequest(`${URL_BASE}/approver`, "GET"))).json()).pending).toBeNull();
  });

  it.each([
    [{ mode: "anyone" }],
    [{ mode: "designated" }],
    [{ mode: "both", designatedUserId: IDS.groom }],
    [{ mode: "designated", designatedUserId: IDS.outsider }],
    [{ mode: "unset", extra: true }],
  ])("refuses %j at the boundary", async (body) => {
    useClient();
    const admin = useAdmin(() => ok(null));
    expect((await putApprover(jsonRequest(`${URL_BASE}/approver`, "PUT", body))).status).toBe(400);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["unset", null],
    ["designated", IDS.groom],
    ["both", null],
  ] as const)("stores %s through the service function", async (mode, designated) => {
    useClient();
    const admin = useAdmin(() => ok({ mode, designatedUserId: designated, revision: 2, changed: true, outcome: "applied", pending: null }));
    const response = await putApprover(jsonRequest(`${URL_BASE}/approver`, "PUT", { mode, ...(designated ? { designatedUserId: designated } : {}) }));
    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("hall_inquiry_set_approver", {
      p_couple_id: IDS.couple, p_actor_user_id: IDS.bride, p_mode: mode, p_designated_user_id: designated,
    });
    await expect(response.json()).resolves.toMatchObject({
      setting: { mode, designatedUserId: designated, revision: 2 }, pending: null, outcome: "applied",
    });
  });

  it("says a change that takes power from the partner only waits as a proposal", async () => {
    useClient();
    useAdmin(() => ok(proposedState(IDS.bride)));
    const body = await (await putApprover(jsonRequest(`${URL_BASE}/approver`, "PUT", { mode: "unset" }))).json();
    expect(body).toMatchObject({
      setting: { mode: "both", revision: 1 }, outcome: "proposed",
      pending: { proposalId: PROPOSAL, mode: "unset", proposedBy: IDS.bride, viewerCanRespond: false },
    });
  });

  it("rejects a malformed database result instead of guessing", async () => {
    useClient();
    const withoutOutcome = { mode: "both", designatedUserId: null, revision: 1, changed: false, pending: null };
    useAdmin(() => ok(withoutOutcome));
    expect((await putApprover(jsonRequest(`${URL_BASE}/approver`, "PUT", { mode: "unset" }))).status).toBe(503);
    useAdmin(() => ok({ ...withoutOutcome, outcome: "maybe" }));
    expect((await putApprover(jsonRequest(`${URL_BASE}/approver`, "PUT", { mode: "unset" }))).status).toBe(503);
    useAdmin(() => ok({ ...proposedState(IDS.groom), pending: { proposalId: "p1" } }));
    expect((await putApprover(jsonRequest(`${URL_BASE}/approver`, "PUT", { mode: "unset" }))).status).toBe(503);
  });

  it.each([
    ["confirm", confirmApprover, true],
    ["decline", declineApprover, false],
  ] as const)("%s answers the exact proposal through the service function", async (name, handler, accept) => {
    useClient();
    const admin = useAdmin(() => ok({
      mode: accept ? "unset" : "both", designatedUserId: null, revision: accept ? 2 : 1, changed: accept,
      outcome: accept ? "confirmed" : "declined", pending: null,
    }));
    for (const bad of [{}, { proposalId: "p1" }, { proposalId: PROPOSAL, accept: true }]) {
      expect((await handler(jsonRequest(`${URL_BASE}/approver/${name}`, "POST", bad))).status, JSON.stringify(bad)).toBe(400);
    }
    expect(admin.rpc).not.toHaveBeenCalled();
    const response = await handler(jsonRequest(`${URL_BASE}/approver/${name}`, "POST", { proposalId: PROPOSAL.toUpperCase() }));
    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("hall_inquiry_respond_approver", {
      p_couple_id: IDS.couple, p_actor_user_id: IDS.bride, p_proposal_id: PROPOSAL, p_accept: accept,
    });
    await expect(response.json()).resolves.toMatchObject({ outcome: accept ? "confirmed" : "declined", pending: null });
  });

  it("maps a changed proposal and an own proposal to conflicts", async () => {
    useClient();
    useAdmin(() => fail("55000", "HALL_INQUIRY_APPROVER_PROPOSAL_CHANGED"));
    const changed = await confirmApprover(jsonRequest(`${URL_BASE}/approver/confirm`, "POST", { proposalId: PROPOSAL }));
    expect(changed.status).toBe(409);
    await expect(changed.json()).resolves.toMatchObject({ code: "APPROVER_PROPOSAL_CHANGED" });
    useAdmin(() => fail("42501", "HALL_INQUIRY_APPROVER_PROPOSAL_OWN"));
    const own = await declineApprover(jsonRequest(`${URL_BASE}/approver/decline`, "POST", { proposalId: PROPOSAL }));
    expect(own.status).toBe(409);
    await expect(own.json()).resolves.toMatchObject({ code: "APPROVER_PROPOSAL_OWN" });
  });

  it("maps the partner requirement to a conflict", async () => {
    useClient();
    useAdmin(() => fail("22023", "HALL_INQUIRY_APPROVER_PARTNER_REQUIRED"));
    const response = await putApprover(jsonRequest(`${URL_BASE}/approver`, "PUT", { mode: "both" }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "APPROVER_PARTNER_REQUIRED" });
  });
});
