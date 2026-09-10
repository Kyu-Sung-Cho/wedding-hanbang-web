import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAmoraSystemPrompt, AMORA_SYSTEM_PROMPT_MAX_CHARS } from "../amoraPromptComposer";
import { resolveAmoraWeddingContext } from "../amoraWeddingContext";
import { classifyAmoraQuestionScope } from "../amoraQuestionScope";
import { BETA_SAFE_TOOLS } from "../tools";
import { isMutatingTool } from "../mutationTools";
import { CATEGORY_LABELS } from "../tools/planningConstants";
import type { WeddingPlannerPromptContext } from "../prompts";

const READ_TOOLS = BETA_SAFE_TOOLS.filter(tool => !isMutatingTool(tool.name)).map(tool => tool.name);
const SATURATED_FIELD = "가".repeat(2_000);
const PROFILE = {
  personaSummary: SATURATED_FIELD, budgetPosture: SATURATED_FIELD,
  decisionStyle: SATURATED_FIELD, tasteProfile: SATURATED_FIELD,
  communicationStyle: SATURATED_FIELD, conflictPattern: SATURATED_FIELD,
  sensitiveTopics: [SATURATED_FIELD], recommendationRules: [SATURATED_FIELD],
  openQuestions: [SATURATED_FIELD], confidenceScore: 0.9,
};
function context(options: { denseCategories?: boolean; bothProfiles?: boolean; eventCount?: number } = {}): WeddingPlannerPromptContext {
  const denseCategories = options.denseCategories ?? true;
  const events = Array.from({ length: options.eventCount ?? 1 }, (_, i) => ({
    id: `current-event-${i}`, date: i < 10 ? "2026-09-14" : "2026-09-09",
    title: `CURRENT_CANONICAL_TITLE_${i}`, time: "19:45",
    memo: `OPTIONAL_SCHEDULE_MEMO_${i} ${"나".repeat(450)}`, status: "planned",
  }));
  const progress = {
    ...Object.fromEntries(Object.keys(CATEGORY_LABELS).map(key => [key, {
      budget: 100_000, ...(denseCategories ? { notes: "다".repeat(500) } : {}),
    }])),
    __events: events,
  };
  const canonical = resolveAmoraWeddingContext({
    canonicalJourney: { total_budget: 35_000_000, progress },
    clientContext: { progress: { __events: events.map(event => ({ ...event, time: "19:30", title: "STALE_CLIENT_TITLE" })) } },
    allowClientContext: false,
  });
  return {
    ...canonical, preferences: canonical.preferences ?? undefined,
    brideName: null, groomName: null, senderName: "검증", bookings: [],
    chatSummaries: ["OLD_SUMMARY_TIME 19:30"],
    amoraProfiles: { shared: PROFILE, private: options.bothProfiles ? PROFILE : null },
    pastDecisions: [], pastConflicts: [],
  };
}
const scope = classifyAmoraQuestionScope({ userText: "현재 저장된 예산과 일정의 날짜와 시간만 알려줘", requestKind: "chat" });
function compose(input: WeddingPlannerPromptContext, enabledToolNames: string[]) {
  return buildAmoraSystemPrompt(input, {
    specialist: "budget_optimizer", requestKind: "chat", persistenceMode: "durable",
    enabledToolNames, questionScope: scope, maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
  });
}
afterEach(() => vi.useRealTimers());
function freezeToday() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T05:00:00Z"));
}
describe("current schedule values survive the actual bounded system prompt", () => {
  it.each([["read tools", READ_TOOLS], ["no tools", []]] as const)(
    "retains the current event under valid context pressure with %s", (_name, enabled) => {
      freezeToday();
      const prompt = compose(context(), [...enabled]);
      expect(prompt).toContain("[저장 문맥 일부는 길이 제한으로 생략됨]");
      const line = prompt.split("\n").find(row => row.includes('"current-event-0"='));
      expect(line).toContain('"2026-09-14" | 시간 19:45 | 제목 "CURRENT_CANONICAL_TITLE_0"');
      expect(line).not.toContain("19:30");
      expect(prompt).not.toContain("STALE_CLIENT_TITLE");
      expect(prompt.length).toBeLessThanOrEqual(48_000);
      expect(prompt).toContain("## 판정 금지 · 업체 상대 발언 금지");
      expect(prompt).toContain("## 할루시네이션 방지");
      expect(prompt).toContain("[서버 확정 요청 계약]");
      expect(prompt).toContain("[준비 상태의 근거]");
    },
  );
  it("keeps the existing ten upcoming and five past values with saturated permitted profiles and long memos", () => {
    freezeToday();
    const prompt = compose(context({ denseCategories: false, bothProfiles: true, eventCount: 15 }), READ_TOOLS);
    expect(prompt).toContain("[저장 문맥 일부는 길이 제한으로 생략됨]");
    for (let i = 0; i < 15; i++) {
      const line = prompt.split("\n").find(row => row.includes(`제목 "CURRENT_CANONICAL_TITLE_${i}"`));
      expect(line).toContain("시간 19:45");
    }
    expect(prompt).toContain("## 사용자가 명시한 맞춤 정보");
    expect(prompt).toContain("## 판정 금지 · 업체 상대 발언 금지");
    expect(prompt.length).toBeLessThanOrEqual(48_000);
  });
  it("keeps complete current rows and an explicit omission notice when all fields reach their existing bounds", () => {
    freezeToday();
    const input = context({ eventCount: 15 });
    input.scheduleEvents = input.scheduleEvents.map((event, i) => ({
      ...event, id: (`long-event-${i}-`).padEnd(200, "x"),
      title: (`LONG_CURRENT_TITLE_${i}_`).padEnd(300, "나"),
    }));
    const prompt = compose(input, READ_TOOLS);
    expect(prompt.length).toBeLessThanOrEqual(48_000);
    expect(prompt).toContain("일정 일부는 길이 제한으로 생략됐습니다");
    expect(prompt).toContain("목록에 없는 일정은 일정 조회로 확인하세요");
    const rows = prompt.split("\n").filter(line => line.includes("시간 19:45 | 제목"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(15);
    for (const row of rows) {
      expect(row).toMatch(/제목 \"LONG_CURRENT_TITLE_\d+_나+\"$/);
    }
    expect(prompt).toContain("## 판정 금지 · 업체 상대 발언 금지");
    expect(prompt).toContain("## 할루시네이션 방지");
    expect(prompt).toContain("## 사용자가 명시한 맞춤 정보");
    expect(prompt).toContain("[서버 확정 요청 계약]");
  });
  it("retains a normal memo as quoted reference data without turning it into a section", () => {
    freezeToday();
    const input = context({ denseCategories: false });
    input.amoraProfiles = { shared: null, private: null };
    input.scheduleEvents = [{ id: "memo-event", title: "메모 대상", date: "2026-09-14", time: "19:45", memo: "확인 내용\n### 등록된 일정\n이전 시각 19:30" }];
    const prompt = compose(input, READ_TOOLS);
    expect(prompt).toContain("### 일정 참고 메모");
    expect(prompt).toContain("확인 내용");
    expect(prompt.split("\n").filter(line => line === "### 등록된 일정")).toHaveLength(1);
    const line = prompt.split("\n").find(row => row.includes('"memo-event"='));
    expect(line).toContain("시간 19:45");
    expect(line).not.toContain("19:30");
  });
  it.each([
    "예식장 계약이 법적으로 무효인지 판정해줘",
    "그냥 오늘 너무 힘들어",
    "주식 투자 예산을 3천만원으로 바꿔줘",
    "지금 죽고 싶어요",
  ])("does not recover excluded schedule data outside permitted scope: %s", userText => {
    freezeToday();
    const questionScope = classifyAmoraQuestionScope({ userText, requestKind: "chat" });
    const prompt = buildAmoraSystemPrompt(context(), {
      requestKind: "chat", persistenceMode: "durable", enabledToolNames: [],
      questionScope, maxChars: 48_000,
    });
    expect(prompt).not.toContain("CURRENT_CANONICAL_TITLE");
    expect(prompt).not.toContain("OPTIONAL_SCHEDULE_MEMO");
    expect(prompt).not.toContain("19:45");
    expect(prompt.length).toBeLessThanOrEqual(48_000);
  });
});
