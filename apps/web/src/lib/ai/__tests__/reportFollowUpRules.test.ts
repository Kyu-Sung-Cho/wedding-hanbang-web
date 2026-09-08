/**
 * 팀 아모라 테스트 리포트(2026-08-29)에서 나온 규칙들이 **모델이 받는 프롬프트에**
 * 실린다.
 *
 * 원본(`prompts.ts`)을 보면 안 된다 — `removeLegacyOperationalInstructions` 가
 * 일부 구간을 통째로 지우므로 원본에는 있고 모델이 받는 것에는 없을 수 있다.
 * 운영이 실제로 넘기는 도구 집합을 쓴다 — 쓰기 도구는 `!isMutatingTool` 로
 * 걸러져 `enabledToolNames` 에 오지 않으므로, 손으로 넣으면 운영에서 한 번도
 * 안 나가는 규칙이 초록불을 받는다.
 */
import { describe, expect, it } from "vitest";

import {
  AMORA_SYSTEM_PROMPT_MAX_CHARS,
  buildAmoraSystemPrompt,
} from "@/lib/ai/amoraPromptComposer";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import type { AmoraQuestionScopeClassification } from "@/lib/ai/amoraQuestionScope";
import {
  getWeddingPlannerSystemPrompt,
  type WeddingPlannerPromptContext,
} from "@/lib/ai/prompts";

const PRODUCTION_ENABLED_TOOL_NAMES = BETA_SAFE_TOOLS
  .filter((tool) => !isMutatingTool(tool.name))
  .map((tool) => tool.name);

function promptContext(): WeddingPlannerPromptContext {
  return {
    weddingDate: "2027-05-15",
    budget: 50_000_000,
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
    pastDecisions: [],
  };
}

const compose = (enabledToolNames: string[]) =>
  buildAmoraSystemPrompt(promptContext(), {
    enabledToolNames,
    requestKind: "chat",
    persistenceMode: "durable",
  });

const delivered = compose(PRODUCTION_ENABLED_TOOL_NAMES);
describe("공개 준비 의견의 귀속은 마지막 보호 계약에 전달한다", () => {
  const heading = "[준비 의견의 근거 확인]";
  const rulePrefix = "- 공개된 두 사람의 준비 의견을 비교할 때, ";
  const attributionLine = (prompt: string) =>
    prompt.split("\n").find(line => line.startsWith(rulePrefix)) ?? "";
  const coreScope: AmoraQuestionScopeClassification = {
    scope: "W0_wedding_core", allowsLongTermMemory: true, confidence: "high", needsClarification: false,
  };

  function expectProtectedAttribution(prompt: string): void {
    const line = attributionLine(prompt);
    expect(line).not.toBe("");
    expect(prompt.split(heading)).toHaveLength(2);
    expect(prompt.split(line)).toHaveLength(2);
    expect(prompt.indexOf(heading)).toBeGreaterThan(prompt.indexOf("[서버 확정 요청 계약]"));
    expect(prompt.indexOf(heading)).toBeLessThan(prompt.indexOf("[준비 방향 변경]"));
    expect(prompt.length - prompt.indexOf(line) - line.length).toBeLessThan(1000);
    expect(prompt.length).toBeLessThanOrEqual(AMORA_SYSTEM_PROMPT_MAX_CHARS);
  }

  it("도구 유무와 무관하게 귀속·피벗·추천·범위 계약 순서를 유지한다", () => {
    for (const enabledToolNames of [PRODUCTION_ENABLED_TOOL_NAMES, []]) {
      const prompt = buildAmoraSystemPrompt(promptContext(), {
        enabledToolNames, requestKind: "chat", persistenceMode: "durable",
        questionScope: coreScope, maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
      });
      expectProtectedAttribution(prompt);
      expect(prompt.indexOf("[추천 근거 확인]"))
        .toBeGreaterThan(prompt.indexOf("[준비 방향 변경]"));
      expect(prompt.indexOf("[서버 확정 질문 범위 계약]"))
        .toBeGreaterThan(prompt.indexOf("[추천 근거 확인]"));
    }
  });

  // 모델의 의미 판단을 흉내내지 않는다. 실제 마지막 한 줄에 필요한
  // 양성/음성 대조 기준이 함께 실리는지를 검사한다.
  it.each([
    ["한쪽만 추가한 조건", "한 주제에서 한쪽만 조건을 밝혔다면 그 사람의 조건으로 남기고, 공동 기준이나 의견 충돌로 확대하지 마세요"],
    ["양쪽이 명시한 실제 충돌", "같은 주제에서 양쪽이 밝힌 양립하지 않는 조건이 있을 때만 의견이 갈린다고"],
    ["확인된 공동 합의", "한 사람의 예산 제안을 공동 상한으로 만들지 말고, 확인된 공동 합의는 유지"],
    ["불확실한 귀속과 감정", "감정·의도는 단정하지 말며 귀속이 불확실하면 확인할 점으로 남기세요"],
  ])("%s의 기준을 한 보호 규칙에서 구분한다", (_name, expected) => {
    const line = attributionLine(delivered);
    expect(line).toContain("공개된 두 사람의 준비 의견을 비교할 때");
    expect(line).toContain("직전 맥락까지 확인해 말·이유·조건을 말한 사람에게만 귀속");
    expect(line).toContain(expected);
  });

  it("옛 기본 중재 문구를 남겨 같은 귀속 계약을 중복하지 않는다", () => {
    const oldPrefix = "- 두 사람의 말·이유·조건은 말한 사람별로 유지";
    expect(getWeddingPlannerSystemPrompt(promptContext())).not.toContain(oldPrefix);
    expect(delivered).not.toContain(oldPrefix);
    expectProtectedAttribution(delivered);
  });

  it("일반 상담·구조화 중재의 기존 요청 및 근거 범위는 그대로 남는다", () => {
    for (const requestKind of ["chat", "initial_greeting", "mediation"] as const) {
      const prompt = buildAmoraSystemPrompt(promptContext(), {
        enabledToolNames: [], requestKind, persistenceMode: "durable",
        questionScope: { ...coreScope, scope: "W1_wedding_adjacent" },
        maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
      });
      expect(attributionLine(prompt)).not.toBe("");
      expect(prompt.split(heading)).toHaveLength(2);
      expect(prompt).toContain(`request_kind: ${requestKind}`);
      if (requestKind === "mediation") {
        expect(prompt).toContain("requester_summary_only");
        expect(prompt).toContain("상대방의 관점은 아직 확인되지 않았습니다");
      }
    }
  });

  const safetyScopes: AmoraQuestionScopeClassification[] = [
    { scope: "W2_high_risk_adjacent", highRiskReason: "safety", allowsLongTermMemory: false, confidence: "high", needsClarification: false },
    { scope: "W5_safety_override", allowsLongTermMemory: false, confidence: "high", needsClarification: false },
  ];
  it.each(safetyScopes)("$scope 안전 신고에는 준비 의견 비교 계약을 싣지 않는다", questionScope => {
    for (const requestKind of ["chat", "mediation"] as const) {
      for (const maxChars of [AMORA_SYSTEM_PROMPT_MAX_CHARS, undefined]) {
        const prompt = buildAmoraSystemPrompt(promptContext(), {
          enabledToolNames: [], requestKind, persistenceMode: "durable", questionScope, maxChars,
        });
        expect(prompt).not.toContain(heading);
        expect(prompt).not.toContain(rulePrefix);
        expect(prompt).toContain(questionScope.scope);
      }
    }
  });

  const dense = "가".repeat(2000);
  const denseProfile = {
    personaSummary: dense, budgetPosture: dense, decisionStyle: dense,
    tasteProfile: dense, communicationStyle: dense, conflictPattern: dense,
    sensitiveTopics: [dense], recommendationRules: [dense], openQuestions: [dense], confidenceScore: 0.9,
  };
  const contexts: Array<{ name: string; context: WeddingPlannerPromptContext }> = [
    { name: "포화된 프로필", context: { ...promptContext(), amoraProfiles: { shared: denseProfile, private: denseProfile } } },
    { name: "긴 대화 요약", context: { ...promptContext(), chatSummaries: Array.from({ length: 30 }, (_, index) => `합성 요약 ${index}. 준비 조건을 확인함. `.repeat(30)) } },
  ];
  it.each(contexts)("$name이 절단되어도 귀속·안전·실행 경계를 한 번 보존한다", ({ context }) => {
    for (const enabledToolNames of [PRODUCTION_ENABLED_TOOL_NAMES, []]) {
      const prompt = buildAmoraSystemPrompt(context, {
        enabledToolNames, requestKind: "chat", persistenceMode: "durable",
        questionScope: coreScope, maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
      });
      expect(prompt).toContain("길이 제한으로 생략됨");
      expectProtectedAttribution(prompt);
      expect(prompt).toContain("## 할루시네이션 방지");
      expect(prompt).toContain("## 판정 금지 · 업체 상대 발언 금지");
      expect(prompt).toContain("persistence: durable");
      expect(prompt).toContain("[이번 답변의 대화 우선순위]");
    }
  });
});
it("개인 상담 답변은 실제 개인 저장 버튼으로 안내하고 대화만으로 저장됐다고 하지 않는다", () => {
  const line = delivered.split("\n").find(candidate => candidate.includes("개인 할 일로 저장")) ?? "";
  expect(line).toContain("제목·내용·마감일을 확인");
  expect(line).toContain("나만 볼 할 일");
  expect(line).toContain("버튼의 저장 결과 없이 저장됐다고 말하지");
});
const without = (...drop: string[]) =>
  compose(PRODUCTION_ENABLED_TOOL_NAMES.filter((name) => !drop.includes(name)));

/**
 * 방향전환 규칙 **한 줄**을 꺼낸다.
 *
 * 프롬프트 전체에 `toContain` 을 걸면 **다른 자리에 남은 같은 낱말이 대신 대답한다** —
 * "둘 다", "이미 말했으면" 같은 조각은 이 파일 밖에도 있다. 이 규칙이 지켜야 할 것은
 * "한 줄 안에서 두 갈래를 모두 시키는가" 이므로 그 줄만 놓고 묻는다.
 */
function pivotRuleLine(prompt: string): string {
  const line = prompt
    .split("\n")
    .find((candidate) => candidate.includes("하객 규모") && candidate.includes("이유는 한 번만"));
  return line ?? "";
}

describe("큰 방향전환은 이유를 한 번 확인한다", () => {
  // Turn 17: 180명 일반예식 -> 40명 가족식을 이유 확인 없이 즉시 수용했다.
  it("크기 조건과 함께 실린다", () => {
    expect(pivotRuleLine(delivered)).toContain("절반 이하");
    expect(pivotRuleLine(delivered)).toContain("이유는 한 번만");
  });

  it("가족식에서 큰 예식으로 확대할 때도 이유 확인과 계획 정리를 전달한다", () => {
    const line = pivotRuleLine(delivered);
    expect(line).toContain("2배 이상");
    expect(line).toContain("예식 형태·지역 전환");
    expect(line).toContain("유지할 것과 다시 정할 것을");
    expect(line).toContain("한 답변에 둘 다");
  });

  /**
   * 2026-09-03 (2차 Major 1 의 남은 구멍). 조건어가 "예식 형태·하객 규모" 뿐이라
   * **하객 수가 그대로인 순수 권역 전환**("대전 말고 제주로. 하객은 그대로 90명")은
   * W0 라 규칙이 실리는데도 조건에 없어 이유 확인 없이 즉시 새 전제가 됐다.
   *
   * 조건어를 낱말로 세지 않고 **세 축이 모두 있는가**로 묻는다 — 하나를 지우면
   * 빨간불이 되고, 순서를 바꾸거나 다른 말을 덧붙여도 통과한다.
   */
  it("예식 형태·지역·하객 규모 세 축이 모두 조건에 있다", () => {
    const line = pivotRuleLine(delivered);
    for (const axis of ["예식 형태", "지역", "하객 규모"]) {
      expect(line, `방향 전환 조건에 '${axis}' 가 없다 — 그 축의 전환은 즉시 수용된다`)
        .toContain(axis);
    }
  });

  it("작은 변경까지 되묻게 하지는 않는다", () => {
    // 이 단서가 빠지면 날짜 한 달 옮기는 것도 되묻는다.
    const line = pivotRuleLine(delivered);
    expect(line).toContain("작은 월 선호는 되묻지 마세요");
    expect(line).not.toContain("반영하세요");
  });

  it("도구 없는 최종 답변에도 같은 큰 변경 대화 기준이 남는다", () => {
    expect(pivotRuleLine(compose([]))).toBe(pivotRuleLine(delivered));
  });

  /**
   * 2026-08-31 운영 실측: 사용자가 "부모님이 비용을 부담스러워하셔서"라고 **먼저
   * 말했는데도** 아모라가 이유를 또 물었다. 같은 프롬프트의 탐색 역할은 "이미 답한
   * 것을 되묻지 말고"라고 하는데, 이 줄이 조건 없이 확인을 시켜 서로 부딪혔다.
   */
  it("이유를 이미 들었으면 다시 묻지 말라는 예외가 같은 줄에 있다", () => {
    const line = pivotRuleLine(delivered);
    expect(line, "이유 확인이 조건 없이 걸려 있다 — 이미 답한 사용자에게 또 묻는다")
      .toContain("이미 말했으면");
    expect(line, "되묻지 말라고만 하고 그때 무엇을 하라는지 없다")
      .toContain("건너뛰고");
  });
});

describe("방향이 바뀌면 기존 계획 상태를 알려준다", () => {
  /**
   * 2026-08-31 운영 실측: **한 답변에 절반씩만 나왔다.** 1회차는 "예산·장소·초대
   * 범위까지 다시 정할지"만, 2회차는 "사진·드레스·반지·여행 등이 그대로면"만 말했다.
   *
   * 옛 문장(`무엇이 남고 무엇을 다시 정할지`)은 **간접 의문문**이라 모델이 그중 한쪽만
   * 골라 사용자에게 되물어도 지킨 셈이 됐다. 그래서 서술형 목적어로 바꾸고 한 답변에
   * 둘 다 나오라고 못 박았다. `toContain("다시 정할")` 만으로는 그 회귀를 못 잡는다 —
   * 옛 문장에도 그 조각이 그대로 있다.
   */
  it("남는 쪽과 다시 정할 쪽을 한 답변에 둘 다 말하게 한다", () => {
    const line = pivotRuleLine(delivered);
    expect(line, "그대로 가는 쪽을 말하라는 지시가 없다 — 사용자는 계획 상태를 잃는다")
      .toContain("유지할 것과 다시 정할 것을");
    expect(line, "한쪽만 말해도 지킨 것이 된다 — 실제로 두 번 다 절반만 나왔다")
      .toContain("한 답변에 둘 다");
  });

  it("한쪽을 고를 수 있는 간접 의문문으로 돌아가지 않는다", () => {
    expect(pivotRuleLine(delivered)).not.toContain("무엇이 남고 무엇을 다시 정할지");
  });

  it("결혼 조회 도구 없이도 유지할 기준과 재검토할 범위를 이어간다", () => {
    expect(pivotRuleLine(without("get_wedding_info", "get_budget_summary")))
      .toBe(pivotRuleLine(delivered));
  });
});

describe("이 규칙에는 늘릴 자리가 없다", () => {
  /**
   * 프롬프트 상한은 48,000자이고 이 턴의 여유는 1,400자대다(2026-08-31 실측
   * 46,583자 / 여유 1,417자). 이 줄을 고칠 때 길어지면 문맥이 많은 커플에서
   * 저장 문맥 꼬리가 그만큼 잘린다 — 그래서 길이를 함께 못 박는다.
   * 이번 수정은 108자 -> 107자였다.
   */
  it("규칙 한 줄이 110자를 넘지 않는다", () => {
    expect(pivotRuleLine(delivered).length).toBeLessThanOrEqual(110);
  });

  it("운영과 같은 도구 집합에서 프롬프트가 상한 안에 있다", () => {
    expect(delivered.length).toBeLessThanOrEqual(AMORA_SYSTEM_PROMPT_MAX_CHARS);
  });
});

describe("방향 변경의 대화 기준은 도구 권한과 분리한다", () => {
  const scopes: AmoraQuestionScopeClassification[] = [
    { scope: "W0_wedding_core", allowsLongTermMemory: true, confidence: "high", needsClarification: false },
    { scope: "W1_wedding_adjacent", allowsLongTermMemory: true, confidence: "high", needsClarification: false },
    { scope: "W2_high_risk_adjacent", highRiskReason: "domain", allowsLongTermMemory: false, confidence: "high", needsClarification: false },
    { scope: "W2_high_risk_adjacent", highRiskReason: "safety", allowsLongTermMemory: false, confidence: "high", needsClarification: false },
    { scope: "W3_social_care", allowsLongTermMemory: false, confidence: "high", needsClarification: false },
    { scope: "W4_out_of_scope", allowsLongTermMemory: false, confidence: "high", needsClarification: false },
    { scope: "W5_safety_override", allowsLongTermMemory: false, confidence: "high", needsClarification: false },
  ];

  it.each(scopes)("도구 없는 $scope $highRiskReason 답변은 서버가 허용한 대화 범위만 잇는다", questionScope => {
    const prompt = buildAmoraSystemPrompt(promptContext(), {
      enabledToolNames: [], requestKind: "chat", persistenceMode: "durable",
      questionScope, maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
    });
    const isWeddingConversation = questionScope.scope === "W0_wedding_core"
      || questionScope.scope === "W1_wedding_adjacent";
    expect(pivotRuleLine(prompt)).toBe(isWeddingConversation ? pivotRuleLine(delivered) : "");
    expect(prompt).not.toContain("## 현재 실행 가능한 도구 계약");
    expect(prompt).toContain("[서버 확정 요청 계약]");
    expect(prompt.length).toBeLessThanOrEqual(AMORA_SYSTEM_PROMPT_MAX_CHARS);
  });

  it.each(["initial_greeting", "mediation"] as const)("%s에는 일반 웨딩 계획의 이유 질문을 추가하지 않는다", requestKind => {
    const prompt = buildAmoraSystemPrompt(promptContext(), {
      enabledToolNames: [], requestKind, persistenceMode: "durable",
      questionScope: scopes[1], maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
    });
    expect(pivotRuleLine(prompt)).toBe("");
    expect(prompt).toContain(`request_kind: ${requestKind}`);
  });

  const denseText = "가".repeat(2_000);
  const denseProfile = {
    personaSummary: denseText, budgetPosture: denseText, decisionStyle: denseText,
    tasteProfile: denseText, communicationStyle: denseText, conflictPattern: denseText,
    sensitiveTopics: [denseText], recommendationRules: [denseText], openQuestions: [denseText],
    confidenceScore: 0.9,
  };
  const denseContexts: { label: string; context: WeddingPlannerPromptContext }[] = [
    { label: "포화 프로필", context: {
      ...promptContext(), amoraProfiles: { shared: denseProfile, private: denseProfile },
    } },
    { label: "긴 일정·요약", context: {
      ...promptContext(),
      scheduleEvents: Array.from({ length: 40 }, (_, index) => ({
        id: `evt-${index}`, title: `일정 ${index}: 견적 문의`, date: "2027-03-01",
      })),
      chatSummaries: Array.from({ length: 30 }, (_, index) =>
        `요약 ${index}. 예식장 후보와 촬영 견적을 비교한 합성 대화. `.repeat(30)),
    } },
  ];

  it.each(denseContexts)("$label이 잘려도 도구 호출 전후 같은 피벗 기준 전체가 한 번 남는다", ({ context }) => {
    for (const enabledToolNames of [PRODUCTION_ENABLED_TOOL_NAMES, []]) {
      const prompt = buildAmoraSystemPrompt(context, {
        enabledToolNames, requestKind: "chat", persistenceMode: "durable",
        questionScope: scopes[0], maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
      });
      expect(prompt).toContain("길이 제한으로 생략됨");
      expect(prompt.split("\n").filter(line => line === pivotRuleLine(delivered)))
        .toEqual([pivotRuleLine(delivered)]);
      expect(pivotRuleLine(prompt).length).toBeLessThanOrEqual(110);
      expect(prompt.length).toBeLessThanOrEqual(AMORA_SYSTEM_PROMPT_MAX_CHARS);
      expect(prompt).toContain("[서버 확정 요청 계약]");
      expect(prompt).toContain("## 할루시네이션 방지");
      expect(prompt).toContain("## 판정 금지 · 업체 상대 발언 금지");
    }
  });
});

describe("무엇부터 할지 모른다고 하면 되묻기로 끝내지 않는다", () => {
  it("판단·이유·다음 한 가지를 함께 주게 한다", () => {
    expect(delivered).toContain("되묻기로 끝내지 말고");
    expect(delivered).toContain("판단·이유·다음 한 가지를 함께");
  });

  it("결혼 조회 도구가 없으면 싣지 않는다", () => {
    expect(without("get_wedding_info", "get_budget_summary"))
      .not.toContain("되묻기로 끝내지 말고");
  });
});

describe("금액 감이 없다고 하면 시세 도구를 쓴다", () => {
  // 이 도구는 켜져 있는데 프롬프트 어디에도 쓸 이유가 적혀 있지 않았다.
  it("도구 이름과 출처 요구가 함께 실린다", () => {
    expect(delivered).toContain("`get_market_price`");
    expect(delivered).toContain("기준 시점·출처와 함께 말하고");
  });

  it("지어내지 말라는 단서가 붙어 있다", () => {
    expect(delivered).toContain("도구 없이 평균가를 지어내지 마세요");
  });

  it("그 도구가 없으면 싣지 않는다", () => {
    expect(without("get_market_price")).not.toContain("도구 없이 평균가를 지어내지 마세요");
  });
});
