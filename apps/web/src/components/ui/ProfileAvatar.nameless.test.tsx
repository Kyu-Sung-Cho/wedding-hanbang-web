import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ChatBubble from "@/components/app/chat/ChatBubble";
import CommunityAvatar from "@/components/community/Avatar";
import type { ChatMessage } from "@/types/database.types";
import ProfileAvatar from "./ProfileAvatar";

/**
 * 이름 없는 계정의 머리글자 — 2026-09-15.
 *
 * 화면마다 대체 문구를 이름 자리에 넣어 같은 계정이 사이드바 「예」, 설정 「사」, 채팅
 * 「상」, 커뮤니티 「익」으로 보였다. 모바일은 사람 모양 아이콘이다. 웹도 이름이 없으면
 * 어느 화면에서나 같은 아이콘을 그리고, 대체 문구는 읽기 보조 이름으로만 쓴다.
 */

const PERSON_GLYPH = 'data-profile-avatar-fallback="person"';

function visibleInitial(html: string): string | null {
  return /<span aria-hidden="true">([^<]*)<\/span>/u.exec(html)?.[1] ?? null;
}

describe("이름 없는 계정의 아바타", () => {
  it("대체 문구를 label 로 주면 글자 대신 같은 사람 아이콘을 그리고 읽기 이름은 유지한다", () => {
    for (const label of ["예비부부", "사용자", "상대방", "파트너", "익명"]) {
      const html = renderToStaticMarkup(<ProfileAvatar name={null} label={label} />);
      expect(html, label).toContain(PERSON_GLYPH);
      expect(visibleInitial(html), label).toBeNull();
      expect(html, label).toContain(`aria-label="${label} 프로필"`);
    }
  });

  it("이름이 있으면 그 이름의 첫 글자를 그대로 쓴다", () => {
    const html = renderToStaticMarkup(<ProfileAvatar name="홍길동" label="상대방" />);
    expect(visibleInitial(html)).toBe("홍");
    expect(html).not.toContain(PERSON_GLYPH);
  });

  it("커뮤니티의 「익명」·빈 닉네임은 「익」이 아니라 같은 아이콘이다", () => {
    for (const nickname of ["익명", "", "  "]) {
      const html = renderToStaticMarkup(<CommunityAvatar nickname={nickname} />);
      expect(html, JSON.stringify(nickname)).toContain(PERSON_GLYPH);
      expect(html).toContain('aria-label="익명 프로필"');
    }
    expect(visibleInitial(renderToStaticMarkup(<CommunityAvatar nickname="봄날" />))).toBe("봄");
  });

  it("채팅에서 이름 없는 상대의 말풍선 아바타는 「상」이 아니라 같은 아이콘이다", () => {
    const message: ChatMessage = {
      id: "m1", couple_id: "c1", sender_id: "partner", sender_role: "groom", visibility: "shared",
      content: "확인했어요", metadata: {}, created_at: "2026-09-15T00:00:00Z",
    };
    const nameless = renderToStaticMarkup(<ChatBubble message={message} isCurrentUser={false} senderName={null} />);
    expect(nameless).toContain(PERSON_GLYPH);
    expect(nameless).toContain('aria-label="상대방 프로필"');
    const named = renderToStaticMarkup(<ChatBubble message={message} isCurrentUser={false} senderName="민준" />);
    expect(named).not.toContain(PERSON_GLYPH);
    expect(named).toContain('aria-hidden="true">민</span>');
  });
});
