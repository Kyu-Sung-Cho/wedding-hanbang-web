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
  it.each([
    { persistenceMode: "durable", conversationLane: "private", maxChars: 48_000 },
    { persistenceMode: "durable", conversationLane: "shared", maxChars: 48_000 },
    { persistenceMode: "durable", conversationLane: "private", maxChars: 25_000 },
    { persistenceMode: "durable", conversationLane: "shared", maxChars: 25_000 },
    { persistenceMode: "demo", conversationLane: "shared", maxChars: 25_000 },
  ] as const)(
    "$persistenceMode/$conversationLane/$maxChars 자료 위치 질문에 실제 제품 링크와 범위가 남는다",
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
      expect(citation.includes("[공시 가격·위약금](https://hanbang.ai/price)")).toBe(true);
      expect(citation.includes("[결혼 예절 가이드](https://hanbang.ai/wedding/manners)")).toBe(true);
      expect(citation.includes("공시 가격과 위약금·환불 조건 원문을 찾는 시작점")).toBe(true);
      expect(citation.includes("공시된 원문이 있는 경우")).toBe(true);
      expect(citation.includes("자료 위치를 묻는 질문에는 해당 링크를 그대로 사용")).toBe(true);
      expect(citation.includes("지금 본문을 읽거나 조건을 검증했다는 뜻은 아닙니다")).toBe(true);
      expect(prompt.includes("공시 가격 목록(hanbang.ai/price)")).toBe(false);
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
    { requestKind: "chat", persistenceMode: "durable", conversationLane: "shared", enabledToolNames: ["get_market_price"] },
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
