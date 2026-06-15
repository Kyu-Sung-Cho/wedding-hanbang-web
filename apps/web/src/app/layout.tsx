import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Noto_Sans_KR, Noto_Serif_KR, Plus_Jakarta_Sans } from "next/font/google";
import AnalyticsProvider from "@/components/analytics/AnalyticsProvider";
import "./globals.css";

const notoSansKr = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-noto-sans-kr",
});

const notoSerifKr = Noto_Serif_KR({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-noto-serif-kr",
});

const cormorantGaramond = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "600"],
  style: ["normal", "italic"],
  variable: "--font-cormorant-garamond",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-plus-jakarta-sans",
});

const fontVariables = [
  notoSansKr.variable,
  notoSerifKr.variable,
  cormorantGaramond.variable,
  plusJakartaSans.variable,
].join(" ");

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
    <html lang="ko" data-scroll-behavior="smooth" className={fontVariables}>
      <body className="antialiased">
        <AnalyticsProvider />
        {children}
      </body>
    </html>
  );
}
