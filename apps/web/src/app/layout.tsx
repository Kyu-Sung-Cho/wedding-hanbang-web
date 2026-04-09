import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "웨딩한방 — AI가 이끄는 새로운 결혼 준비",
  description:
    "24시간 맞춤 상담, AI 드레스 가상 피팅, 스마트 예산 관리까지. 웨딩 플래너 없이도 완벽한 결혼 준비를 시작하세요.",
  icons: {
    icon: "/images/favicon.png",
    apple: "/images/apple-touch-icon.png",
  },
  openGraph: {
    title: "웨딩한방 — AI가 이끄는 새로운 결혼 준비",
    description:
      "24시간 맞춤 상담, AI 드레스 가상 피팅, 스마트 예산 관리까지.",
    url: "https://hanbang.ai",
    siteName: "웨딩한방",
    locale: "ko_KR",
    type: "website",
    images: [
      {
        url: "/images/og-image.png",
        width: 1200,
        height: 630,
        alt: "웨딩한방 - AI 웨딩 플래너",
      },
    ],
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=Noto+Serif+KR:wght@200;300;400;500;600&family=Noto+Sans+KR:wght@300;400;500;600;700&display=swap"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
