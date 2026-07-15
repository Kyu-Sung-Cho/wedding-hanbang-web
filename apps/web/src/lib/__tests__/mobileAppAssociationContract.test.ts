import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createMobileAppShareUrl,
  MOBILE_APP_ASSOCIATION_PATHS,
  MOBILE_APP_SHARE_ROUTE_CONTRACTS,
  rewriteMobileAppLink,
} from "@hanbang/shared";
import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import {
  createAppleAppSiteAssociationResponse,
  createAssetLinksResponse,
} from "@/lib/appAssociations";

const repoRoot = resolve(process.cwd(), "../..");
const readRepo = (path: string) =>
  readFileSync(resolve(repoRoot, path), "utf8");

const mobileConfig = JSON.parse(readRepo("apps/mobile/app.json")).expo as {
  ios?: { associatedDomains?: string[] };
  android?: {
    package?: string;
    intentFilters?: Array<{
      data?: Array<{
        scheme?: string;
        host?: string;
        path?: string;
        pathPrefix?: string;
      }>;
    }>;
  };
};

describe("mobile app association contract", () => {
  it("keeps Apple, Android, and Expo Router on the same /app namespace", async () => {
    expect(mobileConfig.ios?.associatedDomains).toContain("applinks:hanbang.ai");
    expect(mobileConfig.android?.package).toBe("ai.hanbang.wedding");
    const androidData = mobileConfig.android?.intentFilters?.flatMap(
      (filter) => filter.data ?? []
    );
    expect(androidData).toContainEqual({
      scheme: "https",
      host: "hanbang.ai",
      path: "/app",
    });
    for (const { source } of Object.values(MOBILE_APP_SHARE_ROUTE_CONTRACTS)) {
      expect(androidData).toContainEqual({
        scheme: "https",
        host: "hanbang.ai",
        pathPrefix: source.replace(":id", ""),
      });
    }
    expect(androidData).not.toContainEqual({
      scheme: "https",
      host: "hanbang.ai",
      pathPrefix: "/app/",
    });

    const aasa = (await createAppleAppSiteAssociationResponse({
      APPLE_TEAM_ID: "6RSK726532",
    }).json()) as { applinks: { details: Array<{ appID: string; paths: string[] }> } };
    expect(aasa.applinks.details).toEqual([
      {
        appID: "6RSK726532.ai.hanbang.wedding",
        paths: [...MOBILE_APP_ASSOCIATION_PATHS],
      },
    ]);

    const assetLinks = (await createAssetLinksResponse({
      PLAY_APP_SIGNING_SHA256:
        "85:25:B7:5F:66:FC:6A:85:0D:A7:57:A2:CA:D2:47:B9:F6:EB:C7:81:10:D3:2F:B7:2C:84:42:0D:AE:B6:40:0D",
    }).json()) as Array<{ target: { package_name: string } }>;
    expect(assetLinks[0]?.target.package_name).toBe(mobileConfig.android?.package);
  });

  it("rewrites canonical web app links to real Expo routes", () => {
    expect(rewriteMobileAppLink("https://hanbang.ai/app")).toBe("/");
    expect(rewriteMobileAppLink("https://hanbang.ai/app?source=invite#join")).toBe(
      "/?source=invite#join"
    );
    expect(
      rewriteMobileAppLink(
        "https://hanbang.ai/app/community/post/abc?source=share#comments"
      )
    ).toBe("/community/post/abc?source=share#comments");
    expect(rewriteMobileAppLink("https://hanbang.ai/app/vendors/vendor-123")).toBe("/");
    expect(rewriteMobileAppLink("/bookings?id=abc")).toBe("/bookings?id=abc");
    expect(rewriteMobileAppLink("hanbang:///settings")).toBe("hanbang:///settings");
  });

  it("creates canonical share URLs only for routes present in both apps", () => {
    expect(
      createMobileAppShareUrl({ kind: "communityPost", id: "post-123" })
    ).toBe("https://hanbang.ai/app/community/post/post-123");
    for (const id of ["", " post-123", "post/123", "post?draft=true"]) {
      expect(() =>
        createMobileAppShareUrl({ kind: "communityPost", id })
      ).toThrow("share route id");
    }

    for (const routeFile of [
      "apps/mobile/app/community/post/[id].tsx",
      "apps/web/src/app/(community)/community/post/[id]/page.tsx",
    ]) {
      expect(readRepo(routeFile).length).toBeGreaterThan(0);
    }
  });

  it("fails malformed, sibling, and foreign URLs closed to the app root", () => {
    for (const value of [
      "https://evil.example/app/settings",
      "https://hanbang.ai/application/settings",
      "https://hanbang.ai/app//evil.example",
      "//evil.example/settings",
      " https://hanbang.ai/app/settings",
      "https://hanbang.ai/app\\settings",
      "https://hanbang.ai/app/settings",
      "https://hanbang.ai/app/profile",
      "https://hanbang.ai/app/community/post/abc/extra",
      "https://hanbang.ai/app/vendors/vendor%2Fescape",
    ]) {
      expect(rewriteMobileAppLink(value)).toBe("/");
    }
  });

  it("wires each allowed share route to a non-404 web fallback before the catch-all", async () => {
    const nativeIntent = readRepo("apps/mobile/app/+native-intent.tsx");
    const redirects = await nextConfig.redirects?.();

    expect(nativeIntent).toContain("rewriteMobileAppLink(path)");
    expect(redirects).toEqual(
      expect.arrayContaining([
        ...Object.values(MOBILE_APP_SHARE_ROUTE_CONTRACTS).map(
          ({ source, destination }) => ({ source, destination, permanent: false })
        ),
        { source: "/app", destination: "/wedding", permanent: false },
        { source: "/app/:path*", destination: "/wedding", permanent: false },
      ])
    );

    const catchAllIndex = redirects?.findIndex(
      (redirect) => redirect.source === "/app/:path*"
    );
    expect(catchAllIndex).toBeGreaterThanOrEqual(0);
    for (const route of Object.values(MOBILE_APP_SHARE_ROUTE_CONTRACTS)) {
      expect(
        redirects?.findIndex((redirect) => redirect.source === route.source)
      ).toBeLessThan(catchAllIndex ?? -1);
    }
  });

  it("uses canonical app links in the selected consumer share buttons", () => {
    const postCard = readRepo("apps/web/src/components/community/PostCard.tsx");

    expect(postCard).toContain(
      'createMobileAppShareUrl({ kind: "communityPost", id: post.id })'
    );
  });
});
