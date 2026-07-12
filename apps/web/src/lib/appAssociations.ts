import { MOBILE_APP_ASSOCIATION_PATHS } from "@hanbang/shared";

const IOS_BUNDLE_IDENTIFIER = "ai.hanbang.wedding";
const ANDROID_PACKAGE_NAME = "ai.hanbang.wedding";

const APPLE_TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/;
const COMPACT_SHA256_PATTERN = /^[0-9A-Fa-f]{64}$/;
const COLON_SHA256_PATTERN = /^(?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/;

const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
} as const;

type AssociationEnvironment = {
  readonly APPLE_TEAM_ID?: string;
  readonly PLAY_APP_SIGNING_SHA256?: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function unavailableResponse(): Response {
  return jsonResponse({ error: "association_configuration_unavailable" }, 503);
}

function looksLikeObviousPlaceholder(value: string): boolean {
  const compact = value.replaceAll(":", "").toUpperCase();
  return compact.includes("0123456789")
    || compact.includes("9876543210")
    || /^(.{1,20})\1+$/.test(compact);
}

function parseAppleTeamId(value: string | undefined): string | null {
  if (
    !value
    || value !== value.trim()
    || !APPLE_TEAM_ID_PATTERN.test(value)
    || new Set(value).size < 4
    || /(?:TEAM|APPLE|EXAMPLE|PLACEHOLDER)/.test(value)
    || looksLikeObviousPlaceholder(value)
  ) {
    return null;
  }

  return value;
}

function parsePlaySigningFingerprints(value: string | undefined): string[] | null {
  if (!value || value !== value.trim()) return null;

  const candidates = value.split(",");
  if (candidates.length === 0 || candidates.length > 4) return null;

  const fingerprints: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || candidate !== candidate.trim()) return null;
    const compact = candidate.replaceAll(":", "");
    if (
      !(COMPACT_SHA256_PATTERN.test(candidate) ||
        COLON_SHA256_PATTERN.test(candidate)) ||
      !COMPACT_SHA256_PATTERN.test(compact) ||
      new Set(compact.toUpperCase().match(/.{2}/g) ?? []).size < 8 ||
      looksLikeObviousPlaceholder(compact)
    ) {
      return null;
    }

    fingerprints.push(
      compact
        .toUpperCase()
        .match(/.{2}/g)!
        .join(":")
    );
  }

  return [...new Set(fingerprints)];
}

export function createAppleAppSiteAssociationResponse(
  environment: AssociationEnvironment = {
    APPLE_TEAM_ID: process.env.APPLE_TEAM_ID,
    PLAY_APP_SIGNING_SHA256: process.env.PLAY_APP_SIGNING_SHA256,
  }
): Response {
  const teamId = parseAppleTeamId(environment.APPLE_TEAM_ID);
  if (!teamId) return unavailableResponse();

  return jsonResponse({
    applinks: {
      apps: [],
      details: [
        {
          appID: `${teamId}.${IOS_BUNDLE_IDENTIFIER}`,
          paths: [...MOBILE_APP_ASSOCIATION_PATHS],
        },
      ],
    },
  });
}

export function createAssetLinksResponse(
  environment: AssociationEnvironment = {
    APPLE_TEAM_ID: process.env.APPLE_TEAM_ID,
    PLAY_APP_SIGNING_SHA256: process.env.PLAY_APP_SIGNING_SHA256,
  }
): Response {
  const fingerprints = parsePlaySigningFingerprints(
    environment.PLAY_APP_SIGNING_SHA256
  );
  if (!fingerprints) return unavailableResponse();

  return jsonResponse([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: ANDROID_PACKAGE_NAME,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ]);
}
