import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Gowun_Batang, Noto_Sans_KR } from "next/font/google";
import AnalyticsProvider from "@/components/analytics/AnalyticsProvider";
import UtmCapture from "@/components/analytics/UtmCapture";
import { BROWSER_STORAGE_FALLBACK_SNIPPET } from "@/lib/browserStorageFallback";
import "./globals.css";

// 청첩장 디자인(2026-11-17)의 글꼴 셋. 파운더가 만든 디자인 아티팩트가 정한 조합이다:
// 고운바탕(한글 제목·이름·편지) + Cormorant Garamond(숫자·날짜·로고) + Noto Sans KR(본문).
// next/font 가 빌드 때 받아 같은 주소에서 내주므로 CSP(font-src 'self')를 바꾸지 않는다.
// 한글 글자는 unicode-range 조각으로 필요한 만큼만 받는다. 미리 받기는 라틴 조각만 한다.
const invitationSerif = Gowun_Batang({
  weight: ["400", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-invitation-serif",
});
const invitationNumeral = Cormorant_Garamond({
  weight: ["400", "500"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-invitation-numeral",
});
const invitationSans = Noto_Sans_KR({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-invitation-sans",
});

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
    <html
      lang="ko"
      data-scroll-behavior="smooth"
      className={`${invitationSerif.variable} ${invitationNumeral.variable} ${invitationSans.variable}`}
    >
      <head>
        <link
          rel="preload"
          href="/fonts/pretendard/PretendardVariable.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
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
