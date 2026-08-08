import type { Metadata } from "next";

// 공개 글의 작성 주체·경험 인증과 서버 렌더링 메타데이터가 검증되기 전에는
// 검색 결과에 UGC 상세를 노출하지 않는다. 링크 탐색은 허용해 서비스 자체는 발견된다.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: true,
  },
};

export default function CommunityPostDetailLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
