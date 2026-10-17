import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ server: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: mocks.server }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/utils/log", () => ({ log: { error: vi.fn() } }));
import { GET } from "./route";

interface Row { id: string; user_id: string; category: string; created_at: string; base_price: number; extra_price: number | null; vendor_name: string }
function contracts(users: string[], category = "studio"): Row[] {
  return users.map((user_id, i) => ({
    id: String(i + 1).padStart(5, "0"), user_id, category,
    created_at: "2026-10-17", base_price: 100, extra_price: 20, vendor_name: "가상 업체",
  }));
}
function fixture(rows: Row[], options: { pageCap?: number; countMissing?: boolean; pageError?: boolean } = {}) {
  const queries: { select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>; limit: ReturnType<typeof vi.fn> }[] = [];
  const admin = {
    from: vi.fn((table: string) => {
      if (table !== "cohort_contracts") throw new Error("다른 집합의 통계 조회");
      let projection = "";
      const query = {
        select: vi.fn((value: string) => { projection = value; return query; }),
        eq: vi.fn(() => query), order: vi.fn(() => query), limit: vi.fn(() => query),
        then: (resolve: (result: unknown) => unknown) => {
          const paged = projection === "category, user_id, base_price, extra_price";
          return Promise.resolve(resolve({
            data: paged ? rows.slice(0, options.pageCap ?? 10_000) : rows,
            error: paged && options.pageError ? { code: "SYNTHETIC" } : null,
            count: options.countMissing ? null : rows.length,
          }));
        },
      };
      queries.push(query);
      return query;
    }),
  };
  mocks.admin.mockReturnValue(admin);
  return { admin, queries };
}
async function request() {
  return GET(new NextRequest("https://example.invalid/api/community/cohort/room-1/contracts"), {
    params: Promise.resolve({ id: "room-1" }),
  });
}
describe("동기방 계약 통계의 실제 참여자 경계", () => {
  afterEach(() => { vi.restoreAllMocks(); });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const membership = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => ({ data: { id: "membership" } })) };
    membership.select.mockReturnValue(membership); membership.eq.mockReturnValue(membership);
    mocks.server.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "self" } } }) },
      from: () => membership,
    });
  });
  it.each([
    [["self", "self", "self", "self", "self"], 1],
    [["self", "u2", "u3", "u4", "u4"], 4],
  ] as const)("다섯 행이어도 다섯 명 미만이면 평균을 숨긴다", async (users, expected) => {
    fixture(contracts([...users]));
    const response = await request();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stats).toEqual([{ room_id: "room-1", category: "studio", sample_size: expected }]);
    expect(JSON.stringify(body)).not.toContain("user_id");
    expect(JSON.stringify(body)).not.toContain('"u2"');
  });
  it("다섯 명 이상일 때만 기존 평균 정책의 값을 유지한다", async () => {
    fixture(contracts(["self", "u2", "u3", "u4", "u5", "u5"]));
    const body = await (await request()).json();
    expect(body.stats[0]).toEqual({ room_id: "room-1", category: "studio", sample_size: 5,
      avg_base_price: 100, avg_extra_price: 20, avg_total: 120 });
  });
  it("참여자 게이트는 분야마다 따로 적용한다", async () => {
    const rows = [...contracts(["self", "u2", "u3", "u4", "u5"]),
      ...contracts(["self", "self", "self", "self", "self"], "dress").map((row) => ({ ...row, id: "d" + row.id }))];
    fixture(rows);
    const body = await (await request()).json();
    expect(body.stats.find((row: { category: string }) => row.category === "studio").avg_total).toBe(120);
    expect(body.stats.find((row: { category: string }) => row.category === "dress").avg_total).toBeUndefined();
  });
  it("서버 상한으로 집합이 잘리면 여러 snapshot을 섞지 않고 503으로 닫는다", async () => {
    const { queries } = fixture(contracts(["self", "u2", "u3", "u4", "u5", "u6"]), { pageCap: 2 });
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("stats");
    const participantQueries = queries.filter((query) => query.select.mock.calls[0]?.[0] === "category, user_id, base_price, extra_price");
    expect(participantQueries).toHaveLength(1);
    for (const query of participantQueries) expect(query.eq).toHaveBeenCalledWith("room_id", "room-1");
    expect(participantQueries[0].select).toHaveBeenCalledWith("category, user_id, base_price, extra_price", { count: "exact" });
    expect(participantQueries[0].limit).toHaveBeenCalledWith(10_000);
  });
  it.each([{ pageError: true }, { countMissing: true }, { pageCap: 0 }, { pageCap: 1 }])(
    "완전한 표본 조회를 확인하지 못하면 평균을 반환하지 않는다: %j", async (options) => {
      fixture(contracts(Array.from({ length: 21 }, (_, i) => "user-" + i)), options);
      const response = await request();
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(await response.json()).not.toHaveProperty("stats");
    },
  );
  it("동일 행 집합에서 기존 행 가중 평균과 null 제외 정책을 지킨다", async () => {
    const rows = contracts(["self", "u2", "u3", "u4", "u5", "u5"])
      .map((row, i) => ({ ...row, base_price: (i + 1) * 100, extra_price: i % 2 ? i * 10 : null }));
    const { admin } = fixture(rows);
    const body = await (await request()).json();
    expect(body.stats[0]).toMatchObject({ sample_size: 5, avg_base_price: 350, avg_extra_price: 30, avg_total: 365 });
    expect(admin.from).not.toHaveBeenCalledWith("cohort_stats");
  });
  it("추가금 전체 null이면 평균도 null이며 총액에는 0으로 합산한다", async () => {
    fixture(contracts(["self", "u2", "u3", "u4", "u5"]).map((row) => ({ ...row, extra_price: null })));
    expect((await (await request()).json()).stats[0]).toMatchObject({ avg_extra_price: null, avg_total: 100 });
  });
  it("정상 빈 집합은 빈 통계로 응답한다", async () => {
    fixture([]);
    const response = await request();
    expect(response.status).toBe(200);
    expect((await response.json()).stats).toEqual([]);
  });
  it("음수의 반올림도 이전 PostgreSQL AVG/ROUND와 같다", async () => {
    fixture(contracts(["self", "u2", "u3", "u4", "u5", "u5"])
      .map((row, i) => ({ ...row, base_price: i < 3 ? -1 : 0, extra_price: 0 })));
    expect((await (await request()).json()).stats[0]).toMatchObject({ avg_base_price: -1, avg_total: -1 });
  });
  it("비회원은 service-role 원본 조회 전에 거절한다", async () => {
    mocks.server.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } });
    expect((await request()).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("로그인했어도 방 비회원이면 service-role 조회 전에 거절한다", async () => {
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: async () => ({ data: null }) };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
    mocks.server.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "outsider" } } }) }, from: () => query });
    expect((await request()).status).toBe(403);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});
