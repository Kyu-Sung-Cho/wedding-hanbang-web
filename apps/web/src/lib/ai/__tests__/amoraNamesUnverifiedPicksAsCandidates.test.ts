/**
 * 검증 전에 추천을 확정했다.
 *
 * 2026-09-03 2차 팀 테스트 Major 7(후반) / Turn 28: 예산 3,500만 원에 대한 적합성을
 * 확인하지 못한 채 "대전 식당 예식 180~200명" 을 **추천 1순위**로 먼저 못 박고,
 * "다만 실제 예산 적합성은 아직 판단할 수 없어요" 를 뒤에 붙였다. 단서는 있었고
 * 순서만 위험했다 — 사용자는 1순위를 먼저 읽는다.
 *
 * 2026-09-08 재검증에서도 1순위를 먼저 말하고 단서를 뒤에 붙였다. 강화한 규칙도
 * 포화 프로필·긴 이력에서는 잘렸으므로 결정 역할 바로 아래로 옮긴다.
 *
 * ## 이 파일이 재는 것
 *
 * 결정·프로필·대화 요약을 각각 채워 실제로 절단이 일어나는 표본에서도 규칙 전체가
 * 한 번만 남는지 본다. 다른 추천 기준도 유지한다.
 * 절단이 한 번도 안 일어난 표본으로 재면 이 검사는 아무것도 지키지 못한다.
 */
import { describe, expect, it } from "vitest";

import {
  AMORA_SYSTEM_PROMPT_MAX_CHARS,
  buildAmoraSystemPrompt,
} from "@/lib/ai/amoraPromptComposer";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import {
  classifyAmoraQuestionScope,
  filterAmoraToolsByQuestionScope,
} from "@/lib/ai/amoraQuestionScope";
import { buildAmoraPendingActionPrompt } from "@/lib/ai/amoraPendingAction";
import { getAmoraActionApprovalPolicy } from "@/lib/ai/amoraActionApprovalPolicy";
import {
  selectAmoraPendingProposalTools,
  selectAmoraTools,
} from "@/lib/ai/amoraToolPolicy";
import { getAvailableChatTools } from "@/lib/ai/placeSearchRouting";

const CHECKLIST_HEADING = "**추천·비교의 내부 점검:**";

// 손으로 도구를 나열하지 않는다. route.ts 와 같은 순서로 범위 판정 -> 도구 선택 ->
// 차단 정책 필터를 돌린 결과만 넘긴다 — 운영이 만들지 않는 입력으로 재면
// 한 번도 안 나가는 규칙이 초록불을 받는다.
const PENDING_ACTION_TOOLS = BETA_SAFE_TOOLS.filter((tool) => isMutatingTool(tool.name));
const USER_TEXT = "결혼식 예산 배분 좀 도와줘";

function promptWith(decisionCount: number, stress: "none" | "profiles" | "history" = "none"): string {
  const questionScope = classifyAmoraQuestionScope({ userText: USER_TEXT });
  const candidateTools = getAvailableChatTools({
    requestKind: "chat",
    isDurableUserMessageBound: true,
    tools: BETA_SAFE_TOOLS,
  });
  const readTools = filterAmoraToolsByQuestionScope(
    selectAmoraTools({
      availableTools: candidateTools,
      userText: USER_TEXT,
      specialistType: "general",
      checklistLabels: [],
      attachmentKind: "none",
    } as never).filter((tool) => !isMutatingTool(tool.name)),
    questionScope,
  );
  const proposableTools = filterAmoraToolsByQuestionScope(
    selectAmoraPendingProposalTools({
      availableTools: PENDING_ACTION_TOOLS,
      userText: USER_TEXT,
      specialistType: "general",
      checklistLabels: [],
      attachmentKind: "none",
    } as never).filter((tool) => getAmoraActionApprovalPolicy(tool.name) !== "blocked"),
    questionScope,
  );
  const pastDecisions = Array.from({ length: decisionCount }, (_, index) => ({
    category: ["venue", "budget", "schedule", "dress", "studio"][index % 5],
    decisionType: "user_confirmed",
    title: `결정 ${index + 1}: 예식장 후보 비교`,
    value: `값 ${index + 1} — 그랜드힐 2층, 보증 250명`,
    reasoning: `사용자가 확인함 ${index + 1}`,
    confidence: 0.8,
    source: "amora_chat",
    createdAt: "2026-08-01T10:00:00Z",
    vendorDeliveryStatus: null,
    vendorConfirmationStatus: null,
    internalRequestStatus: null,
    vendorCancellationStatus: null,
    refundStatus: null,
    completionEvidence: null,
  }));
  return buildAmoraSystemPrompt(
    {
      weddingDate: "2027-05-15",
      budget: 35_000_000,
      venue: null,
      progress: {},
      preparationStatus: null,
      brideName: "신부",
      groomName: "신랑",
      senderName: "신부",
      bookings: [],
      scheduleEvents: [],
      chatSummaries: [],
      pastConflicts: [],
      pastDecisions,
      ...(stress === "profiles" ? {
        amoraProfiles: Object.fromEntries(["shared", "private"].map(scope => [scope, {
          personaSummary: "가".repeat(2_000), budgetPosture: "가".repeat(2_000),
          decisionStyle: "가".repeat(2_000), tasteProfile: "가".repeat(2_000),
          communicationStyle: "가".repeat(2_000), conflictPattern: "가".repeat(2_000),
          sensitiveTopics: ["가".repeat(2_000)], recommendationRules: ["가".repeat(2_000)],
          openQuestions: ["가".repeat(2_000)], confidenceScore: 0.9,
        }])),
      } : {}),
      ...(stress === "history" ? {
        chatSummaries: Array.from({ length: 30 }, (_, index) => `요약 ${index}. 예식장 후보와 촬영 견적을 비교한 합성 대화. `.repeat(30)),
        scheduleEvents: Array.from({ length: 40 }, (_, index) => ({
          id: `evt-${index}`, title: `일정 ${index}: 견적 문의`, date: "2027-03-01", type: "couple_promise",
        })),
      } : {}),
    } as never,
    {
      specialist: "general",
      requestKind: "chat",
      persistenceMode: "durable",
      enabledToolNames: readTools.map((tool) => tool.name),
      actionContract: proposableTools.length > 0
        ? { kind: "proposal", text: buildAmoraPendingActionPrompt(proposableTools) }
        : undefined,
      questionScope,
      maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
    } as never,
  ) as string;
}

/** 내부 점검 목록만 잘라낸다. 프롬프트 전체에 물으면 다른 절이 대신 답한다. */
function checklistSection(prompt: string): string {
  const start = prompt.indexOf(CHECKLIST_HEADING);
  expect(start, "내부 점검 목록이 합성 결과에 없다").toBeGreaterThan(-1);
  const end = prompt.indexOf("\n\n**", start + CHECKLIST_HEADING.length);
  return end === -1 ? prompt.slice(start) : prompt.slice(start, end);
}

describe("미검증 안은 추천이 아니라 후보로 부른다", () => {
  it("결론부터 말하는 규칙 자체가 확인된 비교와 미검증 후보를 구분한다", () => {
    const prompt = promptWith(0);
    const decision = prompt.split("\n").find(line => line.startsWith("- **결정**:")) ?? "";
    expect(decision).toContain("확인된 근거 안에서");
    const objectRule = prompt.split("\n").find(line => line.includes("**사물**")) ?? "";
    expect(objectRule).toContain("미검증 후보의 이름은 유지");
    expect(objectRule).not.toContain("그대로 결론부터");
  });

  it("미검증 후보는 첫 이름과 근거를 일치시키고 검증된 비교·준비 순서 추천은 허용한다", () => {
    const prompt = promptWith(0);
    expect(prompt).toContain("견적·인원·날짜를 확인한 비교와 일반 준비 순서 추천은 가능");
    expect(prompt).toContain("첫 제목부터 끝까지 같은 이름");
    expect(prompt).toContain("검토 1순위는 1안이에요");
  });

  it("규칙이 결정 역할 바로 다음에 있다", () => {
    const prompt = promptWith(0);
    const section = prompt.split("\n").find(line => line.includes("**미검증은 이름부터**")) ?? "";
    expect(prompt.indexOf(section)).toBeGreaterThan(prompt.indexOf("- **결정**:"));
    expect(prompt.indexOf(section)).toBeLessThan(prompt.indexOf("단 **두 사람의 의견이 갈린 자리**"));
    expect(section).toContain("미검증은 이름부터");
    expect(section, "무엇을 미검증으로 볼지가 없다")
      .toContain("예산·수용 인원·일정 적합성");
    expect(section, "부르지 말라고만 하고 대신 무엇이라 부를지 없다")
      .toContain('검토 후보의 우선순위인 "검토 1순위"');
    expect(section, "이름이 언제 바뀌는지 말하지 않으면 사용자는 다음 행동을 모른다")
      .toContain("무엇을 확인해야 그 이름이 바뀌는지");
    expect(section, "1순위를 요구받아도 미검증 후보의 이름을 낮춰야 한다")
      .toContain("미검증이면 1순위를 요청해도");
    expect(section, "후보를 확정 추천한 뒤 단서만 붙이는 것은 같은 실패다")
      .toContain("뒤에 단서를 붙여");
  });

  it("결정이 쌓여 절단이 일어나는 턴에서도 남는다", () => {
    const prompt = promptWith(12);
    expect(prompt, "이 표본은 절단 구간에 닿지 않는다 — 아래 단언이 헛돈다")
      .toContain("길이 제한으로 생략됨");
    expect(prompt, "문맥이 무거운 커플에게서 이 규칙이 조용히 빠진다")
      .toContain("미검증은 이름부터");
  });

  it.each(["profiles", "history"] as const)("%s가 상한에 닿아도 같은 추천 계약 전체가 한 번만 남는다", stress => {
    const ordinary = promptWith(0);
    const expectedRule = ordinary.split("\n").find(line => line.includes("**미검증은 이름부터**"))?.trim();
    expect(expectedRule).toBeTruthy();
    const prompt = promptWith(0, stress);
    expect(prompt, "실제 절단이 없는 표본으로 도달을 주장하지 않는다").toContain("길이 제한으로 생략됨");
    expect(prompt.length).toBeLessThanOrEqual(AMORA_SYSTEM_PROMPT_MAX_CHARS);
    const rules = prompt.split("\n").filter(line => line.includes("**미검증은 이름부터**")).map(line => line.trim());
    expect(rules).toEqual([expectedRule]);
    expect(prompt).toContain("확인된 공동 합의는 유지");
    expect(prompt).toContain("미정은 미전달의 증거가 아닙니다");
  });

  it("같은 목록의 기존 기준을 밀어내지 않았다", () => {
    const section = checklistSection(promptWith(12));
    for (const rule of [
      "확인된 조건부터",
      "질문은 한 가지",
      "선택지는 필요한 만큼",
      "충돌은 솔직하게",
      "내부 계산을 과시하지 않기",
    ]) {
      expect(section, `"${rule}" 가 사라졌다`).toContain(rule);
    }
  });
});
