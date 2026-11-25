import {
  naverWebLookupProducts,
  type NaverHubCredentials,
  type NaverLookupProduct,
} from "@/lib/ai/webLookup/webLookupConfig";
import { sanitizeWebLookupText } from "@/lib/ai/webLookup/webLookupPageFacts";
import { checkWebLookupUrl } from "@/lib/ai/webLookup/webLookupUrlPolicy";

/**
 * 네이버 검색 API(API HUB)로 웨딩 업체의 공개 정보를 찾는다.
 *
 * ## 네이버 글은 화면에만 간다(모델·저장 금지)
 *
 * 네이버 개발자센터 오픈 API 이용약관(2026-10-07 개정, 원문 확인)이 검색 데이터를 "AI에 입력하거나
 * 학습, 개선, 평가 및 노출 등에 활용하는 행위"를 금지하고, 결과를 "가공 없이" 출처·원본 링크와 함께
 * 보이게 하며, 순위·내용을 고치지 못하게 하고, 서버 보관을 이력 조회 목적 21일까지로 묶는다.
 * 우리가 쓰는 API HUB 판 약관(PDF)은 아직 읽지 못했다. 그래서 같은 규칙을 지킨다고 보고 만든다.
 *   - 여기서 만든 `hits` 는 카드가 네이버 순서 그대로 그리는 자료다. 모델에는 개수와 번호표(ref)만
 *     간다(`webLookupModelView.ts`). 순서를 바꾸거나 합치거나 지우지 않는다(겹치는 업체도 그대로).
 *   - 저장은 우리가 만든 값(검색어·개수·확인 시각)만 한다. 네이버 글은 저장하지 않는다.
 *   - 업체 공식 홈페이지 주소(`link`)는 서버가 들고 있다가 `read_page` 가 번호표로 부르면 그 주소를
 *     읽는다. 모델이 듣는 업체 정보는 업체 자기 사이트에서 읽은 것뿐이다.
 *
 * ## 쓰는 상품
 *
 *   - 지역(local): 업체 이름·분류·주소·전화·공식 홈페이지 주소. 업체 목록의 뼈대이고, 홈페이지 주소가
 *     `read_page` 의 출발점이다. 기본은 이것만 부른다.
 *   - 웹문서(webkr): 업체 공식 페이지 후보. `AMORA_WEB_SEARCH_NAVER_PRODUCTS` 에 적었을 때만 부른다
 *     (30문항 평가와 파운더 승인 뒤). 콘솔에서 상품을 켜는 것만으로는 쓰이지 않는다.
 *   블로그는 다루는 코드가 없다(`webLookupConfig.ts` 의 `SUPPORTED_NAVER_LOOKUP_PRODUCTS`).
 *
 * 2026-11-20 실측: 지금 열쇠는 지역만 열려 있고 웹문서는 401 "요청한 API는 이 Application에서
 * 활성화되어 있지 않습니다" 였다. 목록에 넣은 상품이 그렇게 답하면 상품 이름과 상태 코드만 기록에 남기고
 * (열쇠·검색어·응답 본문은 남기지 않는다) 10분 동안 건너뛴다. 10분 뒤 다시 막히면 다시 남긴다.
 */

export type { NaverLookupProduct } from "@/lib/ai/webLookup/webLookupConfig";

export type WebLookupHitSource = "naver_local" | "naver_web";

export interface WebLookupHit {
  /** 이번 검색 안의 번호표(w1, w2 …). 네이버 순서 그대로 매긴다. */
  ref: string;
  source: WebLookupHitSource;
  /** 업체 이름(지역) 또는 문서 제목(웹). 태그를 지우고 자른 것. 화면에만 간다. */
  name: string;
  /** 지역 검색의 분류 원문(예: "연애,결혼>예식장"). 화면에만 간다. */
  category: string | null;
  address: string | null;
  telephone: string | null;
  /** 업체 공식 홈페이지(지역) 또는 문서 주소(웹). */
  url: string | null;
  /** `read_page` 가 이 주소를 읽어도 되는가(약관·주소 검사 통과). */
  readable: boolean;
  /** 웹문서 요약(태그를 지운 것). 지역은 null. 화면에만 간다. */
  description: string | null;
}

export interface NaverLookupOutcome {
  hits: WebLookupHit[];
  productsAnswered: NaverLookupProduct[];
  productsUnavailable: NaverLookupProduct[];
  /** 부른 상품이 전부 오류였다(결과 0건과 다르다). */
  allFailed: boolean;
}

const API_BASE = "https://naverapihub.apigw.ntruss.com";
const CALL_TIMEOUT_MS = 4_000;
const DISPLAY_PER_PRODUCT = 5;
const PRODUCT_DISABLED_MS = 10 * 60 * 1000;
const TEXT_MAX_CHARS = 120;

const productDisabledUntil = new Map<NaverLookupProduct, number>();

export function clearNaverProductAvailabilityForTests(): void {
  productDisabledUntil.clear();
}

export type NaverFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

type CallResult =
  | { kind: "ok"; items: Record<string, unknown>[] }
  | { kind: "unavailable" }
  | { kind: "error" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function field(item: Record<string, unknown>, key: string): string {
  return typeof item[key] === "string" ? (item[key] as string).trim() : "";
}

async function callProduct(
  product: NaverLookupProduct,
  query: string,
  credentials: NaverHubCredentials,
  fetchImpl: NaverFetch,
  now: () => number,
): Promise<CallResult> {
  const disabledUntil = productDisabledUntil.get(product);
  if (disabledUntil !== undefined && disabledUntil > now()) return { kind: "unavailable" };
  const url = new URL(`/search/v1/${product}`, API_BASE);
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(DISPLAY_PER_PRODUCT));
  url.searchParams.set("start", "1");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url.toString(), {
      headers: {
        "X-NCP-APIGW-API-KEY-ID": credentials.clientId,
        "X-NCP-APIGW-API-KEY": credentials.clientSecret,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      if (response.status === 401 && text.includes("활성화되어 있지 않습니다")) {
        // 조용히 빼지 않는다. 상품 이름과 상태 코드만 남긴다(열쇠·검색어·본문은 남기지 않는다).
        console.error("[webLookup] naver product not enabled for this key", { product, status: response.status });
        productDisabledUntil.set(product, now() + PRODUCT_DISABLED_MS);
        return { kind: "unavailable" };
      }
      // 상태 코드만 남긴다. 검색어·열쇠·본문은 남기지 않는다.
      console.error("[webLookup] naver search failed", { product, status: response.status });
      return { kind: "error" };
    }
    const body: unknown = JSON.parse(text);
    const items = isRecord(body) && Array.isArray(body.items) ? body.items.filter(isRecord) : [];
    return { kind: "ok", items: items.slice(0, DISPLAY_PER_PRODUCT) };
  } catch {
    console.error("[webLookup] naver search unavailable", { product });
    return { kind: "error" };
  } finally {
    clearTimeout(timer);
  }
}

function linkOf(raw: string): { url: string | null; readable: boolean } {
  if (!raw) return { url: null, readable: false };
  const check = checkWebLookupUrl(raw);
  if (check.ok) return { url: check.url.toString(), readable: true };
  // 인스타그램·네이버 블로그처럼 읽을 수 없는 곳이라도 사람이 눌러 볼 링크로는 남긴다.
  try {
    const url = new URL(raw);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? { url: url.toString(), readable: false }
      : { url: null, readable: false };
  } catch {
    return { url: null, readable: false };
  }
}

function text(value: string): string | null {
  return sanitizeWebLookupText(value, TEXT_MAX_CHARS) || null;
}

function localHit(item: Record<string, unknown>): Omit<WebLookupHit, "ref"> | null {
  const name = text(field(item, "title"));
  if (!name) return null;
  return {
    source: "naver_local",
    name,
    category: text(field(item, "category")),
    address: text(field(item, "roadAddress") || field(item, "address")),
    telephone: text(field(item, "telephone")),
    ...linkOf(field(item, "link")),
    description: null,
  };
}

function webHit(item: Record<string, unknown>): Omit<WebLookupHit, "ref"> | null {
  const name = text(field(item, "title"));
  const link = linkOf(field(item, "link"));
  if (!name || !link.url) return null;
  return {
    source: "naver_web",
    name,
    category: null,
    address: null,
    telephone: null,
    ...link,
    description: text(field(item, "description")),
  };
}

export async function searchNaverForWebLookup(
  query: string,
  credentials: NaverHubCredentials,
  options: { fetchImpl?: NaverFetch; now?: () => number; products?: readonly NaverLookupProduct[] } = {},
): Promise<NaverLookupOutcome> {
  const fetchImpl: NaverFetch = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const products: readonly NaverLookupProduct[] = options.products ?? naverWebLookupProducts();
  const results = await Promise.all(
    products.map((product) => callProduct(product, query, credentials, fetchImpl, now)),
  );

  const productsAnswered: NaverLookupProduct[] = [];
  const productsUnavailable: NaverLookupProduct[] = [];
  const collected: Array<Omit<WebLookupHit, "ref">> = [];
  results.forEach((result, index) => {
    const product = products[index];
    if (result.kind === "unavailable") productsUnavailable.push(product);
    if (result.kind !== "ok") return;
    productsAnswered.push(product);
    for (const item of result.items) {
      const hit = product === "local" ? localHit(item) : webHit(item);
      if (hit) collected.push(hit);
    }
  });

  const tried = products.length - productsUnavailable.length;
  return {
    hits: collected.map((hit, index) => ({ ...hit, ref: `w${index + 1}` })),
    productsAnswered,
    productsUnavailable,
    allFailed: tried > 0 && productsAnswered.length === 0,
  };
}
