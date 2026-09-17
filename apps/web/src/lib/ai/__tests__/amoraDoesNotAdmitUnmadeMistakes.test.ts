/**
 * 아모라가 **하지 않은 잘못을 인정했다.**
 *
 * 2026-09-17 운영 재검사: 직전 답이 "먼저 이유를 확인하고 싶어요" 라고 물었는데,
 * 사용자가 "왜 바뀌었는지 먼저 물어보지도 않고 바로 전제로 삼으면 안 되는 거 아니야?"
 * 라고 따지자 "맞아요. 제가 이유를 묻기 전에 제주 가족식으로 전제했어요." 라고 답했다
 * (이 질문에서 2번 중 2번). 직전 답은 W4 신뢰 이력으로 모델에 갔으니 이력 문제가 아니다.
 * 프롬프트 문장 셋이 확인 없이 인정하라고 시켰다 — `amoraVoice.ts` 의 `실수/오류 지적`
 * 줄, 자기 탓으로 시작하던 `### 대화의 결 예시`, `prompts.ts` `## 자기 성찰` 의 한 구절.
 *
 * ## 이 파일이 지키는 것
 *
 * 1. 원본이 아니라 **합성된 프롬프트**에 묻는다. 라이브에서 돈 두 갈래(W4 신뢰 이력·W4
 *    연결 문맥, 도구 0개)와 같은 뜻의 W0 문장(운영 도구, 체험 포함)을 운영과 같은 순서로
 *    만든다(`amoraPromptComposedContract.test.ts` 의 경로를 옮겼다).
 * 2. **길이.** 이 상수는 프롬프트 앞쪽이라 늘린 만큼 꼬리가 잘린다. 긴 예산 대화는 이미
 *    48,000자에 붙어 있고, 32자 늘린 초안이 113개 조합 중 20개에서 "확인 전에는 저장 도구를
 *    실행하지 않습니다" 같은 줄을 밀어냈다. 그래서 고친 줄의 길이 합이 d643b5f4 보다 길어지면
 *    실패한다.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AMORA_SYSTEM_PROMPT_MAX_CHARS,
  buildAmoraSystemPrompt,
} from "@/lib/ai/amoraPromptComposer";
import { AMORA_CARE_VOICE } from "@/lib/ai/amoraVoice";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { isMutatingTool } from "@/lib/ai/mutationTools";
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

const PENDING_ACTION_TOOLS = BETA_SAFE_TOOLS.filter((tool) => isMutatingTool(tool.name));

function composeLikeProduction(
  userText: string,
  options: {
    // 도구 0개 갈래를 강제로 볼 때만 — 라이브 W4 턴은 도구가 0개였다.
    enabledToolNames?: readonly string[];
    linkedContextMode?: "linked_context_only";
    persistenceMode?: "durable" | "demo";
  } = {},
): string {
  const questionScope = classifyAmoraQuestionScope({ userText });
  const candidateTools = getAvailableChatTools({
    requestKind: "chat",
    isDurableUserMessageBound: true,
    tools: BETA_SAFE_TOOLS,
  });
  const readTools = filterAmoraToolsByQuestionScope(
    selectAmoraTools({
      availableTools: candidateTools,
      userText,
      specialistType: "general",
      checklistLabels: [],
      attachmentKind: "none",
    } as never).filter((tool) => !isMutatingTool(tool.name)),
    questionScope,
  );
  const proposableTools = filterAmoraToolsByQuestionScope(
    selectAmoraPendingProposalTools({
      availableTools: PENDING_ACTION_TOOLS,
      userText,
      specialistType: "general",
      checklistLabels: [],
      attachmentKind: "none",
    } as never).filter((tool) => getAmoraActionApprovalPolicy(tool.name) !== "blocked"),
    questionScope,
  );

  const context = {
    startingPointAsked: false,
    weddingDate: "2027-05-15",
    budget: 62_000_000,
    venue: "그랜드힐컨벤션",
    progress: {},
    preparationStatus: "preparing",
    brideName: "지은",
    groomName: "민수",
    neutralMemberPresentation: false,
    senderName: "지은",
    bookings: [],
    scheduleEvents: [],
    chatSummaries: [],
    preferences: undefined,
    helpPreference: null,
    amoraProfiles: { shared: null, private: null },
    pastDecisions: [],
    pastConflicts: [],
  };

  return buildAmoraSystemPrompt(context as never, {
    specialist: "general",
    requestKind: "chat",
    persistenceMode: options.persistenceMode ?? "durable",
    enabledToolNames: options.enabledToolNames ?? readTools.map((tool) => tool.name),
    actionContract: proposableTools.length > 0
      ? { kind: "proposal", text: buildAmoraPendingActionPrompt(proposableTools) }
      : undefined,
    questionScope,
    linkedContextMode: options.linkedContextMode,
    maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
  } as never);
}

// 라이브 문장 그대로. 직전 사용자 말("그냥 제주에서 가족 20명만")과 함께 W4-low 다.
const LIVE_COMPLAINT = "왜 바뀌었는지 먼저 물어보지도 않고 바로 전제로 삼으면 안 되는 거 아니야?";
// 같은 뜻을 W0 로 만든 문장. 체험 평가(`amora:eval`)는 이 갈래만 잴 수 있다.
const W0_COMPLAINT = "결혼식을 왜 바꿨는지 먼저 물어보지도 않고 바로 전제로 삼으면 안 되는 거 아니야?";

const NEW_RULE = "대화·저장값으로 확인된 잘못만";
const NEW_RULE_NO_UNMADE = "없던 잘못을 인정하지 말고";
const OLD_RULE = "실수/오류 지적: 짧게 인정하고 변명하지 마세요";
const OLD_EXAMPLE = "제가 저장 여부부터 확인했어야";
const EXAMPLE_FACT = "일정엔 아직 없어요";
const EXAMPLE_ADMISSION = "저장 결과를 봤어야";
const NEW_REFLECTION = "실제로 잘못 이해한 점만 짧게 인정하고 바로 고치세요.";
const OLD_REFLECTION = "무엇을 잘못 이해했는지 짧게 인정하고";

const CASES: Array<{ label: string; prompt: () => string }> = [
  {
    label: "라이브 W4 신뢰 이력 · 도구 0개",
    prompt: () => composeLikeProduction(LIVE_COMPLAINT, { enabledToolNames: [] }),
  },
  {
    label: "라이브 W4 연결 문맥 · 도구 0개",
    prompt: () => composeLikeProduction(LIVE_COMPLAINT, {
      enabledToolNames: [],
      linkedContextMode: "linked_context_only",
    }),
  },
  {
    label: "W0 문장 · 운영 도구",
    prompt: () => composeLikeProduction(W0_COMPLAINT),
  },
  {
    label: "W0 문장 · 체험",
    prompt: () => composeLikeProduction(W0_COMPLAINT, { persistenceMode: "demo" }),
  },
];

describe("사용자가 따져도 하지 않은 잘못을 인정하라고 시키지 않는다", () => {
  it("표본의 전제: 라이브 항의는 W4-low, 같은 뜻의 W0 문장은 W0 다", () => {
    // 이 단언이 깨지면 위 갈래 이름이 틀린 것이다 — 어느 갈래를 재는지 다시 볼 것.
    expect(classifyAmoraQuestionScope({ userText: LIVE_COMPLAINT })).toMatchObject({
      scope: "W4_out_of_scope",
      confidence: "low",
      needsClarification: true,
    });
    expect(classifyAmoraQuestionScope({ userText: W0_COMPLAINT }).scope).toBe("W0_wedding_core");
  });

  it.each(CASES)("$label: 확인된 잘못만 인정하라는 규칙이 실리고 옛 문장은 없다", ({ prompt }) => {
    const composed = prompt();
    expect(composed).toContain(NEW_RULE);
    expect(composed).toContain(NEW_RULE_NO_UNMADE);
    expect(composed).not.toContain(OLD_RULE);
    expect(composed).not.toContain(OLD_EXAMPLE);
    expect(composed).toContain(NEW_REFLECTION);
    expect(composed).not.toContain(OLD_REFLECTION);
  });

  it.each(CASES)("$label: 예시는 확인한 사실을 먼저 말하고 그다음 진짜 잘못을 인정한다", ({ prompt }) => {
    const composed = prompt();
    const fact = composed.indexOf(EXAMPLE_FACT);
    const admission = composed.indexOf(EXAMPLE_ADMISSION);
    expect(fact).toBeGreaterThan(-1);
    expect(admission).toBeGreaterThan(-1);
    expect(fact).toBeLessThan(admission);
  });
});

describe("고친 문장은 프롬프트를 늘리지 않는다", () => {
  // d643b5f4 의 길이. 규칙 줄 57 + 예시 줄 85, `자기 성찰` 의 불만족 줄 133.
  const VOICE_LINES_MAX = 142;
  const REFLECTION_LINE_MAX = 133;

  it("규칙 줄과 예시 줄의 길이 합이 고치기 전보다 길지 않다", () => {
    const lines = AMORA_CARE_VOICE.split("\n");
    const rule = lines.filter((line) => line.startsWith("- 실수/오류 지적:"));
    const example = lines.filter((line) => line.includes(EXAMPLE_ADMISSION));
    expect(rule).toHaveLength(1);
    expect(example).toHaveLength(1);
    expect(rule[0].length + example[0].length).toBeLessThanOrEqual(VOICE_LINES_MAX);
  });

  it("prompts.ts 의 자기 성찰 문장은 조건부로 바뀌었고 줄 길이가 그대로다", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/ai/prompts.ts"), "utf8");
    expect(source).toContain(NEW_REFLECTION);
    expect(source).not.toContain(OLD_REFLECTION);
    const reflection = source.split("\n").filter((line) => line.startsWith("- 불만족 감지 시"));
    expect(reflection).toHaveLength(1);
    expect(reflection[0]).toContain(NEW_REFLECTION);
    expect(reflection[0].length).toBeLessThanOrEqual(REFLECTION_LINE_MAX);
  });
});
