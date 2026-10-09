import type { Metadata } from "next";
import WeddingCodeNextClient from "@/components/weddingCodeNext/WeddingCodeNextClient";

export const metadata: Metadata = {
  title: "웨딩코드 새 개편본 | 웨딩한방",
  description: "내 답의 근거로 결혼 준비 기준을 확인하고 두 사람의 다음 대화를 준비하는 새 개편본입니다.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function WeddingCodeNextPage() {
  return <WeddingCodeNextClient />;
}
