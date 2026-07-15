import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  if (process.env.NEXT_PUBLIC_LAUNCH_MODE !== "full") {
    return {
      rules: [
        {
          userAgent: "*",
          allow: [
            "/demo",
            "/beta",
            "/about",
            "/privacy",
            "/terms",
            "/ai-policy",
            "/support",
          ],
          disallow: ["/", "/beta/verify"],
        },
      ],
    };
  }

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
          "/wedding-code",
          "/beta/verify",
        ],
      },
    ],
    sitemap: "https://hanbang.ai/sitemap.xml",
  };
}
