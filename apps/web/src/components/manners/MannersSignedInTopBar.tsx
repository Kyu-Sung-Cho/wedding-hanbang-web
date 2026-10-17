"use client";

import TopNav from "@/components/app/TopNav";
import { useAuthStore } from "@/stores/authStore";

/**
 * 로그인한 사람에게만 상단 바(제목·결혼식 D-day·알림)를 보인다(`MannersChrome`).
 *
 * 라운지와 같은 조밀한 머리를 쓴다. 이 변형은 모바일에서도 알림 종을 둔다(계획 화면 변형은
 * 모바일에서 종을 숨긴다).
 *
 * 목록 화면(`/manners`)에서는 본문 안의 자체 모바일 머리(`MannersMobileHeader`)가 같은 자리에서
 * 제목을 한 번 더 말하므로, 이 바가 있을 때 그쪽을 내리도록 표식을 남긴다. 글 화면의 머리는
 * 「목록으로」 되돌아가는 길이라 그대로 둔다.
 */
export default function MannersSignedInTopBar({ onMenuToggle }: { onMenuToggle: () => void }) {
  const signedIn = useAuthStore((state) => state.isInitialized && state.user !== null);
  if (!signedIn) return null;

  return (
    <>
      <span data-manners-app-chrome hidden />
      <TopNav loungeWorkspace onMenuToggle={onMenuToggle} />
    </>
  );
}
