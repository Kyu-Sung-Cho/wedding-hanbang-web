import type { Metadata } from "next";

// 클라이언트 페이지라 여기(서버 레이아웃)에서 메타데이터 제공 — 검색 결과·링크 미리보기용
export const metadata: Metadata = {
  title: "스드메 추가비용 확인 체크리스트 — 계약 전 질문 | 웨딩한방",
  description:
    "견적서의 원본 데이터·헬퍼·피팅 등 포함 범위를 직접 표시하고, 계약 전 업체에 물어볼 질문을 정리합니다. 항목별 가격이나 발생 가능성을 판정하지 않습니다.",
  alternates: { canonical: "/wedding/community/quote-check" },
  openGraph: {
    title: "스드메 추가비용 확인 체크리스트 — 계약 전 질문",
    description: "견적 포함 범위를 직접 표시하고 계약 전 질문을 정리하세요.",
    url: "/wedding/community/quote-check",
    siteName: "웨딩한방",
    locale: "ko_KR",
    type: "article",
    images: [{ url: "/images/og-image.png", width: 1200, height: 630, alt: "웨딩한방 견적 체크리스트" }],
  },
};

export default function QuoteCheckLayout({ children }: { children: React.ReactNode }) {
  return children;
}
