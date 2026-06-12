import type { Metadata } from "next";

// 클라이언트 페이지라 여기(서버 레이아웃)에서 메타데이터 제공 — 검색 결과·링크 미리보기용
export const metadata: Metadata = {
  title: "결혼 예절 가이드 — 상견례부터 본식까지 | 웨딩한방",
  description:
    "상견례 준비, 양가 인사, 함·폐백, 축의금 예절까지. 결혼 준비 단계별 예절을 26개 챕터로 정리한 무료 가이드입니다.",
  alternates: { canonical: "/wedding/etiquette" },
  openGraph: {
    title: "결혼 예절 가이드 — 상견례부터 본식까지",
    description: "결혼 준비 단계별 예절 26개 챕터, 무료 공개.",
    url: "/wedding/etiquette",
  },
};

export default function EtiquetteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
