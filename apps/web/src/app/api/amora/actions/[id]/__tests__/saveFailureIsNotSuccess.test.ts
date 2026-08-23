// @vitest-environment node

/**
 * 저장이 실패했으면 성공이라고 말하지 않는다.
 *
 * ## 무엇이 있었나
 *
 * 레거시 경로는 RPC 가 실패하면 `wedding_journeys` 를 직접 UPDATE 하는 폴백을 갖고
 * 있었는데, **그 오류를 아무도 보지 않았다.** 그러고는 바뀐 값을 그대로 돌려줬고
 * 라우트는 200 을 냈다.
 *
 *     RPC 실패 → 폴백도 실패 → 200 { action: { status: "done" } }
 *
 * 사용자에게는 완료된 것으로 보인다. 앱은 그 줄을 화면에서 지운다. 그런데 다음에
 * 열면 그대로 살아 있다. 무엇을 잃었는지 알 방법이 없다.
 *
 * 웹 라운지가 이미 쓰는 경로이고, 앱의 완료 버튼도 같은 곳을 부른다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ACTION_ID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const COUPLE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  rpcError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  updateCalls: 0,
}));

function journeyRow() {
  return {
    id: "journey-1",
    progress: {
      __amora_actions: [
        {
          id: ACTION_ID,
          title: "청첩장 문구 확정하기",
          status: "open",
          priority: "medium",
          source: "chat",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({ single: async () => ({ data: { couple_id: COUPLE_ID }, error: null }) }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: journeyRow(), error: null }) }),
        }),
        update: () => ({
          eq: async () => {
            state.updateCalls += 1;
            return { error: state.updateError };
          },
        }),
      };
    },
    rpc: async () => ({ error: state.rpcError }),
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
  }),
}));

vi.mock("@/lib/amora/actionRepository", () => ({
  updateAmoraActionRecord: async () => {
    const error = new Error("relation \"amora_actions\" does not exist");
    (error as { code?: string }).code = "42P01";
    throw error;
  },
  isAmoraActionStorageUnavailable: () => true,
}));

async function patchDone() {
  const { PATCH } = await import("../route");
  return PATCH(
    new Request(`https://hanbang.ai/api/amora/actions/${ACTION_ID}`, {
      method: "PATCH",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ status: "done" }),
    }),
    { params: Promise.resolve({ id: ACTION_ID }) },
  );
}

beforeEach(() => {
  vi.resetModules();
  state.rpcError = null;
  state.updateError = null;
  state.updateCalls = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("아모라 행동 저장", () => {
  it("정상 저장은 그대로 200 이다", async () => {
    const response = await patchDone();
    expect(response.status).toBe(200);
    // RPC 가 성공했으면 폴백을 부르지 않는다.
    expect(state.updateCalls).toBe(0);
  });

  it("RPC 가 실패해도 폴백이 성공하면 200 이다", async () => {
    state.rpcError = { message: "function unavailable" };
    const response = await patchDone();
    expect(response.status).toBe(200);
    expect(state.updateCalls).toBe(1);
  });

  it("두 쓰기가 모두 실패하면 성공이라고 말하지 않는다", async () => {
    // 이 검사가 없으면 사용자는 완료됐다고 믿고, 앱은 줄을 지우고,
    // 다음에 열면 그대로 살아 있다.
    state.rpcError = { message: "function unavailable" };
    state.updateError = { message: "write boundary rejected" };

    const response = await patchDone();

    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload).not.toHaveProperty("action");
    expect(payload.error).toContain("수정하지 못했");
  });

  it("저장 실패를 '찾지 못했습니다'로 바꾸지 않는다", async () => {
    // 404 는 대상이 없다는 뜻이다. 대상은 있었고 쓰기가 실패한 것이다.
    state.rpcError = { message: "function unavailable" };
    state.updateError = { message: "write boundary rejected" };

    const response = await patchDone();
    expect(response.status).not.toBe(404);
  });
});
