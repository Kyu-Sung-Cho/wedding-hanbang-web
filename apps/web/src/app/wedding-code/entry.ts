import { WEDDING_CODE_V20_VERSION, type WeddingCodeV20Answers } from "@/constants/weddingCodeV20";
import { WEDDING_CODE_V30_VERSION, type V30Draft } from "@/constants/weddingCodeV30";
import { WEDDING_CODE_V31_VERSION, type V31Draft } from "@/constants/weddingCodeV31";
import { WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { resolveWeddingCodeSceneConfig, type WeddingCodeSceneVersion } from "@/lib/weddingCode/scene/config";
import { decodeWeddingCodeV06 } from "@/lib/weddingCode/v06/code";
import type { WeddingCodeV06Answers } from "@/lib/weddingCode/v06/gap";
import { decodeWeddingCodeV20, encodeWeddingCodeV20 } from "@/lib/weddingCode/v20";
import { encodeWeddingCodeV06 } from "@/lib/weddingCode/v06/code";
import { decodeV30, encodeV30 } from "@/lib/weddingCode/v30";
import { decodeV31, encodeV31 } from "@/lib/weddingCode/v31";
import { decodeShareParams, encodeCode } from "@/lib/weddingCode/v40/codec";
import { V40_LAYOUT } from "@/lib/weddingCode/v40/layout";
import type { CodecBankView, V40EntryInitial } from "@/lib/weddingCode/v40/types";

export type WeddingCodeEntrySearchParams = Record<string, string | string[] | undefined>;

/**
 * 새 방문자가 맨 주소(`/wedding-code`)에서 만나는 판. 기본은 v3.1 이다.
 * v4.0-tendency 는 `?v=v4.0-tendency`(답 없음)와 `#v=v4.0-tendency&a=…[&b=…]` 로만 열리고, 기본을 v4 로 바꾸는 것은
 * 문항 검수와 인지면접을 통과한 뒤 이 상수 하나를 고치는 별도 PR 이다(계약 문서 13절).
 */
export type WeddingCodeDefaultVersion = typeof WEDDING_CODE_V31_VERSION | typeof WEDDING_CODE_V40_VERSION;
export const WEDDING_CODE_DEFAULT_VERSION: WeddingCodeDefaultVersion = WEDDING_CODE_V31_VERSION;

/** 파서와 되돌리기 도우미가 기본 판을 바꿔 시험할 수 있게 하는 선택 인자. 생략하면 WEDDING_CODE_DEFAULT_VERSION. */
export type WeddingCodeEntryOptions = Readonly<{ defaultVersion?: WeddingCodeDefaultVersion }>;

export type WeddingCodeV31EntryInitial = Readonly<{
  partnerDraft: V31Draft | null;
  partnerCode: string | null;
  bothDrafts: { first: V31Draft; second: V31Draft } | null;
}>;

export type WeddingCodeV30EntryInitial = Readonly<{
  partnerDraft: V30Draft | null;
  partnerCode: string | null;
  bothDrafts: { first: V30Draft; second: V30Draft } | null;
}>;

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

/**
 * - v40: 웨딩코드 4.0. initial 이 비어 있으면 시작 화면, partner 가 있으면 받는 사람 화면, both 가 있으면 두 사람 결과.
 * - v31 의 older: 기본 진입이 v4 인 동안 `?v=v3.1-preferences`(답 없음)로 연 이전 판 시작 화면. 기본이 v3.1 이면 붙지 않는다.
 * - error 의 version: 읽을 수 없는 v4 링크(오류 화면이 v4 문구를 쓴다). 그 밖의 오류에는 붙지 않는다.
 */
export type WeddingCodeEntry =
  | Readonly<{ kind: "v40"; initial: V40EntryInitial }>
  | Readonly<{ kind: "v31"; initial: WeddingCodeV31EntryInitial; older?: true }>
  | Readonly<{ kind: "v30"; initial: WeddingCodeV30EntryInitial }>
  | Readonly<{ kind: "v20"; initial: WeddingCodeV20EntryInitial }>
  | Readonly<{ kind: "legacy"; initial: WeddingCodeLegacyEntryInitial }>
  | Readonly<{ kind: "error"; version?: typeof WEDDING_CODE_V40_VERSION }>;

const ERROR: WeddingCodeEntry = { kind: "error" };
const V40_ERROR: WeddingCodeEntry = { kind: "error", version: WEDDING_CODE_V40_VERSION };
const SHARE_KEYS = ["v", "a", "b"] as const;

/** v3.1 의 답 없는 시작 입구. 이름은 예전 그대로다(기본 판이 무엇이든 이 값은 v3.1 이다). */
export const EMPTY_WEDDING_CODE_ENTRY: WeddingCodeEntry = {
  kind: "v31",
  initial: { partnerDraft: null, partnerCode: null, bothDrafts: null },
};

/** v4 의 답 없는 시작 입구(`?v=v4.0-tendency`). */
export const EMPTY_V40_ENTRY: WeddingCodeEntry = {
  kind: "v40",
  initial: { partner: null, both: null },
};

/** 기본 진입이 v4 인 동안 명시 `?v=v3.1-preferences` 로 연 v3.1 시작 입구(이전 판 안내가 붙는다). */
export const OLDER_V31_ENTRY: WeddingCodeEntry = {
  kind: "v31",
  initial: { partnerDraft: null, partnerCode: null, bothDrafts: null },
  older: true,
};

/**
 * v4 링크 코드를 풀 때 쓰는 문항 목록.
 * decodeCode, encodeCode 는 문항의 id 와 형식만 읽는다. 문구가 든 문항 은행(bank.ts)을 가져오면 v4 문구 전체가 v3.1 길로 들어오므로
 * 배치 골격(layout.ts)의 id, 형식 목록으로 대신한다. 은행과 같은 결과를 내는지는 entry.v40.test.ts 가 고정한다.
 */
const V40_LINK_BANK: CodecBankView = { items: V40_LAYOUT };

/** 기본 판의 답 없는 시작 입구. */
export function defaultWeddingCodeEntry(defaultVersion: WeddingCodeDefaultVersion = WEDDING_CODE_DEFAULT_VERSION): WeddingCodeEntry {
  return defaultVersion === WEDDING_CODE_V40_VERSION ? EMPTY_V40_ENTRY : EMPTY_WEDDING_CODE_ENTRY;
}

/** 기본 진입이 v4 인가. 메타데이터와 색인 규칙이 이 값을 읽는다. */
export function weddingCodeDefaultsToV40(defaultVersion: WeddingCodeDefaultVersion = WEDDING_CODE_DEFAULT_VERSION): boolean {
  return defaultVersion === WEDDING_CODE_V40_VERSION;
}

/** 다시 시작의 도착 판. default 는 그때의 기본 판, v31 은 v3.1 빈 입구, v40 은 v4 빈 입구. */
export type WeddingCodeRestartTarget = "default" | "v31" | "v40";

/** 다시 시작한 뒤 보여 줄 입구. v3.1 은 기본 판이 v4 이면 이전 판 안내가 붙은 입구다. */
export function weddingCodeRestartEntry(
  target: WeddingCodeRestartTarget,
  defaultVersion: WeddingCodeDefaultVersion = WEDDING_CODE_DEFAULT_VERSION,
): WeddingCodeEntry {
  if (target === "v40") return EMPTY_V40_ENTRY;
  if (target === "v31") return defaultVersion === WEDDING_CODE_V31_VERSION ? EMPTY_WEDDING_CODE_ENTRY : OLDER_V31_ENTRY;
  return defaultWeddingCodeEntry(defaultVersion);
}

/**
 * 다시 시작 뒤 주소의 쿼리. 새로고침해도 같은 판이 열리게 기본 판이 아닌 판은 `?v=` 로 적는다. 답은 어떤 경우에도 쿼리에 넣지 않는다.
 * 기본 판으로 돌아가면 빈 문자열이다.
 */
export function weddingCodeRestartSearch(
  target: WeddingCodeRestartTarget,
  defaultVersion: WeddingCodeDefaultVersion = WEDDING_CODE_DEFAULT_VERSION,
): string {
  if (target === "v40" && defaultVersion !== WEDDING_CODE_V40_VERSION) return `?v=${WEDDING_CODE_V40_VERSION}`;
  if (target === "v31" && defaultVersion !== WEDDING_CODE_V31_VERSION) return `?v=${WEDDING_CODE_V31_VERSION}`;
  return "";
}

function parseParams(params: URLSearchParams, source: "query" | "hash", defaultVersion: WeddingCodeDefaultVersion): WeddingCodeEntry {
  const version = params.get("v");
  // v4 링크가 깨진 경우만 오류 화면이 v4 문구를 쓴다. 다른 판의 오류는 예전 그대로다.
  const fail = version === WEDDING_CODE_V40_VERSION ? V40_ERROR : ERROR;
  for (const key of SHARE_KEYS) {
    if (params.getAll(key).length > 1) return fail;
  }
  if (source === "hash" || version === WEDDING_CODE_V30_VERSION || version === WEDDING_CODE_V31_VERSION) {
    for (const key of params.keys()) {
      if (!SHARE_KEYS.some(allowed => key === allowed)) return fail;
    }
  }
  if (source === "hash" && !params.has("a")) return fail;
  // 빈 버전도 명시된 잘못된 값이다. 버전이 아예 없던 초기 공유 링크와 구분한다.
  if (version !== null && (!version || version !== version.trim())) return fail;
  const hasAnswers = params.has("a") || params.has("b");
  if (hasAnswers && !params.has("a")) return fail;

  if (!hasAnswers) {
    if (version === null) return defaultWeddingCodeEntry(defaultVersion);
    // 기본 진입이 v3.1 이면 명시 v3.1 도 같은 입구다. v4 로 바뀐 뒤에는 이전 판 안내가 붙은 입구가 된다.
    if (version === WEDDING_CODE_V31_VERSION) return weddingCodeRestartEntry("v31", defaultVersion);
    // 쿼리의 v4 는 그 밖의 키(유입 경로 등)를 무시하고 답만 막는다. 해시는 위에서 v, a, b 외의 키를 이미 거절했다.
    if (version === WEDDING_CODE_V40_VERSION) return EMPTY_V40_ENTRY;
  }
  if (version === WEDDING_CODE_V40_VERSION) {
    // 답은 fragment 로만 받는다. query 에 a, b 가 오면 서버가 보게 되므로 읽지 않는다.
    if (source !== "hash") return V40_ERROR;
    // 코드 하나라도 어긋나면 링크 전체를 거절한다. 한 사람의 답만 살리거나 기본값을 채우지 않는다.
    const shared = decodeShareParams(V40_LINK_BANK, params.get("a"), params.get("b"));
    if (shared.kind === "partner") return { kind: "v40", initial: { partner: shared.first, both: null } };
    if (shared.kind === "both") return { kind: "v40", initial: { partner: null, both: { first: shared.first, second: shared.second } } };
    return V40_ERROR;
  }
  if (version === WEDDING_CODE_V31_VERSION) {
    if (source !== "hash") return ERROR;
    const firstCode = params.get("a");
    const first = decodeV31(firstCode);
    const second = params.has("b") ? decodeV31(params.get("b")) : null;
    if (!first || !firstCode || (params.has("b") && !second)) return ERROR;
    return {
      kind: "v31",
      initial: {
        partnerDraft: second ? null : first,
        partnerCode: firstCode,
        bothDrafts: second ? { first, second } : null,
      },
    };
  }
  if (version === WEDDING_CODE_V30_VERSION) {
    if (!hasAnswers) return { kind: "v30", initial: { partnerDraft: null, partnerCode: null, bothDrafts: null } };
    // 새 판의 응답은 fragment로만 받는다. query 응답을 서버에서 복원하지 않는다.
    if (source !== "hash") return ERROR;
    const firstCode = params.get("a");
    const first = decodeV30(firstCode);
    const second = params.has("b") ? decodeV30(params.get("b")) : null;
    if (!first || !firstCode || (params.has("b") && !second)) return ERROR;
    return {
      kind: "v30",
      initial: {
        partnerDraft: second ? null : first,
        partnerCode: firstCode,
        bothDrafts: second ? { first, second } : null,
      },
    };
  }
  if (version === WEDDING_CODE_V20_VERSION) {
    if (!hasAnswers) {
      return { kind: "v20", initial: { partnerAnswers: null, partnerCode: null, bothAnswers: null } };
    }
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

/** 같은 키가 배열로 오는(반복된) 쿼리에서 판이 v4 인가. 오류 화면이 v4 문구를 고르는 데만 쓴다. */
function mentionsV40(search: WeddingCodeEntrySearchParams): boolean {
  const value = search.v;
  return Array.isArray(value) ? value.includes(WEDDING_CODE_V40_VERSION) : value === WEDDING_CODE_V40_VERSION;
}

export function parseWeddingCodeEntryQuery(
  search: WeddingCodeEntrySearchParams | URLSearchParams,
  options?: WeddingCodeEntryOptions,
): WeddingCodeEntry {
  const defaultVersion = options?.defaultVersion ?? WEDDING_CODE_DEFAULT_VERSION;
  if (search instanceof URLSearchParams) return parseParams(search, "query", defaultVersion);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (Array.isArray(value)) {
      if (SHARE_KEYS.some(allowed => key === allowed)) return mentionsV40(search) ? V40_ERROR : ERROR;
      for (const part of value) params.append(key, part);
      continue;
    }
    if (value !== undefined) params.set(key, value);
  }
  return parseParams(params, "query", defaultVersion);
}

export function parseWeddingCodeEntryHash(hash: string, options?: WeddingCodeEntryOptions): WeddingCodeEntry | null {
  if (!hash || hash === "#") return null;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw.length > 12000) return ERROR;
  return parseParams(new URLSearchParams(raw), "hash", options?.defaultVersion ?? WEDDING_CODE_DEFAULT_VERSION);
}

/** v4 링크의 해시. 두 사람 결과(both)는 b 까지, 받는 사람(partner)은 a 까지. 코드를 만들 수 없으면 null. */
function v40EntryHash({ partner, both }: V40EntryInitial): string | null {
  const first = both ? both.first : partner;
  if (!first) return null;
  const a = encodeCode(V40_LINK_BANK, first.formBit, first.responses);
  if (a === null) return null;
  const params = new URLSearchParams({ v: WEDDING_CODE_V40_VERSION, a });
  if (both) {
    const b = encodeCode(V40_LINK_BANK, both.second.formBit, both.second.responses);
    if (b === null) return null;
    params.set("b", b);
  }
  return `#${params.toString()}`;
}

export function weddingCodeEntryHash(entry: WeddingCodeEntry): string | null {
  if (entry.kind === "error") return null;
  if (entry.kind === "v40") return v40EntryHash(entry.initial);
  if (!entry.initial.partnerCode) return null;
  const version = entry.kind === "v31" ? WEDDING_CODE_V31_VERSION
    : entry.kind === "v30" ? WEDDING_CODE_V30_VERSION
    : entry.kind === "v20" ? WEDDING_CODE_V20_VERSION : entry.initial.version;
  const params = new URLSearchParams({ v: version, a: entry.initial.partnerCode });
  if (entry.kind === "v31" && entry.initial.bothDrafts) {
    params.set("b", encodeV31(entry.initial.bothDrafts.second));
  } else if (entry.kind === "v30" && entry.initial.bothDrafts) {
    params.set("b", encodeV30(entry.initial.bothDrafts.second));
  } else if (entry.kind === "v20" && entry.initial.bothAnswers) {
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
  if (entry.kind === "error") return entry.version ? `error:${entry.version}` : "error";
  return weddingCodeEntryHash(entry) ?? (entry.kind === "legacy" ? `${entry.initial.version}:clean` : `${entry.kind}:clean`);
}
