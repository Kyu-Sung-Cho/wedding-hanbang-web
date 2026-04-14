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
          "/dashboard",
          "/chat",
          "/budget",
          "/schedule",
          "/settings",
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
