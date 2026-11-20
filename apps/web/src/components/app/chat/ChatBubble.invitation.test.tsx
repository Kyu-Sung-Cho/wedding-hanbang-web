import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/types/database.types";

import ChatBubble from "./ChatBubble";
import StreamingBubble from "./StreamingBubble";
import SuggestionButtons from "./SuggestionButtons";

/**
 * 대화의 청첩장 모양(2026-11-17 파운더 디자인 아티팩트 `Web.dc`·`Chat.dc`, 원문 "이 디자인 완전 같아야해").
 * 아모라 말은 말풍선 없는 17px 글줄(줄 높이 1.7, 먹색), 사람 말은 돌빛 말풍선(반경 20, 15px), 제안은 38px 칩.
 * 모양만 바뀌고 무엇을 그리는지(나만 보기·상대에게·누가 한 말인지)는 기본 모양과 같아야 한다.
 */

const base: ChatMessage = {
  id: "message",
  couple_id: "couple",
  sender_id: "owner",
  sender_role: "bride",
  visibility: "shared",
  content: "확인한 내용",
  metadata: {},
  created_at: "2026-11-17T00:00:00Z",
};

describe("대화 말풍선의 청첩장 모양", () => {
  it("아모라 말은 말풍선·얼굴·시각 없이 17px 글줄이다(이름은 화면낭독기에만)", () => {
    const html = renderToStaticMarkup(
      <ChatBubble message={{ ...base, sender_role: "ai", sender_id: null }} isCurrentUser={false} presentation="invitation" />,
    );
    expect(html).toContain("text-[17px]");
    expect(html).toContain("leading-[1.7]");
    expect(html).toContain("text-inv-ink");
    expect(html).not.toContain("hb-chat-amora-surface");
    expect(html).toContain('<span class="sr-only">아모라</span>');
    expect(html).toContain("확인한 내용");
  });

  it("나만 보기 아모라 답은 그 표시를 남긴다", () => {
    const html = renderToStaticMarkup(
      <ChatBubble message={{ ...base, sender_role: "ai", sender_id: null, visibility: "bride_private" }} isCurrentUser={false} presentation="invitation" />,
    );
    expect(html).toContain("나만 보기");
  });

  it("내 말은 돌빛 말풍선(반경 20, 15px)이고 상대에게 보낸 표시와 나만 보기 표시는 그대로다", () => {
    const own = renderToStaticMarkup(<ChatBubble message={base} isCurrentUser presentation="invitation" />);
    expect(own).toContain("rounded-[20px] bg-inv-stone px-4 py-2.5 text-[15px]");
    expect(own).not.toContain("hb-chat-");
    const direct = renderToStaticMarkup(
      <ChatBubble message={{ ...base, metadata: { target: "partner" } }} isCurrentUser presentation="invitation" />,
    );
    expect(direct).toContain("상대방에게");
    const personal = renderToStaticMarkup(
      <ChatBubble message={{ ...base, visibility: "bride_private" }} isCurrentUser presentation="invitation" />,
    );
    expect(personal).toContain("나만 보기");
  });

  it("상대의 말은 얼굴 없이 이름을 남긴다(누가 한 말인지 지우지 않는다)", () => {
    const html = renderToStaticMarkup(
      <ChatBubble message={base} isCurrentUser={false} senderName="준호" presentation="invitation" />,
    );
    expect(html).toContain("준호");
    expect(html).toContain("bg-inv-stone");
    expect(html).not.toContain("data-profile-avatar");
  });

  it("기본 모양은 그대로다", () => {
    const html = renderToStaticMarkup(<ChatBubble message={{ ...base, sender_role: "ai", sender_id: null }} isCurrentUser={false} />);
    expect(html).toContain("hb-chat-amora-surface");
    expect(html).not.toContain("text-[17px]");
  });

  it("쓰는 중인 답도 말풍선 없이 같은 글줄 자리에 쓴다", () => {
    const html = renderToStaticMarkup(<StreamingBubble content="정리하고 있어요" toolResults={[]} presentation="invitation" />);
    expect(html).toContain("text-[17px]");
    expect(html).not.toContain("hb-chat-amora-surface");
    expect(html).toContain('aria-live="polite"');
  });

  it("제안 칩은 머리말 없이 38px, 카드 고리 색 테두리, 13px 이다", () => {
    const html = renderToStaticMarkup(
      <SuggestionButtons suggestions={["예산 범위 같이 정하기"]} onSelect={() => undefined} presentation="invitation" />,
    );
    expect(html).toContain("h-[38px]");
    expect(html).toContain("border-inv-ring");
    expect(html).toContain("text-[13px]");
    expect(html).not.toContain("추천 대화");
  });
});
