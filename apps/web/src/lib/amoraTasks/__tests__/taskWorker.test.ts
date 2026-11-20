// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { AmoraTaskKind } from "@hanbang/shared/amora-tasks";
import type { AmoraTaskAdapters, AmoraTaskWebSearchAdapter } from "../adapters";
import { PLAN_STEP_SCHEMA, type TaskModelCall } from "../taskModel";
import type { AmoraTaskRow, AmoraTaskStore, AmoraTaskUsageReservation } from "../taskStore";
import { deliverAmoraTaskNotifications, runAmoraTaskSlice, type AmoraTaskWorkerDeps } from "../taskWorker";

const COUPLE = "10000000-0000-4000-8000-000000000001";
const TASK = "20000000-0000-4000-8000-000000000001";
const USER = "30000000-0000-4000-8000-000000000001";
const TODAY = "2026-11-20";

function row(kind: AmoraTaskKind, input: Record<string, unknown>): AmoraTaskRow {
  return {
    id: TASK, couple_id: COUPLE, requested_by: USER, kind, status: "searching", title: "맡은 일", input,
    progress: {}, steps: [], result: null, review_reason: null, error_code: null, model_steps: 0, web_searches: 0,
    input_tokens: 0, output_tokens: 0, reserved_cost_microusd: 0, cost_microusd: 0, run_count: 1, failure_count: 0,
    lease_token: "40000000-0000-4000-8000-000000000001", leased_until: "2026-11-20T01:05:00.000Z",
    started_at: "2026-11-20T01:00:00.000Z", finished_at: null, created_at: "", updated_at: "",
  };
}

type Finish = Parameters<AmoraTaskStore["finish"]>[0];

function fakeStore(options: { modelDenied?: string; saveFails?: boolean } = {}) {
  const finishes: Finish[] = [];
  const reservations: { usage: string }[] = [];
  const steps: (string | null)[] = [];
  const notifications: { taskId: string; state: string; reason: string }[] = [];
  const savedProgress: Record<string, unknown>[] = [];
  const store: AmoraTaskStore = {
    offer: vi.fn(), start: vi.fn(), cancel: vi.fn(), resume: vi.fn(), claim: vi.fn(),
    async saveProgress(input) {
      steps.push(input.stepLabel);
      savedProgress.push(input.progress);
      return !options.saveFails;
    },
    async reserveUsage(input): Promise<AmoraTaskUsageReservation> {
      reservations.push({ usage: input.usage });
      if (input.usage === "model_step" && options.modelDenied) return { allowed: false, reason: options.modelDenied };
      return { allowed: true, reason: null };
    },
    async release() { return true; },
    async finish(input) { finishes.push(input); return true; },
    async claimNotifications() { return [{ taskId: TASK, coupleId: COUPLE, requestedBy: USER, kind: "todo_deadlines", attempts: 1 }]; },
    async finishNotification(taskId, state, reason) { notifications.push({ taskId, state, reason }); return true; },
  };
  return { store, finishes, reservations, steps, notifications, savedProgress };
}

/** 커플 두 사람 이름. 찾기 거르개(갈래 3 blockedTerms)에만 가야 한다. */
const COUPLE_NAMES = ["김민준", "이지연"];

/** 정해진 답을 돌려주는 모델. 진짜 호출기처럼 답하기 전에 걸음 예약부터 한다. */
function scriptedModel(responses: Record<string, unknown[]>) {
  const calls: string[] = [];
  const inputs: string[] = [];
  const callModel: TaskModelCall = async (input) => {
    await input.reserveStep();
    calls.push(input.schemaName);
    inputs.push(`${input.instructions}\n${input.input}`);
    const queue = responses[input.schemaName] ?? [];
    const next = queue.shift();
    if (next === undefined) throw new Error(`no scripted response for ${input.schemaName}`);
    return { data: input.validate(next), usage: { inputTokens: 1_000, outputTokens: 200, costMicrousd: 440 } };
  };
  return { callModel, calls, inputs };
}

function deps(overrides: Partial<AmoraTaskWorkerDeps> & { store: AmoraTaskStore }): AmoraTaskWorkerDeps {
  const adapters: AmoraTaskAdapters = {
    checkGate: async () => ({ allowed: true, reply: null }),
    sendPush: async () => ({ sent: true, reason: "sent" }),
    webSearch: null,
    inquiry: null,
  };
  return {
    adapters,
    callModel: scriptedModel({}).callModel,
    readTool: vi.fn(),
    loadWeddingContext: async () => ({ weddingDate: "2027-05-08", budget: 30_000_000, venue: null, progress: {} }),
    loadCoupleNames: async () => [...COUPLE_NAMES],
    reserveGlobalWallet: async () => true,
    todayYmd: () => TODAY,
    nowMs: () => 0,
    ...overrides,
  };
}

const organized = (extra: Record<string, unknown> = {}) => ({
  summary: "다가오는 일정과 할 일을 날짜 순서로 모았어요.",
  rows: [],
  next_actions: [{ type: "add_schedule", row: 0 }],
  needs_input: "",
  ...extra,
});

describe("앱 안 자료로 하는 일", () => {
  it("할 일과 마감: 읽고, 날짜 순서 표를 코드가 만들고, 모델 한 걸음으로 끝낸다", async () => {
    const fake = fakeStore();
    const model = scriptedModel({ amora_task_organize_v1: [organized()] });
    const readTool = vi.fn(async (name: string) => ({
      toolName: name, toolInput: {}, success: true, displayMessage: "",
      toolOutput: name === "get_schedule_events"
        ? { events: [{ date: "2026-12-12", title: "드레스 투어" }, { date: "2026-11-28", title: "웨딩홀 상담" }] }
        : { actions: [{ title: "청첩장 문구 정하기", dueDate: "2026-12-01" }, { title: "부모님께 하객 명단 받기", dueDate: "다음 주 중" }] },
    }));
    const outcome = await runAmoraTaskSlice(row("todo_deadlines", { horizon_days: 60 }), deps({ store: fake.store, callModel: model.callModel, readTool }), 1);
    expect(outcome).toEqual({ kind: "done" });
    expect(readTool.mock.calls.map(([name]) => name)).toEqual(["get_schedule_events", "get_amora_actions"]);
    expect(model.calls).toEqual(["amora_task_organize_v1"]);
    const finish = fake.finishes.at(-1)!;
    expect(finish.status).toBe("done");
    const result = finish.result as { rows: { cells: string[]; sourceIds: string[] }[]; nextActions: { prompt: string }[]; sources: { id: string }[] };
    expect(result.rows.map((r) => r.cells[0])).toEqual(["웨딩홀 상담", "청첩장 문구 정하기", "드레스 투어", "부모님께 하객 명단 받기"]);
    expect(result.rows[0].cells.slice(1)).toEqual(["11월 28일", "8일", "일정"]);
    expect(result.rows[3].cells[1]).toBe("다음 주 중");
    expect(result.rows.every((r) => r.sourceIds.length > 0)).toBe(true);
    expect(result.sources.map((s) => s.id).sort()).toEqual(["a1", "a2", "e1", "e2"]);
    expect(result.nextActions).toEqual([{ label: "일정에 넣기", prompt: "웨딩홀 상담 일정을 11월 28일로 넣어 줘" }]);
    expect(fake.reservations).toEqual([{ usage: "model_step" }]);
  });

  it("끝난 일의 알림은 맡긴 사람에게 내용 없이, 갈래 2 계약 그대로 한 번 부른다", async () => {
    const fake = fakeStore();
    const sendPush = vi.fn(async () => ({ sent: true, reason: "sent" }));
    const result = await deliverAmoraTaskNotifications({ store: fake.store, adapters: { ...deps({ store: fake.store }).adapters, sendPush } }, 10);
    expect(result).toEqual({ sent: 1, skipped: 0 });
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush).toHaveBeenCalledWith({ userId: USER, kind: "task_done", deepLink: "home", dedupeKey: `task_done:${TASK}` });
    expect(fake.notifications).toEqual([{ taskId: TASK, state: "sent", reason: "sent" }]);
  });

  it("보내지 못한 까닭은 다시 부르지 않고 기록에 남긴다(조용한 시간·동의·상한은 갈래 2 가 판단)", async () => {
    for (const reason of ["quiet_hours", "not_consented", "daily_cap", "duplicate", "unavailable"]) {
      const fake = fakeStore();
      const sendPush = vi.fn(async () => ({ sent: false, reason }));
      await deliverAmoraTaskNotifications({ store: fake.store, adapters: { ...deps({ store: fake.store }).adapters, sendPush } }, 10);
      expect(sendPush).toHaveBeenCalledTimes(1);
      expect(fake.notifications).toEqual([{ taskId: TASK, state: "skipped", reason }]);
    }
  });
});

describe("한도와 문지기", () => {
  it.each(["daily_step_limit", "task_step_limit", "background_budget"])("모델 걸음 예약이 %s 로 막히면 모델을 부르지 않고 확인해 주세요로 둔다", async (reason) => {
    const fake = fakeStore({ modelDenied: reason });
    const model = scriptedModel({ amora_task_organize_v1: [organized()] });
    const outcome = await runAmoraTaskSlice(row("date_candidates", { purpose: "상견례", prefer: "weekend", from_date: "2026-11-21", to_date: "2026-12-31" }),
      deps({ store: fake.store, callModel: model.callModel, readTool: vi.fn(async () => ({ toolName: "", toolInput: {}, toolOutput: { events: [] }, success: true, displayMessage: "" })) }), 1);
    expect(outcome).toEqual({ kind: "needs_review", reason });
    expect(model.calls).toEqual([]);
    expect(fake.finishes.at(-1)).toMatchObject({ status: "needs_review", reviewReason: reason });
  });

  it("전역 지갑이 거절하면 서비스 몫이 찼다고 본다", async () => {
    const fake = fakeStore();
    const model = scriptedModel({ amora_task_organize_v1: [organized()] });
    const outcome = await runAmoraTaskSlice(row("todo_deadlines", {}), deps({
      store: fake.store, callModel: model.callModel, reserveGlobalWallet: async () => false,
      readTool: vi.fn(async () => ({ toolName: "", toolInput: {}, toolOutput: {}, success: true, displayMessage: "" })),
    }), 1);
    expect(outcome).toEqual({ kind: "needs_review", reason: "background_budget" });
    expect(model.calls).toEqual([]);
  });

  it("문지기가 막으면 아무것도 읽지 않는다", async () => {
    const fake = fakeStore();
    const readTool = vi.fn();
    const base = deps({ store: fake.store, readTool });
    const outcome = await runAmoraTaskSlice(row("todo_deadlines", {}), { ...base, adapters: { ...base.adapters, checkGate: async () => ({ allowed: false, reply: null }) } }, 1);
    expect(outcome).toEqual({ kind: "needs_review", reason: "gate_blocked" });
    expect(readTool).not.toHaveBeenCalled();
  });

  it("선점을 잃으면(저장이 거절되면) 끝내지 않고 멈춘다", async () => {
    const fake = fakeStore({ saveFails: true });
    const outcome = await runAmoraTaskSlice(row("todo_deadlines", {}), deps({
      store: fake.store,
      readTool: vi.fn(async () => ({ toolName: "", toolInput: {}, toolOutput: {}, success: true, displayMessage: "" })),
    }), 1);
    expect(outcome).toEqual({ kind: "lost" });
    expect(fake.finishes).toEqual([]);
  });
});

describe("찾기가 드는 일", () => {
  function fakeSearch(): AmoraTaskWebSearchAdapter & { search: ReturnType<typeof vi.fn>; readPage: ReturnType<typeof vi.fn> } {
    return {
      search: vi.fn(async () => ({
        ok: true as const,
        checkedAt: "2026-11-20T01:00:00.000Z",
        items: [
          { name: "더채플 강남 웨딩홀 공식", url: "https://chapel.example/hall", address: "서울 강남구 식대 6만원대", phone: null },
          { name: "라움 강남 웨딩홀", url: "https://raum.example/", address: null, phone: "02-000-0000" },
          { name: "강남 웨딩홀 순위 모음", url: "https://blog.example/top", address: null, phone: null },
        ],
        modelSummary: { hitCount: 3, refs: ["r1", "r2", "r3"] },
      })),
      readPage: vi.fn(async () => ({
        ok: true as const, url: "https://chapel.example/hall", domain: "chapel.example", title: "더채플 강남 안내",
        checkedAt: "2026-11-20T01:01:00.000Z",
        prices: [{ label: "식대", amount: "1인 65,000원", quote: "성인 1인" }, { label: "보증 인원", amount: "200명", quote: "" }],
        modelSummary: { priceCount: 2, hasMeal: true },
      })),
    };
  }

  it("갈래 3 이 없으면 시작하지 않고 확인해 주세요로 둔다", async () => {
    const fake = fakeStore();
    const outcome = await runAmoraTaskSlice(row("hall_candidates", { region: "강남" }), deps({ store: fake.store }), 1);
    expect(outcome).toEqual({ kind: "needs_review", reason: "source_unavailable" });
  });

  it("찾고, 공식 페이지를 읽고, 가격은 공식 페이지 근거가 있는 줄에만 남기고 순위 말이 든 줄은 버린다", async () => {
    const fake = fakeStore();
    const search = fakeSearch();
    const model = scriptedModel({
      amora_task_plan_v1: [
        { action: "search", query: "강남 웨딩홀", source_id: "" },
        { action: "read", query: "", source_id: "w1" },
        { action: "finish", query: "", source_id: "" },
      ],
      amora_task_organize_v1: [organized({
        summary: "강남 웨딩홀 두 곳을 같은 기준으로 모았어요.",
        rows: [
          { cells: ["더채플", "강남", "1인 65,000원", "업체 확인 필요", "200명", "아무거나"], source_ids: ["p1", "w1"] },
          { cells: ["라움", "강남", "1인 70,000원", "", "", ""], source_ids: ["w2"] },
          { cells: ["강남 최고 웨딩홀", "강남", "", "", "", ""], source_ids: ["w3"] },
          { cells: ["지어낸 홀", "강남", "", "", "", ""], source_ids: ["w9"] },
        ],
        next_actions: [{ type: "draft_inquiry", row: 0 }, { type: "visit_schedule", row: 1 }],
      })],
    });
    const base = deps({ store: fake.store, callModel: model.callModel });
    const run = (task: AmoraTaskRow) => runAmoraTaskSlice(task, { ...base, adapters: { ...base.adapters, webSearch: search } }, 1);
    const task = row("hall_candidates", { region: "강남", guest_count: 200, request_text: "강남 웨딩홀 찾아 줘" });
    const outcome = await run(task);
    expect(outcome).toEqual({ kind: "done" });
    // 커플 이름은 거르개로 넘긴다: 이름이 든 낱말은 사용자가 쳤어도 네이버로 가지 않는다(갈래 3, 약관 일반조건 7.4 ⑦).
    expect(search.search).toHaveBeenCalledWith({
      query: "강남 웨딩홀", coupleId: COUPLE, userTexts: ["강남 웨딩홀 찾아 줘"], blockedTerms: COUPLE_NAMES,
    });
    expect(search.readPage).toHaveBeenCalledWith({
      url: "https://chapel.example/hall",
      coupleId: COUPLE,
      sourceUrls: ["https://chapel.example/hall", "https://raum.example/", "https://blog.example/top"],
    });
    const result = fake.finishes.at(-1)!.result as { rows: { cells: string[]; sourceIds: string[] }[]; nextActions: { prompt: string }[] };
    // 표는 서버가 짠다: 이름·사이트는 네이버 칸(w), 가격은 공식 페이지(p)에서만. 순위 모음 글은 빠진다.
    expect(result.rows.map((r) => r.cells)).toEqual([
      ["더채플 강남 웨딩홀 공식", "강남", "1인 65,000원", "업체 확인 필요", "200명", "chapel.example"],
      ["라움 강남 웨딩홀", "강남", "업체 확인 필요", "업체 확인 필요", "업체 확인 필요", "raum.example"],
    ]);
    expect(result.rows.map((r) => r.sourceIds)).toEqual([["w1", "p1"], ["w2"]]);
    expect(result.nextActions.map((a) => a.prompt)).toEqual(["더채플 강남 웨딩홀 공식에 보낼 문의 글을 써 줘", "라움 강남 웨딩홀 상담 일정을 넣고 싶어"]);
    // 네이버 결과의 글(이름·주소·사이트)은 어떤 모델 걸음에도 들어가지 않는다(약관: 검색 데이터를 AI 입력으로 쓰지 않음).
    for (const sent of model.inputs) {
      for (const leaked of ["더채플", "라움", "chapel.example", "raum.example", "식대 6만원대", "순위 모음", "02-000-0000"]) {
        expect(sent.includes(leaked), leaked).toBe(false);
      }
    }
    // 커플 이름은 거르개에만 쓰고, 모델 입력·진행 기록·결과에는 남기지 않는다.
    const kept = JSON.stringify([fake.savedProgress, fake.finishes]);
    for (const name of COUPLE_NAMES) {
      expect(model.inputs.some((sent) => sent.includes(name)), name).toBe(false);
      expect(kept.includes(name), name).toBe(false);
    }
    expect(fake.reservations.filter((r) => r.usage === "web_search")).toHaveLength(2);
    expect(fake.reservations.filter((r) => r.usage === "model_step")).toHaveLength(4);
  });

  it("커플 이름을 못 읽으면 찾지 않고 이번 차례를 쉰다", async () => {
    const fake = fakeStore();
    const search = fakeSearch();
    const model = scriptedModel({ amora_task_plan_v1: [{ action: "search", query: "강남 웨딩홀", source_id: "" }] });
    const base = deps({ store: fake.store, callModel: model.callModel });
    const outcome = await runAmoraTaskSlice(
      row("hall_candidates", { region: "강남", request_text: "강남 웨딩홀 찾아 줘" }),
      { ...base, adapters: { ...base.adapters, webSearch: search }, loadCoupleNames: async () => { throw new Error("profiles down"); } },
      1,
    );
    expect(outcome).toEqual({ kind: "paused" });
    expect(search.search).not.toHaveBeenCalled();
    // 이름을 먼저 읽고 나서 찾기 횟수를 잡는다. 못 읽으면 하루 찾기 몫도 쓰지 않는다.
    expect(fake.reservations.filter((r) => r.usage === "web_search")).toHaveLength(0);
  });

  it("숫자나 조건에 없는 낱말이 든 검색어는 보내지 않는다", async () => {
    const fake = fakeStore();
    const search = fakeSearch();
    const model = scriptedModel({
      amora_task_plan_v1: [
        { action: "search", query: "강남 웨딩홀 3000만원", source_id: "" },
        { action: "search", query: "신부 김지은 웨딩홀", source_id: "" },
      ],
      amora_task_organize_v1: [organized({ rows: [], next_actions: [] })],
    });
    const base = deps({ store: fake.store, callModel: model.callModel });
    await runAmoraTaskSlice(row("hall_candidates", { region: "강남" }), { ...base, adapters: { ...base.adapters, webSearch: search } }, 1);
    expect(search.search).not.toHaveBeenCalled();
  });

  it("찾기 걸음의 모델은 search·read·finish 밖을 고를 수 없다", () => {
    const action = (PLAN_STEP_SCHEMA.properties as { action: { enum: string[] } }).action;
    expect(action.enum).toEqual(["search", "read", "finish"]);
  });

  it("같은 검색어는 다시 보내지 않는다(실측: 같은 검색을 세 번 되풀이했다)", async () => {
    const fake = fakeStore();
    const search = fakeSearch();
    const model = scriptedModel({
      amora_task_plan_v1: [
        { action: "search", query: "강남 웨딩홀", source_id: "" },
        { action: "search", query: "강남 웨딩홀", source_id: "" },
        { action: "search", query: "강남  웨딩홀", source_id: "" },
      ],
      amora_task_organize_v1: [organized({ rows: [], next_actions: [] })],
    });
    const base = deps({ store: fake.store, callModel: model.callModel });
    await runAmoraTaskSlice(row("hall_candidates", { region: "강남" }), { ...base, adapters: { ...base.adapters, webSearch: search } }, 1);
    expect(search.search).toHaveBeenCalledTimes(1);
    expect(fake.reservations.filter((r) => r.usage === "web_search")).toHaveLength(1);
  });
});

describe("오늘의 한 가지 자리(갈래 2)", () => {
  it("사흘 안에 끝난 일만 최근 것부터 고른다", async () => {
    const { pickFinishedAmoraTasks } = await import("../todayOneSource");
    const base = { couple_id: COUPLE, kind: "todo_deadlines", title: "할 일과 마감 정리", steps: [], result: null, review_reason: null, offer_expires_at: null, created_at: null, started_at: null, updated_at: null };
    const picks = pickFinishedAmoraTasks([
      { ...base, id: "a0000000-0000-4000-8000-000000000001", status: "done", finished_at: "2026-11-19T01:00:00.000Z" },
      { ...base, id: "a0000000-0000-4000-8000-000000000002", status: "done", finished_at: "2026-11-20T00:30:00.000Z" },
      { ...base, id: "a0000000-0000-4000-8000-000000000003", status: "done", finished_at: "2026-11-10T00:00:00.000Z" },
      { ...base, id: "a0000000-0000-4000-8000-000000000004", status: "needs_review", finished_at: null },
    ], new Date("2026-11-20T01:00:00.000Z"));
    expect(picks.map((pick) => pick.taskId)).toEqual(["a0000000-0000-4000-8000-000000000002", "a0000000-0000-4000-8000-000000000001"]);
    expect(picks[0].sourceKey).toMatch(/^task_done:[0-9a-f]{24}$/);
    expect(picks[0].confirmed).toEqual(["맡은 일: 할 일과 마감 정리"]);
  });
});
