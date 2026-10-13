import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClientFromRequest } from "@/lib/supabase/server";
import { GET } from "../route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
  })),
}));
vi.mock("@/utils/log", () => ({ log: { error: vi.fn() } }));

type Row = Record<string, unknown>;
const fixture = {
  actions: [] as Row[],
  legacy: [] as Row[],
  actionError: null as unknown,
  journeyError: null as unknown,
};

class Query {
  private filters: Array<[string, unknown]> = [];
  private start = 0;
  private end = Infinity;
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private ids: unknown[] | undefined;
  private cursor: { createdAt: string; id: string } | null = null;
  select() { return this; }
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
  in(_column: string, values: unknown[]) { this.ids = values; return this; }
  order(column: string, options: { ascending?: boolean } = {}) {
    this.orders.push({ column, ascending: options.ascending !== false });
    return this;
  }
  limit(count: number) { this.end = this.start + count; return this; }
  range(start: number, end: number) { this.start = start; this.end = end + 1; return this; }
  or(filter: string) {
    const match = /^created_at\.lt\.([^,]+),and\(created_at\.eq\.[^,]+,id\.lt\."((?:\\.|[^"\\])*)"\)$/.exec(filter);
    if (!match) throw new Error("Unexpected keyset filter");
    this.cursor = { createdAt: match[1], id: JSON.parse(`"${match[2]}"`) as string };
    return this;
  }
  single() { return Promise.resolve({ data: { couple_id: "couple-1" }, error: null }); }
  maybeSingle() {
    return Promise.resolve({ data: { progress: { __amora_actions: fixture.legacy } }, error: fixture.journeyError });
  }
  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: unknown; count: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const rows = fixture.actions.filter((row) => this.filters.every(([key, value]) => row[key] === value) && (!this.ids || this.ids.includes(row.id))
      && (!this.cursor || String(row.created_at) < this.cursor.createdAt
        || (String(row.created_at) === this.cursor.createdAt && String(row.id).localeCompare(this.cursor.id) < 0)));
    rows.sort((a, b) => {
      for (const { column, ascending } of this.orders) {
        const difference = String(a[column]).localeCompare(String(b[column]));
        if (difference) return ascending ? difference : -difference;
      }
      return 0;
    });
    return Promise.resolve({ data: rows.slice(this.start, this.end), count: rows.length, error: fixture.actionError })
      .then(onfulfilled, onrejected);
  }
}

function action(index: number, status: "open" | "done" = "done"): Row {
  const created = new Date(Date.UTC(2026, 0, index + 1)).toISOString();
  return {
    id: `act_${index}`, couple_id: "couple-1", title: `Action ${index}`,
    status, priority: "medium", source: "chat", created_at: created, updated_at: created,
  };
}

describe("Amora action list", () => {
  beforeEach(() => {
    fixture.actions = [];
    fixture.legacy = [];
    fixture.actionError = null;
    fixture.journeyError = null;
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: () => new Query(),
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
  });

  it("keeps an older unfinished action after more than 80 newer completed actions", async () => {
    fixture.actions = [action(0, "open"), ...Array.from({ length: 81 }, (_, index) => action(index + 1))];
    const response = await GET(new Request("https://hanbang.ai/api/amora/actions?status=open"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      actions: [{ id: "act_0" }], count: 1, open_count: 1, source: "table",
    });
  });
  it("keeps actual raw canonical and legacy view versions separate from display fallback dates", async () => {
    const canonicalToken = "2026-10-12T00:00:00.123456Z";
    const legacyToken = "2026-10-12T09:00:00.123456+09:00";
    fixture.actions = [{ ...action(0, "open"), updated_at: canonicalToken }];
    fixture.legacy = [{ ...action(1, "open"), createdAt: "2026-01-02T00:00:00Z", updatedAt: legacyToken },
      { ...action(2, "open"), createdAt: "2026-01-03T00:00:00Z", viewVersion: canonicalToken }];
    const response = await GET(new Request("https://hanbang.ai/api/amora/actions?status=all"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.actions.find((value: { id: string }) => value.id === "act_0").viewVersion).toBe(canonicalToken);
    expect(body.actions.find((value: { id: string }) => value.id === "act_1").viewVersion).toBe(legacyToken);
    expect(body.actions.find((value: { id: string }) => value.id === "act_2").viewVersion).toBeNull();
  });

  it("counts all unfinished actions while keeping the requested display limit", async () => {
    fixture.actions = Array.from({ length: 85 }, (_, index) => action(index, "open"));
    const response = await GET(new Request("https://hanbang.ai/api/amora/actions?status=open&limit=2"));
    const body = await response.json();
    expect(body.actions).toHaveLength(2);
    expect(body).toMatchObject({ count: 85, open_count: 85 });
  });

  it("does not report zero actions when the legacy journey read fails", async () => {
    fixture.journeyError = { code: "57014", message: "query timed out" };
    const response = await GET(new Request("https://hanbang.ai/api/amora/actions"));
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(await response.json()).not.toHaveProperty("count");
  });

  it("does not revive a stale legacy open card that the table has completed", async () => {
    fixture.actions = [action(0), ...Array.from({ length: 100 }, (_, index) => action(index + 1))];
    fixture.legacy = [{ ...action(0, "open"), createdAt: "2026-01-01", updatedAt: "2026-01-01" }];
    const response = await GET(new Request("https://hanbang.ai/api/amora/actions?status=open"));
    expect(await response.json()).toMatchObject({ actions: [], count: 0, open_count: 0 });
  });

  it("includes legacy-only actions without double-counting mirrored table cards", async () => {
    fixture.actions = [action(0, "open")];
    fixture.legacy = [
      { ...action(0, "open"), createdAt: "2026-01-01", updatedAt: "2026-01-01" },
      { ...action(1, "open"), createdAt: "2026-01-02", updatedAt: "2026-01-02" },
    ];
    const response = await GET(new Request("https://hanbang.ai/api/amora/actions?status=open"));
    const body = await response.json();
    expect(body.actions).toHaveLength(2);
    expect(body).toMatchObject({ count: 2, open_count: 2, truncated: false });
  });

  it("keeps completed results visible even with more than 80 open cards", async () => {
    fixture.actions = [action(0), ...Array.from({ length: 100 }, (_, index) => action(index + 1, "open"))];
    const response = await GET(new Request("https://hanbang.ai/api/amora/actions?status=done"));
    expect(await response.json()).toMatchObject({ actions: [{ id: "act_0" }], count: 1, open_count: 100 });
  });

  it("uses the legacy fallback only for a missing table, not permission failures", async () => {
    fixture.actionError = { code: "42P01" };
    fixture.legacy = [{ ...action(0, "open"), createdAt: "2026-01-01", updatedAt: "2026-01-01" }];
    const fallback = await GET(new Request("https://hanbang.ai/api/amora/actions"));
    expect(await fallback.json()).toMatchObject({ source: "legacy", count: 1, open_count: 1 });

    fixture.actionError = { code: "42501" };
    const failed = await GET(new Request("https://hanbang.ai/api/amora/actions"));
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(await failed.json()).not.toHaveProperty("count");
  });

  async function allPages(status = "all", limit = 80) {
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const params = new URLSearchParams({ status, limit: String(limit) });
      if (cursor) params.set("cursor", cursor);
      const response = await GET(new Request(`https://hanbang.ai/api/amora/actions?${params}`));
      expect(response.status).toBe(200);
      const body = await response.json();
      ids.push(...body.actions.map((item: { id: string }) => item.id));
      expect(body).toHaveProperty("next_cursor");
      cursor = body.next_cursor;
      pages += 1;
      expect(pages).toBeLessThan(20);
    } while (cursor);
    return ids;
  }

  it("reads every canonical action past 80 through bounded stable pages", async () => {
    fixture.actions = Array.from({ length: 171 }, (_, index) => action(index, index % 2 ? "done" : "open"));
    const ids = await allPages();
    expect(ids).toHaveLength(171);
    expect(new Set(ids).size).toBe(171);
    expect(ids[0]).toBe("act_170");
    expect(ids.at(-1)).toBe("act_0");
  });

  it("keeps exact timestamp ties stable across pages", async () => {
    fixture.actions = Array.from({ length: 85 }, (_, index) => ({ ...action(index, "open"), created_at: "2026-01-01T00:00:00.123456Z" }));
    const ids = await allPages("open", 7);
    expect(new Set(ids).size).toBe(85);
    expect(ids).toEqual(fixture.actions.map((row) => String(row.id)).sort((a, b) => b.localeCompare(a)));
  });

  it("paginates all 91 legacy rows when the canonical table is missing", async () => {
    fixture.actionError = { code: "42P01" };
    fixture.legacy = Array.from({ length: 91 }, (_, index) => ({ ...action(index, "open"), createdAt: action(index).created_at }));
    expect(new Set(await allPages()).size).toBe(91);
  });

  it("does not resurrect legacy cards shadowed by canonical rows outside the current page", async () => {
    fixture.actions = Array.from({ length: 95 }, (_, index) => action(index));
    fixture.legacy = Array.from({ length: 91 }, (_, index) => ({ ...action(index, "open"), createdAt: action(index).created_at }));
    const ids = await allPages("open");
    expect(ids).toEqual([]);
  });

  it("merges interleaved canonical and legacy pages without duplicates", async () => {
    fixture.actions = Array.from({ length: 50 }, (_, index) => action(index * 2, "open"));
    fixture.legacy = Array.from({ length: 100 }, (_, index) => ({ ...action(index, "open"), createdAt: action(index).created_at }));
    const ids = await allPages("all", 9);
    expect(ids).toHaveLength(100);
    expect(new Set(ids).size).toBe(100);
    expect(ids).toEqual(Array.from({ length: 100 }, (_, index) => `act_${99 - index}`));
  });

  it("rejects malformed and cross-status cursors instead of silently restarting", async () => {
    expect((await GET(new Request("https://hanbang.ai/api/amora/actions?cursor=bad"))).status).toBe(400);
    fixture.actions = [action(0, "open"), action(1, "open")];
    const first = await (await GET(new Request("https://hanbang.ai/api/amora/actions?status=open&limit=1"))).json();
    expect(typeof first.next_cursor).toBe("string");
    expect((await GET(new Request(`https://hanbang.ai/api/amora/actions?status=done&cursor=${first.next_cursor}`))).status).toBe(400);
  });
});
