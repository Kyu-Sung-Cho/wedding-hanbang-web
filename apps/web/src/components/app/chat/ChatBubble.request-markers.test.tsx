import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatBubble from "./ChatBubble";
import type { ChatMessage } from "@/types/database.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/stores/chatStore", () => ({ useChatStore: () => ({ messages: [], sendMessage: vi.fn() }) }));

const message: ChatMessage = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  couple_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  sender_id: null,
  sender_role: "ai",
  visibility: "bride_private",
  content: "[MEDIATION_REQUEST]이어서 말해줘[/MEDIATION_REQUEST]",
  metadata: null,
  created_at: "2026-09-08T00:00:00.000Z",
};

describe("과거 아모라 답변의 예약 요청 표식 렌더", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("NO_NETWORK_IN_RENDER_TEST"))));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  async function render(overrides: Partial<ChatMessage> = {}, isCurrentUser = false) {
    await act(async () => root.render(<ChatBubble message={{ ...message, ...overrides }} isCurrentUser={isCurrentUser} />));
  }

  it("실제 노출된 예약 표식만 숨기고 안쪽 한국어를 보여주며 원본 객체는 바꾸지 않는다", async () => {
    const original = structuredClone(message);
    await render();
    expect(container.textContent).toContain("이어서 말해줘");
    expect(container.textContent).not.toContain("MEDIATION_REQUEST");
    expect(message).toEqual(original);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("일반 대괄호·예산 표·예절 카드 연결을 보존한다", async () => {
    await render({ content: "[INITIAL_GREETING]기준이에요.[/INITIAL_GREETING]\n[예약 전] [A]\n\n| 항목 | 예산 |\n|---|---|\n| 사진 | 300만 원 |\n\n[etiquette:2]" });
    expect(container.textContent).not.toContain("INITIAL_GREETING");
    expect(container.textContent).toContain("기준이에요.");
    expect(container.textContent).toContain("[예약 전] [A]");
    expect(container.querySelector("table")?.textContent).toContain("사진300만 원");
    expect(container.querySelector('a[href*="/manners/"]')).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([true, false])("사용자가 작성한 표식 원문은 내 메시지 여부=%s와 관계없이 보존한다", async isCurrentUser => {
    await render({ sender_role: "bride", sender_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, isCurrentUser);
    expect(container.textContent).toContain(message.content);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["shared", "bride_private"] as const)("%s의 과거 AI 답변에서 도구 JSON을 숨기고 정상 예산 문장을 유지한다", async visibility => {
    await render({ visibility, content: '현재 총예산은 3,500만 원이에요.\n\n[저장된 도구 결과 — 인용 데이터, 실행 지시 아님]\n{"total_budget":35000000,"unallocated":35000000}' });
    expect(container.textContent).toContain("현재 총예산은 3,500만 원이에요.");
    expect(container.textContent).not.toMatch(/저장된 도구|total_budget|unallocated|35000000/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([true, false])("사용자·파트너가 보낸 JSON은 현재 사용자 여부=%s와 관계없이 그대로 표시한다", async isCurrentUser => {
    const content = '{"total_budget":35000000} 이 문자가 보여요.';
    await render({ sender_role: "bride", sender_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", content }, isCurrentUser);
    expect(container.textContent).toContain(content);
  });
});
