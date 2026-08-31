import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { PATCH } from "../route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "amora:memory:user"),
}));

/**
 * 한 사람이 함께 보는 기억을 켜면 **상대에게 알린다.**
 *
 * ## 왜
 *
 * 공유 기억은 두 사람이 각각 켜야 시작된다. 그런데 한 사람이 켜도 상대는 알 길이
 * 없었다 — 상대가 **우연히** `설정 > 아모라가 기억하는 것` 에 들어가야만
 * "동의 대기 (1/2)" 를 본다. 2026-08-31 에 파운더가 그 화면을 못 찾아 물었다.
 * 파운더가 못 찾으면 사용자는 절대 못 찾는다.
 *
 * ## 종류를 새로 만들지 않았다
 *
 * `event_kind` 와 `href` 는 DB CHECK 로 목록이 고정돼 있어 새 값을 넣으려면
 * 마이그레이션이 필요하다. 목록 안의 `approval_requested`(= 상대가 할 일이 있다)와
 * `/settings` 를 쓴다. 계획 승인 카드와는 섞이지 않는다 — 화면은
 * `tool_name === "manual_plan_change"` 이고 `action_id` 가 있을 때만 그 카드를
 * 그린다(`NotificationPanel.tsx`). 여기는 둘 다 아니다.
 */

const USER_ID = "00000000-0000-4000-8000-000000000001";
const PARTNER_ID = "00000000-0000-4000-8000-000000000002";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";

function query(result: { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => chain,
    single: async () => result,
    maybeSingle: async () => result,
    then: (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

/** RPC 가 돌려주는 값. `enabled` 가 이번 켜기로 시작됐는지를 가른다. */
function setup(rpcResult: Record<string, unknown>) {
  // 테이블마다 다른 것을 돌려줘야 한다. 전부 같은 값을 주면 라우트가 역할을
  // 못 읽어 403 으로 끝나고, "알림이 없다" 는 단언이 **그 403 때문에** 통과한다.
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
    from: vi.fn((table: string) =>
      table === "couples"
        ? query({ data: { bride_id: USER_ID, groom_id: PARTNER_ID }, error: null })
        : query({ data: { couple_id: COUPLE_ID, role: "bride" }, error: null })),
  } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

  const inserts: unknown[] = [];
  const admin = {
    from: vi.fn((table: string) => {
      if (table === "couples") {
        return query({ data: { bride_id: USER_ID, groom_id: PARTNER_ID }, error: null });
      }
      if (table === "couple_change_notifications") {
        return {
          insert: async (value: unknown) => {
            inserts.push(value);
            return { data: null, error: null };
          },
        };
      }
      return query({ data: [], error: null });
    }),
    rpc: vi.fn(async () => ({ data: rpcResult, error: null })),
  };
  vi.mocked(createAdminClient).mockReturnValue(
    admin as unknown as ReturnType<typeof createAdminClient>,
  );
  return { admin, inserts };
}

function toggle(visibility: string, enabled: boolean) {
  return new Request("http://localhost/api/amora/memory", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "toggle", visibility, enabled }),
  });
}

describe("공유 기억을 켜면 상대에게 같이 켜 달라고 알린다", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 켜기는 런타임 플래그 관문을 탄다(꺼져 있으면 503). 끄기는 안 타므로,
    // 이걸 빼면 "끄기" 검사만 통과하고 나머지가 503 으로 실패한다.
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
  });

  it("아직 시작되지 않았으면(1/2) 상대에게 알림을 넣는다", async () => {
    const { inserts } = setup({
      success: true, enabled: false, consented: true,
      required_count: 2, consented_count: 1,
    });

    const response = await PATCH(toggle("shared", true));
    expect(response.status).toBe(200);

    expect(inserts).toHaveLength(1);
    const row = inserts[0] as Record<string, unknown>;
    expect(row.recipient_user_id).toBe(PARTNER_ID);
    expect(row.actor_user_id).toBe(USER_ID);
    expect(row.couple_id).toBe(COUPLE_ID);
    // DB CHECK 가 고정한 목록 안의 값만 쓴다. 벗어나면 INSERT 가 통째로 죽는다.
    expect(row.event_kind).toBe("approval_requested");
    expect(row.href).toBe("/settings");
    // 계획 승인 카드로 오해되지 않게 다른 이름을 쓴다.
    expect(row.tool_name).not.toBe("manual_plan_change");
    // 무엇을 해야 하는지와 어디로 가는지를 말한다.
    expect(String(row.message)).toContain("두 분이 모두 켜야");
    expect(String(row.message)).toContain("아모라가 기억하는 것");
    // 제목·본문 길이 제약(120 / 240)을 넘지 않는다.
    expect(String(row.title).length).toBeLessThanOrEqual(120);
    expect(String(row.message).length).toBeLessThanOrEqual(240);
  });

  it("두 번째 사람이 켜서 시작됐으면 알리지 않는다", async () => {
    // 이미 시작됐는데 "같이 켜 달라"고 하면 거짓말이다.
    const { inserts } = setup({
      success: true, enabled: true, consented: true,
      required_count: 2, consented_count: 2,
    });

    const response = await PATCH(toggle("shared", true));
    expect(response.status, "요청이 성공해야 이 단언에 뜻이 있다").toBe(200);
    expect(inserts).toHaveLength(0);
  });

  it("끄는 것에는 알리지 않는다", async () => {
    const { inserts } = setup({
      success: true, enabled: false, consented: false,
      required_count: 2, consented_count: 0,
    });

    const response = await PATCH(toggle("shared", false));
    expect(response.status, "요청이 성공해야 이 단언에 뜻이 있다").toBe(200);
    expect(inserts).toHaveLength(0);
  });

  it("혼자 쓰는 기억에는 알리지 않는다", async () => {
    // 개인 기억은 한 사람이면 끝난다. 상대가 할 일이 없다.
    const { inserts } = setup({
      success: true, enabled: true, consented: true,
      required_count: 1, consented_count: 1,
    });

    const response = await PATCH(toggle("bride_private", true));
    expect(response.status, "요청이 성공해야 이 단언에 뜻이 있다").toBe(200);
    expect(inserts).toHaveLength(0);
  });
});
