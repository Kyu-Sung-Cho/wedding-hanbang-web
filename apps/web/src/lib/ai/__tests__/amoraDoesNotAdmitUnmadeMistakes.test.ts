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
 * 2. **갈래 셋.** 확인된 잘못은 인정, 대화·저장값과 다르면 인정하지 않기, 그리고 **아무것도
 *    없어서 확인할 수 없으면 모른다고 말하기.** 셋째가 없으면 모델은 앞의 둘 중 하나를
 *    고르고, 라이브에서 고른 쪽이 "인정" 이었다.
 * 3. **길이는 합이 아니라 자리.** 처음 판본은 규칙 줄 +27자를 19줄 뒤 예시 줄 -27자로 갚아
 *    "합이 0" 이었지만, 그 사이 19줄은 그대로 27자 뒤로 밀렸다(`### 도구 실행 뒤 말하는 법`
 *    4,417 → 4,444). 절단은 꼬리부터 통째로 자르니 밀린 줄이 절단선을 넘으면 사라진다.
 *    그래서 **합이 아니라 자리**를 잡는다 — 규칙 줄 자체의 길이, 규칙 줄 뒤 섹션의 자리,
 *    상수 전체 길이 셋 다 d643b5f4 보다 커지면 실패한다.
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

// 규칙의 세 갈래. 하나씩 따로 묻는다 — 셋이 한 문자열이면 어느 갈래가 빠졌는지 못 본다.
const RULE_CONFIRMED = "대화·저장값에 있으면 변명 없이 인정";
const RULE_CONTRADICTED = "다르면 인정 말고";
const RULE_CANNOT_VERIFY = "없으면 모른다 하세요";
const OLD_RULE = "실수/오류 지적: 짧게 인정하고 변명하지 마세요";
// 94b58409 의 두 갈래 판본. 확인 불가 갈래가 없어서 모델이 인정·부인 중 하나를 골라야 했다.
const BINARY_RULE = "없던 잘못을 인정하지 말고 원하는 방향을 물으세요";
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

  it.each(CASES)("$label: 확인·반증·확인 불가 세 갈래가 다 실리고 옛 문장은 없다", ({ prompt }) => {
    const composed = prompt();
    expect(composed).toContain(RULE_CONFIRMED);
    expect(composed).toContain(RULE_CONTRADICTED);
    expect(composed).toContain(RULE_CANNOT_VERIFY);
    expect(composed).not.toContain(OLD_RULE);
    expect(composed).not.toContain(BINARY_RULE);
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

describe("고친 문장은 어떤 줄도 뒤로 밀지 않는다", () => {
  // d643b5f4 의 `AMORA_CARE_VOICE` 실측값(`${AMORA_STATUS_SUMMARY_EVIDENCE_RULE}` 가 펼쳐진
  // 런타임 문자열이다 — 원문 길이를 쓰면 182자 어긋난다). 합이 아니라 **자리**라서 따로 잡는다.
  //   규칙 줄 57자 · 예시 줄 85자 · 상수 전체 5,220자
  //   규칙 줄 뒤 자리: `### 도구 실행 뒤 말하는 법` 4,417 / `### 대화의 결 예시` 4,764
  // 94b58409 은 그 둘을 4,444 / 4,791 로 밀면서도 상수 전체가 5,220 이라 "합이 0" 으로는
  // 초록불이었다.
  const D643_RULE_LINE_MAX = 57;
  const D643_EXAMPLE_LINE_MAX = 85;
  const D643_CARE_VOICE_MAX = 5_220;
  const D643_SECTION_OFFSETS: ReadonlyArray<readonly [string, number]> = [
    ["### 도구 실행 뒤 말하는 법", 4_417],
    ["### 대화의 결 예시", 4_764],
    ['- 사용자: "일정에 왜 반영 안 됐어?"', 5_110],
  ];
  const REFLECTION_LINE_MAX = 133;

  it("고친 두 줄 자체가 각각 고치기 전보다 길지 않다", () => {
    const lines = AMORA_CARE_VOICE.split("\n");
    const rule = lines.filter((line) => line.startsWith("- 실수/오류 지적:"));
    const example = lines.filter((line) => line.includes(EXAMPLE_ADMISSION));
    expect(rule).toHaveLength(1);
    expect(example).toHaveLength(1);
    // 줄마다 따로 잡는다. 뒤의 줄을 줄여 앞의 줄을 늘리는 맞바꾸기는 그 사이 줄을 밀어낸다.
    expect(rule[0].length).toBeLessThanOrEqual(D643_RULE_LINE_MAX);
    expect(example[0].length).toBeLessThanOrEqual(D643_EXAMPLE_LINE_MAX);
  });

  it("규칙 줄 뒤의 섹션과 예시가 d643b5f4 보다 뒤로 가지 않는다", () => {
    // 자리는 앞 모든 줄의 길이 합이다 — 규칙 줄이든 그 사이 아무 줄이든 한 글자만 늘어도
    // 이 단언이 깨진다. 합만 재던 옛 가드가 못 본 것이 바로 이 밀림이다.
    for (const [anchor, maxOffset] of D643_SECTION_OFFSETS) {
      const offset = AMORA_CARE_VOICE.indexOf(anchor);
      expect(offset, `${anchor} 를 못 찾았다`).toBeGreaterThan(-1);
      expect(offset, `${anchor} 가 ${offset} 로 밀렸다`).toBeLessThanOrEqual(maxOffset);
    }
  });

  it("상수 전체 길이도 d643b5f4 보다 길지 않다", () => {
    expect(AMORA_CARE_VOICE.length).toBeLessThanOrEqual(D643_CARE_VOICE_MAX);
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
