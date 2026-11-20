import { vi } from "vitest";

/**
 * 경로 시험용 가짜 Supabase. 표마다 돌려줄 결과를 정하고, 어떤 거르기를 불렀는지 기록한다.
 * 결과는 함수로도 줄 수 있어서 같은 표를 다른 거르기로 두 번 읽는 경로도 시험한다.
 */

export type QueryResult = { data: unknown; error: unknown; count?: number | null };
export type QueryCall = { table: string; method: string; args: unknown[] };
export type TableHandler = QueryResult | ((calls: QueryCall[]) => QueryResult);

export type FakeClient = {
  calls: QueryCall[];
  rpc: ReturnType<typeof vi.fn>;
  from: (table: string) => unknown;
  auth: { getUser: ReturnType<typeof vi.fn> };
};

const CHAIN = ["select", "eq", "in", "is", "order", "limit", "gte", "insert", "delete", "update", "or", "neq"] as const;

export function createFakeClient(input: {
  user?: { id: string } | null;
  tables?: Record<string, TableHandler>;
  rpc?: (name: string, args: Record<string, unknown>) => QueryResult | Promise<QueryResult>;
}): FakeClient {
  const calls: QueryCall[] = [];
  const tables = input.tables ?? {};
  const from = (table: string) => {
    const own: QueryCall[] = [];
    const resolve = (): QueryResult => {
      const handler = tables[table];
      if (handler === undefined) throw new Error(`unexpected table: ${table}`);
      return typeof handler === "function" ? handler(own) : handler;
    };
    const query: Record<string, unknown> = {};
    for (const method of CHAIN) {
      query[method] = (...args: unknown[]) => {
        const call = { table, method, args };
        own.push(call);
        calls.push(call);
        return query;
      };
    }
    query.maybeSingle = async () => resolve();
    query.single = async () => resolve();
    query.then = (onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve().then(resolve).then(onFulfilled, onRejected);
    return query;
  };
  return {
    calls,
    from,
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (!input.rpc) throw new Error(`unexpected rpc: ${name}`);
      return input.rpc(name, args);
    }),
    auth: { getUser: vi.fn(async () => ({ data: { user: input.user ?? null } })) },
  };
}

export const ok = (data: unknown, count?: number): QueryResult => ({ data, error: null, ...(count === undefined ? {} : { count }) });
export const fail = (code = "XX000", message = "synthetic failure"): QueryResult => ({ data: null, error: { code, message } });

/** 같은 표에서 마지막으로 부른 거르기 값. */
export function filterValue(calls: QueryCall[], method: string, column: string): unknown {
  const call = [...calls].reverse().find((item) => item.method === method && item.args[0] === column);
  return call?.args[1];
}

export function jsonRequest(url: string, method: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

/** 커플 회원 한 쌍의 기본 표. 신부 자리가 요청한 사람이다. */
export const IDS = {
  bride: "11111111-1111-4111-8111-111111111111",
  groom: "22222222-2222-4222-8222-222222222222",
  outsider: "33333333-3333-4333-8333-333333333333",
  couple: "55555555-5555-4555-8555-555555555555",
  hallA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  hallB: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  hallC: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  letter: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  version: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  dispatchA: "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1",
  dispatchB: "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2",
  replyA: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  replyB: "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2",
} as const;

export const FINGERPRINT = "a".repeat(64);

export function coupleTables(overrides: {
  progress?: Record<string, unknown>;
  weddingDate?: string | null;
  venue?: string | null;
  totalBudget?: number;
  sealed?: boolean;
  viewerRole?: "bride" | "groom";
  partnerName?: string | null;
} = {}): Record<string, TableHandler> {
  return {
    profiles: ok({ id: IDS.bride, name: "민지", role: overrides.viewerRole ?? "bride", couple_id: IDS.couple }),
    couples: ok({
      id: IDS.couple,
      bride_id: IDS.bride,
      groom_id: IDS.groom,
      membership_sealed_at: overrides.sealed === false ? null : "2026-11-01T00:00:00Z",
    }),
    couple_profile_directory: ok(overrides.partnerName === null ? null : { id: IDS.groom, name: overrides.partnerName ?? "준호" }),
    wedding_journeys: ok({
      wedding_date: overrides.weddingDate ?? null,
      venue: overrides.venue ?? null,
      total_budget: overrides.totalBudget ?? 0,
      progress: overrides.progress ?? {},
      state_revision: 7,
    }),
  };
}

export function listingRow(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    region: "서울",
    area_label: "마포구 하우스웨딩",
    kind_label: "하우스웨딩",
    meal_price_won: 68_000,
    rental_fee_won: null,
    rental_included: true,
    minimum_guarantee: 180,
    station_walk_minutes: 8,
    transit_note: null,
    photo_url: null,
    source_url: "https://example.com/price",
    checked_on: "2026-11-14",
    active: true,
    ...extra,
  };
}
