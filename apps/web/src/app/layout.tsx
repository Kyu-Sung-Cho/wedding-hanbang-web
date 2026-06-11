import type { Metadata, Viewport } from "next";
import AnalyticsProvider from "@/components/analytics/AnalyticsProvider";
import "./globals.css";

// 모든 기기에서 일관된 viewport — iPhone notch (viewport-fit=cover) 대응 +
// 사용자 줌 허용 (maximumScale 미지정 — 접근성).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fcf9f8",
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://hanbang.ai"),
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
    url: "https://hanbang.ai/wedding",
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
    <html lang="ko" data-scroll-behavior="smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,400&family=Noto+Serif+KR:wght@300;400;500;600&family=Noto+Sans+KR:wght@300;400;500;600&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap"
        />
      </head>
      <body className="antialiased">
        <AnalyticsProvider />
        {children}
      </body>
    </html>
  );
}
