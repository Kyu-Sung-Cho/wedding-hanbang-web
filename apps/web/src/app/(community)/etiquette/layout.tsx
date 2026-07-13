import type { Metadata } from "next";

// 클라이언트 페이지라 여기(서버 레이아웃)에서 메타데이터 제공 — 검색 결과·링크 미리보기용
export const metadata: Metadata = {
  title: "결혼 관습 선택 가이드 — 첫 만남부터 행정 확인까지 | 웨딩한방",
  description:
    "가족 형태와 개인의 경계를 존중하며 첫 만남, 초대, 본식, 축의금, 혼인신고와 비용 대화를 살펴보는 25개 참고 가이드입니다.",
  alternates: { canonical: "/wedding/etiquette" },
  openGraph: {
    title: "결혼 관습 선택 가이드 — 첫 만남부터 행정 확인까지",
    description: "관습은 선택으로, 법·세금·행정은 최신 공식 안내로 확인하는 결혼 준비 참고 가이드입니다.",
    url: "/wedding/etiquette",
    siteName: "웨딩한방",
    locale: "ko_KR",
    type: "article",
    images: [{ url: "/images/og-image.png", width: 1200, height: 630, alt: "웨딩한방 결혼 관습 선택 가이드" }],
  },
};

export default function EtiquetteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
