// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 홈의 "아모라가 맡은 일" API 와 일꾼 크론. 스위치가 꺼졌거나 표가 없을 때 화면이 깨지지 않는 응답을 주는지,
 * 크론이 비밀값 없이 돌지 않는지, 예약 목록에 한 번만 있는지를 잰다.
 */

const state = vi.hoisted(() => ({
  user: { id: "30000000-0000-4000-8000-000000000001" } as { id: string } | null,
  listError: null as null | { code: string; message: string },
  rows: [] as Record<string, unknown>[],
  workerCalls: 0,
  workerError: null as Error | null,
  logged: [] as unknown[][],
}));

// 5xx 는 Sentry 로 가는 유일한 길(`log.error`)로 보고해야 한다(scripts/tests/no-silent-5xx-catch.test.mjs).
vi.mock("@/utils/log", () => ({
  log: { error: (...args: unknown[]) => { state.logged.push(args); } },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const result = table === "profiles"
        ? { data: { couple_id: "10000000-0000-4000-8000-000000000001" }, error: null }
        : { data: state.listError ? null : state.rows, error: state.listError };
      for (const method of ["select", "eq", "in", "order"]) chain[method] = () => chain;
      chain.limit = async () => result;
      chain.maybeSingle = async () => result;
      return chain;
    },
  }),
}));

vi.mock("@/utils/rateLimit", () => ({ checkRateLimit: () => null, rateLimitKey: () => "k" }));
vi.mock("@/lib/amoraTasks/taskRuntime", () => ({
  AMORA_TASK_CRON_BUDGET: { maxSlices: 1, budgetMs: 1 },
  createAmoraTaskWorkerDeps: () => ({}),
}));
vi.mock("@/lib/amoraTasks/taskWorker", () => ({
  runAmoraTaskWorker: async () => {
    state.workerCalls += 1;
    if (state.workerError) throw state.workerError;
    return { claimed: 0, done: 0, needsReview: 0, paused: 0, lost: 0, notified: 0, notifySkipped: 0, notifyDeferred: 0 };
  },
}));

import { GET as listTasks } from "./route";
import { GET as runCron } from "../../cron/amora-tasks/route";

const request = () => new Request("https://hanbang.ai/api/amora/tasks");

afterEach(() => {
  vi.unstubAllEnvs();
  state.user = { id: "30000000-0000-4000-8000-000000000001" };
  state.listError = null;
  state.rows = [];
  state.workerCalls = 0;
  state.workerError = null;
  state.logged = [];
});

/** 보고된 오류 하나를 꺼낸다. 원래 오류가 아니라 자리·종류만 담은 새 Error 여야 한다. */
function onlyReport(): { scope: string; message: string } {
  expect(state.logged).toHaveLength(1);
  const [scope, reported] = state.logged[0] as [string, unknown];
  expect(reported).toBeInstanceOf(Error);
  return { scope, message: (reported as Error).message };
}

describe("GET /api/amora/tasks", () => {
  it("로그인하지 않으면 401", async () => {
    state.user = null;
    expect((await listTasks(request())).status).toBe(401);
  });

  it("스위치가 꺼져 있으면 enabled:false 를 주고 표를 읽지 않는다", async () => {
    vi.stubEnv("AMORA_TASKS_ENABLED", "false");
    state.listError = { code: "XX000", message: "should not be read" };
    const response = await listTasks(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false, available: false, tasks: [] });
  });

  it("표가 아직 없으면(42P01) available:false 를 준다", async () => {
    vi.stubEnv("AMORA_TASKS_ENABLED", "true");
    state.listError = { code: "42P01", message: "relation \"public.amora_tasks\" does not exist" };
    const response = await listTasks(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: true, available: false, tasks: [] });
  });

  it("켜져 있으면 화면 칸만 담아 준다", async () => {
    vi.stubEnv("AMORA_TASKS_ENABLED", "true");
    state.rows = [{
      id: "20000000-0000-4000-8000-000000000001", couple_id: "10000000-0000-4000-8000-000000000001",
      kind: "todo_deadlines", status: "organizing", title: "할 일과 마감 정리", steps: [], result: null,
      review_reason: null, offer_expires_at: null, created_at: "2026-11-20T01:00:00Z", started_at: "2026-11-20T01:00:05Z",
      finished_at: null, updated_at: "2026-11-20T01:00:30Z",
    }];
    const body = await (await listTasks(request())).json();
    expect(body.enabled).toBe(true);
    expect(Object.keys(body.tasks[0]).sort()).toEqual(
      ["createdAt", "finishedAt", "id", "kind", "reviewReason", "startedAt", "status", "title", "updatedAt"],
    );
  });

  it("읽다 실패하면 503 이고 Sentry 로 보고하되, DB 오류 문장과 모양이 이상한 코드는 싣지 않는다", async () => {
    vi.stubEnv("AMORA_TASKS_ENABLED", "true");
    state.listError = { code: "K(홍길동)", message: "Key (name)=(홍길동) already exists" };
    const response = await listTasks(request());
    expect(response.status).toBe(503);
    const report = onlyReport();
    expect(report.scope).toBe("[amora-tasks] list failed");
    expect(report.message).toMatch(/^AMORA_TASKS_LIST_FAILED \([A-Za-z]+\)$/);
    expect(report.message).not.toContain("홍길동");
  });

  it("표가 아직 없을 때(42P01)는 고장이 아니라서 보고하지 않는다", async () => {
    vi.stubEnv("AMORA_TASKS_ENABLED", "true");
    state.listError = { code: "42P01", message: "relation \"public.amora_tasks\" does not exist" };
    expect((await listTasks(request())).status).toBe(200);
    expect(state.logged).toEqual([]);
  });
});

describe("GET /api/cron/amora-tasks", () => {
  const cron = (auth?: string) => runCron(new Request("https://hanbang.ai/api/cron/amora-tasks", {
    headers: auth ? { authorization: auth } : {},
  }) as never);

  it("크론 비밀값이 없거나 틀리면 401", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await cron()).status).toBe(401);
    expect((await cron("Bearer wrong")).status).toBe(401);
    expect(state.workerCalls).toBe(0);
  });

  it("서버에 크론 비밀값이 없으면(설정 빠짐) 어떤 헤더로도 돌지 않는다", async () => {
    vi.stubEnv("AMORA_TASKS_ENABLED", "true");
    const saved = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      // 비밀값이 없을 때 `Bearer ${secret}` 은 "Bearer undefined" 가 된다. 그 헤더로 돌면 안 된다.
      expect((await cron("Bearer undefined")).status).toBe(401);
      expect(state.workerCalls).toBe(0);
    } finally {
      if (saved !== undefined) process.env.CRON_SECRET = saved;
    }
  });

  it("스위치가 꺼져 있으면 아무것도 잡지 않는다", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubEnv("AMORA_TASKS_ENABLED", "false");
    expect(await (await cron("Bearer s3cret")).json()).toEqual({ ok: true, enabled: false, claimed: 0 });
    expect(state.workerCalls).toBe(0);
  });

  it("켜져 있으면 일꾼을 한 번 돌린다", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubEnv("AMORA_TASKS_ENABLED", "true");
    expect((await cron("Bearer s3cret")).status).toBe(200);
    expect(state.workerCalls).toBe(1);
    expect(state.logged).toEqual([]);
  });

  it("일꾼이 던지면 503 이고 Sentry 로 보고하되, 원래 오류 문장과 모양이 이상한 이름은 싣지 않는다", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubEnv("AMORA_TASKS_ENABLED", "true");
    const thrown = new Error("row for 010-1234-5678 홍길동");
    thrown.name = "홍길동 Error";
    state.workerError = thrown;
    const response = await cron("Bearer s3cret");
    expect(response.status).toBe(503);
    const report = onlyReport();
    expect(report.scope).toBe("[amora-tasks-cron] run failed");
    expect(report.message).toBe("AMORA_TASKS_CRON_FAILED (UnknownError)");
  });

  it("예약 목록(vercel.json)에 한 번만 있다", () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as { crons: { path: string }[] };
    expect(config.crons.filter((entry) => entry.path === "/api/cron/amora-tasks")).toHaveLength(1);
  });
});
