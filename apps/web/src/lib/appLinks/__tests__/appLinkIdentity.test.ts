import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { GET as getAppleAppSiteAssociation } from "@/app/.well-known/apple-app-site-association/route";
import { GET as getAssetLinks } from "@/app/.well-known/assetlinks.json/route";
import {
  buildAndroidAssetLinks,
  buildAppleAppSiteAssociation,
  NATIVE_APP_ID,
  normalizeAppleTeamId,
  parseAndroidCertFingerprints,
} from "../appLinkIdentity";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../../../..");
const repoRoot = path.resolve(webRoot, "../..");

const TEAM_ID = "ABCDE12345";
const FINGERPRINT_A =
  "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99";
const FINGERPRINT_B =
  "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00";

afterEach(() => {
  delete process.env.APPLE_APP_SITE_ASSOCIATION_TEAM_ID;
  delete process.env.ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINTS;
});

describe("앱 식별자는 모바일 앱이 선언한 값과 같아야 한다", () => {
  it("번들 id·패키지명이 app.json과 어긋나지 않는다", () => {
    // 어긋나면 두 파일 다 문법은 멀쩡한데 OS 검증만 조용히 실패한다.
    const appJson = JSON.parse(
      readFileSync(path.join(repoRoot, "apps/mobile/app.json"), "utf8"),
    ) as { expo: { ios: { bundleIdentifier: string }; android: { package: string } } };

    expect(NATIVE_APP_ID).toBe(appJson.expo.ios.bundleIdentifier);
    expect(NATIVE_APP_ID).toBe(appJson.expo.android.package);
  });
});

describe("값이 없으면 파일을 내주지 않는다", () => {
  it("Team ID가 없으면 404다", async () => {
    // 빈 파일이나 가짜 값을 서빙하면 iOS는 검증 실패 뒤 한동안 재시도하지 않는다 —
    // 아무것도 없을 때보다 나쁘다.
    expect((await getAppleAppSiteAssociation()).status).toBe(404);

    process.env.APPLE_APP_SITE_ASSOCIATION_TEAM_ID = "not-a-team-id";
    expect((await getAppleAppSiteAssociation()).status).toBe(404);
  });

  it("지문이 없으면 404다", async () => {
    expect((await getAssetLinks()).status).toBe(404);

    process.env.ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINTS = "AA:BB";
    expect((await getAssetLinks()).status).toBe(404);
  });

  it("지문 하나만 깨져도 목록 전체를 거절한다", () => {
    // 반쯤 서빙하면 어느 기기에서 왜 안 열리는지 알 수 없게 된다.
    expect(parseAndroidCertFingerprints(`${FINGERPRINT_A}, AA:BB`)).toBeNull();
  });
});

describe("값이 있으면 올바른 JSON을 내준다", () => {
  it("apple-app-site-association", async () => {
    process.env.APPLE_APP_SITE_ASSOCIATION_TEAM_ID = ` ${TEAM_ID.toLowerCase()} `;
    const response = await getAppleAppSiteAssociation();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      applinks: {
        apps: [],
        details: [
          {
            appID: `${TEAM_ID}.${NATIVE_APP_ID}`,
            // 앱에 실물 화면이 있는 경로만 넘긴다(apps/mobile/app/invite.tsx).
            paths: ["/invite"],
          },
        ],
      },
    });
  });

  it("assetlinks.json", async () => {
    process.env.ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINTS = `${FINGERPRINT_A}\n${FINGERPRINT_B}`;
    const response = await getAssetLinks();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: NATIVE_APP_ID,
          sha256_cert_fingerprints: [FINGERPRINT_A, FINGERPRINT_B],
        },
      },
    ]);
  });

  it("Team ID 모양은 짐작해서 채우지 않는다", () => {
    expect(normalizeAppleTeamId("abcde12345")).toBe(TEAM_ID);
    expect(normalizeAppleTeamId("ABCDE1234")).toBeNull();
    expect(normalizeAppleTeamId(null)).toBeNull();
    expect(buildAppleAppSiteAssociation(TEAM_ID).applinks.apps).toEqual([]);
    expect(buildAndroidAssetLinks([FINGERPRINT_A])).toHaveLength(1);
  });
});

describe("두 경로는 리다이렉트·리라이트에 걸리지 않는다", () => {
  it("next.config가 `/.well-known`을 다른 곳으로 보내지 않는다", () => {
    const config = readFileSync(path.join(webRoot, "next.config.ts"), "utf8");
    expect(config).not.toContain(".well-known");
    // 루트 전체를 삼키는 catch-all이 생기면 이 두 파일이 조용히 사라진다.
    expect(config).not.toMatch(/source:\s*"\/:path\*"/u);
  });

  it("`/wedding/*` 리라이트 목록에도 없다", () => {
    const routes = readFileSync(path.join(webRoot, "weddingAppRoutes.ts"), "utf8");
    expect(routes).not.toContain("well-known");
  });

  it("환경변수 두 개가 .env.example에 설명과 함께 있다", () => {
    const envExample = readFileSync(path.join(webRoot, ".env.example"), "utf8");
    expect(envExample).toContain("APPLE_APP_SITE_ASSOCIATION_TEAM_ID=");
    expect(envExample).toContain("ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINTS=");
  });
});
