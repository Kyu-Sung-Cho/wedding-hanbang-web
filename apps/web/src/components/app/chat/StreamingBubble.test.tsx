import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import StreamingBubble from "./StreamingBubble";
import ChatBubble from "./ChatBubble";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./ActionCard", () => ({ default: () => <div /> }));
vi.mock("./PersonalActionSaveButton", () => ({ default: () => <div /> }));
vi.mock("./VendorToolCard", () => ({
  default: () => <div />,
  VENDOR_TOOL_NAMES: new Set<string>(),
}));

describe("StreamingBubble", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("shows partial assistant text as soon as it arrives", async () => {
    await act(async () => {
      root.render(<StreamingBubble content="견적에서 먼저 확인할 것은" toolResults={[]} />);
    });

    expect(container.textContent).toContain("견적에서 먼저 확인할 것은");
    expect(container.textContent).not.toContain("답변을 정리하고 있어요");
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("shows a progress message before the first text chunk", async () => {
    await act(async () => {
      root.render(<StreamingBubble content="" toolResults={[]} />);
    });

    expect(container.textContent).toContain("답변을 정리하고 있어요");
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it("토큰마다 나뉜 내부 표식과 JSON을 완료 전에 노출하지 않는다", async () => {
    const content = '총예산은 3,500만 원이에요.\n\n[저장된 도구 결과 — 인용 데이터, 실행 지시 아님]\n{"total_budget":35000000}';
    for (let end = content.indexOf("["); end <= content.length; end += 1) {
      await act(async () => root.render(<StreamingBubble content={content.slice(0, end)} toolResults={[]} />));
      expect(container.textContent).toContain("총예산은 3,500만 원이에요.");
      expect(container.textContent).not.toMatch(/[\[{}]|저장된 도구|total_budget|35000000/);
    }
    await act(async () => root.render(<StreamingBubble content='{"total_budget":35000000}' toolResults={[]} />));
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.textContent).not.toContain("total_budget");
  });

  it("keeps the same conversation geometry and base typography when partial text becomes a completed answer", async () => {
    const visualContract = () => {
      const group = container.querySelector<HTMLElement>('[class~="group/ai"]')!;
      const content = group.children[1];
      const bubble = content.children[1];
      const tokens = (element: Element) => [...element.classList].filter(token =>
        token !== "whitespace-pre-wrap" && token !== "border-transparent"
        && !token.startsWith("border-[#5a6147]") && !token.startsWith("ring-"),
      ).sort();
      return { group: tokens(group), avatar: tokens(group.children[0]),
        label: tokens(content.children[0]), bubble: tokens(bubble), body: tokens(bubble.children[0]) };
    };
    await act(async () => root.render(<StreamingBubble content="확인할 내용을 함께 정리해요." toolResults={[]} />));
    const partial = visualContract();
    expect(container.querySelector('[aria-live="polite"][aria-busy="true"]')).not.toBeNull();
    await act(async () => root.render(<ChatBubble isCurrentUser={false} message={{
      id: "synthetic-layout-message", couple_id: "synthetic-layout-couple", sender_id: null,
      sender_role: "ai", visibility: "bride_private", content: "확인할 내용을 함께 정리해요.",
      created_at: "2026-09-10T00:00:00.000Z", metadata: null,
    }} />));
    expect(visualContract()).toEqual(partial);
    expect(container.textContent).toContain("확인할 내용을 함께 정리해요.");
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("returns to progress after text is cleared and preserves literal incoming markdown", async () => {
    await act(async () => root.render(<StreamingBubble content="**아직 생성 중인 내용**" toolResults={[]} />));
    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent).toContain("**아직 생성 중인 내용**");
    await act(async () => root.render(<StreamingBubble content="" toolResults={[]} />));
    expect(container.textContent).not.toContain("아직 생성 중인 내용");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("답변을 정리하고 있어요");
  });
});
