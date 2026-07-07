import type { Metadata } from "next";
import WeddingCodeResultClient from "./ResultClient";

// 웨딩코드 v0.5 결과 — noindex (robots.ts의 /wedding-code 프리픽스 disallow와 이중 방어)
export const metadata: Metadata = {
  title: "웨딩코드 결과 | 웨딩한방",
  robots: { index: false, follow: false },
};

export default function WeddingCodeResultPage() {
  return <WeddingCodeResultClient />;
}
