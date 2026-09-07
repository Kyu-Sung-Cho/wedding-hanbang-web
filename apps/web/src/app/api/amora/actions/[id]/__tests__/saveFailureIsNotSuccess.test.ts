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
  updateError: null as { message: string } | null,
  updateCalls: 0,
  filters: {} as Record<string, unknown>,
}));

function journeyRow() {
  return {
    id: "journey-1",
    state_revision: 0,
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

function clientFixture() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
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
        update: (payload: { progress: unknown }) => {
          const query = {
            eq: (key: string, value: unknown) => { state.filters[key] = value; return query; },
            select: () => query,
            maybeSingle: async () => {
              state.updateCalls += 1;
              return { data: state.updateError ? null : { progress: payload.progress, state_revision: 1 }, error: state.updateError };
            },
          };
          return query;
        },
      };
    },
    rpc: async (name: string, values: Record<string, unknown>) => {
      if (name !== "update_own_legacy_amora_action") throw new Error("Unconditional array replacement is forbidden");
      state.updateCalls += 1;
      state.filters = { id: values.p_journey_id, couple_id: values.p_couple_id, state_revision: values.p_expected_revision };
      return {
        data: state.updateError ? null : {
          progress: { __amora_actions: [{ ...journeyRow().progress.__amora_actions[0], status: "done" }] },
          state_revision: 1,
        },
        error: state.updateError,
      };
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: async () => clientFixture(),
}));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

vi.mock("@/lib/amora/actionRepository", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/amora/actionRepository")>(),
  mutateOwnAmoraActionRecord: async () => {
    const error = new Error("relation \"amora_actions\" does not exist");
    (error as { code?: string }).code = "42P01";
    throw error;
  },
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
  state.updateError = null;
  state.updateCalls = 0;
  state.filters = {};
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("아모라 행동 저장", () => {
  it("잘못된 JSON의 개인 원문을 운영 콘솔에 남기지 않는다", async () => {
    const marker = "PRIVATE_X";
    vi.stubEnv("NODE_ENV", "production");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { PATCH } = await import("../route");
      const response = await PATCH(new Request(`https://hanbang.ai/api/amora/actions/${ACTION_ID}`, {
        method: "PATCH",
        headers: { authorization: "Bearer test-token", "content-type": "application/json" },
        body: `${marker}: synthetic invalid JSON`,
      }), { params: Promise.resolve({ id: ACTION_ID }) });

      expect(response.status).toBe(500);
      expect(state.updateCalls).toBe(0);
      expect(await response.json()).not.toHaveProperty("action");
      const output = consoleError.mock.calls.flat().map((value) => value instanceof Error
        ? `${value.name}: ${value.message}\n${value.stack ?? ""}` : String(value)).join("\n");
      expect(output).toContain("api/amora/actions/[id]");
      expect(output).toContain("SyntaxError");
      expect(output).not.toContain(marker);
    } finally {
      consoleError.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("정상 저장은 그대로 200 이다", async () => {
    const response = await patchDone();
    expect(response.status).toBe(200);
    expect(state.updateCalls).toBe(1);
    expect(state.filters).toEqual({ id: "journey-1", couple_id: COUPLE_ID, state_revision: 0 });
  });

  it("조건부 저장이 실패하면 성공이라고 말하지 않는다", async () => {
    // 이 검사가 없으면 사용자는 완료됐다고 믿고, 앱은 줄을 지우고,
    // 다음에 열면 그대로 살아 있다.
    state.updateError = { message: "private database detail" };

    const response = await patchDone();

    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload).not.toHaveProperty("action");
    expect(payload.error).toContain("수정하지 못했");
    expect(payload.error).not.toContain("private database detail");
  });

  it("실패해도 버전 조건을 빼고 다시 저장하지 않는다", async () => {
    // CAS 실패 뒤 버전 없는 덮어쓰기로 우회하면 다른 준비 기록이 사라진다.
    state.updateError = { message: "conditional write failed" };

    await patchDone();

    expect(state.updateCalls).toBe(1);
    expect(state.filters.state_revision).toBe(0);
  });

  it("저장 실패를 '찾지 못했습니다'로 바꾸지 않는다", async () => {
    // 404 는 대상이 없다는 뜻이다. 대상은 있었고 쓰기가 실패한 것이다.
    state.updateError = { message: "conditional write failed" };

    const response = await patchDone();
    expect(response.status).not.toBe(404);
  });
});
