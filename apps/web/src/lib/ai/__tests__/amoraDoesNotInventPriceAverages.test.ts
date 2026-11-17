// @vitest-environment node

/**
 * 예산 감이 없거나 시세를 물어도 아모라는 평균을 지어내지 않는다.
 *
 * ## 왜 (2026-11-16)
 *
 * 파운더가 한국소비자원 참가격 자료를 "모두 그만 쓰기"로 정했다(설계도 D-79). 그 전에는
 * "예산 감이 없어요"·"대관료는 보통 얼마야?" 에 `get_market_price` 가 붙어 참가격 통계를
 * 출처·기준 시점과 함께 말했다. 도구를 빼면 모델에게 남는 것은 훈련 때 본 숫자뿐이고, 그
 * 숫자에는 출처도 기준 시점도 없다. 그래서 도구를 빼는 것과 함께 "지어내지 말라"는 규칙이
 * 모든 턴에 실려야 한다.
 *
 * ## 이 파일이 지키는 것 (운영 경로 그대로 잰다)
 *
 * 1. 어떤 말투로 물어도 시세 도구가 모델에 가지 않는다. 출시 목록·도구 선택 정책·범위
 *    필터를 **각각 따로** 본다 — 출시 목록에서만 빠지고 정책에 남아 있으면, 누가 그 목록을
 *    되돌리는 순간 다시 붙는다.
 * 2. 그 턴의 시스템 프롬프트에 "평균·시세를 지어내지 말라"는 규칙이 실리고, 프롬프트가 가장
 *    짧게 잘려도 남는다. 시세 도구·공시가 페이지·참가격을 가리키는 말은 없다.
 * 3. 실행기는 그 이름이 와도 DB 를 읽지 않고 실패한다.
 * 4. 켜져 있는 견적 확인(`analyze_quote`)의 결과도 시세 칸이나 공시가 화면 안내를 모델에 싣지 않는다.
 * 5. 옛 대화에 남은 시세 결과를 다시 모델에 보내지 않는다.
 *
 * 이 파일이 대신하는 옛 검사(전제가 뒤집혀 지웠다): `priceQuestionsGetThePriceTool.test.ts`
 * (시세 질문에 시세 도구가 붙는다), `priceRulesFollowTheTool.test.ts`(시세 조회 약속은 도구를
 * 따라간다), `toolExecutor.marketPriceScope.test.ts`(실행기의 공시 분야 범위). 말투 몇 개는 앞의
 * 두 파일에서 가져왔다.
 *
 * ## 재지 못하는 것
 *
 * 모델이 실제로 숫자를 지어내는지는 여기서 재지 못한다 — 모델을 부르지 않는다. 여기서 막는
 * 것은 숫자를 지어낼 이유(도구가 있다는 약속, 공시가 페이지 안내)와 길(옛 시세 이력)이다.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AMORA_SYSTEM_PROMPT_MAX_CHARS,
  buildAmoraSystemPrompt,
} from "@/lib/ai/amoraPromptComposer";
import { summarizeCardOnlyToolResults } from "@/lib/ai/amoraBoundedContinuity";
import {
  buildAmoraQuestionScopeInstruction,
  classifyAmoraQuestionScope,
  filterAmoraToolsByQuestionScope,
  type AmoraQuestionScopeClassification,
} from "@/lib/ai/amoraQuestionScope";
import { selectAmoraTools } from "@/lib/ai/amoraToolPolicy";
import { appendAmoraToolResultHistory } from "@/lib/ai/amoraToolResultHistory";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { getModelSafeToolOutput } from "@/lib/ai/placeSearchResultPolicy";
import { getSpecialistPromptAddon } from "@/lib/ai/stage-router";
import { executeTool } from "@/lib/ai/toolExecutor";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";
import { BETA_DISABLED_TOOL_NAMES, BETA_SAFE_TOOLS, WEDDING_TOOLS } from "@/lib/ai/tools";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

beforeEach(() => {
  vi.clearAllMocks();
});

const PRICE_TOOL = "get_market_price";

/** 운영이 실제로 넘기는 집합 — 쓰기 도구는 `!isMutatingTool` 로 걸러진다. */
const PRODUCTION_READ_TOOLS = BETA_SAFE_TOOLS.filter((tool) => !isMutatingTool(tool.name));

/**
 * 출시 목록을 거치지 않은 모든 읽기 도구(시세 도구 포함). 정책과 범위 필터가 **스스로**
 * 시세 도구를 고르지 않는지 보려면 그 도구가 후보에 있어야 한다.
 */
const ALL_READ_TOOLS = WEDDING_TOOLS.filter((tool) => !isMutatingTool(tool.name));

const names = (tools: readonly { name: string }[]) => tools.map((tool) => tool.name);

/**
 * 말투를 구조별로 나열한다(VERIFICATION.md 4절). 같은 구조만 모으면 "안 붙는다" 가
 * 내 손끝에서 만들어진다.
 */
const PRICE_QUESTIONS: ReadonlyArray<readonly [string, string]> = [
  ["감이 없다는 직접 서술", "예산 감이 하나도 없어요. 결혼식에 얼마가 드는지 전혀 모르겠어"],
  ["감이 없다는 짧은 서술", "금액 감이 아예 없어"],
  ["항목 평균 질문", "웨딩홀 대관료 평균이 얼마예요?"],
  ["항목 보통 질문", "대관료는 보통 얼마야?"],
  ["묶음 상품", "스드메 보통 얼마 해?"],
  ["대여 비용 평균", "드레스 대여 비용 평균 알려줘"],
  ["지역과 1인당", "강남 쪽 식대는 1인당 얼마 정도야?"],
  ["적정성 판정 요청", "1인당 밥값 6만원이면 비싼 거야?"],
  ["받은 견적의 적정성", "스튜디오 견적 300 받았는데 적당한 거야?"],
  ["전언(제3자)", "친구가 대관료 평균이 천만원이라던데 맞아?"],
  ["다른 사람과 비교", "다른 사람들은 결혼식에 보통 얼마 써?"],
  ["시세 낱말", "요즘 웨딩홀 시세 어때?"],
  ["공시 자료를 콕 집음", "한국소비자원 참가격 기준으로 드레스 가격 알려줘"],
  ["공시 가격 화면", "공시 가격 보여줘"],
  ["결혼 낱말 없는 모호한 질문", "보통 얼마 들어?"],
  ["범위 밖 물건", "노트북 얼마야?"],
  ["영어", "What is the average wedding hall price in Seoul?"],
];

/** 운영 라우트와 같은 순서: 범위 판정 → 도구 선택 → 범위 필터. */
function offeredTools(
  userText: string,
  availableTools: readonly AiToolDefinition[],
  options: { specialistType?: string; attachmentKind?: "none" | "image" | "document" } = {},
): { classification: AmoraQuestionScopeClassification; tools: string[] } {
  const classification = classifyAmoraQuestionScope({ userText });
  const selected = selectAmoraTools({
    availableTools,
    userText,
    specialistType: options.specialistType ?? "general",
    attachmentKind: options.attachmentKind ?? "none",
  } as never);
  return {
    classification,
    tools: names(filterAmoraToolsByQuestionScope(selected, classification)),
  };
}

describe("시세 도구는 어떤 말투에도 모델에 가지 않는다", () => {
  it("출시 목록에서 빠지고 차단 목록에 있다", () => {
    expect(BETA_DISABLED_TOOL_NAMES.has(PRICE_TOOL)).toBe(true);
    expect(names(BETA_SAFE_TOOLS)).not.toContain(PRICE_TOOL);
  });

  it.each(PRICE_QUESTIONS)("운영 경로 — %s: %s", (_label, userText) => {
    for (const specialistType of ["general", "budget_optimizer"]) {
      expect(offeredTools(userText, PRODUCTION_READ_TOOLS, { specialistType }).tools, specialistType)
        .not.toContain(PRICE_TOOL);
    }
  });

  it.each(PRICE_QUESTIONS)("출시 목록을 되돌려도 정책이 고르지 않는다 — %s: %s", (_label, userText) => {
    for (const specialistType of ["general", "budget_optimizer"]) {
      for (const attachmentKind of ["none", "image", "document"] as const) {
        const selected = names(selectAmoraTools({
          availableTools: ALL_READ_TOOLS,
          userText,
          specialistType,
          attachmentKind,
        } as never));
        expect(selected, `${specialistType}/${attachmentKind}`).not.toContain(PRICE_TOOL);
      }
    }
  });

  it("범위 필터도 시세 도구를 커플 문맥 없는 조회로 남기지 않는다", () => {
    // W1 과 낮은 확신의 W4 는 커플 문맥 없는 조회만 남긴다. 11-16 전에는 시세 조회가 거기 있었다.
    for (const userText of ["시어머니가 나를 싫어해", "노트북 얼마야?", "보통 얼마 들어?"]) {
      const classification = classifyAmoraQuestionScope({ userText });
      const contextFreeLane = classification.scope === "W1_wedding_adjacent"
        || (classification.scope === "W4_out_of_scope"
          && classification.confidence === "low"
          && classification.needsClarification);
      // 이 문장이 그 레인에 안 들어가면 아래 단언은 아무것도 재지 않는다.
      expect(contextFreeLane, `${userText}: ${classification.scope}`).toBe(true);
      const kept = names(filterAmoraToolsByQuestionScope(ALL_READ_TOOLS, classification));
      // 대조군: 장소 검색은 남는다 — 필터가 "전부 0개" 갈래로 빠진 것이 아니다.
      expect(kept, userText).toContain("search_nearby_places");
      expect(kept, userText).not.toContain(PRICE_TOOL);
    }
  });

  it("범위 지시문이 시세 조회를 할 수 있는 일처럼 말하지 않는다", () => {
    const classification = classifyAmoraQuestionScope({ userText: "노트북 얼마야?" });
    const instruction = buildAmoraQuestionScopeInstruction(classification, {
      contextFreeToolNames: ["search_nearby_places", PRICE_TOOL],
    });
    // 대조군: 장소 검색 줄은 나간다.
    expect(instruction).toContain("search_nearby_places");
    expect(instruction).not.toContain(PRICE_TOOL);
    expect(instruction).not.toContain("시세 조회");
  });
});

const PRICE_RULE_LINES = [
  "## 가격 안내 규칙",
  "- 아모라에게는 시세·평균 가격 자료가 없습니다.",
  "평균가·중간값·시세·가격대를 지어내지 마세요.",
  "일반 지식으로 기억하는 숫자도 시세처럼 말하지 마세요.",
  "- 금액 감이 없다고 하면 평균을 대신 말하지 말고",
] as const;

/** 은퇴한 자료를 가리키거나, 아모라에게 시세 자료가 있다고 말하는 문구. */
const RETIRED_PRICE_CLAIMS = [
  PRICE_TOOL,
  "hanbang.ai/price",
  "(/price)",
  "공시가 페이지",
  "참가격",
  "시세 데이터",
  "현재 공시가",
  "공식 시세",
  "공식 참고",
  "시세 조회",
] as const;

function promptContext(extra: Record<string, unknown> = {}) {
  return {
    weddingDate: "2027-05-15",
    budget: 0,
    venue: null,
    progress: {},
    preparationStatus: null,
    brideName: "신부",
    groomName: "신랑",
    bookings: [],
    scheduleEvents: [],
    chatSummaries: [],
    pastConflicts: [],
    pastDecisions: [],
    ...extra,
  } as never;
}

/** 운영 라우트가 그 턴에 만드는 것과 같은 조합으로 시스템 프롬프트를 만든다. */
function productionPrompt(userText: string, maxChars: number = AMORA_SYSTEM_PROMPT_MAX_CHARS): string {
  const { classification, tools } = offeredTools(userText, PRODUCTION_READ_TOOLS, {
    specialistType: "budget_optimizer",
  });
  return buildAmoraSystemPrompt(promptContext(), {
    enabledToolNames: tools,
    requestKind: "chat",
    persistenceMode: "durable",
    questionScope: classification,
    specialist: "budget_optimizer",
    maxChars,
  } as never);
}

const MAX_CHARS_TOO_SMALL = /maxChars must be an integer large enough/;

/**
 * 필수 영역만 남을 만큼 가장 짧게 자른 프롬프트. 보호 머리(`PRODUCT_SAFETY_HEADINGS`)에
 * 없는 섹션은 여기서 사라진다 — 기억을 채우는 것만으로는 절단이 그 섹션까지 안 닿을 수 있다.
 */
function shortestPrompt(userText: string): string {
  for (let maxChars = 8_000; maxChars <= AMORA_SYSTEM_PROMPT_MAX_CHARS; maxChars += 500) {
    try {
      return productionPrompt(userText, maxChars);
    } catch (error) {
      if (!(error instanceof Error) || !MAX_CHARS_TOO_SMALL.test(error.message)) throw error;
    }
  }
  throw new Error("필수 영역이 상한보다 크다");
}

describe("그 턴의 프롬프트는 평균을 지어내지 말라고 한다", () => {
  it.each(PRICE_QUESTIONS)("%s: %s", (_label, userText) => {
    const prompt = productionPrompt(userText);
    for (const line of PRICE_RULE_LINES) {
      expect(prompt, line).toContain(line);
    }
    for (const claim of RETIRED_PRICE_CLAIMS) {
      expect(prompt, claim).not.toContain(claim);
    }
    expect(prompt.length).toBeLessThanOrEqual(AMORA_SYSTEM_PROMPT_MAX_CHARS);
  });

  it("가장 짧게 잘린 프롬프트에도 규칙이 남는다", () => {
    const userText = "예산 감이 하나도 없어요. 결혼식에 얼마가 드는지 전혀 모르겠어";
    const full = productionPrompt(userText);
    const shortest = shortestPrompt(userText);
    // 실제로 잘렸는지 먼저 본다 — 아니면 아래 단언이 헛초록불이다. 보호되지 않는 참조표가
    // 전체 프롬프트에는 있고 가장 짧은 프롬프트에는 없어야 한다. (가장 짧게 자르면 선택 영역이
    // 통째로 빠지는 갈래를 타서 "[저장 문맥 일부는 … 생략됨]" 표식은 붙지 않는다.)
    const UNPROTECTED_SECTION = "## 준비 항목에서 확인할 것";
    expect(shortest.length).toBeLessThan(full.length);
    expect(full).toContain(UNPROTECTED_SECTION);
    expect(shortest).not.toContain(UNPROTECTED_SECTION);
    for (const line of PRICE_RULE_LINES) {
      expect(shortest, line).toContain(line);
    }
  });

  it("예산 전문 보강문이 공시가를 근거로 들지 않는다", () => {
    const addon = getSpecialistPromptAddon("budget_optimizer");
    expect(addon).toContain("사용자가 입력한 총액·견적·계약 금액·지출 상한만 사용하세요.");
    expect(addon).not.toContain("공시가");
  });
});

describe("실행기는 시세 도구 이름이 와도 DB 를 읽지 않는다", () => {
  const ctx: ToolExecutionContext = {
    coupleId: "synthetic-couple",
    currentUserText: "대관료는 보통 얼마야?",
    weddingContext: { weddingDate: null, budget: 0, venue: null, progress: {} },
  } as ToolExecutionContext;

  it.each([
    { category: "hall" },
    { category: "hall", itemType: "식대" },
    { category: "studio", region: "seoul" },
    { category: "dress", region: null },
    { category: "honeymoon" },
    {},
  ])("입력 %j", async (input) => {
    const result = await executeTool(PRICE_TOOL, input, ctx);
    expect(result).toMatchObject({
      toolName: PRICE_TOOL,
      success: false,
      toolOutput: { error: "market_price_retired", retryable: false },
    });
    for (const key of ["medianKrw", "minKrw", "maxKrw", "sampleCount", "breakdown", "source", "period"]) {
      expect(result.toolOutput, key).not.toHaveProperty(key);
    }
    expect(result.displayMessage).not.toMatch(/\d/);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("견적 확인 결과도 시세나 공시가 화면을 가리키지 않는다", () => {
  // `analyze_quote` 는 켜져 있는 도구이고 그 출력은 모델에 그대로 간다. 11-16 전에는 늘 0 인
  // 시세 비교 칸과 "업체별 최신 공시가는 ‘업체 공시가’에서 확인" 안내가 함께 갔다.
  const ctx: ToolExecutionContext = {
    coupleId: "synthetic-couple",
    currentUserText: "스드메 견적 300 받았는데 봐줘",
    weddingContext: { weddingDate: null, budget: 0, venue: null, progress: {} },
  } as ToolExecutionContext;

  it.each([
    ["첫 단계(확인할 항목 목록)", { quote_price: 300, category: "sdm_package", included_items: [], not_needed_items: [] }],
    ["둘째 단계(고른 결과 정리)", { quote_price: 300, category: "studio", region: "seoul", included_items: [], not_needed_items: [], checklist_confirmed: true }],
  ])("%s", async (_label, input) => {
    const result = await executeTool("analyze_quote", input, ctx);
    // 대조군: 견적 확인 자체는 그대로 돈다.
    expect(result.success).toBe(true);
    const forModel = JSON.stringify(getModelSafeToolOutput(result));
    for (const retired of ["공시", "/price", "참가격", "marketMedian", "marketComparatorLabel", "priceDiff"]) {
      expect(forModel, retired).not.toContain(retired);
    }
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("출처 안내는 업체의 서면 견적을 가리킨다", async () => {
    const result = await executeTool("analyze_quote", {
      quote_price: 300, category: "studio", region: "seoul",
      included_items: [], not_needed_items: [], checklist_confirmed: true,
    }, ctx);
    expect(result.toolOutput).toMatchObject({
      dataSource: expect.stringContaining("업체의 서면 견적으로 확인하세요"),
      statsNote: expect.stringContaining("가격의 적정성을 판정하지 않습니다"),
    });
  });
});

describe("옛 대화의 시세 결과를 다시 보내지 않는다", () => {
  const OLD_PRICE_RESULT = {
    toolName: PRICE_TOOL,
    success: true,
    toolOutput: {
      category: "hall",
      region: null,
      source: "한국소비자원 참가격",
      period: "2025년 11월",
      breakdown: [
        { itemType: "식대", perPerson: true, sampleCount: 2, minKrw: 51_000, medianKrw: 61_000, maxKrw: 71_000 },
      ],
    },
  };
  const SEARCH_RESULT = {
    toolName: "search_nearby_places",
    success: true,
    toolOutput: {
      query: "강남역 한정식",
      resultCount: 3,
      places: [],
      displayOnlyPlaceholder: true,
      searchedAt: "2026-09-06T03:00:00.000Z",
    },
  };

  it("이력 보충에 옛 시세 숫자가 실리지 않는다", () => {
    expect(appendAmoraToolResultHistory("지난 답변", [OLD_PRICE_RESULT])).toBe("지난 답변");
    const mixed = appendAmoraToolResultHistory("지난 답변", [SEARCH_RESULT, OLD_PRICE_RESULT]);
    // 대조군: 장소 검색은 그대로 이어진다 — 이력 보충 자체가 꺼진 것이 아니다.
    expect(mixed).toContain("search_nearby_places");
    for (const leaked of [PRICE_TOOL, "61000", "medianKrw", "참가격", "2025년 11월"]) {
      expect(mixed, leaked).not.toContain(leaked);
    }
  });

  it("연결 문맥의 카드 요약도 옛 시세 카드를 되살리지 않는다", () => {
    expect(summarizeCardOnlyToolResults([OLD_PRICE_RESULT])).toBeNull();
    const line = summarizeCardOnlyToolResults([SEARCH_RESULT, OLD_PRICE_RESULT]);
    // 대조군: 장소 검색 요약은 나간다.
    expect(line).toContain("네이버 지역검색");
    expect(line).not.toContain("시세");
    expect(line).not.toContain("참가격");
  });
});
