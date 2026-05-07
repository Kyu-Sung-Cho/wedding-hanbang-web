"use client";

import ChatContent from "@/components/app/chat/ChatContent";

/**
 * 커뮤니티 안에서 아모라 상담을 인플레이스로 사용 — /community/chat.
 * CommunityLayout의 nav + footer는 그대로, 메인 영역에 채팅 풀 기능 렌더.
 *
 * 높이: viewport - CommunityNav(72) - footer(여유 80px) ≈ -160px.
 * 풀페이지(/chat)와는 별도 라우트, 같은 ChatContent 컴포넌트 공유.
 */
export default function CommunityChatPage() {
  return (
    <div className="h-[calc(100vh-160px)] max-w-5xl mx-auto w-full">
      <ChatContent embedded />
    </div>
  );
}
