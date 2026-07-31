import type { Metadata } from "next";

import StartHereClient from "@/components/community/StartHereClient";

// 견적서가 없는 사람에게도 첫 행동을 주는 공개 표면.
// 로그인 게이트 뒤에 있던 D-day 체크리스트를 앞으로 꺼낸 것이고, 아무것도 저장하지 않는다.
export const metadata: Metadata = {
  title: "결혼 준비 지금 뭐부터? — 결혼식 날짜로 보는 이번 순서",
  description:
    "결혼식 날짜만 넣으면 지금 확인할 준비 항목과 첫걸음을 정리해 드려요. 로그인 없이 사용할 수 있고, 입력한 날짜는 저장하지 않습니다.",
  alternates: { canonical: "/start-here" },
  openGraph: {
    title: "결혼 준비 지금 뭐부터? — 결혼식 날짜로 보는 이번 순서",
    description: "결혼식 날짜만 넣으면 지금 확인할 일 세 가지를 정리해 드려요.",
    url: "/start-here",
    type: "website",
  },
};

export default function StartHerePage() {
  return (
    <main className="min-h-screen bg-[#FBF8F2]">
      <StartHereClient />
    </main>
  );
}
