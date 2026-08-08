import { decodeWeddingCodeV06 } from "@/lib/weddingCode/v06/code";
import type { WeddingCodeV06Answers } from "@/lib/weddingCode/v06/gap";
import {
  resolveWeddingCodeSceneConfig,
  type WeddingCodeSceneVersion,
} from "@/lib/weddingCode/scene/config";

export type DecodedWeddingCodeShareLink = Readonly<{
  version: WeddingCodeSceneVersion;
  partnerAnswers: WeddingCodeV06Answers | null;
  partnerCode: string | null;
  bothCodes: {
    first: WeddingCodeV06Answers;
    second: WeddingCodeV06Answers;
  } | null;
}>;

function normalizedCode(value: string | null): string | null {
  const normalized = value?.trim().toUpperCase() ?? "";
  return normalized || null;
}

export function decodeWeddingCodeShareParams(
  params: Pick<URLSearchParams, "get">,
): DecodedWeddingCodeShareLink | null {
  const firstCode = normalizedCode(params.get("a"));
  const secondCode = normalizedCode(params.get("b"));
  const config = resolveWeddingCodeSceneConfig(
    params.get("v"),
    Boolean(firstCode || secondCode),
  );
  if (!config) return null;

  const first = decodeWeddingCodeV06(firstCode, config.questions);
  const second = decodeWeddingCodeV06(secondCode, config.questions);
  const bothCodes = first && second ? { first, second } : null;

  return {
    version: config.version,
    partnerAnswers: bothCodes ? null : first,
    partnerCode: first ? firstCode : null,
    bothCodes,
  };
}

export function decodeWeddingCodeShareHash(
  hash: string,
): DecodedWeddingCodeShareLink | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  return decodeWeddingCodeShareParams(new URLSearchParams(raw));
}

/**
 * Answers go after `#`, which browsers do not send in the HTTP request or referrer.
 * The recipient can still read them, so the UI must continue to treat the link as private.
 */
export function buildWeddingCodeShareUrl({
  origin,
  version,
  firstCode,
  secondCode,
}: {
  origin: string;
  version: WeddingCodeSceneVersion;
  firstCode: string;
  secondCode?: string | null;
}): string {
  const params = new URLSearchParams({
    v: version,
    a: firstCode.trim().toUpperCase(),
  });
  if (secondCode) params.set("b", secondCode.trim().toUpperCase());
  return `${origin.replace(/\/$/, "")}/wedding-code#${params.toString()}`;
}
