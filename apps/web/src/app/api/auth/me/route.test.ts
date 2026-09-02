import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { GET } from "./route";

const routeSource = readFileSync(
  resolve(process.cwd(), "src/app/api/auth/me/route.ts"),
  "utf8",
);

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/demoSession", () => ({
  hasSignedDemoSessionFromCookieHeader: vi.fn(() => false),
}));

describe("/api/auth/me GET guest probe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    } as never);
  });

  it("keeps the normal endpoint authentication-required", async () => {
    const response = await GET(new Request("http://localhost/api/auth/me"));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns a cache-disabled anonymous result for the exact guest probe", async () => {
    const response = await GET(
      new Request("http://localhost/api/auth/me?guest_probe=1"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toEqual({ user: null });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("does not enable the probe for a truthy-looking alternative value", async () => {
    const response = await GET(
      new Request("http://localhost/api/auth/me?guest_probe=true"),
    );

    expect(response.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("projects private rows explicitly and keeps invite codes behind their dedicated API", () => {
    expect(routeSource).not.toContain('.select("*")');
    expect(routeSource).not.toMatch(/\.select\(\s*\)/);
    expect(routeSource).not.toMatch(
      /PROFILE_AUTH_COLUMNS[\s\S]*phone|PROFILE_AUTH_COLUMNS[\s\S]*push_token/,
    );
    expect(routeSource).toContain("invite_code: null");
    expect(routeSource).toContain("PRIVATE_NO_STORE_HEADERS");
    expect(routeSource).toMatch(
      /JOURNEY_AUTH_COLUMNS[\s\S]*state_revision/,
    );
    expect(routeSource).toContain("journeyInsertErr?.code === \"23505\"");
  });
});

/**
 * 딥링크로 `/wedding/*` 를 처음 열면 앱 셸이 이 응답을 기다리는 동안 화면 전체가
 * "웨딩 라운지를 불러오는 중..." 으로 덮인다. 그래서 여기서 줄인 왕복은 그대로
 * 사람이 기다리지 않는 시간이 된다.
 *
 * 커플·member_model·여정 셋은 서로의 결과를 쓰지 않는다 — 전부 couple_id 하나만
 * 있으면 된다. 예전에는 차례로 기다려서 왕복 세 번이 그대로 대기 시간이었다.
 */
describe("/api/auth/me 콜드 로드 왕복", () => {
  interface PendingQuery {
    table: string;
    columns: string;
    resolve: (value: unknown) => void;
  }

  /** 결과를 쥐고 있는 클라이언트. 풀어 주기 전까지 어떤 조회도 끝나지 않는다. */
  function stallingClient(pending: PendingQuery[]) {
    return {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "a@b.test", user_metadata: {} } },
        }),
      },
      from: (table: string) => {
        let columns = "";
        const builder: Record<string, unknown> = {
          select: (cols: string) => {
            columns = cols;
            return builder;
          },
          eq: () => builder,
        };
        const stall = () =>
          new Promise((resolve) => pending.push({ table, columns, resolve }));
        builder.single = stall;
        builder.maybeSingle = stall;
        return builder;
      },
    };
  }

  /** 프로필은 곧바로 답한다 — 커플 조회는 couple_id 를 알아야 시작한다. */
  function instantAdmin(row: unknown) {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      update: () => builder,
      insert: () => builder,
      single: () => Promise.resolve({ data: row, error: null }),
      maybeSingle: () => Promise.resolve({ data: row, error: null }),
    };
    return { from: () => builder };
  }

  it("커플·member_model·여정을 한 번에 내보낸다", async () => {
    const pending: PendingQuery[] = [];
    vi.mocked(createClientFromRequest).mockResolvedValue(
      stallingClient(pending) as never,
    );
    vi.mocked(createAdminClient).mockReturnValue(
      instantAdmin({ id: "user-1", name: "사람", couple_id: "couple-1" }) as never,
    );

    const response = GET(new Request("http://localhost/api/auth/me"));
    // 프로필 조회가 끝나 커플 블록까지 닿게만 하고, 세 조회는 아직 풀지 않는다.
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();

    // 하나도 응답하지 않았는데 셋 다 이미 나가 있어야 한다. 차례로 기다리면
    // 이 시점에 커플 조회 하나뿐이다.
    expect(pending).toHaveLength(3);
    expect(pending.filter((query) => query.table === "couples")).toHaveLength(2);
    expect(
      pending.filter((query) => query.columns.includes("member_model_version")),
    ).toHaveLength(1);
    expect(
      pending.filter((query) => query.table === "wedding_journeys"),
    ).toHaveLength(1);

    for (const query of pending) query.resolve({ data: null, error: null });
    expect((await response).status).toBe(200);
  });
});
