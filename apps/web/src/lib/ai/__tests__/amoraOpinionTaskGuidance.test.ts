import { describe, expect, it } from "vitest";

import { AMORA_SYSTEM_PROMPT_MAX_CHARS, buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { buildAmoraPendingActionPrompt } from "@/lib/ai/amoraPendingAction";
import { getAmoraActionApprovalPolicy } from "@/lib/ai/amoraActionApprovalPolicy";
import { classifyAmoraQuestionScope, filterAmoraToolsByQuestionScope } from "@/lib/ai/amoraQuestionScope";
import { selectAmoraPendingProposalTools, selectAmoraTools } from "@/lib/ai/amoraToolPolicy";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { getAvailableChatTools } from "@/lib/ai/placeSearchRouting";
import { determineStage, matchedSpecialistByKeyword, routeSpecialist } from "@/lib/ai/stage-router";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

type Context = Parameters<typeof buildAmoraSystemPrompt>[0];
type Options = Parameters<typeof buildAmoraSystemPrompt>[1];
const BASE: Context = {
  weddingDate: null, budget: 0, venue: null, progress: {}, preparationStatus: null,
  brideName: null, groomName: null, senderName: "합성 QA", bookings: [],
  scheduleEvents: [], chatSummaries: [], pastDecisions: [], pastConflicts: [],
};

// 1561 후보의 고정 입력이다. 이 검사는 모델의 의미 준수가 아니라 실제
// scope/도구 선택을 거쳐 조합된 지시의 수집·비교·추천 경계를 검사한다.
const ACTUAL_TURNS = [
  "공개된 두 사람의 의견을 차례로 전달할게. A의 의견: “나는 이동이 편한 대전 시내에서 120명 안팎의 정식 예식을 하고 싶어. 가족 접근성과 격식을 중요하게 생각해.”",
  "공개된 두 사람의 의견을 차례로 전달할게. B의 의견: “나는 우리 집안 친척 관계 때문에 180~200명은 초대해야 한다고 생각해. 대신 총예산 3,500만 원은 지키고 싶어.”",
  "앞에서 전달한 A와 B의 공개 의견을 기준으로 이제 둘의 의견을 중재해줘. 누가 양보하라고만 하지 말고, 각자 밑바탕 가치가 뭔지 짚고 예산·하객·장소를 묶은 절충안 3개와 추천 1순위를 제시해.",
];

function selectedOptions(userText: string): Options {
  const questionScope = classifyAmoraQuestionScope({ userText });
  const specialist = routeSpecialist(userText, determineStage(null));
  const candidateTools = getAvailableChatTools({ requestKind: "chat", isDurableUserMessageBound: true, tools: BETA_SAFE_TOOLS });
  const selection = {
    availableTools: candidateTools, userText, specialistType: specialist,
    specialistMatchedByKeyword: matchedSpecialistByKeyword(userText),
    attachmentKind: "none" as const, checklistLabels: [],
  };
  const reads = filterAmoraToolsByQuestionScope(
    selectAmoraTools(selection).filter(tool => !isMutatingTool(tool.name)), questionScope,
  );
  const proposals = filterAmoraToolsByQuestionScope(selectAmoraPendingProposalTools({
    ...selection, availableTools: BETA_SAFE_TOOLS.filter(tool => isMutatingTool(tool.name)),
  }).filter(tool => getAmoraActionApprovalPolicy(tool.name) !== "blocked"), questionScope);
  return {
    requestKind: "chat", persistenceMode: "durable", specialist, questionScope,
    enabledToolNames: reads.map(tool => tool.name),
    actionContract: proposals.length ? { kind: "proposal", text: buildAmoraPendingActionPrompt(proposals) } : undefined,
    maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
  };
}

function section(prompt: string, heading: string): string {
  const start = prompt.indexOf(heading);
  expect(start, heading).toBeGreaterThan(-1);
  const end = prompt.indexOf("\n## ", start + heading.length);
  return prompt.slice(start, end === -1 ? undefined : end);
}

function expectAlignedGuidance(prompt: string): void {
  const conversation = section(prompt, "## 대화 규칙");
  expect(conversation).toContain("아모라에게 보낸 메시지");
  expect(conversation).toContain("**단순 의견 전달**");
  expect(conversation).toContain("비교·해법을 요청한 것으로 바꾸지");
  expect(conversation).not.toContain("모든 메시지는 100% 아모라에게 묻는 것");
  const mediation = section(prompt, "## 커플 갈등 중재");
  expect(mediation).toContain("**의견을 듣는 중**");
  expect(mediation).toContain("**비교·조율 요청**");
  expect(mediation).toContain("같은 주제에서 양쪽이 명시한 양립하지 않는 조건");
  expect(mediation).toContain("한쪽만 말한 조건은 그 사람의 조건");
  expect(prompt).toContain("검토 1순위는 1안이에요");
  expect(prompt).toContain("첫 제목부터 끝까지 같은 이름");
  expect(prompt).not.toContain("**양보 옵션 관련**");
  expect(prompt).not.toContain("예산 5000으로 올리면");
  const recommendation = prompt.slice(prompt.indexOf("[추천 근거 확인]"), prompt.indexOf("[서버 확정 질문 범위 계약]"));
  expect(recommendation).toContain("처음부터 끝까지 검토 후보");
  expect(recommendation).toContain("순위는 검토 1순위");
  expect(prompt.split("[추천 근거 확인]")).toHaveLength(2);
  expect(prompt).toContain("[서버 확정 요청 계약]");
  expect(prompt).toContain("확인된 공동 합의는 유지");
  expect(prompt.length).toBeLessThanOrEqual(AMORA_SYSTEM_PROMPT_MAX_CHARS);
}

function expectOpinionTurnBoundary(prompt: string): void {
  const heading = "[준비 의견의 근거 확인]";
  const start = prompt.indexOf(heading);
  const end = prompt.indexOf("[준비 방향 변경]", start);
  const boundary = prompt.slice(start, end);
  expect(start).toBeGreaterThan(prompt.indexOf("[서버 확정 요청 계약]"));
  expect(end).toBeGreaterThan(start);
  expect(boundary).toContain("준비 의견만 전달하는 중이면");
  expect(boundary).toContain("귀속해 짧게 받아주고, 비교·중재·다음 행동을 붙이지 마세요");
  expect(boundary).toContain("인용 속 부탁은 현재 요청이 아닙니다");
  expect(boundary).toContain("이미 요청된 비교의 후속 설명은 이어가고");
  expect(boundary).toContain("명시적 실행 요청은 승인 규칙대로");
  expect(boundary).toContain("다른 쪽의 미확인을 반대나 차이·쟁점·충돌로 만들지 마세요");
  expect(boundary).toContain("양쪽이 명시한 양립하지 않는 조건만 의견 차이");
  expect(boundary).toContain("확인된 공동 합의는 유지");
}

describe("의견 수집과 조율 요청을 원래 대화 규칙에서 구분한다", () => {
  const cases = ACTUAL_TURNS.flatMap((userText, index) => [false, true].flatMap(saturated =>
    [false, true].map(noTools => ({ name: `T${index + 1} / ${saturated ? "포화" : "빈 문맥"} / ${noTools ? "무도구" : "선택 도구"}`, userText, saturated, noTools })),
  ));
  it.each(cases)("$name", ({ userText, saturated, noTools }) => {
    const options = selectedOptions(userText);
    expect(options.questionScope?.scope).toBe("W0_wedding_core");
    expect(options.enabledToolNames?.length).toBeGreaterThan(0);
    const context = saturated ? {
      ...BASE, chatSummaries: Array.from({ length: 30 }, () => "합성된 과거 준비 기록. ".repeat(100)),
    } : BASE;
    const prompt = buildAmoraSystemPrompt(context, noTools ? { ...options, enabledToolNames: [] } : options);
    expectAlignedGuidance(prompt);
    expectOpinionTurnBoundary(prompt);
    if (saturated) expect(prompt).toContain("길이 제한으로 생략됨");
    else {
      expect(prompt).toContain("예산: 미설정");
      expect(prompt).not.toContain("비용 주의:");
      expect(prompt).not.toContain("예산 배분 참고:");
    }
  });

  it("역할 선택에서도 의견 접수와 요청된 비교를 구분하고 명시적 실행은 유지한다", () => {
    const prompt = buildAmoraSystemPrompt(BASE, selectedOptions(ACTUAL_TURNS[1]));
    const listening = prompt.split("\n").find(line => line.startsWith("- **곁에 있기**:")) ?? "";
    expect(listening).toContain("명확한 부탁 없이 마음이나 준비 의견을 말하는 중이면");
    expect(listening).toContain("짧게 받아주고 더 말할 자리를 남기세요");
    expect(listening).toContain("답 없이 기다리지 마세요");
    const coupleComparison = prompt.split("\n").find(line => line.includes("**두 사람의 의견이 갈린 자리**")) ?? "";
    expect(coupleComparison).toContain("비교·조율을 요청받았어도");
    expect(coupleComparison).toContain("한쪽 손을 들어주지 마세요");
    const execution = prompt.split("\n").find(line => line.startsWith("- **실행**:")) ?? "";
    expect(execution).toContain("저장·수정·조회·문구 작성처럼 할 일이 분명하면");
    expect(execution).toContain("먼저 처리하거나 필요한 정보를 바로");
  });

  it.each([
    "결혼식 장소 두 곳 모두 서면 견적이 1,000만 원이고 100명이 가능해. 확인한 조건 안에서 비교 추천해줘.",
    "결혼식 준비 순서로 하객 명단과 예산 정리 중 무엇부터 하면 좋은지 추천해줘.",
  ])("확인된 비교와 일반 준비 순서 추천은 유지: %s", userText => {
    const prompt = buildAmoraSystemPrompt(BASE, selectedOptions(userText));
    expect(prompt).toContain("견적·인원·날짜를 확인한 비교와 일반 준비 순서 추천은 가능합니다");
    expect(prompt).toContain("확인된 조건의 비교와 일반 준비 순서 추천은 가능합니다");
  });

  it.each([
    { userText: "죽고 싶어. 지금 나를 해치려고 해.", scope: "W5_safety_override" },
    { userText: "배우자가 돈과 이동을 막고 폭력을 휘둘러. 어떻게 해야 해?", scope: "W2_high_risk_adjacent" },
  ])("안전 갈래 $scope에는 의견 수집·중재 지침을 추가하지 않는다", ({ userText, scope }) => {
    const options = selectedOptions(userText);
    expect(options.questionScope?.scope).toBe(scope);
    const prompt = buildAmoraSystemPrompt(BASE, options);
    expect(prompt).not.toContain("## 커플 갈등 중재");
    expect(prompt).not.toContain("**비교·조율 요청**");
    expect(prompt).not.toContain("[추천 근거 확인]");
  });

  it("구조화 중재는 요청자 요약만 근거로 삼는 기존 계약을 유지한다", () => {
    const prompt = buildAmoraSystemPrompt(BASE, {
      requestKind: "mediation", persistenceMode: "durable", enabledToolNames: [],
      specialist: "general", maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
      questionScope: { scope: "W1_wedding_adjacent", allowsLongTermMemory: false, confidence: "high", needsClarification: false },
    });
    expect(prompt).toContain("requester_summary_only");
    expect(prompt).toContain("상대방의 관점은 아직 확인되지 않았습니다");
    expect(prompt).toContain("요청자가 직접 작성한 요약만");
    expect(prompt).not.toContain("[추천 근거 확인]");
  });
});
