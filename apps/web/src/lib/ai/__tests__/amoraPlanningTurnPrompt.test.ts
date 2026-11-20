import { describe, expect, it } from "vitest";
import { buildAmoraSystemPrompt, AMORA_SYSTEM_PROMPT_MAX_CHARS } from "@/lib/ai/amoraPromptComposer";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";
import { saturatingDecisionHistory } from "./fixtures/saturatingDecisionHistory";
type Context = Parameters<typeof buildAmoraSystemPrompt>[0];
type Options = Parameters<typeof buildAmoraSystemPrompt>[1];
const context: Context = {
  weddingDate: null, budget: 0, venue: null, progress: {}, preparationStatus: null,
  brideName: null, groomName: null, senderName: "합성 검사", bookings: [],
  scheduleEvents: [], chatSummaries: [], pastDecisions: [], pastConflicts: [],
};
const options: Options = {
  requestKind: "chat",
  persistenceMode: "durable",
  questionScope: classifyAmoraQuestionScope({
    userText: "결혼식을 가족식으로 바꾸는 이유는 준비가 부담되기 때문이야.",
  }),
  enabledToolNames: [],
  maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
  planningTurn: "pivot_reason_followup",
};
const marker = "[이번 턴: 방향 변경 이유에 대한 후속]";
describe("검증된 방향 변경 후속에만 이번 답변 계약을 선택한다", () => {
  it.each([false, true])("포화=%s에도 유지와 재검토, 현재 선호 우선과 미확정 경계를 함께 전달한다", saturated => {
    const prompt = buildAmoraSystemPrompt(saturated ? {
      ...context,
      pastDecisions: saturatingDecisionHistory("합성 과거 문맥"),
    } : context, options);
    expect(prompt.split(marker)).toHaveLength(2);
    expect(prompt).toContain("이유를 다시 묻거나 새 취향 질문으로 넘기지");
    expect(prompt).toContain("바꾸지 않은 명시적 우선순위·중요 항목·생략·시기");
    expect(prompt).toContain("이번에 바꾼 선호·월 후보는 과거보다 우선");
    expect(prompt).toContain("후보를 확정으로 바꾸지");
    expect(prompt).toContain("규모·장소·식사·최소 인원·견적");
    expect(prompt).toContain("공동 합의나 예산·일정의 저장 완료");
    expect(prompt).not.toContain("이유 답변에는 미변경 선호·우선순위·생략·시기의 유지");
    expect(prompt).toContain("[서버 확정 요청 계약]");
    expect(prompt.length).toBeLessThanOrEqual(48000);
    if (saturated) expect(prompt).toContain("길이 제한으로 생략됨");
  });
  it("단서가 없으면 기존 일반 규칙을 그대로 유지한다", () => {
    const prompt = buildAmoraSystemPrompt(context, { ...options, planningTurn: null });
    expect(prompt).not.toContain(marker);
    expect(prompt).toContain("이유 답변에는 미변경 선호·우선순위·생략·시기의 유지");
  });
  it.each(["paused", "called_off"] as const)("준비 중단 %s에는 새 후속 계약을 넣지 않는다", preparationStatus => {
    expect(buildAmoraSystemPrompt({ ...context, preparationStatus }, options)).not.toContain(marker);
  });
  it.each([
    { persistenceMode: "demo" },
    { requestKind: "initial_greeting" },
    { requestKind: "mediation" },
    { actionContract: { kind: "execution", text: "합성 실행 계약" } },
    { questionScope: classifyAmoraQuestionScope({ userText: "죽고 싶어. 지금 나를 해치려고 해." }) },
    { questionScope: classifyAmoraQuestionScope({ userText: "오늘 날씨 알려줘" }) },
  ] satisfies Partial<Options>[])("다른 권한/요청 계약에 새 후속 규칙이 침범하지 않는다: %j", overrides => {
    expect(buildAmoraSystemPrompt(context, { ...options, ...overrides })).not.toContain(marker);
  });
});
