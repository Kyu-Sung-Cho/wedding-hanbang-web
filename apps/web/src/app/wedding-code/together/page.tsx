import type { Metadata } from "next";
import WeddingCodeTogether from "./WeddingCodeTogether";

export const metadata: Metadata = {
  title: "두 사람의 웨딩코드 | 웨딩한방",
  description: "각자 답한 결혼식 취향과 준비 방식을 함께 살펴봐요.",
  robots: { index: false, follow: false }, referrer: "no-referrer",
};
export default function WeddingCodeTogetherPage() { return <WeddingCodeTogether />; }
