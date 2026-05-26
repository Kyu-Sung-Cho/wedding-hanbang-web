import { Suspense } from "react";
import CommunityLandingClient from "@/components/community/CommunityLandingClient";

export const metadata = {
  title: "웨딩한방 커뮤니티 — 경험을 나누고 더 완벽한 결혼을 준비해요",
  description:
    "실제 후기, 견적 정보, 예산 팁, 동기부여 커뮤니티를 한 곳에서 확인하는 웨딩한방 커뮤니티.",
};

// 메인 페이지 = 커뮤니티. 마케팅 랜딩은 /landing으로 보존.
export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#fffdf7]" />}>
      <CommunityLandingClient />
    </Suspense>
  );
}
