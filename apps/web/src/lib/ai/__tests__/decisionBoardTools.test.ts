import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeTool } from "../toolExecutor";
import { parsePreparationDecisions } from "@/lib/amora/preparationBoard";
import type { ToolExecutionContext } from "../tools/toolTypes";
import { classifyAmoraQuestionScope } from "../amoraQuestionScope";

const database = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, fail: false, afterRead: null as (() => void) | null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => new Query(table), rpc: async () => ({ data: null, error: null }) }) }));

// DB 경계만 대체한다. 실제 도구 실행기와 결정보드 파서를 함께 통과시킨다.
class Query {
  private filters: Array<(row: Record<string, unknown>) => boolean> = [];
  private cap = Infinity;
  private sorts: Array<{ key: string; ascending: boolean }> = [];
  constructor(private table: string) {}
  select() { return this; }
  eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this; }
  is(key: string, value: unknown) {
    this.filters.push(row => (key === "metadata->>extracted_by"
      ? (row.metadata as Record<string, unknown> | null)?.extracted_by ?? null : row[key]) === value);
    return this;
  }
  order(key: string, options: { ascending: boolean }) { this.sorts.push({ key, ...options }); return this; }
  limit(value: number) { this.cap = value; return this; }
  private result() {
    const data = (database.rows[this.table] ?? []).filter(row => this.filters.every(filter => filter(row)))
      .sort((a, b) => { for (const sort of this.sorts) { const order = String(a[sort.key]).localeCompare(String(b[sort.key])); if (order) return sort.ascending ? order : -order; } return 0; })
      .slice(0, this.cap);
    return { data, error: database.fail ? { code: "TEST_READ_FAILURE" } : null };
  }
  async maybeSingle() { const result = this.result(); return { ...result, data: result.data[0] ?? null }; }
  then<TResult>(resolve: (value: ReturnType<Query["result"]>) => TResult) { const result = this.result(); if (this.table === "decision_nodes") database.afterRead?.(); return Promise.resolve(result).then(resolve); }
}

const actor = "00000000-0000-4000-8000-000000000001";
const couple = "00000000-0000-4000-8000-000000000002";
const decisionId = "00000000-0000-4000-8000-000000000003";
const row = {
  id: decisionId, couple_id: couple, visibility: "shared", category: "venue",
  title: "2028년 가을, 하객 80명 안팎의 식사 중심 예식 검토",
  reasoning: "두 분은 서울 거주, 부모님은 부산·대구 거주. 날짜·지역·장소·예산·하객 명단은 미정.",
  decision_type: "considering", source: "chat", created_at: "2026-09-20T01:00:00.000Z",
  superseded_at: null, memory_key: null, metadata: {}, chosen_value: null,
};
const routineRow = { ...row, id: "00000000-0000-4000-8000-000000000005", category: "plan",
  title: "진행 상황: 1개 수정", decision_type: "decided", source: "manual",
  metadata: { origin: "couple_plan_change_request" },
  chosen_value: { schemaVersion: 1, changes: { progress_patch: {
    venue: { category: "venue", status: "completed", checklist: [{ id: "venue_01", done: true }] },
  }, progress_remove_keys: [] } },
};
const context: ToolExecutionContext = { coupleId: couple, actorProfileId: actor,
  weddingContext: { weddingDate: null, budget: 0, venue: null, progress: {} } };

beforeEach(() => {
  database.fail = false;
  database.afterRead = null;
  database.rows = { decision_nodes: [{ ...row }], profiles: [{ id: actor, couple_id: couple, role: "bride" }],
    couples: [{ id: couple, bride_id: actor, groom_id: null }] };
});

describe("아모라의 결정보드 실제 저장 조회", () => {
  it.each(["결정 보드에 논의 중으로 저장해줘", "결정보드에 저장된 기록 보여줘", "결정 기록에 식사 중심으로 검토 중이라고 남겨줘"])("실제 제품의 결정 기록 요청을 범위 밖으로 내보내지 않는다: %s", text => {
    expect(classifyAmoraQuestionScope({ userText: text }).scope).toBe("W0_wedding_core");
  });
  it("결정보드와 동일한 기록을 조회하고 논의 중을 확정이나 할 일로 바꾸지 않는다", async () => {
    const result = await executeTool("get_decision_records", {}, context);
    expect(result.success).toBe(true);
    expect(result.toolOutput.list_kind).toBe("decision_records");
    expect(result.toolOutput.records).toEqual(parsePreparationDecisions([row], couple).records);
    expect(result.toolOutput).toMatchObject({ truncated: false, count: 1 });
    expect(result.displayMessage).toContain("결정 기록");
  });
  it("체크리스트 진행만 바꾼 행은 화면처럼 결정 목록과 결정 건수에서 뺀다", async () => {
    database.rows.decision_nodes = [{ ...routineRow }, { ...row }];
    const result = await executeTool("get_decision_records", {}, context);
    expect(result.success).toBe(true);
    expect(result.toolOutput.records).toEqual(parsePreparationDecisions([row], couple).records);
    expect(result.toolOutput).toMatchObject({ count: 1, truncated: false, count_scope: "returned_records_only" });
    expect(result.displayMessage).toContain("결정 기록 1개");
  });
  it.each([{ couple_id: couple }, { visibility: "shared" }, { visibility: "bride_private" },
    { decision_id: decisionId, limit: 1000 }])("허용하지 않은 입력 필드는 조회 권한처럼 받아들이지 않는다: %j", async input => {
    const result = await executeTool("get_decision_records", input, context);
    expect(result.success).toBe(false);
    expect(result.toolOutput).not.toHaveProperty("records");
  });
  it.each([
    { visibility: "bride_private" }, { visibility: "groom_private" },
    { couple_id: "00000000-0000-4000-8000-000000000004" },
    { memory_key: "private_preference" }, { metadata: { extracted_by: "automatic_memory" } },
    { superseded_at: "2026-09-20T02:00:00.000Z" },
  ])("비공개·다른 커플·자동 기억·이전 값은 공유 결정으로 조회하지 않는다: %j", overrides => {
    database.rows.decision_nodes = [{ ...row, ...overrides }];
    return expect(executeTool("get_decision_records", {}, context)).resolves.toMatchObject({ success: true, toolOutput: { records: [], count: 0 } });
  });
  it.each(["missing_actor", "wrong_profile", "wrong_roster", "late_roster", "database_error", "invalid_id"])("권한·조회 실패를 빈 목록 성공으로 바꾸지 않는다: %s", async kind => {
    let ctx = context;
    if (kind === "missing_actor") ctx = { ...context, actorProfileId: undefined };
    if (kind === "wrong_profile") database.rows.profiles[0].couple_id = "another";
    if (kind === "wrong_roster") database.rows.couples[0].bride_id = null;
    if (kind === "late_roster") database.afterRead = () => { database.rows.couples[0].groom_id = "00000000-0000-4000-8000-000000000004"; };
    if (kind === "database_error") database.fail = true;
    const result = await executeTool("get_decision_records", kind === "invalid_id" ? { decision_id: "forged" } : {}, ctx);
    expect(result.success).toBe(false);
    expect(result.toolOutput).not.toHaveProperty("records");
    expect(result.displayMessage).toContain("확인하지 못했어요");
  });
  it("정확한 기록 id를 조회하며 없는 id는 다른 결정을 대신 보여주지 않는다", async () => {
    expect((await executeTool("get_decision_records", { decision_id: decisionId }, context)).toolOutput.count).toBe(1);
    expect((await executeTool("get_decision_records", { decision_id: "00000000-0000-4000-8000-000000000099" }, context)).toolOutput.count).toBe(0);
  });
  it("모델의 직접 저장 호출은 사용자 확인 id 없이 실행하지 않는다", async () => {
    const result = await executeTool("add_decision_record", { title: row.title, status: "considering" }, {
      ...context, requestKey: `chat:${actor}:00000000-0000-4000-8000-000000000009`, requestAttemptCount: 1, providerCallIndex: 1,
    });
    expect(result.success).toBe(false);
    expect(result.toolOutput.error).toBe("DECISION_APPROVAL_REQUIRED");
  });
  it("최근 30개만 읽었으면 전체 기록 수라고 주장하지 않는다", async () => {
    database.rows.decision_nodes = Array.from({ length: 35 }, (_, index) => ({ ...row,
      id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}` }));
    const result = await executeTool("get_decision_records", {}, context);
    expect(result.toolOutput).toMatchObject({ count: 30, truncated: true, count_scope: "returned_records_only" });
    expect(result.displayMessage).toContain("이전 기록");
  });
  it("최근 페이지가 진행 기록으로만 채워졌어도 이전 결정 기록이 있을 수 있음을 유지한다", async () => {
    database.rows.decision_nodes = [row, ...Array.from({ length: 31 }, (_, index) => ({ ...routineRow,
      id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}` }))];
    const result = await executeTool("get_decision_records", {}, context);
    expect(result.success).toBe(true);
    expect(result.toolOutput).toMatchObject({ records: [], count: 0, truncated: true, count_scope: "returned_records_only" });
    expect(result.displayMessage).toContain("이번 조회 조건");
    expect(result.displayMessage).toContain("이전 기록은 결정보드");
  });
  it.each([
    "결정보드에 자살 방법을 기록해줘", "결정보드에 남편이 나를 때렸어 죽고 싶어 기록해줘",
    "회사 업무 결정 기록을 저장해줘", "주식 투자 결정 기록을 저장해줘",
    "결정보드에 파이썬 코드 저장해줘", "결정 기록에 자바 알고리즘을 저장해줘",
    "결정보드에 소스 코드를 저장해줘",
    "결정 보드에 병원 진단과 약 용량을 정해서 저장해줘",
  ])("결정보드라는 낱말이 안전·다른 분야 경계를 열지 않는다: %s", text => {
    expect(classifyAmoraQuestionScope({ userText: text }).scope).not.toBe("W0_wedding_core");
  });
});
