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
 * 공유 기억 동의는 **알림을 만들지 않는다.** 만들려다 실패해서도 안 된다.
 *
 * ## 왜 이 검사가 있나
 *
 * 2026-08-31 에 "상대에게 같이 켜 달라고 알린다" 를 `couple_change_notifications`
 * 로 넣었다. **한 번도 나가지 않았다.** 그 테이블의 `source_message_id` 와
 * `action_id` 가 NOT NULL 이고 기본값이 없는데 둘 다 빼고 INSERT 했다. 매번
 * 23502 로 죽었고 그 오류는 `console.warn` 으로 삼켜졌다. 운영 알림 41건 중
 * `amora_memory_consent` 는 0건이었다.
 *
 * **그때 테스트는 전부 초록이었다.** 가짜 DB 의 `insert` 가 무엇을 넣든 성공을
 * 돌려줬기 때문이다. 제약을 흉내내지 않는 mock 은 스키마 위반을 증명할 수 없다.
 *
 * 그래서 이 검사는 두 가지를 한다.
 *   1. 동의 경로가 알림 테이블을 **건드리지 않는지** 확인한다.
 *   2. 가짜 DB 가 **NOT NULL 을 실제로 강제한다.** 누가 알림을 되살리면서 그 두
 *      컬럼을 빠뜨리면 여기서 죽는다 — 운영에서 조용히 죽는 대신에.
 */

const USER_ID = "00000000-0000-4000-8000-000000000001";
const PARTNER_ID = "00000000-0000-4000-8000-000000000002";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";

/** 운영 스키마가 값을 요구하는 컬럼. 2026-08-31 실측. */
const NOT_NULL_COLUMNS = ["source_message_id", "action_id", "tool_name", "href", "event_kind"];

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

function setup() {
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
    from: vi.fn((table: string) =>
      table === "couples"
        ? query({ data: { bride_id: USER_ID, groom_id: PARTNER_ID }, error: null })
        : query({ data: { couple_id: COUPLE_ID, role: "bride" }, error: null })),
  } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

  const notificationInserts: unknown[] = [];
  const admin = {
    from: vi.fn((table: string) => {
      if (table === "couples") {
        return query({ data: { bride_id: USER_ID, groom_id: PARTNER_ID }, error: null });
      }
      if (table === "couple_change_notifications") {
        return {
          // **운영 스키마를 흉내낸다.** 항상 성공을 돌려주면 이 파일의 존재 이유가 없다.
          insert: async (value: Record<string, unknown>) => {
            notificationInserts.push(value);
            const missing = NOT_NULL_COLUMNS
              .filter((column) => value?.[column] === undefined || value?.[column] === null);
            if (missing.length > 0) {
              return {
                data: null,
                error: { code: "23502", message: `null value in column "${missing[0]}"` },
              };
            }
            return { data: null, error: null };
          },
        };
      }
      return query({ data: [], error: null });
    }),
    rpc: vi.fn(async () => ({
      data: {
        success: true, enabled: false, consented: true,
        required_count: 2, consented_count: 1,
      },
      error: null,
    })),
  };
  vi.mocked(createAdminClient).mockReturnValue(
    admin as unknown as ReturnType<typeof createAdminClient>,
  );
  return { admin, notificationInserts };
}

function toggle(visibility: string, enabled: boolean) {
  return new Request("http://localhost/api/amora/memory", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "toggle", visibility, enabled, confirmationTarget: { ownerId: USER_ID, coupleId: COUPLE_ID, privacyEpoch: 7 } }),
  });
}

describe("공유 기억 동의는 알림을 만들지 않는다", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
  });

  it("동의는 저장되고 알림 테이블은 건드리지 않는다", async () => {
    const { admin, notificationInserts } = setup();

    const response = await PATCH(toggle("shared", true));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, consented: true });
    expect(notificationInserts).toHaveLength(0);
    expect(admin.from).not.toHaveBeenCalledWith("couple_change_notifications");
  });

  it("가짜 DB 가 NOT NULL 을 실제로 강제한다", async () => {
    // 이 검사가 없으면 위 검사는 "알림이 없다"를 증명하지 못한다 — mock 이 무엇이든
    // 받아 주면, 되살린 알림이 운영에서만 죽고 테스트는 초록이다.
    const { admin } = setup();
    const table = admin.from("couple_change_notifications") as {
      insert: (value: Record<string, unknown>) => Promise<{ error: { code?: string } | null }>;
    };

    const 빠뜨린것 = await table.insert({
      couple_id: COUPLE_ID,
      recipient_user_id: PARTNER_ID,
      actor_user_id: USER_ID,
      event_kind: "approval_requested",
      tool_name: "amora_memory_consent",
      title: "함께 보는 기억을 같이 켜 주세요",
      message: "상대가 켰어요.",
      href: "/settings",
      // source_message_id · action_id 없음 — 2026-08-31 에 내가 낸 그 모양이다.
    });
    expect(빠뜨린것.error?.code, "NOT NULL 위반이 통과했다").toBe("23502");

    const 다채운것 = await table.insert({
      couple_id: COUPLE_ID,
      recipient_user_id: PARTNER_ID,
      actor_user_id: USER_ID,
      source_message_id: "30000000-0000-4000-8000-000000000001",
      action_id: "40000000-0000-4000-8000-000000000001",
      event_kind: "approval_requested",
      tool_name: "amora_memory_consent",
      title: "함께 보는 기억을 같이 켜 주세요",
      message: "상대가 켰어요.",
      href: "/settings",
    });
    expect(다채운것.error).toBeNull();
  });
});
