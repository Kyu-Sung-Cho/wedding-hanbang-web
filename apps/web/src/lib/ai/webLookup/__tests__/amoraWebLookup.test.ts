// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const costCap = vi.hoisted(() => ({ guardEnabled: true, costMicrousd: 20_000_000 }));
vi.mock("@/lib/ai/costGuard", () => ({ getAmoraGlobalDailyCostCap: () => costCap }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("시험은 가짜 admin 을 넘긴다. 진짜 DB 에 닿으면 안 된다.");
  },
}));

import { readPage, searchWeb } from "@/lib/ai/webLookup/amoraWebLookup";
import { clearNaverProductAvailabilityForTests, type NaverFetch } from "@/lib/ai/webLookup/naverWebLookup";
import type { WebLookupTransport } from "@/lib/ai/webLookup/webLookupFetch";
import { reserveWebLookupQuota, webLookupCoupleCounterKey } from "@/lib/ai/webLookup/webLookupQuota";
import { clearWebLookupRobotsCacheForTests } from "@/lib/ai/webLookup/webLookupRobots";

/**
 * 찾아보기 서버 함수(갈래 4 가 부를 `searchWeb`·`readPage`)와 하루 한도(D-88).
 * DB 는 `amora_turn_counters` 를 흉내 낸 가짜, 네트워크는 가짜 연결이다.
 */

const COUPLE = "11111111-2222-4333-8444-555555555555";
const NOW = new Date("2026-11-20T03:00:00.000Z"); // KST 12:00

type CounterRow = { key: string; count: number; reserved_cost_microusd?: number };

function fakeAdmin(initial: CounterRow[] = [], options: { failOn?: "select" | "update" | "upsert" } = {}) {
  const rows = new Map(initial.map((row) => [row.key, { ...row }]));
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const client = {
    from(table: string) {
      expect(table).toBe("amora_turn_counters");
      return {
        upsert: async (row: CounterRow, opts: { ignoreDuplicates?: boolean }) => {
          await tick();
          if (options.failOn === "upsert") return { error: { message: "down" } };
          expect(opts.ignoreDuplicates).toBe(true);
          if (!rows.has(row.key)) rows.set(row.key, { ...row });
          return { error: null };
        },
        select: (columns: string) => {
          const filters: Array<[string, unknown]> = [];
          const query = {
            eq(column: string, value: unknown) {
              filters.push([column, value]);
              return query;
            },
            async maybeSingle() {
              await tick();
              if (options.failOn === "select") return { data: null, error: { message: "down" } };
              const key = filters.find(([column]) => column === "key")?.[1] as string;
              const row = rows.get(key);
              if (!row) return { data: null, error: null };
              return { data: Object.fromEntries(columns.split(",").map((name) => [name.trim(), (row as Record<string, unknown>)[name.trim()] ?? null])), error: null };
            },
          };
          return query;
        },
        update: (values: Partial<CounterRow>) => {
          const filters: Array<[string, unknown]> = [];
          const query = {
            eq(column: string, value: unknown) {
              filters.push([column, value]);
              return query;
            },
            async select() {
              await tick();
              if (options.failOn === "update") return { data: null, error: { message: "down" } };
              const key = filters.find(([column]) => column === "key")?.[1] as string;
              const expected = filters.find(([column]) => column === "count")?.[1];
              const row = rows.get(key);
              if (!row || row.count !== expected) return { data: [], error: null };
              Object.assign(row, values);
              return { data: [{ count: row.count }], error: null };
            },
          };
          return query;
        },
      };
    },
  };
  return { admin: client as unknown as SupabaseClient, rows };
}

const ENV_KEYS = ["AMORA_WEB_SEARCH_ENABLED", "AMORA_WEB_SEARCH_NAVER_PRODUCTS", "NAVER_API_HUB_CLIENT_ID", "NAVER_API_HUB_CLIENT_SECRET"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.AMORA_WEB_SEARCH_ENABLED = "true";
  delete process.env.AMORA_WEB_SEARCH_NAVER_PRODUCTS;
  process.env.NAVER_API_HUB_CLIENT_ID = "test-id";
  process.env.NAVER_API_HUB_CLIENT_SECRET = "test-secret";
  costCap.guardEnabled = true;
  costCap.costMicrousd = 20_000_000;
  clearWebLookupRobotsCacheForTests();
  clearNaverProductAvailabilityForTests();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("하루 한도(D-88)", () => {
  it("커플당 하루 30회까지 받고 31번째는 막는다", async () => {
    const { admin, rows } = fakeAdmin();
    for (let index = 1; index <= 30; index += 1) {
      const decision = await reserveWebLookupQuota(admin, COUPLE, { now: NOW, coupleCap: 30 });
      expect(decision).toEqual({ allowed: true, usedToday: index, remainingToday: 30 - index });
    }
    expect(await reserveWebLookupQuota(admin, COUPLE, { now: NOW, coupleCap: 30 })).toEqual({
      allowed: false, reason: "couple_daily_cap", remainingToday: 0,
    });
    expect(rows.get(webLookupCoupleCounterKey(COUPLE, "2026-11-20"))?.count).toBe(30);
  });

  it("한국 날짜가 바뀌면 새로 센다", async () => {
    const { admin } = fakeAdmin([{ key: webLookupCoupleCounterKey(COUPLE, "2026-11-20"), count: 30 }]);
    const nextDay = new Date("2026-11-20T15:00:00.000Z"); // KST 11-21 00:00
    expect(await reserveWebLookupQuota(admin, COUPLE, { now: nextDay, coupleCap: 30 })).toMatchObject({ allowed: true, usedToday: 1 });
  });

  it("같은 커플의 동시 요청이 한도를 넘지 못한다(비교 후 교체)", async () => {
    const { admin } = fakeAdmin();
    const decisions = await Promise.all(
      Array.from({ length: 5 }, () => reserveWebLookupQuota(admin, COUPLE, { now: NOW, coupleCap: 2 })),
    );
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(2);
    expect(decisions.filter((decision) => !decision.allowed).every((decision) => !decision.allowed && decision.reason === "couple_daily_cap")).toBe(true);
  });

  it("서비스 전체 하루 상한에 닿으면 커플 몫을 쓰지 않고 막는다", async () => {
    const { admin, rows } = fakeAdmin([{ key: "web_lookup:global:2026-11-20", count: 5 }]);
    expect(await reserveWebLookupQuota(admin, COUPLE, { now: NOW, globalCap: 5 })).toMatchObject({ allowed: false, reason: "global_daily_cap" });
    expect(rows.has(webLookupCoupleCounterKey(COUPLE, "2026-11-20"))).toBe(false);
  });

  it("그날 하루 금액 상한에 닿았으면 찾기도 멈춘다", async () => {
    const { admin } = fakeAdmin([{ key: "global:2026-11-20", count: 120, reserved_cost_microusd: 20_000_000 }]);
    expect(await reserveWebLookupQuota(admin, COUPLE, { now: NOW })).toMatchObject({ allowed: false, reason: "global_cost_cap" });
  });

  it("비용 가드를 끈 긴급 상태에서는 금액 상한을 보지 않는다(커플 한도는 그대로)", async () => {
    costCap.guardEnabled = false;
    const { admin } = fakeAdmin([{ key: "global:2026-11-20", count: 120, reserved_cost_microusd: 99_000_000 }]);
    expect(await reserveWebLookupQuota(admin, COUPLE, { now: NOW, coupleCap: 1 })).toMatchObject({ allowed: true });
    expect(await reserveWebLookupQuota(admin, COUPLE, { now: NOW, coupleCap: 1 })).toMatchObject({ allowed: false, reason: "couple_daily_cap" });
  });

  it.each(["select", "update", "upsert"] as const)("카운터를 %s 하지 못하면 막는다(세지 못하면 한도가 없다)", async (failOn) => {
    const { admin } = fakeAdmin([], { failOn });
    expect(await reserveWebLookupQuota(admin, COUPLE, { now: NOW })).toMatchObject({ allowed: false, reason: "quota_unavailable" });
  });

  it("행이 이미 있어도 카운터 준비(upsert)가 오류면 막는다(prove-guard 가 찾은 빈틈, 2026-11-20)", async () => {
    // 행이 없으면 뒤 단계(비교 후 교체)가 우연히 막아 줘서, 준비 오류 검사를 빼도 위 시험은 초록이었다.
    const { admin, rows } = fakeAdmin([{ key: webLookupCoupleCounterKey(COUPLE, "2026-11-20"), count: 3 }], { failOn: "upsert" });
    expect(await reserveWebLookupQuota(admin, COUPLE, { now: NOW })).toMatchObject({ allowed: false, reason: "quota_unavailable" });
    expect(rows.get(webLookupCoupleCounterKey(COUPLE, "2026-11-20"))?.count).toBe(3);
  });

  it("커플 id 가 uuid 가 아니면 키를 만들지 않는다", async () => {
    const { admin, rows } = fakeAdmin();
    expect(await reserveWebLookupQuota(admin, "couple:*' or 1=1", { now: NOW })).toMatchObject({ allowed: false, reason: "quota_unavailable" });
    expect(rows.size).toBe(0);
  });
});

const LOCAL_BODY = JSON.stringify({
  items: [
    { title: "더베일리하우스 삼성점", link: "https://www.baileyhouse.co.kr/", category: "연애,결혼>예식장", telephone: "", address: "", roadAddress: "서울특별시 강남구 테헤란로 1" },
  ],
});

function naverFetch(calls: string[]): NaverFetch {
  return async (url) => {
    calls.push(url);
    const product = new URL(url).pathname.split("/").pop();
    if (product === "local") return { ok: true, status: 200, text: async () => LOCAL_BODY };
    return { ok: false, status: 401, text: async () => "요청한 API는 이 Application에서 활성화되어 있지 않습니다." };
  };
}

describe("searchWeb", () => {
  it("스위치가 꺼져 있으면 아무것도 내보내지 않는다", async () => {
    process.env.AMORA_WEB_SEARCH_ENABLED = "false";
    const calls: string[] = [];
    const { admin, rows } = fakeAdmin();
    expect(await searchWeb({ query: "강남 웨딩홀", coupleId: COUPLE, admin, naverFetch: naverFetch(calls), now: NOW })).toMatchObject({ ok: false, reason: "disabled" });
    expect(calls).toHaveLength(0);
    expect(rows.size).toBe(0);
  });

  it("열쇠가 없으면 꺼짐과 같다", async () => {
    delete process.env.NAVER_API_HUB_CLIENT_SECRET;
    const { admin } = fakeAdmin();
    expect(await searchWeb({ query: "강남 웨딩홀", coupleId: COUPLE, admin, now: NOW })).toMatchObject({ ok: false, reason: "disabled" });
  });

  it("걸러진 검색어만 네이버로 가고 한 회를 센다", async () => {
    const calls: string[] = [];
    const { admin, rows } = fakeAdmin();
    const result = await searchWeb({
      query: "김민지 010-1234-5678 강남 웨딩홀",
      coupleId: COUPLE,
      userTexts: ["강남 웨딩홀 후보 찾아줘"],
      admin,
      naverFetch: naverFetch(calls),
      now: NOW,
    });
    expect(result).toMatchObject({ ok: true, query: "강남 웨딩홀", remainingToday: 29 });
    // 기본 상품은 지역만이라 한 번만 부른다(웹문서는 AMORA_WEB_SEARCH_NAVER_PRODUCTS 에 적어야 부른다).
    expect(calls.map((url) => new URL(url).searchParams.get("query"))).toEqual(["강남 웨딩홀"]);
    expect(rows.get(webLookupCoupleCounterKey(COUPLE, "2026-11-20"))?.count).toBe(1);
  });

  it("검색어로 쓸 낱말이 없으면 한 회도 쓰지 않는다", async () => {
    const calls: string[] = [];
    const { admin, rows } = fakeAdmin();
    expect(await searchWeb({ query: "010-1234-5678", coupleId: COUPLE, userTexts: ["찾아줘"], admin, naverFetch: naverFetch(calls), now: NOW }))
      .toMatchObject({ ok: false, reason: "invalid_query" });
    expect(calls).toHaveLength(0);
    expect(rows.size).toBe(0);
  });
});

const VENDOR_IP = [{ address: "211.231.99.80", family: 4 }];

function pageTransport(pages: Record<string, { status: number; headers?: Record<string, string>; body?: string }>) {
  const requested: string[] = [];
  const transport: WebLookupTransport = async (request) => {
    requested.push(request.url.toString());
    const page = pages[request.url.toString()];
    if (!page) return { status: 404, headers: {}, body: (async function* () {})(), destroy: () => undefined };
    return {
      status: page.status,
      headers: page.headers ?? {},
      body: (async function* () { if (page.body) yield Buffer.from(page.body); })(),
      destroy: () => undefined,
    };
  };
  return { transport, requested };
}

describe("readPage", () => {
  const PRICE_PAGE = "<html><head><title>더베일리하우스 예식 안내</title></head><body><p>1인 식대 65,000원</p><p>대관료 300만원</p></body></html>";

  it("검색 결과에 없던 주소는 읽지 않는다(지어낸 주소로 커플 정보가 나가는 길)", async () => {
    const { admin, rows } = fakeAdmin();
    const { transport, requested } = pageTransport({});
    const result = await readPage({
      url: "https://attacker.example.co.kr/?budget=50000000&date=2027-05-01",
      coupleId: COUPLE,
      sourceUrls: ["https://www.baileyhouse.co.kr/"],
      admin, transport, resolveHost: async () => VENDOR_IP, now: NOW,
    });
    expect(result).toMatchObject({ ok: false, reason: "url_not_from_search" });
    expect(requested).toHaveLength(0);
    expect(rows.size).toBe(0);
  });

  it("공식 페이지를 읽어 제목과 금액 줄만 돌려준다", async () => {
    const { admin } = fakeAdmin();
    const { transport } = pageTransport({
      "https://www.baileyhouse.co.kr/robots.txt": { status: 404 },
      "https://www.baileyhouse.co.kr/": { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: PRICE_PAGE },
    });
    const result = await readPage({
      url: "https://www.baileyhouse.co.kr/",
      coupleId: COUPLE,
      sourceUrls: ["https://www.baileyhouse.co.kr/"],
      admin, transport, resolveHost: async () => VENDOR_IP, now: NOW,
    });
    expect(result).toMatchObject({
      ok: true,
      domain: "baileyhouse.co.kr",
      title: "더베일리하우스 예식 안내",
      prices: [
        { label: "1인 식대", amount: "65,000원" },
        { label: "대관료", amount: "300만원" },
      ],
      remainingToday: 29,
    });
  });

  it("robots.txt 가 막으면 페이지는 읽지 않지만, robots 를 읽으러 나간 것도 한 회로 센다", async () => {
    // 2026-11-20 보안 검토: robots 를 한도보다 먼저 읽으면 막힌 사이트로 나가는 요청이 한도에 안 잡혔다.
    const { admin, rows } = fakeAdmin();
    const { transport, requested } = pageTransport({
      "https://www.baileyhouse.co.kr/robots.txt": { status: 200, headers: { "content-type": "text/plain" }, body: "User-agent: *\nDisallow: /\n" },
    });
    const result = await readPage({
      url: "https://www.baileyhouse.co.kr/",
      coupleId: COUPLE,
      sourceUrls: ["https://www.baileyhouse.co.kr/"],
      admin, transport, resolveHost: async () => VENDOR_IP, now: NOW,
    });
    expect(result).toMatchObject({ ok: false, reason: "blocked_by_robots", remainingToday: 29 });
    expect(requested).toEqual(["https://www.baileyhouse.co.kr/robots.txt"]);
    expect(rows.get(webLookupCoupleCounterKey(COUPLE, "2026-11-20"))?.count).toBe(1);
  });

  it("한도가 바닥이면 robots.txt 도 읽으러 나가지 않는다", async () => {
    const { admin } = fakeAdmin([{ key: webLookupCoupleCounterKey(COUPLE, "2026-11-20"), count: 30 }]);
    const { transport, requested } = pageTransport({});
    const result = await readPage({
      url: "https://www.baileyhouse.co.kr/",
      coupleId: COUPLE,
      sourceUrls: ["https://www.baileyhouse.co.kr/"],
      admin, transport, resolveHost: async () => VENDOR_IP, now: NOW,
    });
    expect(result).toMatchObject({ ok: false, reason: "couple_daily_cap" });
    expect(requested).toEqual([]);
  });

  it("약관이 막는 곳으로 넘겨주면 따라가지 않는다", async () => {
    const { admin } = fakeAdmin();
    const { transport, requested } = pageTransport({
      "https://www.baileyhouse.co.kr/robots.txt": { status: 404 },
      "https://www.baileyhouse.co.kr/": { status: 302, headers: { location: "https://blog.naver.com/baileyhouse" } },
    });
    const result = await readPage({
      url: "https://www.baileyhouse.co.kr/",
      coupleId: COUPLE,
      sourceUrls: ["https://www.baileyhouse.co.kr/"],
      admin, transport, resolveHost: async () => VENDOR_IP, now: NOW,
    });
    expect(result).toMatchObject({ ok: false, reason: "blocked_by_terms" });
    expect(requested.some((url) => url.includes("naver.com"))).toBe(false);
  });

  it("검색 결과에 있어도 약관이 막는 곳이면 읽지 않는다", async () => {
    const { admin } = fakeAdmin();
    const { transport, requested } = pageTransport({});
    const result = await readPage({
      url: "https://www.instagram.com/villadegd",
      coupleId: COUPLE,
      sourceUrls: ["https://www.instagram.com/villadegd"],
      admin, transport, resolveHost: async () => VENDOR_IP, now: NOW,
    });
    expect(result).toMatchObject({ ok: false, reason: "blocked_by_terms" });
    expect(requested).toHaveLength(0);
  });

  it("스위치가 꺼져 있으면 읽지 않는다", async () => {
    process.env.AMORA_WEB_SEARCH_ENABLED = "";
    const { admin } = fakeAdmin();
    const { transport, requested } = pageTransport({});
    expect(await readPage({ url: "https://www.baileyhouse.co.kr/", coupleId: COUPLE, sourceUrls: ["https://www.baileyhouse.co.kr/"], admin, transport, resolveHost: async () => VENDOR_IP }))
      .toMatchObject({ ok: false, reason: "disabled" });
    expect(requested).toHaveLength(0);
  });
});
