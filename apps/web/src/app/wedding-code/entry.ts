import { WEDDING_CODE_V20_VERSION, type WeddingCodeV20Answers } from "@/constants/weddingCodeV20";
import { resolveWeddingCodeSceneConfig, type WeddingCodeSceneVersion } from "@/lib/weddingCode/scene/config";
import { decodeWeddingCodeV06 } from "@/lib/weddingCode/v06/code";
import type { WeddingCodeV06Answers } from "@/lib/weddingCode/v06/gap";
import { decodeWeddingCodeV20, encodeWeddingCodeV20 } from "@/lib/weddingCode/v20";
import { encodeWeddingCodeV06 } from "@/lib/weddingCode/v06/code";

export type WeddingCodeEntrySearchParams = Record<string, string | string[] | undefined>;

export type WeddingCodeV20EntryInitial = Readonly<{
  partnerAnswers: WeddingCodeV20Answers | null;
  partnerCode: string | null;
  bothAnswers: { first: WeddingCodeV20Answers; second: WeddingCodeV20Answers; firstCode?: string } | null;
}>;

export type WeddingCodeLegacyEntryInitial = Readonly<{
  version: WeddingCodeSceneVersion;
  partnerAnswers: WeddingCodeV06Answers | null;
  partnerCode: string | null;
  bothCodes: { first: WeddingCodeV06Answers; second: WeddingCodeV06Answers } | null;
}>;

export type WeddingCodeEntry =
  | Readonly<{ kind: "v20"; initial: WeddingCodeV20EntryInitial }>
  | Readonly<{ kind: "legacy"; initial: WeddingCodeLegacyEntryInitial }>
  | Readonly<{ kind: "error" }>;

const ERROR: WeddingCodeEntry = { kind: "error" };
const SHARE_KEYS = ["v", "a", "b"] as const;

export const EMPTY_WEDDING_CODE_ENTRY: WeddingCodeEntry = {
  kind: "v20",
  initial: { partnerAnswers: null, partnerCode: null, bothAnswers: null },
};

function parseParams(params: URLSearchParams, source: "query" | "hash"): WeddingCodeEntry {
  for (const key of SHARE_KEYS) {
    if (params.getAll(key).length > 1) return ERROR;
  }
  if (source === "hash") {
    for (const key of params.keys()) {
      if (!SHARE_KEYS.some(allowed => key === allowed)) return ERROR;
    }
    if (!params.has("a")) return ERROR;
  }
  const version = params.get("v");
  // 빈 버전도 명시된 잘못된 값이다. 버전이 아예 없던 초기 공유 링크와 구분한다.
  if (version !== null && (!version || version !== version.trim())) return ERROR;
  const hasAnswers = params.has("a") || params.has("b");
  if (hasAnswers && !params.has("a")) return ERROR;

  if (!hasAnswers && (version === null || version === WEDDING_CODE_V20_VERSION)) return EMPTY_WEDDING_CODE_ENTRY;
  if (version === WEDDING_CODE_V20_VERSION) {
    const firstCode = params.get("a");
    const first = decodeWeddingCodeV20(firstCode);
    const second = params.has("b") ? decodeWeddingCodeV20(params.get("b")) : null;
    if (!first || !firstCode || (params.has("b") && !second)) return ERROR;
    return {
      kind: "v20",
      initial: {
        partnerAnswers: second ? null : first,
        partnerCode: firstCode,
        bothAnswers: second ? { first, second, firstCode } : null,
      },
    };
  }
  const config = resolveWeddingCodeSceneConfig(version, hasAnswers);
  if (!config) return ERROR;
  if (!hasAnswers) {
    return { kind: "legacy", initial: { version: config.version, partnerAnswers: null, partnerCode: null, bothCodes: null } };
  }
  const first = decodeWeddingCodeV06(params.get("a"), config.questions);
  const second = params.has("b") ? decodeWeddingCodeV06(params.get("b"), config.questions) : null;
  if (!first || (params.has("b") && !second)) return ERROR;
  return {
    kind: "legacy",
    initial: {
      version: config.version,
      partnerAnswers: second ? null : first,
      partnerCode: encodeWeddingCodeV06(first, config.questions),
      bothCodes: second ? { first, second } : null,
    },
  };
}

export function parseWeddingCodeEntryQuery(search: WeddingCodeEntrySearchParams | URLSearchParams): WeddingCodeEntry {
  if (search instanceof URLSearchParams) return parseParams(search, "query");
  const params = new URLSearchParams();
  for (const key of SHARE_KEYS) {
    const value = search[key];
    if (Array.isArray(value)) return ERROR;
    if (value !== undefined) params.set(key, value);
  }
  return parseParams(params, "query");
}

export function parseWeddingCodeEntryHash(hash: string): WeddingCodeEntry | null {
  if (!hash || hash === "#") return null;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw.length > 1024) return ERROR;
  return parseParams(new URLSearchParams(raw), "hash");
}

export function weddingCodeEntryHash(entry: WeddingCodeEntry): string | null {
  if (entry.kind === "error" || !entry.initial.partnerCode) return null;
  const version = entry.kind === "v20" ? WEDDING_CODE_V20_VERSION : entry.initial.version;
  const params = new URLSearchParams({ v: version, a: entry.initial.partnerCode });
  if (entry.kind === "v20" && entry.initial.bothAnswers) {
    params.set("b", encodeWeddingCodeV20(entry.initial.bothAnswers.second));
  } else if (entry.kind === "legacy" && entry.initial.bothCodes) {
    const config = resolveWeddingCodeSceneConfig(entry.initial.version, true);
    if (!config) return null;
    params.set("b", encodeWeddingCodeV06(entry.initial.bothCodes.second, config.questions));
  }
  return `#${params.toString()}`;
}

/** 두 번째 답만 바뀌어도 기존 client의 응답 state를 재사용하지 않는다. */
export function weddingCodeEntryKey(entry: WeddingCodeEntry): string {
  if (entry.kind === "error") return "error";
  return weddingCodeEntryHash(entry) ?? (entry.kind === "v20" ? "v20:clean" : `${entry.initial.version}:clean`);
}
