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
  // 정상 두 사람 코드보다 충분히 넉넉하게 두되, 파싱 전 입력 크기를 제한한다.
  if (!raw || raw.length > 1024) return null;
  const params = new URLSearchParams(raw);
  const allowedKeys = new Set(["v", "a", "b"]);
  for (const key of params.keys()) {
    if (!allowedKeys.has(key) || params.getAll(key).length !== 1) return null;
  }
  if (!params.has("a")) return null;

  const decoded = decodeWeddingCodeShareParams(params);
  if (!decoded?.partnerCode) return null;
  // 두 사람 링크에서 한 코드가 깨졌다고 다른 사람 답만 유효한 링크로 바꾸지 않는다.
  if (params.has("b") && !decoded.bothCodes) return null;
  return decoded;
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
