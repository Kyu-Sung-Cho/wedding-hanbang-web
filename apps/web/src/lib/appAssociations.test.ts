import { afterEach, describe, expect, it } from "vitest";
import { MOBILE_APP_ASSOCIATION_PATHS } from "@hanbang/shared";
import { GET as getRootAasa } from "@/app/apple-app-site-association/route";
import { GET as getWellKnownAasa } from "@/app/.well-known/apple-app-site-association/route";
import { GET as getAssetLinks } from "@/app/.well-known/assetlinks.json/route";
import {
  createAppleAppSiteAssociationResponse,
  createAssetLinksResponse,
} from "@/lib/appAssociations";

const ORIGINAL_APPLE_TEAM_ID = process.env.APPLE_TEAM_ID;
const ORIGINAL_PLAY_APP_SIGNING_SHA256 =
  process.env.PLAY_APP_SIGNING_SHA256;

const TEAM_ID = "6RSK726532";
const COMPACT_FINGERPRINT =
  "8525b75f66fc6a850da757a2cad247b9f6ebc78110d32fb72c84420daeb6400d";
const CANONICAL_FINGERPRINT =
  "85:25:B7:5F:66:FC:6A:85:0D:A7:57:A2:CA:D2:47:B9:F6:EB:C7:81:10:D3:2F:B7:2C:84:42:0D:AE:B6:40:0D";

function restoreEnvironment(
  name: "APPLE_TEAM_ID" | "PLAY_APP_SIGNING_SHA256",
  value: string | undefined
) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restoreEnvironment("APPLE_TEAM_ID", ORIGINAL_APPLE_TEAM_ID);
  restoreEnvironment(
    "PLAY_APP_SIGNING_SHA256",
    ORIGINAL_PLAY_APP_SIGNING_SHA256
  );
});

async function expectUnavailable(response: Response, secret?: string) {
  expect(response.status).toBe(503);
  expect(response.headers.get("Content-Type")).toBe("application/json");
  expect(response.headers.get("Cache-Control")).toBe("no-store");

  const body = await response.text();
  expect(body).toBe('{"error":"association_configuration_unavailable"}');
  if (secret) expect(body).not.toContain(secret);
}

describe("app association responses", () => {
  it("serves an AASA document for the fixed bundle and app paths", async () => {
    const response = createAppleAppSiteAssociationResponse({
      APPLE_TEAM_ID: TEAM_ID,
      PLAY_APP_SIGNING_SHA256: undefined,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      applinks: {
        apps: [],
        details: [
          {
            appID: "6RSK726532.ai.hanbang.wedding",
            paths: [...MOBILE_APP_ASSOCIATION_PATHS],
          },
        ],
      },
    });
  });

  it.each([
    undefined,
    "",
    "6RSK72653",
    "6rsk726532",
    ` ${TEAM_ID}`,
    "AAAAAAAAAA",
    "0000000000",
    "0123456789",
    "TEAMID1234",
  ])(
    "fails AASA closed for an invalid team ID: %s",
    async (teamId) => {
      await expectUnavailable(
        createAppleAppSiteAssociationResponse({
          APPLE_TEAM_ID: teamId,
          PLAY_APP_SIGNING_SHA256: undefined,
        }),
        teamId
      );
    }
  );

  it("serves canonical assetlinks for a valid SHA-256 fingerprint", async () => {
    const response = createAssetLinksResponse({
      APPLE_TEAM_ID: undefined,
      PLAY_APP_SIGNING_SHA256: COMPACT_FINGERPRINT,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "ai.hanbang.wedding",
          sha256_cert_fingerprints: [CANONICAL_FINGERPRINT],
        },
      },
    ]);
  });

  it("supports a bounded Play App Signing key-upgrade overlap", async () => {
    const replacement =
      "82:D8:12:C3:E7:E3:A7:2E:3E:2C:66:AF:B2:CA:50:56:C1:D5:1F:9C:A5:79:92:61:74:DE:7E:DC:33:8C:A5:BD";
    const response = createAssetLinksResponse({
      APPLE_TEAM_ID: undefined,
      PLAY_APP_SIGNING_SHA256: `${COMPACT_FINGERPRINT},${replacement}`,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([
      {
        target: {
          sha256_cert_fingerprints: [CANONICAL_FINGERPRINT, replacement],
        },
      },
    ]);
  });

  it.each([
    undefined,
    "",
    "01:23:45",
    `${COMPACT_FINGERPRINT}00`,
    ` ${CANONICAL_FINGERPRINT}`,
    CANONICAL_FINGERPRINT.replace(":", "-"),
    `${COMPACT_FINGERPRINT}, ${COMPACT_FINGERPRINT}`,
    "00".repeat(32),
    "AB".repeat(32),
    "0123456789abcdef".repeat(4),
  ])("fails assetlinks closed for an invalid fingerprint: %s", async (fingerprint) => {
    await expectUnavailable(
      createAssetLinksResponse({
        APPLE_TEAM_ID: undefined,
        PLAY_APP_SIGNING_SHA256: fingerprint,
      }),
      fingerprint
    );
  });

  it("keeps root and well-known AASA routes byte-for-byte identical", async () => {
    process.env.APPLE_TEAM_ID = TEAM_ID;

    const rootResponse = getRootAasa();
    const wellKnownResponse = getWellKnownAasa();

    expect(rootResponse.status).toBe(200);
    expect(wellKnownResponse.status).toBe(200);
    expect([...rootResponse.headers.entries()]).toEqual([
      ...wellKnownResponse.headers.entries(),
    ]);
    expect(await rootResponse.text()).toBe(await wellKnownResponse.text());
  });

  it("wires the assetlinks route to the validated server environment", async () => {
    process.env.PLAY_APP_SIGNING_SHA256 = CANONICAL_FINGERPRINT;

    const response = getAssetLinks();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([
      {
        target: {
          package_name: "ai.hanbang.wedding",
          sha256_cert_fingerprints: [CANONICAL_FINGERPRINT],
        },
      },
    ]);
  });
});
