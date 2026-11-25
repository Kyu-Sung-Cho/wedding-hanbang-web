import { trimInvisibleEdges } from "@/lib/ai/webLookup/webLookupText";
/**
 * 아모라 찾아보기(인터넷 찾기) 스위치와 한도. 2026-11-20 파운더 결정 D-85·D-88.
 *
 * - 켜는 값은 정확히 `"true"` 하나다. 빈 값, 오타, `"TRUE"` 는 전부 꺼짐이다.
 *   기본은 꺼짐이고(`.env.example`), 운영에서 켜는 것은 파운더 승인 뒤다(25장 7절).
 * - 열쇠는 장소 검색과 같은 네이버 API HUB 애플리케이션 열쇠다. 2026-11-20 실측으로 그 열쇠는
 *   '지역' 상품만 열려 있고 '블로그'·'웹문서'는 401 이었다. 그래서 스위치를 켜는 조건은 열쇠가 있는 것뿐이다.
 * - 부르는 네이버 상품은 `AMORA_WEB_SEARCH_NAVER_PRODUCTS` 가 정한다(기본은 지역만). 콘솔에서 상품을
 *   켜는 것만으로 운영 동작이 바뀌지 않게 하려는 것이다(2026-11-20 부모 세션 요청). 웹문서는 30문항
 *   평가와 파운더 승인 뒤 목록에 넣는다.
 */

export const AMORA_WEB_LOOKUP_SWITCH_NAME = "AMORA_WEB_SEARCH_ENABLED";
export const AMORA_WEB_LOOKUP_NAVER_PRODUCTS_NAME = "AMORA_WEB_SEARCH_NAVER_PRODUCTS";

/**
 * 이 코드가 다룰 줄 아는 네이버 검색 상품. 블로그는 없다. 블로그 글은 후기·가격이 중심이라 D-14 와
 * 맞지 않고, 약관(검색 API 특약 1.3)이 검색 데이터를 AI 에 넣지 못하게 해 모델이 블로그 글로 업체를
 * 고르게 할 수도 없다. 블로그를 쓰려면 다루는 코드와 평가가 먼저 있어야 한다.
 */
export const SUPPORTED_NAVER_LOOKUP_PRODUCTS = ["local", "webkr"] as const;
export type NaverLookupProduct = (typeof SUPPORTED_NAVER_LOOKUP_PRODUCTS)[number];
export const DEFAULT_NAVER_LOOKUP_PRODUCTS: readonly NaverLookupProduct[] = ["local"];

/** D-88: 커플당 하루 인터넷 찾기 30회. 검색 한 번과 페이지 읽기 한 번을 각각 한 회로 센다. */
export const DEFAULT_COUPLE_DAILY_WEB_LOOKUPS = 30;
/**
 * 서비스 전체 하루 상한. 네이버 호출이 한 커플 몫(30)씩 쌓여 열쇠의 하루 한도를 넘지 않게 하는
 * 바깥 울타리다. 숫자는 내 제안이고 파운더가 운영값을 정한다.
 */
export const DEFAULT_GLOBAL_DAILY_WEB_LOOKUPS = 2_000;
const MAX_CONFIGURABLE_DAILY_LOOKUPS = 100_000;

type Env = Record<string, string | undefined>;

export function isAmoraWebLookupSwitchOn(env: Env = process.env): boolean {
  return env[AMORA_WEB_LOOKUP_SWITCH_NAME] === "true";
}

export interface NaverHubCredentials {
  clientId: string;
  clientSecret: string;
}

/** 앞뒤의 보이지 않는 문자를 벗긴다(복사해 붙인 열쇠에 섞여 401 이 난 적이 있다). */
function cleanSecret(value: string | undefined): string {
  return trimInvisibleEdges(value ?? "");
}

export function readNaverHubCredentials(env: Env = process.env): NaverHubCredentials | null {
  const clientId = cleanSecret(env.NAVER_API_HUB_CLIENT_ID);
  const clientSecret = cleanSecret(env.NAVER_API_HUB_CLIENT_SECRET);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * 부를 네이버 상품. 쉼표로 적고(예: `local,webkr`), 비었으면 지역만이다. 모르는 낱말(오타·대문자·
 * 블로그)은 빼고 기록을 남기되 값은 찍지 않는다. 남는 것이 없으면 기본값(지역만)으로 돌아간다.
 * 순서는 늘 지역 → 웹문서다(카드 번호표가 환경값 적은 순서에 따라 바뀌지 않게).
 */
export function naverWebLookupProducts(env: Env = process.env): NaverLookupProduct[] {
  const raw = env[AMORA_WEB_LOOKUP_NAVER_PRODUCTS_NAME];
  if (raw === undefined || raw.trim() === "") return [...DEFAULT_NAVER_LOOKUP_PRODUCTS];
  const tokens = raw.split(",").map((token) => token.trim()).filter((token) => token.length > 0);
  const supported: readonly string[] = SUPPORTED_NAVER_LOOKUP_PRODUCTS;
  if (tokens.some((token) => !supported.includes(token))) {
    console.error(`[webLookup] ${AMORA_WEB_LOOKUP_NAVER_PRODUCTS_NAME} has unknown products; they are ignored`);
  }
  const chosen = SUPPORTED_NAVER_LOOKUP_PRODUCTS.filter((product) => tokens.includes(product));
  return chosen.length > 0 ? chosen : [...DEFAULT_NAVER_LOOKUP_PRODUCTS];
}

/** 스위치가 켜져 있고 열쇠가 있을 때만 찾아보기를 연다. 없는 기능을 모델에게 주지 않는다. */
export function isAmoraWebLookupAvailable(env: Env = process.env): boolean {
  return isAmoraWebLookupSwitchOn(env) && readNaverHubCredentials(env) !== null;
}

function readDailyCap(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^[1-9][0-9]*$/.test(raw.trim())) {
    // 잘못된 값이 상한을 사실상 없애지 않게 기본값으로 되돌린다. 값은 찍지 않는다.
    console.error(`[webLookup] invalid ${name}; using default`);
    return fallback;
  }
  const parsed = Number(raw.trim());
  return Number.isSafeInteger(parsed) && parsed <= MAX_CONFIGURABLE_DAILY_LOOKUPS ? parsed : fallback;
}

export function coupleDailyWebLookupCap(env: Env = process.env): number {
  return readDailyCap(env, "AMORA_WEB_SEARCH_COUPLE_DAILY_CAP", DEFAULT_COUPLE_DAILY_WEB_LOOKUPS);
}

export function globalDailyWebLookupCap(env: Env = process.env): number {
  return readDailyCap(env, "AMORA_WEB_SEARCH_GLOBAL_DAILY_CAP", DEFAULT_GLOBAL_DAILY_WEB_LOOKUPS);
}
