// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { AmoraTaskAdapters } from "../adapters";
import { normalizeAmoraTaskInput } from "../taskKinds";
import { budgetDifferenceLabel, findDateCandidates, quoteTotal } from "../taskResult";
import { executeOfferAmoraTask, OFFER_AMORA_TASK_TOOL_NAME, selectAmoraTaskChatTools } from "../taskChatTool";
import type { AmoraTaskStore } from "../taskStore";

const ON = { AMORA_TASKS_ENABLED: "true" } as unknown as NodeJS.ProcessEnv;
const COUPLE = "10000000-0000-4000-8000-000000000001";
const USER = "30000000-0000-4000-8000-000000000001";
const KEY = `chat:${USER}:50000000-0000-4000-8000-000000000001`;
const TASK = "20000000-0000-4000-8000-000000000001";

const noAdapters: AmoraTaskAdapters = {
  checkGate: async () => ({ allowed: true, reply: null }),
  sendPush: async () => ({ sent: false, reason: "unavailable" }),
  webSearch: null,
  inquiry: null,
};

describe("시작 카드 도구를 주는 때", () => {
  const base = { visibility: "shared", requestKind: "chat", durable: true, isDemo: false, env: ON, adapters: noAdapters };

  it("스위치가 꺼졌거나, 개인 대화·체험·첫 인사·묶이지 않은 턴이면 주지 않는다", () => {
    expect(selectAmoraTaskChatTools({ ...base, env: {} as NodeJS.ProcessEnv })).toEqual([]);
    expect(selectAmoraTaskChatTools({ ...base, env: { AMORA_TASKS_ENABLED: "TRUE" } as unknown as NodeJS.ProcessEnv })).toEqual([]);
    expect(selectAmoraTaskChatTools({ ...base, visibility: "bride_private" })).toEqual([]);
    expect(selectAmoraTaskChatTools({ ...base, isDemo: true })).toEqual([]);
    expect(selectAmoraTaskChatTools({ ...base, requestKind: "initial_greeting" })).toEqual([]);
    expect(selectAmoraTaskChatTools({ ...base, durable: false })).toEqual([]);
  });

  it("찾기 갈래가 없으면 찾기가 드는 종류는 목록에 없다", () => {
    const [tool] = selectAmoraTaskChatTools(base);
    expect(tool.name).toBe(OFFER_AMORA_TASK_TOOL_NAME);
    const kinds = (tool.input_schema.properties as { kind: { enum: string[] } }).kind.enum;
    expect(kinds).toEqual(["todo_deadlines", "date_candidates", "quote_compare"]);
    const withSearch = selectAmoraTaskChatTools({ ...base, adapters: { ...noAdapters, webSearch: { search: vi.fn(), readPage: vi.fn() } } });
    expect((withSearch[0].input_schema.properties as { kind: { enum: string[] } }).kind.enum).toContain("hall_candidates");
  });
});

describe("시작 카드 만들기", () => {
  function store(result: Awaited<ReturnType<AmoraTaskStore["offer"]>>) {
    return { offer: vi.fn(async () => result) } as unknown as AmoraTaskStore & { offer: ReturnType<typeof vi.fn> };
  }
  const context = { coupleId: COUPLE, actorProfileId: USER, requestKey: KEY, weddingContext: { weddingDate: null, budget: 0, venue: null, progress: {} } };

  it("서버가 정한 칸으로만 카드를 만들고, 맡기기 전에는 시작하지 않는다", async () => {
    const fake = store({ ok: true, code: "offered", status: "offered", taskId: TASK, offerExpiresAt: "2026-11-21T01:00:00.000Z" });
    const result = await executeOfferAmoraTask(
      { kind: "date_candidates", purpose: "상견례", prefer: "weekend", region: "무시할 칸" },
      context,
      { store: fake, adapters: noAdapters, env: ON, todayYmd: "2026-11-20" },
    );
    expect(result.success).toBe(true);
    expect(result.toolOutput).toMatchObject({ offer_kind: "amora_task_offer_v1", task_id: TASK, kind: "date_candidates", title: "상견례 날짜 후보 모으기", started: false });
    expect(fake.offer).toHaveBeenCalledWith(expect.objectContaining({
      coupleId: COUPLE,
      requestedBy: USER,
      sourceLane: "shared",
      sourceRequestKey: KEY,
      input: { purpose: "상견례", prefer: "weekend", from_date: "2026-11-21", to_date: "2027-01-02" },
      offerTtlSeconds: 86_400,
    }));
  });

  it("조건이 틀리면 카드를 만들지 않는다", async () => {
    const fake = store({ ok: true, code: "offered", status: "offered", taskId: TASK, offerExpiresAt: null });
    const result = await executeOfferAmoraTask({ kind: "quote_compare", quotes: [{ label: "A" }] }, context, { store: fake, adapters: noAdapters, env: ON });
    expect(result.success).toBe(false);
    expect(fake.offer).not.toHaveBeenCalled();
  });

  it("찾기 갈래 없이 찾기 일을 부르면 거절한다", async () => {
    const fake = store({ ok: true, code: "offered", status: "offered", taskId: TASK, offerExpiresAt: null });
    const result = await executeOfferAmoraTask({ kind: "hall_candidates", region: "강남" }, context, { store: fake, adapters: noAdapters, env: ON });
    expect(result.toolOutput).toEqual({ error_code: "task_kind_unavailable" });
    expect(fake.offer).not.toHaveBeenCalled();
  });

  it("표가 아직 없으면(앱이 DB 보다 먼저 나감) 조용히 거절한다", async () => {
    const offer = vi.fn(async () => { throw Object.assign(new Error("relation does not exist"), { code: "42P01" }); });
    const result = await executeOfferAmoraTask({ kind: "todo_deadlines" }, context, { store: { offer } as unknown as AmoraTaskStore, adapters: noAdapters, env: ON });
    expect(result.toolOutput).toEqual({ error_code: "tasks_unavailable" });
  });
});

describe("조건과 계산", () => {
  it("견적 조건은 2~5개, 합계나 금액 있는 항목이 있어야 한다", () => {
    expect(normalizeAmoraTaskInput("quote_compare", { quotes: [{ label: "A", total_won: 100 }, { label: "B", items: [{ name: "촬영", won: 50 }] }] }, "2026-11-20").ok).toBe(true);
    expect(normalizeAmoraTaskInput("quote_compare", { quotes: [{ label: "A", total_won: 100 }, { label: "B", items: [{ name: "촬영" }] }] }, "2026-11-20").ok).toBe(false);
    expect(quoteTotal({ label: "B", total_won: null, items: [{ name: "촬영", won: 1_200_000 }, { name: "앨범", won: 300_000 }] })).toBe(1_500_000);
    expect(budgetDifferenceLabel(3_200_000, { key: "sdm", label: "스드메", allocated: 3_000_000, allocated_is_set: true })).toBe("예산보다 20만원 많아요");
    expect(budgetDifferenceLabel(2_800_000, { key: "sdm", label: "스드메", allocated: 3_000_000 })).toBe("예산보다 20만원 적어요");
    expect(budgetDifferenceLabel(2_800_000, null)).toBe("예산을 정하지 않았어요");
  });

  it("날짜 후보는 한국 날짜로 주말만 고르고, 일정이 있는 날과 예식일을 뺀다", () => {
    const picked = findDateCandidates({
      fromDate: "2026-11-21",
      toDate: "2026-12-06",
      prefer: "weekend",
      events: [{ date: "2026-11-22", title: "웨딩홀 상담" }],
      weddingDate: "2026-11-29",
    });
    expect(picked.map((item) => item.date)).toEqual(["2026-11-21", "2026-11-28", "2026-12-05", "2026-12-06"]);
    expect(picked[0].sameWeek).toEqual([]);
    expect(normalizeAmoraTaskInput("date_candidates", { from_date: "2026-11-20" }, "2026-11-20").ok).toBe(false);
    expect(normalizeAmoraTaskInput("date_candidates", { from_date: "2026-11-21", to_date: "2027-03-01" }, "2026-11-20").ok).toBe(false);
  });
});
