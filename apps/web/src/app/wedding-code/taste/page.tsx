import type { Metadata } from "next";
import WeddingTasteClient from "./WeddingTasteClient";

export const metadata: Metadata = {
  title: "내가 원하는 결혼식 | 웨딩코드 · 웨딩한방",
  description: "중요하게 이야기할 주제, 원하는 분위기, 피하고 싶은 것과 함께 맞춰볼 범위를 직접 골라보세요.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function WeddingTastePage() {
  return <WeddingTasteClient />;
}
