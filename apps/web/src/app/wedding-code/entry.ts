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
import { encodeCode } from "@/lib/weddingCode/v40/codec";
import { V40_GUESS_LINK_KEYS, decodeGuessedShareParams, encodeGuessCode } from "@/lib/weddingCode/v40/guess/guessLink";
import { V40_LAYOUT } from "@/lib/weddingCode/v40/layout";
import type { CodecBankView, V40EntryInitial } from "@/lib/weddingCode/v40/types";

export type WeddingCodeEntrySearchParams = Record<string, string | string[] | undefined>;

/**
 * 새 방문자가 맨 주소(`/wedding-code`)에서 만나는 판. 기본은 v3.1 이다.
 * v4.0-tendency 는 `?v=v4.0-tendency`(답 없음)와 `#v=v4.0-tendency&a=…[&ga=…][&b=…[&gb=…]]` 로만 열리고(ga, gb 는 서로 짐작하기의 선택 필드), 기본을 v4 로 바꾸는 것은
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
const V40_NAME_TEXT = /v4.0-tendency/i;

/**
 * 글에 v4 판 이름이 보이는가(대소문자를 가리지 않고, 퍼센트 부호로 적은 글자는 풀어서 본다). 읽을 수 없는 링크의 오류 화면이 v4 문구와 v4 다시 시작을 쓸지 고르는 데만 쓴다.
 * 이 함수가 참이어도 링크가 열리지는 않는다(코드 값과 판 이름은 parseParams 가 정확히 같을 때만 받아들인다). 던지지 않고 입력 길이에 비례해 끝난다.
 */
export function mentionsWeddingCodeV40(text: string): boolean {
  if (V40_NAME_TEXT.test(text)) return true;
  if (!text.includes("%")) return false;
  return V40_NAME_TEXT.test(text.replace(/%([0-9a-f]{2})/gi, (match, hex: string) => {
    const code = Number.parseInt(hex, 16);
    return code < 0x80 ? String.fromCharCode(code) : match;
  }));
}

const isGenericError = (entry: WeddingCodeEntry | null): boolean => entry !== null && entry.kind === "error" && entry.version === undefined;
const SHARE_KEYS = ["v", "a", "b"] as const;
/**
 * v4 링크가 받는 키. 서로 짐작하기(4.1 단계 2)의 ga, gb 는 v4 에서만 허용한다(다른 판의 허용 목록 SHARE_KEYS 는 그대로라서 거기서는 예전처럼 거절).
 * 읽는 쪽은 순서를 따지지 않고, 같은 키는 한 번만 허용한다. ga 는 a 가 있을 때만, gb 는 b 가 있을 때만(guessLink 가 링크 수준에서 거절한다).
 */
const V40_SHARE_KEYS: readonly string[] = [...SHARE_KEYS, V40_GUESS_LINK_KEYS.first, V40_GUESS_LINK_KEYS.second];

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

/**
 * 링크 끝에 붙은 글자를 읽는 규칙(판 이름과 코드 값이 함께 쓴다).
 *
 * 카카오톡 같은 곳에서 링크가 문장 속에 들어가면 끝에 마침표, 쉼표, 괄호, 느낌표, 슬래시, 공백, 한글 조사가 같이 붙어 온다.
 * 값 끝에서 그 값의 마지막 글자가 될 수 없는 글자의 덩어리를 **한 번만** 걷어내고, 그 결과가 판 이름이나 코드와 정확히 같을 때만 읽는다.
 * 걷어낸 결과가 비면 원래 값을 돌려준다(빈 값은 계속 거절). 체크섬과 길이 검사는 그대로라서 틀린 답을 보여 주는 일은 없고,
 * 걷어낼 수 없는 글자(영문자와 숫자가 끝에 붙음, 판 이름 오타, 대소문자)는 계속 거절한다. 일부만 읽는 일도 없다.
 *
 * - version, v40: 마지막 글자는 영문자나 숫자다(판 이름 v4.0-tendency, v4 의 70자 코드와 8자 짐작 코드는 체크섬 글자로 끝난다).
 * - v31: v3.1 코드의 마지막 칸은 숫자, 소문자, - 로 끝난다. 그래서 끝의 . 와 _ 도 걷어낸다(코드 안의 . 와 _ 는 칸 구분이라 끝에 올 수 없다).
 *   걷는 것은 ASCII 영숫자와 -(코드 문자)가 아닌 글자뿐이다. 끝에 붙은 영문 대문자도 영숫자라서 걷지 않고, 그 값은 코드 검사에서 거절된다(v4 와 같다).
 */
export type WeddingCodeLinkValueKind = "version" | "v40" | "v31";

const isAsciiAlnum = (code: number) => (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
/** v3.1 코드의 끝은 영숫자나 - 다. 영숫자는 대문자도 걷지 않고 그대로 남겨 코드 검사가 거절하게 한다(v4 와 같다). */
const isV31FinalChar = (code: number) => isAsciiAlnum(code) || code === 45;

export function normalizeWeddingCodeLinkValue(raw: string, kind: WeddingCodeLinkValueKind): string {
  const isFinal = kind === "v31" ? isV31FinalChar : isAsciiAlnum;
  // 정규식 대신 끝에서부터 센다: 긴 입력에서 역추적하지 않는다.
  let end = raw.length;
  while (end > 0 && !isFinal(raw.charCodeAt(end - 1))) end -= 1;
  return end === 0 ? raw : raw.slice(0, end);
}

/** v 값을 읽는다: 끝의 글자를 한 번 걷어낸 값. */
export function normalizeWeddingCodeVersion(raw: string): string {
  return normalizeWeddingCodeLinkValue(raw, "version");
}

/** 알려진 판 이름인가(정확히 같을 때만). 알 수 없는 판의 오류 화면이 현재 판 제목과 색인 막기를 쓰는 데 쓴다. */
export function isKnownWeddingCodeVersion(version: string): boolean {
  if (version === "" || version !== version.trim()) return false;
  return version === WEDDING_CODE_V40_VERSION
    || version === WEDDING_CODE_V31_VERSION
    || version === WEDDING_CODE_V30_VERSION
    || version === WEDDING_CODE_V20_VERSION
    || resolveWeddingCodeSceneConfig(version, false) !== null;
}

function parseParams(params: URLSearchParams, source: "query" | "hash", defaultVersion: WeddingCodeDefaultVersion): WeddingCodeEntry {
  const rawVersion = params.get("v");
  const version = rawVersion === null ? null : normalizeWeddingCodeVersion(rawVersion);
  const isV40 = version === WEDDING_CODE_V40_VERSION;
  const codeParam = (name: string, kind: "v40" | "v31"): string | null => {
    const raw = params.get(name);
    return raw === null ? null : normalizeWeddingCodeLinkValue(raw, kind);
  };
  // v4 링크가 깨진 경우만 오류 화면이 v4 문구를 쓴다. 다른 판의 오류는 예전 그대로다.
  const fail = isV40 ? V40_ERROR : ERROR;
  const allowedKeys: readonly string[] = isV40 ? V40_SHARE_KEYS : SHARE_KEYS;
  for (const key of allowedKeys) {
    if (params.getAll(key).length > 1) return fail;
  }
  if (source === "hash" || version === WEDDING_CODE_V30_VERSION || version === WEDDING_CODE_V31_VERSION) {
    for (const key of params.keys()) {
      if (!allowedKeys.some(allowed => key === allowed)) return fail;
    }
  }
  if (source === "hash" && !params.has("a")) return fail;
  // 빈 버전도 명시된 잘못된 값이다. 버전이 아예 없던 초기 공유 링크와 구분한다.
  if (version !== null && (!version || version !== version.trim())) return fail;
  // v4 의 ga, gb 도 답이 든 링크의 일부다(a 없이 ga 만 있으면 아래에서 거절하고, 쿼리에 실려 오면 v4 분기가 거절한다).
  const hasAnswers = params.has("a") || params.has("b") || (isV40 && (params.has(V40_GUESS_LINK_KEYS.first) || params.has(V40_GUESS_LINK_KEYS.second)));
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
    // 코드 하나라도 어긋나면 링크 전체를 거절한다. 한 사람의 답만 살리거나 기본값을 채우지 않는다(짐작 ga, gb 도 같다: 나쁜 g 가 있으면 멀쩡한 a 도 버린다).
    const shared = decodeGuessedShareParams(V40_LINK_BANK, {
      a: codeParam("a", "v40"),
      b: codeParam("b", "v40"),
      ga: codeParam(V40_GUESS_LINK_KEYS.first, "v40"),
      gb: codeParam(V40_GUESS_LINK_KEYS.second, "v40"),
    });
    // guess 키는 g 가 링크에 하나라도 있을 때만 붙인다(없으면 옛 링크의 initial 과 키 하나까지 같다).
    if (shared.kind === "partner") {
      return {
        kind: "v40",
        initial: shared.firstGuess === null ? { partner: shared.first, both: null } : { partner: shared.first, both: null, guess: { first: shared.firstGuess, second: null } },
      };
    }
    if (shared.kind === "both") {
      const both = { first: shared.first, second: shared.second };
      return {
        kind: "v40",
        initial:
          shared.firstGuess === null && shared.secondGuess === null
            ? { partner: null, both }
            : { partner: null, both, guess: { first: shared.firstGuess, second: shared.secondGuess } },
      };
    }
    return V40_ERROR;
  }
  if (version === WEDDING_CODE_V31_VERSION) {
    if (source !== "hash") return ERROR;
    const firstCode = codeParam("a", "v31");
    const first = decodeV31(firstCode);
    const second = params.has("b") ? decodeV31(codeParam("b", "v31")) : null;
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

/** 같은 키가 배열로 오는(반복된) 쿼리에서 판이 v4 인가. 오류 화면이 v4 문구를 고르는 데만 쓴다. parseParams 와 같은 읽기(끝 글자 걷어내기)를 쓴다. */
function mentionsV40(search: WeddingCodeEntrySearchParams): boolean {
  const value = search.v;
  const isV40 = (item: string) => normalizeWeddingCodeVersion(item) === WEDDING_CODE_V40_VERSION;
  return Array.isArray(value) ? value.some(isV40) : typeof value === "string" && isV40(value);
}

function readQueryEntry(
  search: WeddingCodeEntrySearchParams | URLSearchParams,
  options?: WeddingCodeEntryOptions,
): WeddingCodeEntry {
  const defaultVersion = options?.defaultVersion ?? WEDDING_CODE_DEFAULT_VERSION;
  if (search instanceof URLSearchParams) return parseParams(search, "query", defaultVersion);
  const params = new URLSearchParams();
  // 반복된(배열) 값은 답이 든 키(a, b, v4 에서는 ga, gb 도)에서 모두 거절한다. 다른 판이 가리키는 쿼리의 ga 는 예전처럼 모르는 키로 무시된다.
  const answerKeys: readonly string[] = mentionsV40(search) ? V40_SHARE_KEYS : SHARE_KEYS;
  for (const [key, value] of Object.entries(search)) {
    if (Array.isArray(value)) {
      if (answerKeys.some(allowed => key === allowed)) return mentionsV40(search) ? V40_ERROR : ERROR;
      for (const part of value) params.append(key, part);
      continue;
    }
    if (value !== undefined) params.set(key, value);
  }
  return parseParams(params, "query", defaultVersion);
}

/** v 값(반복된 값 포함) 어딘가에 v4 판 이름이 보이는가. 정확한 이름이 아니어도(대문자, 뒤에 붙은 글자) 보이면 참이다. */
function queryVersionMentionsV40(search: WeddingCodeEntrySearchParams | URLSearchParams): boolean {
  const values = search instanceof URLSearchParams ? search.getAll("v") : [search.v].flat();
  return values.some(value => typeof value === "string" && mentionsWeddingCodeV40(value));
}

/**
 * 쿼리 읽기. 읽을 수 없는 링크의 `v` 에 v4 판 이름이 보이면(`V4.0-TENDENCY`, `v4.0-tendency-x` 처럼 정확한 이름이 아니어도) 오류 화면이 v4 문구와 v4 다시 시작을 쓴다.
 * 어느 쪽이든 링크는 열리지 않는다. 판 이름이 v4 인 것을 정확히 읽는 규칙(끝 글자 한 번 걷어내기, 체크섬, 길이)은 바뀌지 않는다.
 */
export function parseWeddingCodeEntryQuery(
  search: WeddingCodeEntrySearchParams | URLSearchParams,
  options?: WeddingCodeEntryOptions,
): WeddingCodeEntry {
  const entry = readQueryEntry(search, options);
  return isGenericError(entry) && queryVersionMentionsV40(search) ? V40_ERROR : entry;
}

/** 해시에서 읽는 링크 키(v, a, b, ga, gb). */
const HASH_LINK_KEYS: readonly string[] = ["v", "a", "b", V40_GUESS_LINK_KEYS.first, V40_GUESS_LINK_KEYS.second];
/** 링크 키 이름으로 시작하는 토큰(#a, #V, #ga.x). 키 이름 뒤에 영숫자가 이어지면(#about, #back) 문서 안 이동 표시일 수 있어 링크로 보지 않는다. */
const HASH_LINK_KEY_START = new RegExp(`^(?:${HASH_LINK_KEYS.join("|")})(?![a-z0-9])`, "i");
/** 이 길이를 넘는 해시는 문서 안 이동 표시가 아니라 링크를 붙여 넣으려던 것으로 본다(70자 코드가 든 링크는 이보다 훨씬 길다). */
const HASH_ANCHOR_MAX_LENGTH = 32;

/**
 * 해시를 링크로 읽을 수 있는 모양으로 고른다.
 * (1) 두 번째 # 이후는 버린다(`…&a=코드#top` 처럼 문서 안 이동 표시가 더 붙은 모양).
 * (2) 브라우저가 해시에서 떼어 내는 `:~:text=` 텍스트 지시문이 남아 있으면 그 뒤를 무시한다.
 * (3) = 이 하나도 없고 인코딩된 구분자(%3D)가 있으면 해시 전체가 퍼센트 인코딩되어 온 것이라 한 번만 푼다(풀리지 않으면 그대로 둔다).
 * 읽기가 느슨해져도 코드 값은 parseParams 가 정확히 같을 때만 받아들인다.
 */
function readableFragment(raw: string): string {
  const extra = raw.indexOf("#");
  let body = extra >= 0 ? raw.slice(0, extra) : raw;
  const directive = body.indexOf(":~:");
  if (directive >= 0) body = body.slice(0, directive);
  if (!body.includes("=") && /%3d/i.test(body)) {
    try {
      body = decodeURIComponent(body);
    } catch {
      // 풀 수 없으면 그대로 읽는다(아래에서 링크 시도로 보고 거절된다).
    }
  }
  return body;
}

/**
 * 링크를 열려던 해시인가. 평소 입구로 열려도 되는 것은 링크 모양이 아닌 짧은 조각(#top, #x, #section-2)뿐이다.
 * = 나 & (또는 인코딩된 %3D, %26, 대소문자 무시)가 있거나, 링크 키 이름으로 시작하거나(#a, #V=…), 길이가 HASH_ANCHOR_MAX_LENGTH 를 넘으면 링크 시도다.
 * 그래서 키를 잘못 쓴 링크(#ver=…, #link=…), 대문자 키(#V=…&A=…), 해시 전체를 인코딩하고 끝에 % 가 붙은 링크가 조용히 시작 화면으로 새지 않는다.
 * 텍스트 지시문과 두 번째 # 뒤를 이미 뗀 본문(readableFragment 의 결과)으로 잰다.
 */
function isLinkAttempt(body: string): boolean {
  if (body.length > HASH_ANCHOR_MAX_LENGTH) return true;
  if (/[=&]|%3d|%26/i.test(body)) return true;
  return HASH_LINK_KEY_START.test(body);
}

function readHashEntry(hash: string, options?: WeddingCodeEntryOptions): WeddingCodeEntry | null {
  if (!hash || hash === "#") return null;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw.length > 12000) return ERROR;
  const body = readableFragment(raw);
  if (body === "") return null;
  // 링크 모양이 아닌 짧은 조각(#top, #x)은 링크가 아니다. 평소 입구를 연다. 링크를 열려던 해시는 아래의 엄격한 읽기를 그대로 따른다.
  if (!isLinkAttempt(body)) return null;
  return parseParams(new URLSearchParams(body), "hash", options?.defaultVersion ?? WEDDING_CODE_DEFAULT_VERSION);
}

/**
 * 해시 읽기. 읽을 수 없는 해시에 v4 판 이름이 보이면(대문자 키 `#V=v4.0-tendency&A=…`, 통째로 인코딩하고 끝에 %가 붙어 풀리지 않는 v4 링크 등)
 * 오류 화면이 v4 문구와 v4 다시 시작을 쓴다. 링크가 열리는 조건은 그대로다(체크섬, 길이, 부분 수락 금지).
 */
export function parseWeddingCodeEntryHash(hash: string, options?: WeddingCodeEntryOptions): WeddingCodeEntry | null {
  const entry = readHashEntry(hash, options);
  return isGenericError(entry) && mentionsWeddingCodeV40(hash) ? V40_ERROR : entry;
}

/**
 * 읽을 수 없는 해시가 v4 맥락의 주소에 있으면 v4 오류로 바꾼다. 해시만 보아서는 어느 판의 링크인지 알 수 없는 경우(`?v=v4.0-tendency#utm_source=…`)를 위해
 * 주소의 쿼리(`window.location.search`)에 v4 판 이름이 보이는지 함께 본다. 해시를 읽은 결과가 오류가 아니거나 이미 v4 오류이면 그대로 돌려준다.
 */
export function weddingCodeEntryInAddressContext(hashEntry: WeddingCodeEntry | null, search: string): WeddingCodeEntry | null {
  return isGenericError(hashEntry) && mentionsWeddingCodeV40(search) ? V40_ERROR : hashEntry;
}

/**
 * v4 링크의 해시. 두 사람 결과(both)는 b 까지, 받는 사람(partner)은 a 까지. 코드를 만들 수 없으면 null.
 * 서로 짐작하기의 ga, gb 가 있으면 정규 순서(v, a, ga, b, gb)로 넣는다(같은 답에 짐작만 다른 두 링크가 다른 key 가 되게). 짐작이 있는데 만들 수 없으면 null.
 */
function v40EntryHash({ partner, both, guess }: V40EntryInitial): string | null {
  const first = both ? both.first : partner;
  if (!first) return null;
  const a = encodeCode(V40_LINK_BANK, first.formBit, first.responses);
  if (a === null) return null;
  const params = new URLSearchParams({ v: WEDDING_CODE_V40_VERSION, a });
  if (guess?.first) {
    const ga = encodeGuessCode(guess.first);
    if (ga === null) return null;
    params.set(V40_GUESS_LINK_KEYS.first, ga);
  }
  if (both) {
    const b = encodeCode(V40_LINK_BANK, both.second.formBit, both.second.responses);
    if (b === null) return null;
    params.set("b", b);
    if (guess?.second) {
      const gb = encodeGuessCode(guess.second);
      if (gb === null) return null;
      params.set(V40_GUESS_LINK_KEYS.second, gb);
    }
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
