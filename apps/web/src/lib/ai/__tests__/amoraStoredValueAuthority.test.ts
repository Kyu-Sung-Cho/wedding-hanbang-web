import { describe, expect, it } from "vitest";
import {
  AMORA_SYSTEM_PROMPT_MAX_CHARS,
  buildAmoraSystemPrompt,
} from "@/lib/ai/amoraPromptComposer";
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

// 2026-09-03 스테이징 실측: DB 총예산이 5,000만원인데 아모라가 대화값 3,500만원을
// "현재 확정된 건"이라고 답했고, 요약에서도 대화에서만 들은 하객 90명·지역을
// "확정"이라 썼다. 저장값이 실리는 자리(`## 커플 상황`) 바로 아래에 저장값이
// 정본이라는 규칙이 함께 실리는지, 저장값이 없는 턴에는 안 실리는지를 잰다.
//
// **원본 `prompts.ts` 가 아니라 합성된 프롬프트에 묻는다** — 도구 선택·범위 필터를
// route.ts 와 같은 순서로 돌린 결과만 컴포저에 넘긴다
// (amoraPromptComposedContract.test.ts 의 합성 경로).

const PENDING_ACTION_TOOLS = BETA_SAFE_TOOLS.filter((tool) => isMutatingTool(tool.name));

type ComposeOptions = {
  storedValues: boolean;
  decisionCount?: number;
  /** 상한을 주지 않으면 절단 경로를 타지 않는다(필수 문맥 분리도 없다). */
  bounded?: boolean;
  /** 도구 0개 턴 — 이때만 "도구" 낱말이 든 줄이 걸러진다. */
  noTools?: boolean;
};

function composeLikeProduction(userText: string, options: ComposeOptions): string {
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

  const pastDecisions = Array.from({ length: options.decisionCount ?? 0 }, (_, index) => ({
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

  const context = {
    startingPointAsked: false,
    // 대조군은 결혼일·총예산·결혼식장이 모두 비어 있는 커플이다.
    weddingDate: options.storedValues ? "2027-05-15" : null,
    budget: options.storedValues ? 62_000_000 : 0,
    venue: options.storedValues ? "그랜드힐컨벤션" : null,
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
    pastDecisions,
    pastConflicts: [],
  };

  return buildAmoraSystemPrompt(context as never, {
    specialist: "general",
    requestKind: "chat",
    persistenceMode: "durable",
    enabledToolNames: options.noTools ? [] : readTools.map((tool) => tool.name),
    actionContract: !options.noTools && proposableTools.length > 0
      ? { kind: "proposal", text: buildAmoraPendingActionPrompt(proposableTools) }
      : undefined,
    questionScope,
    ...(options.bounded === false ? {} : { maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS }),
  } as never);
}

/**
 * 저장값이 실리는 블록(`## 커플 상황`)만 잘라낸다.
 *
 * 문자열을 찾아 세지 않고 **구조**로 센다 — 이 블록에서 열 0 의 `- ` 로 시작하는
 * 줄은 규칙 줄뿐이다(저장값 줄은 `커플 이름:` 로 시작하고, 카테고리 현황은
 * 두 칸 들여쓴 `  - ` 다). 그래서 규칙이 사라지면 0줄, 다른 위치로 새면 잡힌다.
 */
function coupleContextBullets(prompt: string): string[] {
  const start = prompt.indexOf("## 커플 상황");
  if (start === -1) return [];
  const rest = prompt.slice(start + "## 커플 상황".length);
  const ends = [rest.indexOf("\n### "), rest.indexOf("\n## ")].filter((i) => i !== -1);
  const block = ends.length > 0 ? rest.slice(0, Math.min(...ends)) : rest;
  return block.split("\n").filter((line) => line.startsWith("- "));
}

const USER_TEXT = "결혼식 예산 배분 좀 도와줘";

describe("저장값이 정본이라는 규칙", () => {
  it("저장값이 실린 턴에는 그 값 바로 아래에 한 줄로 함께 실린다", () => {
    const prompt = composeLikeProduction(USER_TEXT, { storedValues: true });
    const bullets = coupleContextBullets(prompt);

    expect(bullets).toHaveLength(1);
    const [rule] = bullets;
    // 세 가지 의무가 **한 줄 안에** 다 있어야 한다. 하나만 남으면 실측에서 본
    // 실패(대화값을 "확정"이라 부르기)가 그대로 남는다.
    expect(rule).toContain("저장값");
    expect(rule).toContain("정본");
    expect(rule).toContain("말씀하신");
    expect(rule).toMatch(/다르면|차이/);
    expect(rule).toMatch(/물으세요|확인/);
    expect(rule.length).toBeLessThanOrEqual(100);
  });

  it("저장값이 하나도 없는 턴에는 어디에도 안 실린다 (대조군)", () => {
    const prompt = composeLikeProduction(USER_TEXT, { storedValues: false });

    // 같은 화면·같은 블록이 그대로 있는데(예산: 미설정 / 결혼식장: 미정)
    expect(prompt).toContain("## 커플 상황");
    expect(prompt).toContain("예산: 미설정");
    // 규칙만 빠진다 — 짚을 차이가 없고 프롬프트는 상한에 붙어 있다.
    expect(coupleContextBullets(prompt)).toHaveLength(0);
    // 다른 자리로 새지도 않는다 — 저장값과 대화값을 가르는 줄이 프롬프트 어디에도 없다.
    expect(
      prompt.split("\n").filter((line) => line.includes("저장값") && line.includes("말씀하신")),
    ).toHaveLength(0);
  });

  it("저장 문맥이 절단되는 구간에서도 결과가 같다", () => {
    for (let decisions = 0; decisions <= 40; decisions += 8) {
      const stored = composeLikeProduction(USER_TEXT, {
        storedValues: true,
        decisionCount: decisions,
      });
      const empty = composeLikeProduction(USER_TEXT, {
        storedValues: false,
        decisionCount: decisions,
      });
      expect(coupleContextBullets(stored)).toHaveLength(1);
      expect(coupleContextBullets(empty)).toHaveLength(0);
    }
  });

  it("도구가 0개인 턴에서도, 상한이 없는 턴에서도 같은 결과다", () => {
    // 도구 0개 턴은 "도구" 낱말이 든 줄을 걸러내고, 상한이 없는 턴은 필수 문맥을
    // 떼어내지 않는다. 두 경로 모두에서 규칙이 저장값과 함께 살아 있어야 한다.
    for (const variant of [
      { storedValues: true, noTools: true },
      { storedValues: true, bounded: false },
      { storedValues: true, noTools: true, bounded: false },
    ] as const) {
      expect(coupleContextBullets(composeLikeProduction(USER_TEXT, variant))).toHaveLength(1);
    }
    for (const variant of [
      { storedValues: false, noTools: true },
      { storedValues: false, bounded: false },
    ] as const) {
      expect(coupleContextBullets(composeLikeProduction(USER_TEXT, variant))).toHaveLength(0);
    }
  });
});
