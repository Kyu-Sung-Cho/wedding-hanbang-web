import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/admin",
          "/lounge",
          "/chat",
          "/budget",
          "/schedule",
          "/settings",
          "/wedding/lounge",
          "/wedding/chat",
          "/wedding/budget",
          "/wedding/schedule",
          "/wedding/settings",
          "/wedding/bookings",
          "/wedding/vendors",
          "/wedding/favorites",
          "/price/wishlist",
          "/demo",
          // 초대 링크. 페이지 메타에도 noindex가 있지만, 같은 저장소가 다른 비공개
          // 화면에는 두 겹을 쓴다 — 여기만 한 겹일 이유가 없다.
          "/invite",
          // 예시 커플 화면. 업체 이름과 가격이 예시라 검색에 뜨면 실제 정보처럼 읽힌다.
          // 페이지 메타의 noindex 와 두 겹이다.
          "/example",
        ],
      },
    ],
    sitemap: "https://hanbang.ai/sitemap.xml",
  };
}
