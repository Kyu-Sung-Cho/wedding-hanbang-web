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
          "/demo",
          "/vendor/dashboard",
          "/vendor/bookings",
          "/vendor/contracts",
          "/vendor/analytics",
          "/vendor/products",
          "/vendor/timeslots",
          "/vendor/settlements",
          "/vendor/staff",
          "/vendor/messages",
          "/vendor/settings",
          "/vendor/profile",
        ],
      },
    ],
    sitemap: "https://hanbang.ai/sitemap.xml",
  };
}
