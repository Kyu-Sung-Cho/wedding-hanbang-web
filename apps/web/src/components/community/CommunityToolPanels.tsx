"use client";

import ChatSidePanel from "@/components/app/chat/ChatSidePanel";
import { useToolPanelStore } from "@/stores/toolPanelStore";

/**
 * 커뮤니티 레이아웃에 마운트되는 도구 오버레이 모음.
 * 라우트 이동 없이 인플레이스로 도구를 띄움.
 *
 * 단계적 추가 예정:
 *   - chat (이번 PR)
 *   - budget (다음 PR)
 *   - schedule (다음 PR)
 */
export default function CommunityToolPanels() {
  const open = useToolPanelStore((s) => s.open);
  const close = useToolPanelStore((s) => s.close);

  return (
    <>
      <ChatSidePanel isOpen={open === "chat"} onClose={close} />
      {/* TODO PR 2: <BudgetSidePanel isOpen={open === "budget"} onClose={close} /> */}
      {/* TODO PR 3: <ScheduleSidePanel isOpen={open === "schedule"} onClose={close} /> */}
    </>
  );
}
