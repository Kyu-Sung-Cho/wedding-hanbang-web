import type { Metadata, Viewport } from "next";
import AnalyticsProvider from "@/components/analytics/AnalyticsProvider";
import UtmCapture from "@/components/analytics/UtmCapture";
import { BROWSER_STORAGE_FALLBACK_SNIPPET } from "@/lib/browserStorageFallback";
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
  title: "웨딩한방 — 결혼 준비를 함께 정리하는 아모라",
  description:
    "대화에서 확인한 조건을 바탕으로 견적 질문, 예산, 일정과 다음 할 일을 함께 정리하는 AI 도우미 아모라.",
  icons: {
    icon: "/images/favicon.png",
    apple: "/images/apple-touch-icon.png",
  },
  openGraph: {
    title: "웨딩한방 — 결혼 준비를 함께 정리하는 아모라",
    description:
      "견적 질문, 예산, 일정과 다음 할 일을 함께 정리하는 AI 도우미 아모라.",
    url: "https://hanbang.ai/wedding",
    siteName: "웨딩한방",
    locale: "ko_KR",
    type: "website",
    images: [
      {
        url: "/images/og-image.png",
        width: 1200,
        height: 630,
        alt: "웨딩한방 아모라",
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
        {/* 번들보다 먼저 실행돼야 한다. 저장소가 막힌 브라우저에서 Realtime 소켓
            생성자가 던지면 첫 화면이 통째로 에러가 되는데, 그 생성은 hydration
            직후에 일어난다. 정상 브라우저에서는 탐침만 하고 아무것도 바꾸지 않는다.
            자세한 근거는 `lib/browserStorageFallback.ts`. */}
        <script dangerouslySetInnerHTML={{ __html: BROWSER_STORAGE_FALLBACK_SNIPPET }} />
      </head>
      <body className="antialiased">
        <AnalyticsProvider />
        <UtmCapture />
        {children}
      </body>
    </html>
  );
}
