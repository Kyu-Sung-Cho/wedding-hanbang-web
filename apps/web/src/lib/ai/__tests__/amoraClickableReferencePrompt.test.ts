// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildAmoraSystemPrompt } from "../amoraPromptComposer";
import { classifyAmoraQuestionScope } from "../amoraQuestionScope";
import type { WeddingPlannerPromptContext } from "../prompts";

const context: WeddingPlannerPromptContext = {
  weddingDate: null,
  budget: 0,
  venue: null,
  progress: {},
  brideName: null,
  groomName: null,
  senderName: "사용자",
  bookings: [],
  scheduleEvents: [],
  chatSummaries: [],
};

describe("아모라가 안내하는 읽을 곳의 링크 계약", () => {
  it.each([48_000, 25_000])("제품 링크와 출처 경계가 기존 필수 문맥 예산 안에 함께 남는다 — %i", maxChars => {
    const prompt = buildAmoraSystemPrompt(context, {
      requestKind: "chat",
      persistenceMode: "durable",
      conversationLane: "shared",
      enabledToolNames: [],
      maxChars,
    });
    const heading = "## 출처 표기 (Source Citation) — 사용자 신뢰의 핵심";
    const citation = prompt.slice(prompt.indexOf(heading)).split("\n## ")[0];

    // 기존 실제 POST의 긴 맞춤 정보와 행동 카드 250자 여유를 함께 보존하는 예산이다.
    expect(citation.length).toBeLessThanOrEqual(1_027);
    for (const rule of [
      "원문 URL·기준일·지역·구성 범위가 함께 확인된 데이터만 사용",
      "숫자 바로 앞·뒤 1줄",
      "같은 출처는 답변마다 첫 인용에만",
      "개별 견적의 적정성·최종 비용을 보증하지 마세요",
      "수치·평균·통계·출처·원문·기준일 창작 금지",
      "근거 없는 관행·모호한 금액 금지",
      "예시 수치를 만들지 마세요",
      "사용자 값은 제공값임을 밝히세요",
      "제공값의 단순 계산(계산임 명시)",
      "링크 제공은 본문 사실 검증과 다르며",
    ]) expect(citation.includes(rule), rule).toBe(true);
    expect(prompt.length).toBeLessThanOrEqual(maxChars);
  });

  it.each([
    { persistenceMode: "durable", conversationLane: "private", maxChars: 48_000 },
    { persistenceMode: "durable", conversationLane: "shared", maxChars: 48_000 },
    { persistenceMode: "durable", conversationLane: "private", maxChars: 25_000 },
    { persistenceMode: "durable", conversationLane: "shared", maxChars: 25_000 },
    { persistenceMode: "demo", conversationLane: "shared", maxChars: 25_000 },
  ] as const)(
    // 2026-11-16 파운더 결정(D-79): 참가격 자료와 그 화면(/price, 위약금·환불 원문)을 쓰지 않는다.
    // 예전에는 이 질문에 `[공시 가격·위약금](https://hanbang.ai/price)` 을 안내했다. 그 경로는
    // 제품경로에서 빠졌고, 남은 경로와 "주소가 없으면 링크를 만들지 않는다" 는 경계는 그대로다.
    "$persistenceMode/$conversationLane/$maxChars 자료 위치 질문에도 내린 공시 가격 화면을 안내하지 않는다",
    options => {
      const prompt = buildAmoraSystemPrompt(context, {
        ...options,
        requestKind: "chat",
        enabledToolNames: [],
        questionScope: classifyAmoraQuestionScope({
          userText: "참가격 공시 가격과 위약금 자료는 우리 서비스에서 어디서 볼 수 있어? 업체 추천 없이 바로 열 수 있는 링크로 알려줘.",
          requestKind: "chat",
        }),
      });

      const citation = prompt.split("## 출처 표기 (Source Citation) — 사용자 신뢰의 핵심")[1]
        ?.split("\n## ")[0] ?? "";
      expect(citation.includes("hanbang.ai/price")).toBe(false);
      expect(prompt.includes("hanbang.ai/price")).toBe(false);
      expect(citation.includes("[결혼 예절 가이드](https://hanbang.ai/wedding/manners)")).toBe(true);
      expect(citation.includes("자료 위치 질문에는 위 링크를 사용하세요")).toBe(true);
      expect(citation.includes("주소가 없으면 정확한 링크는 확인되지 않았다고")).toBe(true);
      expect(citation.includes("링크 제공은 본문 사실 검증과 다르며")).toBe(true);
      expect(citation.includes("무관한 링크·업체·장소 추천 금지")).toBe(true);
      expect(prompt.length).toBeLessThanOrEqual(options.maxChars);
    },
  );

  it("최종 답변에 조회 도구가 없어도 이름뿐 아니라 클릭 가능한 출처를 안내한다", () => {
    const prompt = buildAmoraSystemPrompt(context, {
      requestKind: "chat",
      persistenceMode: "durable",
      enabledToolNames: [],
      questionScope: classifyAmoraQuestionScope({
        userText: "결혼서비스 공시 가격은 어디에서 확인할 수 있어요?",
        requestKind: "chat",
      }),
    });

    expect(prompt).toContain("사이트·기관·자료를 안내할 때 이름만 말하지 말고");
    expect(prompt).toContain("[자료 이름](제공된 URL)");
  });

  it("주소가 없는 출처를 링크처럼 만들거나 사용자 주소를 검증된 원문으로 바꾸지 않는다", () => {
    const prompt = buildAmoraSystemPrompt(context, {
      requestKind: "chat",
      persistenceMode: "demo",
      enabledToolNames: [],
    });

    expect(prompt.includes("사이트 이름으로 도메인·상세 경로를 추측하거나 URL을 만들지 마세요")).toBe(true);
    expect(prompt.includes("주소가 없으면 정확한 링크는 확인되지 않았다고")).toBe(true);
    expect(prompt.includes("사용자가 준 링크도 읽거나 공식 출처로 검증했다고 말하지 마세요")).toBe(true);
    expect(prompt.includes("홈페이지·검색 결과 링크를 원문 자료인 것처럼 표시하지 마세요")).toBe(true);
  });

  it.each([
    // 읽기 도구가 하나 켜진 턴. 11-16 전에는 그 자리에 시세 도구를 썼다(지금은 모델에 가지 않는다).
    { requestKind: "chat", persistenceMode: "durable", conversationLane: "shared", enabledToolNames: ["get_budget_summary"] },
    { requestKind: "chat", persistenceMode: "demo", conversationLane: "shared", enabledToolNames: [] },
    { requestKind: "chat", persistenceMode: "durable", conversationLane: "private", enabledToolNames: [] },
    { requestKind: "initial_greeting", persistenceMode: "durable", conversationLane: "shared", enabledToolNames: [] },
    { requestKind: "mediation", persistenceMode: "durable", conversationLane: "shared", enabledToolNames: [] },
  ] as const)(
    "$requestKind/$persistenceMode/$conversationLane 절단 뒤에도 링크·검증 경계가 남는다",
    options => {
      const maxChars = 25_000;
      const prompt = buildAmoraSystemPrompt(context, { ...options, maxChars });

      expect(prompt.includes("[저장 문맥 일부는 길이 제한으로 생략됨]")).toBe(true);
      expect(prompt.includes("[자료 이름](제공된 URL)")).toBe(true);
      expect(prompt.includes("사이트 이름으로 도메인·상세 경로를 추측하거나 URL을 만들지 마세요")).toBe(true);
      expect(prompt.includes("제공된 카드·읽기 태그가 이미 바로 열리는 경우 같은 링크를 반복하지 마세요")).toBe(true);
      expect(prompt.length).toBeLessThanOrEqual(maxChars);
    },
  );
});
