import { describe, expect, it } from "vitest";
import { AMORA_SYSTEM_PROMPT_MAX_CHARS, buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { AMORA_STATUS_SUMMARY_EVIDENCE_RULE } from "@/lib/ai/amoraVoice";
import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";
import type { AmoraQuestionScopeClassification } from "@/lib/ai/amoraQuestionScope";

type Context = Parameters<typeof buildAmoraSystemPrompt>[0];
type Options = Parameters<typeof buildAmoraSystemPrompt>[1];
const context: Context = {
  weddingDate: null, budget: 0, venue: null, progress: {}, preparationStatus: "preparing",
  brideName: null, groomName: null, senderName: "합성 검사", bookings: [],
  scheduleEvents: [], chatSummaries: [], pastDecisions: [], pastConflicts: [],
};
const heading = "[준비 상태의 근거]";
const readToolNames = BETA_SAFE_TOOLS.filter(tool => !isMutatingTool(tool.name)).map(tool => tool.name);
const scope = (value: AmoraQuestionScopeClassification["scope"]): AmoraQuestionScopeClassification => ({
  scope: value, allowsLongTermMemory: value === "W0_wedding_core" || value === "W1_wedding_adjacent",
  confidence: "high", needsClarification: false,
});
const options: Options = {
  requestKind: "chat", persistenceMode: "durable", enabledToolNames: [],
  questionScope: scope("W0_wedding_core"), maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
};

// 실제 실패는 질문의 의미를 모델이 잘못 읽은 것이다. 이 검사는 의미 판단을 흉내 내지
// 않고, 최종 조립에서 근거 구분 계약이 사라지거나 권한 경계를 덮는 회귀만 막는다.
describe("준비 상태 요약의 근거가 최종 조립에서도 보존된다", () => {
  it.each(["W0_wedding_core", "W1_wedding_adjacent"] as const)("%s의 도구/포화 문맥에 동일 계약을 한 번 전달한다", value => {
    for (const enabledToolNames of [readToolNames, []]) {
      for (const saturated of [false, true]) {
        const prompt = buildAmoraSystemPrompt(saturated ? {
          ...context, chatSummaries: Array.from({ length: 30 }, () => "합성 과거 대화 ".repeat(1000)),
        } : context, { ...options, questionScope: scope(value), enabledToolNames });
        expect(prompt.split(heading)).toHaveLength(2);
        expect(prompt.split(AMORA_STATUS_SUMMARY_EVIDENCE_RULE)).toHaveLength(2);
        const index = prompt.indexOf(heading);
        expect(index).toBeGreaterThan(prompt.indexOf("[이번 답변의 대화 우선순위]"));
        expect(index).toBeLessThan(prompt.indexOf("[준비 의견의 근거 확인]"));
        expect(prompt.length).toBeLessThanOrEqual(AMORA_SYSTEM_PROMPT_MAX_CHARS);
        if (saturated) expect(prompt).toContain("길이 제한으로 생략됨");
      }
    }
  });

  it("기본 프롬프트 소비자와 기존 scope 생략 호출에서도 근거 규칙을 한 번 유지한다", () => {
    const base = getWeddingPlannerSystemPrompt(context);
    expect(base.split(AMORA_STATUS_SUMMARY_EVIDENCE_RULE)).toHaveLength(2);
    expect(base).not.toContain(heading);
    const prompt = buildAmoraSystemPrompt(context, { ...options, questionScope: undefined });
    expect(prompt.split(AMORA_STATUS_SUMMARY_EVIDENCE_RULE)).toHaveLength(2);
    expect(prompt.split(heading)).toHaveLength(2);
  });

  it("전달 부재 추론과 직접 진술의 양쪽 기준을 같은 보호 블록에 둔다", () => {
    const prompt = buildAmoraSystemPrompt(context, options);
    const start = prompt.indexOf(heading);
    const block = prompt.slice(start, prompt.indexOf("[준비 의견의 근거 확인]", start));
    expect(block).toContain("직접 진술");
    expect(block).toContain("전달 여부 미확인");
    expect(block).toContain("질문·분류 요청·AI가 제안한 문구");
    expect(block).toContain("질문 안에 포함된 직접 진술은 유지");
    expect(block).toContain("전달 여부나 공동 합의가 확인되지 않으면 미확인");
  });

  it.each(["W2_high_risk_adjacent", "W3_social_care", "W4_out_of_scope", "W5_safety_override"] as const)("%s의 근거 범위를 준비 상태로 넓히지 않는다", value => {
    const prompt = buildAmoraSystemPrompt(context, { ...options, questionScope: scope(value) });
    expect(prompt).not.toContain(heading);
    expect(prompt).toContain(value);
  });

  it.each(["initial_greeting", "mediation"] as const)("%s 전용 요청 계약을 일반 준비 요약으로 바꾸지 않는다", requestKind => {
    const prompt = buildAmoraSystemPrompt(context, {
      ...options, requestKind, questionScope: scope("W1_wedding_adjacent"),
    });
    expect(prompt).not.toContain(heading);
    expect(prompt).toContain(`request_kind: ${requestKind}`);
    if (requestKind === "mediation") expect(prompt).toContain("requester_summary_only");
  });

  it("체험의 미저장과 서버 발급 실행 계약의 실제 결과를 그대로 보존한다", () => {
    const demo = buildAmoraSystemPrompt(context, { ...options, persistenceMode: "demo" });
    expect(demo).toContain(heading);
    expect(demo).toContain("[체험 상담 저장 경계]");
    const execution = "합성 서버 실행 영수증: 예산 35000000, 성공";
    const prompt = buildAmoraSystemPrompt(context, {
      ...options, actionContract: { kind: "execution", text: execution },
    });
    expect(prompt).toContain(execution);
    expect(prompt).toContain(heading);
    expect(prompt).toContain("request_kind: chat");
  });
});
