// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatBubble, { AiFeedbackRow } from "@/components/app/chat/ChatBubble";
import type { ChatMessage } from "@/types/database.types";
import { buildCanonicalQuoteAnalysisMessage } from "@/lib/ai/quoteAnalysisSelection";
import { getQuoteCheckItems } from "@/lib/amora/quoteCheck";
import { QUOTE_ANALYSIS_REOPEN_FALLBACK } from "@hanbang/shared/quote-analysis-presentation";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("Amora message feedback", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("keeps feedback visible on touch screens and describes what is actually saved", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );

    await act(async () => {
      root.render(<AiFeedbackRow messageId="message-1" />);
    });

    const row = container.querySelector<HTMLElement>(
      '[data-testid="amora-feedback-row"]',
    );
    expect(row?.className).toContain("opacity-100");

    const badButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("아쉬워요"));
    await act(async () => badButton?.click());

    const input = container.querySelector<HTMLInputElement>("input");
    expect(input?.placeholder).toBe("예: 더 짧게, 덜 딱딱하게");
    expect(container.textContent).toContain(
      "이 의견과 해당 공유 답변은 품질 확인용 기록에 저장돼요.",
    );
    expect(container.textContent).toContain("민감정보는 적지 마세요.");
    expect(container.textContent).toContain(
      "다음 답변을 바로 바꾸려면 채팅에 그대로 말씀해 주세요.",
    );

    await act(async () => {
      if (!input) return;
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "덜 딱딱하게 말해줘");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const submitButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="의견 보내기"]',
    );
    await act(async () => {
      submitButton?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("의견을 남겼어요");
    expect(container.textContent).not.toContain("반영됐어요");
  });

  it("hides quote v2 machine context and never exposes malformed JSON", async () => {
    const itemIds = getQuoteCheckItems("studio", "seoul").map((item) => item.id);
    const base: ChatMessage = {
      id: "30000000-0000-4000-8000-000000000001",
      couple_id: "10000000-0000-4000-8000-000000000001",
      sender_id: "20000000-0000-4000-8000-000000000001",
      sender_role: "bride",
      visibility: "shared",
      metadata: null,
      created_at: "2026-08-12T00:00:00.000Z",
      content: buildCanonicalQuoteAnalysisMessage({
        category: "studio",
        region: "seoul",
        quotePriceManwon: 300,
        vendorName: "테스트 스튜디오",
        includedItemIds: [],
        notNeededItemIds: [],
        unknownItemIds: itemIds,
      }),
    };

    await act(async () => root.render(<ChatBubble message={base} isCurrentUser />));
    expect(container.textContent).toContain("견적 체크: 테스트 스튜디오");
    expect(container.textContent).not.toContain("quote_analysis_v2");
    expect(container.textContent).not.toContain("vendorName");

    await act(async () => root.render(<ChatBubble
      message={{ ...base, content: "안내\n[quote_analysis_v2]\n{\"secret\":\"raw-json\"}\n[/quote_analysis_v2]" }}
      isCurrentUser
    />));
    expect(container.textContent).toContain(QUOTE_ANALYSIS_REOPEN_FALLBACK);
    expect(container.textContent).not.toContain("raw-json");
    expect(container.textContent).not.toContain("secret");
  });
});
