import type { Metadata } from "next";
import WeddingCodeClient from "./WeddingCodeClient";

// 미링크 웨딩코드 v0.5 — 직접 링크로만 접근. 검색 비노출(noindex + robots.ts disallow).
export const metadata: Metadata = {
  title: "웨딩코드 3분 테스트 | 웨딩한방",
  robots: { index: false, follow: false },
};

export default function WeddingCodePage() {
  return <WeddingCodeClient />;
}
