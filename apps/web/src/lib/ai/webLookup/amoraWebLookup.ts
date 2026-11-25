import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  isAmoraWebLookupAvailable,
  readNaverHubCredentials,
} from "@/lib/ai/webLookup/webLookupConfig";
import {
  fetchWebLookupResource,
  type WebLookupResolver,
  type WebLookupTransport,
} from "@/lib/ai/webLookup/webLookupFetch";
import {
  decodeWebLookupBody,
  extractWebLookupPageFacts,
  type WebLookupPriceFact,
} from "@/lib/ai/webLookup/webLookupPageFacts";
import { prepareWebLookupQuery, type WebLookupQueryRemoval } from "@/lib/ai/webLookup/webLookupQueryPolicy";
import { reserveWebLookupQuota, type WebLookupQuotaDenial } from "@/lib/ai/webLookup/webLookupQuota";
import { checkRobotsForUrl, type RobotsDecision } from "@/lib/ai/webLookup/webLookupRobots";
import {
  canonicalWebLookupUrl,
  checkWebLookupUrl,
  displayDomain,
  type WebLookupUrlRejection,
} from "@/lib/ai/webLookup/webLookupUrlPolicy";
import {
  searchNaverForWebLookup,
  type NaverFetch,
  type NaverLookupProduct,
  type WebLookupHit,
} from "@/lib/ai/webLookup/naverWebLookup";

/**
 * 찾아보기의 서버 함수 두 개. 대화 도구(`search_web`·`read_page`)와 맡은 일(갈래 4)이 함께 쓴다.
 *
 * 한도·안전 검사는 전부 이 안에서 지킨다. 부르는 쪽이 검사를 빼먹어도 여기서 막힌다.
 *   - 스위치(`AMORA_WEB_SEARCH_ENABLED`)와 열쇠가 없으면 아무것도 나가지 않는다.
 *   - 검색어는 `prepareWebLookupQuery` 를 지난 것만 네이버로 간다(개인정보·출처 검사).
 *   - 페이지는 `sourceUrls`(앞선 검색 결과의 주소, 또는 사용자가 보낸 주소)에 있는 것만 읽는다.
 *     모델이 지어낸 주소에 커플 정보를 실어 밖으로 보내는 길을 막는다.
 *   - 주소 검사·DNS 검사·robots.txt·약관 차단·크기·시간 한도(`fetchWebLookupResource`).
 *   - 커플당 하루 30회와 하루 금액 상한(`reserveWebLookupQuota`). 검색·읽기 각각 한 회다.
 *
 * 돌려주는 값은 정해진 칸뿐이다. 페이지 원문은 이 파일 밖으로 나가지 않는다.
 */

export type AmoraWebSearchFailure =
  | "disabled"
  | "invalid_query"
  | "search_unavailable"
  | WebLookupQuotaDenial;

export interface AmoraWebSearchSuccess {
  ok: true;
  /** 실제로 네이버에 보낸 검색어(서버가 거른 뒤). */
  query: string;
  removedFromQuery: WebLookupQueryRemoval[];
  checkedAt: string;
  /**
   * 네이버 검색 결과(네이버 순서 그대로). **화면에만 쓴다.** 모델 입력에는 넣지 말고
   * `webSearchSummaryForModel(result)` 만 넣는다(네이버 약관의 AI 입력 금지, `naverWebLookup.ts`).
   * 페이지를 읽을 때는 `hits[i].url` 을 서버가 `readPage` 에 넘긴다.
   */
  hits: WebLookupHit[];
  productsUnavailable: NaverLookupProduct[];
  remainingToday: number;
}

export type AmoraWebSearchResult =
  | AmoraWebSearchSuccess
  | {
      ok: false;
      reason: AmoraWebSearchFailure;
      removedFromQuery: WebLookupQueryRemoval[];
      remainingToday: number | null;
    };

export interface AmoraWebSearchParams {
  query: string;
  coupleId: string;
  /** 사용자 본인이 친 문장. 검색어 낱말의 출처 검사에 쓴다. 없으면 닫힌 낱말 목록만 통과한다. */
  userTexts?: readonly string[];
  /**
   * 검색어에서 뺄 이름(커플 두 사람의 이름 등). 이 이름이 든 낱말은 사용자가 쳤어도 네이버로 보내지
   * 않는다(약관 일반조건 7.4 ⑦). 맡은 일도 커플 이름을 넘길 것.
   */
  blockedTerms?: readonly string[];
  admin?: SupabaseClient;
  now?: Date;
  /** 시험에서만 넘긴다. */
  naverFetch?: NaverFetch;
}

export async function searchWeb(params: AmoraWebSearchParams): Promise<AmoraWebSearchResult> {
  const credentials = readNaverHubCredentials();
  if (!isAmoraWebLookupAvailable() || !credentials) {
    return { ok: false, reason: "disabled", removedFromQuery: [], remainingToday: null };
  }
  const prepared = prepareWebLookupQuery(params.query, {
    userTexts: params.userTexts ?? [],
    blockedTerms: params.blockedTerms ?? [],
  });
  if (!prepared.ok) {
    return { ok: false, reason: "invalid_query", removedFromQuery: prepared.removed, remainingToday: null };
  }
  const quota = await reserveWebLookupQuota(params.admin ?? createAdminClient(), params.coupleId, {
    now: params.now,
  });
  if (!quota.allowed) {
    return { ok: false, reason: quota.reason, removedFromQuery: prepared.removed, remainingToday: quota.remainingToday };
  }
  const checkedAt = (params.now ?? new Date()).toISOString();
  const outcome = await searchNaverForWebLookup(prepared.query, credentials, { fetchImpl: params.naverFetch });
  if (outcome.allFailed || outcome.productsAnswered.length === 0) {
    return {
      ok: false,
      reason: "search_unavailable",
      removedFromQuery: prepared.removed,
      remainingToday: quota.remainingToday,
    };
  }
  return {
    ok: true,
    query: prepared.query,
    removedFromQuery: prepared.removed,
    checkedAt,
    hits: outcome.hits,
    productsUnavailable: outcome.productsUnavailable,
    remainingToday: quota.remainingToday,
  };
}

export type AmoraReadPageFailure =
  | "disabled"
  | "url_not_from_search"
  | WebLookupUrlRejection
  | "blocked_by_robots"
  | "robots_unreachable"
  | "fetch_failed"
  | "not_a_page"
  | WebLookupQuotaDenial;

export interface AmoraReadPageSuccess {
  ok: true;
  /** 넘겨주기를 따라간 뒤 실제로 읽은 주소. */
  url: string;
  domain: string;
  checkedAt: string;
  title: string | null;
  prices: WebLookupPriceFact[];
  /** 글이 거의 없는 페이지였다(그림·스크립트로만 된 곳). 가격이 있어도 못 읽었을 수 있다. */
  textless: boolean;
  /** 크기 한도에서 끊었다. */
  truncated: boolean;
  remainingToday: number;
}

export type AmoraReadPageResult =
  | AmoraReadPageSuccess
  | { ok: false; reason: AmoraReadPageFailure; remainingToday: number | null };

export interface AmoraReadPageParams {
  url: string;
  coupleId: string;
  /** 이 주소가 나온 곳. 앞선 `searchWeb` 결과의 주소들, 또는 사용자가 직접 보낸 주소. */
  sourceUrls: readonly string[];
  admin?: SupabaseClient;
  now?: Date;
  /** 시험에서만 넘긴다. */
  resolveHost?: WebLookupResolver;
  transport?: WebLookupTransport;
}

const PAGE_MAX_BYTES = 1_500_000;
const PAGE_TIMEOUT_MS = 8_000;
const PAGE_MAX_REDIRECTS = 3;
const PAGE_MEDIA_TYPES = new Set(["text/html", "application/xhtml+xml", "text/plain"]);

export async function readPage(params: AmoraReadPageParams): Promise<AmoraReadPageResult> {
  if (!isAmoraWebLookupAvailable()) return { ok: false, reason: "disabled", remainingToday: null };

  const requested = canonicalWebLookupUrl(params.url);
  const allowed = new Set(
    params.sourceUrls.map(canonicalWebLookupUrl).filter((url): url is string => url !== null),
  );
  if (!requested || !allowed.has(requested)) {
    return { ok: false, reason: "url_not_from_search", remainingToday: null };
  }
  const check = checkWebLookupUrl(requested);
  if (!check.ok) return { ok: false, reason: check.reason, remainingToday: null };

  // 한도를 robots.txt 보다 먼저 센다. robots.txt 를 읽는 것도 업체 사이트로 나가는 요청이라, 뒤에서 세면
  // 막힌 사이트를 몇 번이든 공짜로 두드릴 수 있었다(2026-11-20 보안 검토). 한도가 없으면 robots 도 안 읽는다.
  const quota = await reserveWebLookupQuota(params.admin ?? createAdminClient(), params.coupleId, {
    now: params.now,
  });
  if (!quota.allowed) return { ok: false, reason: quota.reason, remainingToday: quota.remainingToday };

  // robots.txt 는 아래 `beforeRequest` 가 첫 주소를 포함해 주소마다(넘겨주기 포함) 연결 전에 본다.
  // 한도를 먼저 세게 바꾼 뒤로 따로 두던 첫 주소 검사는 같은 일을 두 번 했다(prove-guard 가 찾음, 2026-11-20).
  const robotsOptions = { resolveHost: params.resolveHost, transport: params.transport };
  // 넘겨주기마다 바뀐다. 닫힌 함수 안에서 바꾸므로 칸으로 둔다(지역 변수면 타입이 "allowed" 로 굳는다).
  const hop: { robots: RobotsDecision } = { robots: "allowed" };
  const fetched = await fetchWebLookupResource(check.url.toString(), {
    maxBytes: PAGE_MAX_BYTES,
    timeoutMs: PAGE_TIMEOUT_MS,
    maxRedirects: PAGE_MAX_REDIRECTS,
    accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
    acceptContentType: (mediaType) => PAGE_MEDIA_TYPES.has(mediaType),
    beforeRequest: async (url) => {
      hop.robots = await checkRobotsForUrl(url, robotsOptions);
      return hop.robots === "allowed";
    },
    resolveHost: params.resolveHost,
    transport: params.transport,
  });

  if (!fetched.ok) {
    console.info("[webLookup] page not read", { reason: fetched.reason, urlRejection: fetched.urlRejection ?? null });
    const reason: AmoraReadPageFailure = fetched.reason === "url_rejected"
      ? fetched.urlRejection ?? "invalid_url"
      : fetched.reason === "hop_denied"
        ? (hop.robots === "robots_disallow" ? "blocked_by_robots" : "robots_unreachable")
        : fetched.reason === "content_type"
          ? "not_a_page"
          : "fetch_failed";
    return { ok: false, reason, remainingToday: quota.remainingToday };
  }

  const text = decodeWebLookupBody(fetched.body, fetched.charset);
  const facts = extractWebLookupPageFacts(text, fetched.mediaType);
  return {
    ok: true,
    url: fetched.finalUrl,
    domain: displayDomain(fetched.finalUrl) ?? check.host,
    checkedAt: (params.now ?? new Date()).toISOString(),
    title: facts.title,
    prices: facts.prices,
    textless: facts.textless,
    truncated: fetched.truncated,
    remainingToday: quota.remainingToday,
  };
}
