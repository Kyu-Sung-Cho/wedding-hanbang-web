// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 맡기기(start)는 문지기(갈래 1, surface "amora_task_request")를 먼저 지난다.
 * 판정이 allow 가 아니면 맡은 일을 시작하지 않고, 문지기의 답(reply)을 그대로 돌려준다(2026-11-20 부모 세션).
 */

const TASK = "20000000-0000-4000-8000-000000000001";
const COUPLE = "10000000-0000-4000-8000-000000000001";
const USER = "30000000-0000-4000-8000-000000000001";

const state = vi.hoisted(() => ({
  gate: { allowed: true, reply: null as string | null },
  gateInputs: [] as unknown[],
  starts: 0,
  adminError: null as null | { code: string; message: string },
  logged: [] as unknown[][],
}));

vi.mock("@/utils/log", () => ({
  log: { error: (...args: unknown[]) => { state.logged.push(args); } },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "30000000-0000-4000-8000-000000000001" } } }) },
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => ({ data: { couple_id: "10000000-0000-4000-8000-000000000001" }, error: null });
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => (state.adminError
        ? { data: null, error: state.adminError }
        : {
          data: { title: "할 일과 마감 정리", input: { horizon_days: 60 }, couple_id: "10000000-0000-4000-8000-000000000001" },
          error: null,
        });
      return chain;
    },
  }),
}));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimit: () => null, rateLimitKey: () => "k" }));
vi.mock("@/utils/trustedMutation", () => ({ isTrustedMutationRequest: () => true }));
vi.mock("@/lib/amoraTasks/taskRuntime", () => ({
  AMORA_TASK_KICK_BUDGET: { maxSlices: 1, budgetMs: 1 },
  runAmoraTaskWorkerOnce: async () => null,
}));
vi.mock("@/lib/amoraTasks/adapters", () => ({
  defaultAmoraTaskAdapters: () => ({
    checkGate: async (input: unknown) => {
      state.gateInputs.push(input);
      return state.gate;
    },
  }),
}));
vi.mock("@/lib/amoraTasks/taskStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/amoraTasks/taskStore")>();
  return {
    ...actual,
    createSupabaseAmoraTaskStore: () => ({
      start: async () => {
        state.starts += 1;
        return { ok: true, code: "started", status: "queued", taskId: TASK, offerExpiresAt: null };
      },
    }),
  };
});

import { POST } from "./route";

const start = () => POST(
  new Request(`https://hanbang.ai/api/amora/tasks/${TASK}`, { method: "POST", body: JSON.stringify({ action: "start" }) }),
  { params: Promise.resolve({ id: TASK }) },
);

afterEach(() => {
  vi.unstubAllEnvs();
  state.gate = { allowed: true, reply: null };
  state.gateInputs = [];
  state.starts = 0;
  state.adminError = null;
  state.logged = [];
});

describe("POST /api/amora/tasks/:id 맡기기와 문지기", () => {
  it("문지기가 allow 가 아니면 맡은 일을 시작하지 않고 그 답을 그대로 준다", async () => {
    vi.stubEnv("AMORA_TASKS_ENABLED", "true");
    state.gate = { allowed: false, reply: "결혼 준비와 관련된 일만 맡을 수 있어요." };
    const response = await start();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, code: "gate_blocked", reply: "결혼 준비와 관련된 일만 맡을 수 있어요." });
    expect(state.starts).toBe(0);
    expect(state.gateInputs).toEqual([{ text: "할 일과 마감 정리", surface: "amora_task_request", userId: USER, coupleId: COUPLE }]);
  });

  it("문지기가 allow 면 맡긴다", async () => {
    vi.stubEnv("AMORA_TASKS_ENABLED", "true");
    const response = await start();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, code: "started", status: "queued" });
    expect(state.starts).toBe(1);
  });

  it("스위치가 꺼져 있으면 문지기도 맡기기도 하지 않는다", async () => {
    vi.stubEnv("AMORA_TASKS_ENABLED", "false");
    expect(await (await start()).json()).toEqual({ enabled: false, available: false, tasks: [] });
    expect(state.gateInputs).toEqual([]);
    expect(state.starts).toBe(0);
  });

  it("카드를 읽다 DB 가 실패하면 503 이고 Sentry 로 보고하되, DB 오류 문장은 싣지 않는다", async () => {
    vi.stubEnv("AMORA_TASKS_ENABLED", "true");
    // 라우트는 이 오류 객체를 그대로 던진다. 보고에는 자리·종류·코드만 가야 한다.
    state.adminError = { code: "XX000", message: "Key (couple_id)=(홍길동) violates" };
    const response = await start();
    expect(response.status).toBe(503);
    expect(state.starts).toBe(0);
    expect(state.logged).toHaveLength(1);
    const [scope, reported] = state.logged[0] as [string, unknown];
    expect(scope).toBe("[amora-tasks] action failed");
    expect(reported).toBeInstanceOf(Error);
    expect((reported as Error).message).toBe("AMORA_TASK_ACTION_FAILED (UnknownError XX000)");
  });
});
