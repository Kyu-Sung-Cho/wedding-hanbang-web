import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "웨딩한방 — AI가 이끄는 새로운 결혼 준비",
  description:
    "24시간 맞춤 상담, AI 드레스 가상 피팅, 스마트 예산 관리까지. 웨딩 플래너 없이도 완벽한 결혼 준비를 시작하세요.",
  openGraph: {
    title: "웨딩한방 — AI가 이끄는 새로운 결혼 준비",
    description:
      "24시간 맞춤 상담, AI 드레스 가상 피팅, 스마트 예산 관리까지.",
    url: "https://hanbang.ai",
    siteName: "웨딩한방",
    locale: "ko_KR",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
