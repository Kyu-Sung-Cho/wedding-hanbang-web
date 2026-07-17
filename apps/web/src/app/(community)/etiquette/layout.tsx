import type { Metadata } from "next";

// 클라이언트 페이지라 여기(서버 레이아웃)에서 메타데이터 제공 — 검색 결과·링크 미리보기용
export const metadata: Metadata = {
  title: "가족 조율 가이드 | 웨딩한방",
  description:
    "가족·지역·문화마다 다른 결혼 준비 방식을 존중하며, 두 사람이 편안하게 기준을 맞추는 원칙을 안내합니다.",
  alternates: { canonical: "/wedding/etiquette" },
  robots: { index: false, follow: false },
  openGraph: {
    title: "가족 조율 가이드",
    description: "가족·지역·문화마다 다른 준비 방식을 존중하며 두 사람의 기준을 정리해요.",
    url: "/wedding/etiquette",
    siteName: "웨딩한방",
    locale: "ko_KR",
    type: "website",
    images: [{ url: "/images/og-image.png", width: 1200, height: 630, alt: "웨딩한방 가족 조율 가이드" }],
  },
};

export default function EtiquetteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
