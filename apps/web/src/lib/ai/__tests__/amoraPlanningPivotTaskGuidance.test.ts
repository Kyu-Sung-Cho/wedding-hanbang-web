import { describe, expect, it } from "vitest";

import { AMORA_SYSTEM_PROMPT_MAX_CHARS, buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { AMORA_CARE_VOICE } from "@/lib/ai/amoraVoice";
import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";
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
// 1d23 후보의 실제 3턴 입력. 모델 답변을 흉내내는 검사가 아니다.
// 실제 scope/specialist/도구 선택을 통과한 최종 지침의 전달·모순·범위를 검증한다.
const ACTUAL_TURNS = [
  "서울이나 경기에서 180명 정도 일반 웨딩을 생각 중이야. 내년 가을이고 정확한 날짜와 총예산은 미정이야. 신혼집이 최우선이고 사진은 중요해. 예단과 폐백은 두 사람이 생략하기로 했어.",
  "생각이 바뀌었어. 180명 일반웨딩 말고 그냥 40명만 부르는 가족식으로 할래.",
  "비용도 부담되고 준비 과정도 너무 복잡하게 느껴져서 그래. 큰 결혼식이 우리 취향도 아닌 것 같아. 날짜 후보는 9월보다 10월이 더 좋아. 이건 그냥 선호가 바뀐 거야.",
];
const PIVOT_RULE = "- 예식 형태·지역 전환, 하객 규모 절반 이하·2배 이상이면 이유는 한 번만 묻되 이미 말했으면 건너뛰고, 유지할 것과 다시 정할 것을 한 답변에 둘 다 짚으세요. 작은 월 선호는 되묻지 마세요.";

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

function section(prompt: string, start: string, end: string): string {
  const from = prompt.indexOf(start);
  const to = prompt.indexOf(end, from + start.length);
  expect(from, start).toBeGreaterThan(-1);
  expect(to, end).toBeGreaterThan(from);
  return prompt.slice(from, to);
}

function expectPivotGuidance(prompt: string): void {
  const roles = section(prompt, "### 먼저 이번 턴의 역할 하나를 고르기", "### 순서를 말할 때는");
  expect(roles).toContain("이유가 비어 있는 큰 실무 방향 전환");
  expect(roles).toContain("새 취향을 고르게 하기 전에 왜 바뀌었는지 한 번 먼저");
  expect(roles).toContain("질문과 함께 완성된 계획까지 한꺼번에 주지 마세요");
  const continuity = section(prompt, "### 듣는 방식", "### 자연스러운 말투");
  expect(continuity).toContain("예식 형태·지역 변경이나 하객 규모 절반 이하·2배 이상");
  expect(continuity).toContain("기존 선호·생략·시기 기준은 유지");
  expect(continuity).toContain("인원·장소에 따른 식사 구성·최소 인원·견적");
  expect(continuity).toContain("한 답변에서 간결히 구분");
  expect(continuity).toContain("다음 행동 한 가지는 우선순위");
  expect(continuity).toContain("그것만 하면 되거나 다른 준비가 필요 없다는 뜻이 아닙니다");
  expect(prompt.split(PIVOT_RULE)).toHaveLength(2);
  expect(PIVOT_RULE.length).toBe(110);
  expect(prompt).not.toContain("이전 답과 달라졌다면 변화 이유를 캐묻기보다 현재 선택을 우선");
  expect(prompt).toContain("월·규모만 바뀌었다고 확인한 연도를 미정으로 되돌리지 마세요");
  expect(prompt).toContain("저장 요청이 없는 턴에 저장 약속·실패 안내를 만들지 마세요");
  expect(prompt).toContain("[서버 확정 요청 계약]");
  expect(prompt.indexOf("[준비 방향 변경]")).toBeLessThan(prompt.indexOf("[추천 근거 확인]"));
  expect(prompt.indexOf("[추천 근거 확인]")).toBeLessThan(prompt.indexOf("[서버 확정 질문 범위 계약]"));
  expect(prompt.length).toBeLessThanOrEqual(AMORA_SYSTEM_PROMPT_MAX_CHARS);
}

describe("큰 실무 전환과 작은 선호의 질문 목적을 원래 규칙에서 구분한다", () => {
  it("역할을 고르는 입구에서 이유 미상 큰 전환과 경청·안전·질문 거부의 우선순위를 정한다", () => {
    const entry = section(AMORA_CARE_VOICE, "### 먼저 이번 턴의 역할 하나를 고르기", "- **곁에 있기**");
    expect(entry).toContain("큰 실무 방향 전환의 이유가 비어 있다면 탐색을 먼저");
    expect(entry).toContain("경청·안전·질문 거부 예외를 우선");
  });

  it("명확한 새 선택이나 추천 요청을 이유 확인이 끝난 증거로 혼동하지 않는다", () => {
    const preference = section(getWeddingPlannerSystemPrompt(BASE), "**선호가 아직 흐릴 때:**", "**인스타 vs 현실");
    expect(preference).toContain("불필요한 취향 인터뷰를 늘이지 말고");
    expect(preference).toContain("이유가 비어 있는 큰 전환에서는 위 이유 확인·예외 기준을 먼저");
    expect(preference).not.toContain('이미 명확히 답했거나 "그냥 추천해줘"');
  });

  it("기본 프롬프트의 일반 선호 지침이 큰 전환 이유 확인을 취소하지 않는다", () => {
    const preference = section(getWeddingPlannerSystemPrompt(BASE), "**선호가 아직 흐릴 때:**", "**인스타 vs 현실");
    expect(preference).toContain("작은 월·분위기 선호 변경");
    expect(preference).toContain("큰 실무 방향 전환의 이유가 비어 있으면 새 취향 질문보다");
    expect(preference).toContain("그 이유를 한 번 먼저 확인");
    expect(preference).not.toContain("이전 답과 달라졌다면 변화 이유를 캐묻기보다");
  });

  const actualCases = ACTUAL_TURNS.flatMap((userText, index) => [false, true].flatMap(saturated =>
    [false, true].map(noTools => ({ name: `T${index + 1}/${saturated ? "포화" : "빈 문맥"}/${noTools ? "무도구" : "선택 도구"}`, userText, saturated, noTools })),
  ));
  it.each(actualCases)("$name의 최종 조합에서도 같은 질문 목적과 재검토 범위가 남는다", ({ userText, saturated, noTools }) => {
    const options = selectedOptions(userText);
    expect(options.questionScope?.scope).toBe("W0_wedding_core");
    const context = saturated ? {
      ...BASE, chatSummaries: Array.from({ length: 30 }, () => "합성 과거 준비 기록. ".repeat(100)),
    } : BASE;
    const prompt = buildAmoraSystemPrompt(context, noTools ? { ...options, enabledToolNames: [] } : options);
    expectPivotGuidance(prompt);
    if (saturated) expect(prompt).toContain("길이 제한으로 생략됨");
    if (noTools) {
      expect(prompt).not.toContain("## 현재 실행 가능한 도구 계약");
      expect(prompt).not.toContain("사용할 수 있는 도구:");
      expect(prompt).not.toContain("최신 사용자가 본인 커플의 결혼 날짜·예산·일정·예약을 정하거나 바꾸는 확정형 발화를 실행 요청으로 다루세요");
    } else {
      expect(prompt).toContain("데이터 변경은 실행할 값과 범위를 보여주고 사용자가 명시적으로 적용을 확인한 뒤");
    }
  });

  it.each([
    ["알려준 이유", "이유를 이미 말했으면 다시 묻지"],
    ["작은 월 변경", "작은 월·취향 변경은 이유를 캐묻지"],
    ["이유 공개 거부", "이유를 말하기 싫다고 하면 이유 질문을 건너뛰"],
    ["경청 요청", "그냥 들어달라거나 연기·취소 또는 위기 안전 상황이면 이유 확인보다 경청·안전"],
  ])("%s의 예외는 같은 맥락 규칙에서 함께 전달된다", (_label, expected) => {
    const continuity = section(AMORA_CARE_VOICE, "### 듣는 방식", "### 자연스러운 말투");
    expect(continuity).toContain(expected);
  });

  it("조회 도구의 다음 한 가지 안내도 전체 준비 완료처럼 말하지 않는다", () => {
    const prompt = buildAmoraSystemPrompt(BASE, { ...selectedOptions("결혼 준비 뭐부터 해야 할지 모르겠어"), enabledToolNames: ["get_wedding_info", "get_budget_summary"] });
    const line = prompt.split("\n").find(value => value.includes("판단·이유·다음 한 가지를 함께"));
    expect(line).toContain("다른 준비가 필요 없다는 뜻으로 말하지 마세요");
  });

  it.each(["paused", "called_off"] as const)("준비 상태 %s의 캐묻기·재촉 금지는 유지한다", preparationStatus => {
    const prompt = buildAmoraSystemPrompt({ ...BASE, preparationStatus }, selectedOptions(ACTUAL_TURNS[1]));
    expect(prompt).toContain("이유를 캐묻지 말고, 사용자가 말한 범위 안에서만 도우세요");
    expect(prompt).toContain("다음 할 일을 재촉하지 마세요");
    expect(prompt).toContain("그냥 들어달라거나 연기·취소 또는 위기 안전 상황이면 이유 확인보다 경청·안전");
  });

  it.each([
    { text: "남편이 어제 저를 밀쳤어요", scope: "W2_high_risk_adjacent" },
    { text: "죽고 싶어. 지금 나를 해치려고 해.", scope: "W5_safety_override" },
  ])("$scope는 일반 방향 변경 질문을 보호 지침으로 추가하지 않는다", ({ text, scope }) => {
    const options = selectedOptions(text);
    expect(options.questionScope?.scope).toBe(scope);
    const prompt = buildAmoraSystemPrompt(BASE, options);
    expect(prompt).not.toContain("[준비 방향 변경]");
    expect(prompt).not.toContain("## 커플 갈등 중재");
    expect(prompt).toContain("그냥 들어달라거나 연기·취소 또는 위기 안전 상황이면 이유 확인보다 경청·안전");
  });

  it("구조화 중재의 요청자 요약·승인 경계를 유지한다", () => {
    const prompt = buildAmoraSystemPrompt(BASE, {
      requestKind: "mediation", persistenceMode: "durable", enabledToolNames: [], maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
      questionScope: { scope: "W1_wedding_adjacent", allowsLongTermMemory: false, confidence: "high", needsClarification: false },
    });
    expect(prompt).toContain("requester_summary_only");
    expect(prompt).toContain("상대방의 관점은 아직 확인되지 않았습니다");
    expect(prompt).not.toContain("[준비 방향 변경]");
  });
});
