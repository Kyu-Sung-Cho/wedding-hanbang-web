import type { Metadata, Viewport } from "next";
import AnalyticsProvider from "@/components/analytics/AnalyticsProvider";
import UtmCapture from "@/components/analytics/UtmCapture";
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
  title: "웨딩한방 — 결혼 준비를 아모라와 정리하세요",
  description:
    "아모라에게 결혼 준비를 말하면 예산·체크리스트·일정이 함께 정리됩니다. 실제 경험이 필요할 때는 예비부부 커뮤니티에서 찾아보고 질문하세요.",
  icons: {
    icon: "/images/favicon.png",
    apple: "/images/apple-touch-icon.png",
  },
  openGraph: {
    title: "웨딩한방 — 결혼 준비를 아모라와 정리하세요",
    description:
      "아모라에게 결혼 준비를 말하면 예산·체크리스트·일정이 함께 정리됩니다.",
    url: "https://hanbang.ai/landing",
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
      <body className="antialiased">
        <AnalyticsProvider />
        <UtmCapture />
        {children}
      </body>
    </html>
  );
}
