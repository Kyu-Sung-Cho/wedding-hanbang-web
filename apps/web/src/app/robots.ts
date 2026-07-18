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
          "/wedding-code",
        ],
      },
    ],
    sitemap: "https://hanbang.ai/sitemap.xml",
  };
}
