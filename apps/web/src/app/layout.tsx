import type { Metadata, Viewport } from "next";
import AnalyticsProvider from "@/components/analytics/AnalyticsProvider";
import UtmCapture from "@/components/analytics/UtmCapture";
import LoadFailureNoticeCleaner from "@/components/common/LoadFailureNoticeCleaner";
import {
  BROWSER_STORAGE_FALLBACK_SNIPPET,
  LATE_RELOAD_HINT_CSS,
  LOAD_FAILURE_NOTICE_SNIPPET,
} from "@/lib/browserStorageFallback";
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
      <head>
        <link
          rel="preload"
          href="/fonts/pretendard/PretendardVariable.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {/* 화면 조각(/_next/static/ 의 스크립트) 하나가 못 내려오면 하이드레이션이 안 돼 시작 단추가 영영 꺼져 있다. 리액트 코드는 그때 못 도우므로
            번들보다 먼저 도는 이 스크립트가 capture 단계에서 로딩 실패를 듣고 새로고침 안내를 띄운다. 근거는 `lib/browserStorageFallback.ts`. */}
        <script dangerouslySetInnerHTML={{ __html: LOAD_FAILURE_NOTICE_SNIPPET }} />
        {/* 서버 HTML 의 "확인 중" 구간(`LoadStallHint`)이 12초 뒤에 새로고침 한 줄을 보이게 하는 규칙. */}
        <style dangerouslySetInnerHTML={{ __html: LATE_RELOAD_HINT_CSS }} />
        {/* 번들보다 먼저 실행돼야 한다. 저장소가 막힌 브라우저에서 Realtime 소켓
            생성자가 던지면 첫 화면이 통째로 에러가 되는데, 그 생성은 hydration
            직후에 일어난다. 정상 브라우저에서는 탐침만 하고 아무것도 바꾸지 않는다.
            자세한 근거는 `lib/browserStorageFallback.ts`. */}
        <script dangerouslySetInnerHTML={{ __html: BROWSER_STORAGE_FALLBACK_SNIPPET }} />
      </head>
      <body className="antialiased">
        <AnalyticsProvider />
        <UtmCapture />
        {/* 서버 HTML 의 "확인 중" 구간이 사라지면(화면 본문이 하이드레이션되면) 위 head 스크립트가 띄운 "화면을 불러오지 못했어요" 막대를 걷고 이후로는 띄우지 않게 한다.
            이 컴포넌트가 마운트됐다는 것만으로는 걷지 않는다. 그 구간이 없는 화면에서는 막대를 그대로 둔다. */}
        <LoadFailureNoticeCleaner />
        {children}
      </body>
    </html>
  );
}
