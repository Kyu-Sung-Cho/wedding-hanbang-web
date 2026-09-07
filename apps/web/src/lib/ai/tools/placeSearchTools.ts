import type { ToolExecutionResult } from "@/types/database.types";
import { readPlaceRequestedCount } from "@hanbang/shared/place-search-presentation";
import {
  describeDistance,
  extractPlaceAnchor,
  parseNaverPoint,
  rankPlacesByDistance,
} from "@/lib/ai/tools/placeDistance";

const WEDDING_VENDOR_QUERY_PATTERN =
  /웨딩\s*(?:홀|스튜디오|드레스|메이크업|플래너|업체|촬영|사진)|결혼\s*(?:식장|준비\s*업체)|예식\s*(?:장|업체)|웨딩홀|스드메|스튜디오|드레스|(?:혼주\s*)?메이크업|본식(?:\s*(?:스냅|영상))?/i;

// 2026-09-03 스테이징 실측: "대전이나 청주 식당 예식" 에 `청주성모병원장례식장`(장례>장례식장)이,
// "대전이나 청주 연회장" 에 아파트 관리사무소 방면 표지(도로시설>방면정보)가 카드로 나왔다.
// 결혼 준비 장소 검색에서 이 업종은 어떤 검색어에서도 후보가 아니다. 업종 문자열은 네이버 것이지만
// 모델에게는 가지 않고(카드 전용) 여기서는 첫 분류만 본다 — 음식점·카페·숙박 같은 정상 업종은 건드리지 않는다.
const EXCLUDED_PLACE_CATEGORY_PATTERN = /^\s*(?:장례|도로시설)/;

type NaverSearchKind = "local" | "image";

interface NaverSearchConfig {
  provider: "api_hub";
  baseUrl: string;
  headers: Record<string, string>;
}

interface PlaceSearchResult {
  id: string;
  name: string;
  address: string;
  category: string;
  categoryFull: string;
  cuisineType: string;
  description: string | null;
  telephone: string | null;
  searchUrl: string;
  mapsUrl: string;
  blogSearchUrl: string;
  imageUrl: string | null;
  imageSourceUrl: string | null;
  imageTitle: string | null;
  link: string | null;
  mapx: string | null;
  mapy: string | null;
  // 두 지역을 한 번에 물었을 때 이 후보가 어느 지역 검색에서 나왔는지. (2026-09-03)
  // 한 지역만 검색한 보통의 경우에는 null 이다.
  regionLabel: string | null;
}

class NaverSearchError extends Error {
  constructor(
    readonly kind: NaverSearchKind,
    readonly status: number
  ) {
    super(`Naver ${kind} search failed with status ${status}`);
    this.name = "NaverSearchError";
  }
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseCategory(raw: string): { main: string; sub: string | null; full: string } {
  const parts = raw.split(">").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3) return { main: parts[1], sub: parts[2], full: raw };
  if (parts.length === 2) return { main: parts[1], sub: null, full: raw };
  return { main: parts[0] ?? "", sub: null, full: raw };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === "string" ? record[key].trim() : "";
}

function recordItems(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return [];
  return value.items.filter(isRecord);
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safePstaticImageUrl(value: unknown): string | null {
  const safeUrl = safeHttpsUrl(value);
  if (!safeUrl) return null;
  const hostname = new URL(safeUrl).hostname.toLowerCase();
  return hostname.endsWith(".pstatic.net") ? safeUrl : null;
}

function normalizePlaceIdentity(value: string): string {
  return stripHtmlTags(value)
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function imageMatchesPlace(
  placeName: string,
  imageItem: Record<string, unknown>
): boolean {
  const placeIdentity = normalizePlaceIdentity(placeName);
  if ([...placeIdentity].length < 3) return false;
  const imageIdentity = normalizePlaceIdentity(stringField(imageItem, "title"));
  return imageIdentity.includes(placeIdentity);
}

/**
 * 이 도구를 지금 쓸 수 있는가.
 *
 * 라우트가 도구 목록을 만들 때 이걸 본다. 쓸 수 없으면 **모델에게 주지 않는다** —
 * 예전에는 자격증명이 없어도 도구를 주고, 실행하면 사용자에게
 * "네이버 API 키가 설정되지 않았습니다." 를 돌려줬다. 내부 사정을 사용자에게
 * 말하는 것이고, 이 저장소가 반복해서 고쳐온 부류다.
 */
export function isPlaceSearchConfigured(): boolean {
  return readNaverSearchConfig() !== null;
}

/**
 * 말하듯 쓴 검색어를 키워드로 줄인다.
 *
 * 지역은 앞, 종류는 뒤에 오는 것이 한국어 장소 검색어의 보통 모양이라 그 둘을
 * 남긴다. 사이에 낀 꾸밈말은 네이버가 못 알아본다.
 *
 * 줄일 것이 없으면 `null` 을 돌려 재시도하지 않는다 — 같은 검색어를 두 번 보내
 * 같은 빈 결과를 받을 이유가 없다.
 */
// 2026-09-04: "삼성동 어른 카페" 가 그대로 네이버로 가서 0건이었다(`어른` 은 가게 이름이
// 아니다). 동행·분위기 수식어는 검색어에서 빼고, 필요하면 답변에서 조건으로 말한다.
const PLACE_QUERY_FILLER =
  /^(?:근처|주변|가까운|인근|하기|좋은|괜찮은|괜찮는|괜찮을|만한|갈만한|갈|추천|추천해줘|조용한|조용히|분위기|있는|없는|잘하는|유명한|맛있는|예쁜|양쪽|우리|저희|같이|함께|모임|자리|장소|곳|데|를|을|좀|어른|어른들|어르신|어르신들|부모님|부모님들|어머님|아버님|가족|가족들|양가|모시고|모실|모시기|편한|편안한|고급|고급스러운|깔끔한|넓은|한적한|아늑한|프라이빗|프라이빗한|룸|개별룸)$/u;
const PLACE_QUERY_MAX_TOKENS = 3;

/**
 * 카드를 눌렀을 때 네이버에서 **그 가게가 나오게** 하는 검색어.
 *
 * 전에는 `이름 + 전체 도로명 주소` 로 검색했는데, 그러면 검색어가 너무 길어
 * 결과가 아예 없는 가게가 있었다(2026-08-23 실측):
 *
 *     "부엉이산장 강남점 서울특별시 강남구 테헤란로1길 28-11 1층"   0건
 *     "부엉이산장 강남점 강남구"                                  1건
 *     "스타벅스"          → 중구 프레스센터점    (엉뚱한 지역)
 *     "스타벅스 강남구"    → 강남구 코엑스별마당점 (맞는 지역)
 *
 * 그래서 **이름 + 구**로 좁힌다. 이름만 쓰면 흔한 이름이 다른 동네로 가고,
 * 주소를 다 붙이면 아무것도 안 나온다.
 */
/**
 * 시·군·구 중 **좁은 것**을 고른다. "서울특별시 강남구 …" 에서 앞에 있는
 * `서울특별시` 를 집으면 지역을 좁히지 못한다 — 그래서 구·군을 먼저 찾고,
 * 없을 때만 광역이 아닌 시를 쓴다.
 */
const NARROW_DISTRICT_RE = /^[가-힣]{2,10}(?:구|군)$/u;
const CITY_RE = /^[가-힣]{2,10}시$/u;
const WIDE_AREA_RE = /(?:특별시|광역시|특별자치시|특별자치도)$/u;

export function placeLinkQuery(name: string, address: string): string {
  const trimmedName = name.trim();
  if (!trimmedName) return address.trim();
  const tokens = address.trim().split(/\s+/u);
  const district = tokens.find((token) => NARROW_DISTRICT_RE.test(token))
    ?? tokens.find((token) => CITY_RE.test(token) && !WIDE_AREA_RE.test(token));
  return district && !trimmedName.includes(district)
    ? `${trimmedName} ${district}`
    : trimmedName;
}

/**
 * 결과가 적을 때 **한 번만** 더 찾을 보충 질의. (2026-09-03 감사)
 *
 * "3곳 알려줘" 인데 카드가 2장만 나왔다. 네이버가 5건을 줘도 예식장·웨딩홀로
 * 분류된 항목을 `buildPlacesFromItems` 가 빼기 때문에, 예식 관련 낱말이 섞인
 * 질의일수록 카드가 줄었다. 그래서 **행사 낱말과 꾸밈말을 뺀** 같은 지역 질의로
 * 한 번 더 찾아 합친다.
 *
 * 종류가 남지 않으면 `식당` 을 붙인다 — 지역만 남은 질의는 네이버가 관공서·도로까지
 * 준다. 지역이 사라지는 질의(남은 것이 종류 하나뿐)는 전국 검색이 되므로 하지 않는다.
 */
const PLACE_QUERY_EVENT_TOKEN =
  /^(?:예식|예식장|웨딩|웨딩홀|결혼|결혼식|상견례|피로연|본식|폐백|하객|대관|예약)$/u;
const PLACE_GENERAL_KIND_RE =
  /(?:식당|맛집|음식점|레스토랑|한정식|한식|일식|중식|양식|이탈리안|뷔페|연회장|카페|베이커리|코스요리)/u;

export function generalizePlaceQuery(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const kept = trimmed
    .split(/\s+/u)
    .filter(Boolean)
    .filter((token) => !PLACE_QUERY_EVENT_TOKEN.test(token) && !PLACE_QUERY_FILLER.test(token));
  if (kept.length === 0) return null;
  if (kept.length === 1 && PLACE_GENERAL_KIND_RE.test(kept[0])) return null;
  const base = kept.join(" ");
  const generalized = PLACE_GENERAL_KIND_RE.test(base) ? base : `${base} 식당`;
  if (generalized === trimmed) return null;
  // 일반화한 질의가 도로 웨딩 업체 질의가 되면 하지 않는다(차단 계약은 그대로).
  if (WEDDING_VENDOR_QUERY_PATTERN.test(generalized)) return null;
  return generalized;
}

/** 보충 검색을 켜는 문턱. 이 수보다 적게 남았을 때만 한 번 더 찾는다. */
const PLACE_SUPPLEMENT_MIN_RESULTS = 3;

/** 이름+주소가 같은 자리는 한 번만 남기고 뒤에 이어 붙인다. */
function appendUniquePlaces(
  base: PlaceSearchResult[],
  extra: PlaceSearchResult[],
  limit: number,
): void {
  const seen = new Set(
    base.map((place) => `${normalizePlaceIdentity(place.name)}|${normalizePlaceIdentity(place.address)}`),
  );
  for (const place of extra) {
    if (base.length >= limit) return;
    const key = `${normalizePlaceIdentity(place.name)}|${normalizePlaceIdentity(place.address)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    base.push(place);
  }
}

export function shortenPlaceQuery(query: string): string | null {
  const tokens = query.trim().split(/\s+/u).filter(Boolean);
  if (tokens.length <= PLACE_QUERY_MAX_TOKENS) return null;

  const meaningful = tokens.filter((token) => !PLACE_QUERY_FILLER.test(token));
  const picked = meaningful.length <= PLACE_QUERY_MAX_TOKENS
    ? meaningful
    // 앞(지역)과 뒤(종류)를 남기고 가운데 하나를 살린다.
    : [meaningful[0], meaningful[meaningful.length - 2], meaningful[meaningful.length - 1]];

  const shortened = picked.filter(Boolean).join(" ").trim();
  if (shortened.length < 2) return null;
  return shortened === query.trim() ? null : shortened;
}

function readNaverSearchConfig(): NaverSearchConfig | null {
  const hubClientId = process.env.NAVER_API_HUB_CLIENT_ID?.trim();
  const hubClientSecret = process.env.NAVER_API_HUB_CLIENT_SECRET?.trim();
  if (hubClientId && hubClientSecret) {
    return {
      provider: "api_hub",
      baseUrl: "https://naverapihub.apigw.ntruss.com",
      headers: {
        "X-NCP-APIGW-API-KEY-ID": hubClientId,
        "X-NCP-APIGW-API-KEY": hubClientSecret,
      },
    };
  }

  return null;
}

/**
 * 검색어가 말한 종류를 앞으로 올린다. **버리지는 않는다.**
 *
 * 네이버는 "강남 한정식" 에 주꾸미요리·요리주점을 먼저 준다(2026-08-23 실측:
 * 아쭈(주꾸미요리) · 부엉이산장(요리주점) · 벌교한상(한식) · 수담 한정식 · 정식당).
 * 우리 검색어는 정확했고 순위가 네이버 것이다. 그래도 "상견례 할 한정식집" 을
 * 물은 사람에게 주꾸미집이 맨 위면 답이 틀린 것처럼 보인다.
 *
 * 걸러내지 않는 이유: 네이버가 분류를 다르게 붙인 진짜 후보를 우리가 지우면
 * 사용자는 그 가게가 있는 줄도 모른다. 순서만 바꾸면 손해가 없다.
 */
export function rankPlacesByQueryKind<T extends { category?: string | null; categoryFull?: string | null }>(
  places: T[],
  query: string,
): T[] {
  // 2026-09-03: 예식·상견례 장소로 쓰는 "연회장"을 종류로 인정한다 — 없으면 "대전 연회장"
  // 같은 검색어에서 종류가 없는 것으로 보여 앞뒤 보정이 헛돈다.
  const kinds = ["한정식", "한식", "일식", "중식", "양식", "이탈리안", "뷔페", "연회장", "카페", "베이커리", "코스요리"];
  // "한식" 은 "한정식" 의 부분문자열이 아니다(한-정-식). 그래서 상위 갈래를 따로 적는다 —
  // 한정식집을 찾는 사람에게 한식집은 후보지만 주꾸미집보다는 뒤다.
  const broader: Readonly<Record<string, readonly string[]>> = {
    한정식: ["한식"],
    이탈리안: ["양식"],
    베이커리: ["카페"],
    코스요리: ["양식", "한식"],
  };
  const direct = kinds.filter((kind) => query.includes(kind));
  if (direct.length === 0) return places;
  const asked = [
    ...direct,
    ...direct.flatMap((kind) => broader[kind] ?? []).filter((kind) => !direct.includes(kind)),
  ];
  // **구체적인 분류를 먼저 본다.** `categoryFull` 은 `음식점>한식>주꾸미요리` 처럼
  // 상위 갈래를 달고 있어서, 그걸로 세면 주꾸미집도 "한식" 으로 잡힌다(실측).
  // 가게에 실제로 붙은 이름(`category`)이 맞을 때가 훨씬 강한 신호다.
  const score = (place: T): number => {
    const specific = place.category ?? "";
    const full = place.categoryFull ?? "";
    for (let i = 0; i < asked.length; i += 1) {
      if (specific.includes(asked[i])) return 100 + (asked.length - i);
    }
    for (let i = 0; i < asked.length; i += 1) {
      if (full.includes(asked[i])) return asked.length - i;
    }
    return 0;
  };
  // 같은 점수면 네이버 순서를 그대로 둔다.
  return places
    .map((place, index) => ({ place, index, score: score(place) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map((entry) => entry.place);
}

/** `rankPlacesByQueryKind` 와 같은 목록을 본다. 한 곳만 고치면 갈라진다. */
const PLACE_KINDS = ["한정식", "한식", "일식", "중식", "양식", "이탈리안", "뷔페", "카페", "베이커리", "코스요리"] as const;

/**
 * 상견례 검색에 **음식 종류를 채워 넣는다.**
 *
 * 네이버 지역 검색은 키워드 매칭이라 종류가 없으면 자리가 무너진다
 * (2026-08-25 실측):
 *
 *     "공덕 상견례"    → 을밀대(냉면) · 모연(소고기구이) · 아소정(냉면)
 *     "강남역 상견례"  → 딘타이펑(중식) · 바바인디아(인도음식) · 도원참치(생선회)
 *     "상견례 장소"    → 성심당 · 이성당 · 씨엘비베이커리   ← 전부 베이커리
 *
 * 종류를 붙이면 곧바로 제자리를 찾는다:
 *
 *     "공덕 상견례 한정식"    → 한식 5/5
 *     "강남역 상견례 한정식"  → 한정식 5/5
 *
 * 반대로 `상견례` 라는 낱말 자체를 더하는 것은 값이 없다(같은 실측:
 * 강남역 +1, 판교 −1, 공덕 0). 그래서 그건 하지 않는다.
 *
 * 사용자가 종류를 말했으면 건드리지 않는다 — 중식당에서 하겠다는 사람에게
 * 한정식을 밀어 넣으면 그건 도움이 아니다.
 */
export function fillPlaceKindForFamilyMeeting(query: string): string | null {
  if (!/상견례/u.test(query)) return null;
  if (PLACE_KINDS.some((kind) => query.includes(kind))) return null;
  // 이미 다른 음식 이름을 말했으면(초밥·스테이크 등) 그것도 존중한다.
  if (/초밥|스시|스테이크|파스타|딤섬|샤브|갈비|불고기|장어|복요리/u.test(query)) return null;
  return `${query} 한정식`;
}

/**
 * 검색어에 지역이 둘이면 지역별로 가른다. (2026-09-03)
 *
 * "대전이나 청주 한정식" 을 물으면 지금까지 앞 지역 하나만 검색됐다 — 도구 스키마가
 * 지역 하나를 전제하고, 장소 검색이 한 번 돌면 그 턴의 도구가 잠기므로(route.ts)
 * 모델이 이어서 두 번째 지역을 찾을 방법이 코드상 없었다. 그래서 **서버가** 나눠
 * 부른다. 도구 잠금 계약은 그대로 둔다.
 *
 * **"또는" 뜻의 이음말만 본다.** `와/과/랑` 같은 "그리고" 이음말은
 * "부모님과 상견례 한정식" 처럼 지역이 아닌 말에 훨씬 자주 붙는다 — 그걸 지역으로
 * 읽으면 엉뚱한 검색어 두 개가 나간다. `이나/나` 는 앞말에 **붙어 있을 때만** 본다
 * ("부모님 나들이 카페" 가 갈라지지 않게).
 */
const PLACE_REGION_ATTACHED_RE = /^([가-힣]{2,8}?)(?:이나|나)\s+([가-힣]{2,8})\s+(.+)$/u;
const PLACE_REGION_STANDALONE_RE = /^([가-힣]{2,8})\s*(?:또는|아니면|[,/])\s*([가-힣]{2,8})\s+(.+)$/u;
/** 이음말 앞뒤에 오지만 지역이 아닌 말. 여기 걸리면 나누지 않는다. */
const NON_REGION_TOKENS = new Set([
  "상견례", "부모님", "양가", "신랑", "신부", "친구", "가족", "우리", "저희",
  "근처", "주변", "여기", "저기", "어디", "나들이",
]);

export interface PlaceQueryRegionSplit {
  regions: [string, string];
  /** 지역을 뺀 나머지(장소 종류). */
  rest: string;
}

export function splitPlaceQueryByRegion(query: string): PlaceQueryRegionSplit | null {
  const trimmed = query.trim();
  const match = PLACE_REGION_ATTACHED_RE.exec(trimmed) ?? PLACE_REGION_STANDALONE_RE.exec(trimmed);
  if (!match) return null;
  const [, first, second, rest] = match;
  const restText = rest.trim();
  if (!restText) return null;
  if (first === second) return null;
  for (const token of [first, second]) {
    if (NON_REGION_TOKENS.has(token)) return null;
    if (PLACE_KINDS.some((kind) => token.includes(kind))) return null;
  }
  return { regions: [first, second], rest: restText };
}

/**
 * 지역별 결과를 번갈아 섞는다. 한 지역이 5곳을 채워 다른 지역이 한 장도 못 나오는
 * 것을 막는다(그게 이 결함의 증상이었다). 같은 가게는 이름+주소로 한 번만 남긴다.
 */
function mergeRegionPlaces(groups: PlaceSearchResult[][], limit: number): PlaceSearchResult[] {
  const seen = new Set<string>();
  const merged: PlaceSearchResult[] = [];
  const longest = groups.reduce((max, group) => Math.max(max, group.length), 0);
  for (let index = 0; index < longest && merged.length < limit; index += 1) {
    for (const group of groups) {
      if (merged.length >= limit) break;
      const place = group[index];
      if (!place) continue;
      const key = `${normalizePlaceIdentity(place.name)}|${normalizePlaceIdentity(place.address)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(place);
    }
  }
  return merged;
}

function buildNaverHandoff(query: string): { searchUrl: string; mapsUrl: string } {
  return {
    searchUrl: `https://search.naver.com/search.naver?query=${encodeURIComponent(query)}`,
    mapsUrl: `https://map.naver.com/p/search/${encodeURIComponent(query)}`,
  };
}

function buildNaverSearchUrl(
  config: NaverSearchConfig,
  kind: NaverSearchKind,
  params: Record<string, string>
): string {
  const path = `/search/v1/${kind}`;
  const url = new URL(path, config.baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 4000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function fetchNaverSearch(
  config: NaverSearchConfig,
  kind: NaverSearchKind,
  params: Record<string, string>,
  timeoutMs: number
): Promise<unknown> {
  const response = await fetchWithTimeout(
    buildNaverSearchUrl(config, kind, params),
    { headers: config.headers },
    timeoutMs
  );
  if (!response.ok) throw new NaverSearchError(kind, response.status);
  return response.json();
}

/**
 * 네이버 지역 결과를 카드가 쓰는 모양으로 옮긴다. 지역을 나눠 두 번 부를 때
 * 같은 자리를 두 벌 만들어야 해서 함수로 뺐다(2026-09-03) — `idPrefix` 가 없으면
 * 두 지역의 첫 후보가 같은 id 를 갖는다.
 */
function buildPlacesFromItems(
  items: Record<string, unknown>[],
  options: { idPrefix: string; regionLabel: string | null },
): PlaceSearchResult[] {
  const generalPlaceItems = items.filter((item) => !WEDDING_VENDOR_QUERY_PATTERN.test([
    stripHtmlTags(stringField(item, "title")),
    stringField(item, "category"),
    stripHtmlTags(stringField(item, "description")),
  ].join(" ")) && !EXCLUDED_PLACE_CATEGORY_PATTERN.test(stringField(item, "category")));

  return generalPlaceItems.map((item, idx) => {
    const name = stripHtmlTags(stringField(item, "title"));
    const roadAddress = stringField(item, "roadAddress");
    const address = roadAddress || stringField(item, "address");
    const category = parseCategory(stringField(item, "category"));
    const description = stripHtmlTags(stringField(item, "description"));
    const searchTerm = placeLinkQuery(name, address);

    return {
      id: `${options.idPrefix}${idx}`,
      name,
      address,
      category: category.sub || category.main,
      categoryFull: category.full,
      cuisineType: category.main,
      description: description || null,
      telephone: stringField(item, "telephone") || null,
      searchUrl: `https://search.naver.com/search.naver?query=${encodeURIComponent(searchTerm)}`,
      mapsUrl: `https://map.naver.com/p/search/${encodeURIComponent(searchTerm)}`,
      blogSearchUrl: `https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(`${searchTerm} 후기`)}`,
      imageUrl: null,
      imageSourceUrl: null,
      imageTitle: null,
      link: safeHttpsUrl(item.link),
      mapx: stringField(item, "mapx") || null,
      mapy: stringField(item, "mapy") || null,
      regionLabel: options.regionLabel,
    };
  });
}

export async function executeSearchNearbyPlaces(
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const result = await searchNearbyPlaces(input);
  const requestedCount = readPlaceRequestedCount(input.requestedCount);
  if (requestedCount === null) return result;
  const places = Array.isArray(result.toolOutput.places)
    ? result.toolOutput.places.slice(0, Math.min(5, requestedCount)) : [];
  return {
    ...result,
    toolOutput: { ...result.toolOutput, requestedCount, places, resultCount: places.length },
    ...(result.success && places.length > 0
      ? { displayMessage: `'${result.toolOutput.query}' 검색 결과 ${places.length}곳을 표시했어요.${result.toolOutput.partial === true ? " 일부 사진 정보는 불러오지 못했습니다." : ""}` }
      : {}),
  };
}

async function searchNearbyPlaces(
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  // 모델이 자기 검색을 한 글자도 못 보던 문제(2026-09-03). 제공자 텍스트는 그대로
  // 막아 두고, **우리가 만든 값**(개수·보정한 질의·조회 시각)만 결과에 함께 싣는다.
  // `placeSearchResultPolicy.getModelSafeToolOutput` 이 이 세 칸만 모델에 넘긴다.
  const searchedAt = new Date().toISOString();
  if (!query) {
    return {
      toolName: "search_nearby_places",
      toolInput: input,
      toolOutput: { places: [], query, error: "invalid_query", resultCount: 0, searchedAt },
      success: false,
      displayMessage: "검색할 지역과 장소를 알려주세요.",
    };
  }

  if (WEDDING_VENDOR_QUERY_PATTERN.test(query)) {
    return {
      toolName: "search_nearby_places",
      toolInput: input,
      toolOutput: {
        places: [],
        query,
        reason: "wedding_vendor_query_blocked",
        resultCount: 0,
        searchedAt,
      },
      success: false,
      // 2026-09-03: 차단 자체는 그대로 두고 말만 바꾼다. 예전 문구("검수된 공시가
      // 탐색을 이용해주세요")는 실패처럼 읽혀 카드가 빨간 경고로 떴다.
      displayMessage: "예식장·웨딩홀은 여기서 검색하지 않고 업체 탐색에서 볼 수 있어요.",
    };
  }

  const config = readNaverSearchConfig();
  if (!config) {
    return {
      toolName: "search_nearby_places",
      toolInput: input,
      toolOutput: {
        places: [],
        query,
        error: "naver_api_not_configured",
        providerUnavailable: true,
        handoff: buildNaverHandoff(query),
        resultCount: 0,
        searchedAt,
      },
      success: false,
      // 사용자에게 우리 설정 사정을 말하지 않는다. 정상 경로에서는 라우트가
      // `isPlaceSearchConfigured()` 로 걸러 이 도구를 아예 주지 않으므로 여기까지
      // 오지 않는다 — 이 문구는 그 필터가 뚫렸을 때의 마지막 방어다.
      displayMessage: "지금은 장소를 찾아드릴 수 없어요. 찾으시는 지역과 종류를 알려주시면 확인할 방법을 같이 정리해 드릴게요.",
    };
  }

  try {
    // 지역이 둘이면 지역별로 한 번씩 부른다(2026-09-03). 재시도·기준점 조회는 하지
    // 않으므로 네이버 지역 검색 호출은 한 지역 갈래(첫 시도 + 재시도)와 같은 최대 2회다.
    const regionSplit = splitPlaceQueryByRegion(query);
    if (regionSplit) {
      const regionQueries = regionSplit.regions.map((region) => {
        const regionQuery = `${region} ${regionSplit.rest}`;
        return { region, query: fillPlaceKindForFamilyMeeting(regionQuery) ?? regionQuery };
      });
      const regionData = await Promise.all(
        regionQueries.map((entry) =>
          fetchNaverSearch(
            config,
            "local",
            { query: entry.query, display: "5", start: "1", sort: "comment" },
            5000,
          )
        )
      );
      const effectiveQuery = regionQueries.map((entry) => entry.query).join(", ");
      const groups = regionData.map((data, index) => rankPlacesByQueryKind(
        buildPlacesFromItems(recordItems(data).slice(0, 5), {
          idPrefix: `naver-r${index}-`,
          regionLabel: regionQueries[index].region,
        }),
        regionQueries[index].query,
      ));
      const merged = mergeRegionPlaces(groups, 5);
      if (merged.length === 0) {
        return {
          toolName: "search_nearby_places",
          toolInput: input,
          toolOutput: {
            places: [],
            query,
            provider: config.provider,
            providerUnavailable: false,
            partial: false,
            warnings: [],
            resultCount: 0,
            effectiveQuery,
            searchedAt,
          },
          success: true,
          displayMessage: `'${query}' 검색 결과가 없습니다. 다른 검색어를 시도해보세요.`,
        };
      }
      return await buildPlaceSearchSuccess(config, {
        input,
        query,
        effectiveQuery,
        searchedAt,
        basePlaces: merged,
        // 지역별로 이미 종류 순서를 맞춘 뒤 번갈아 섞었다. 여기서 다시 세우면
        // 한 지역이 통째로 뒤로 밀려 이 수정이 없앤 문제가 되돌아온다.
        rankByKind: false,
      });
    }

    // 검색어에 "강남역" 같은 기준점이 있으면 그 좌표를 따로 한 번 찾는다. 두 요청은
    // 서로를 기다릴 이유가 없으므로 나란히 보낸다. 기준점 조회가 실패해도 검색은
    // 그대로 진행된다(`.catch(() => null)`).
    //
    // 후보를 늘리려고 정렬을 달리해 한 번 더 부르는 안도 만들어 봤지만 뺐다. 네이버가
    // 한 번에 5건까지만 주는 것은 맞지만, **어느 정렬이 실제로 더 가까운 집을 주는지
    // 여기서 잴 수가 없다.** 호출을 늘리는 값이 증명되지 않은 채로 남는다. 지금 고치는
    // 문제는 "순서"이고 그것은 기준점 하나로 풀린다.
    const anchorName = extractPlaceAnchor(query);
    // 상견례인데 음식 종류가 없으면 서버가 채운다. 모델 지시만 믿지 않는다 —
    // 지시만 있고 자료가 없으면 모델이 지어낸다는 것을 이 저장소에서 여러 번
    // 확인했고, 이 경우는 지어내는 대신 **엉뚱한 집을 5개** 가져온다.
    const searchQuery = fillPlaceKindForFamilyMeeting(query) ?? query;
    const [localData, anchorData] = await Promise.all([
      fetchNaverSearch(config, "local", { query: searchQuery, display: "5", start: "1", sort: "comment" }, 5000),
      anchorName
        ? fetchNaverSearch(
            config,
            "local",
            { query: anchorName, display: "1", start: "1", sort: "random" },
            4000,
          ).catch(() => null)
        : Promise.resolve(null),
    ]);

    let items = recordItems(localData).slice(0, 5);

    // 모델은 사용자 말투를 그대로 옮겨 적는다. 네이버 지역 검색은 키워드로
    // 찾으므로 그런 검색어에는 **결과를 하나도 주지 않는다**(2026-08-22 실측):
    //
    //     "강남역 근처 상견례 하기 좋은 한정식 식당"   0건
    //     "강남역 상견례 한정식"                      5건
    //     "서초 조용한 룸 있는 한식당"                0건
    //     "서초 한식당"                               5건
    //
    // 도구 설명에도 짧게 쓰라고 적었지만 그것만 믿지 않는다 — 지시만 있고
    // 자료가 없으면 모델은 지어낸다는 것을 이 저장소에서 여러 번 확인했다.
    // 첫 시도가 비면 서버가 스스로 줄여 한 번 더 찾는다.
    const shortened = items.length === 0 ? shortenPlaceQuery(searchQuery) : null;
    if (shortened !== null) {
      const retryData = await fetchNaverSearch(
        config,
        "local",
        { query: shortened, display: "5", start: "1", sort: "comment" },
        5000
      );
      items = recordItems(retryData).slice(0, 5);
    }
    // 실제로 네이버에 보낸 검색어. 서버가 종류를 채우거나 줄였으면 그 값이다.
    let effectiveQuery = shortened ?? searchQuery;

    // 2026-09-04 스테이징 실측: "삼성동 어른 카페" 가 0건으로 끝났다. 보충 검색은
    // 1~2건일 때만 돌았고 0건은 여기서 바로 "결과 없음" 이었다. 수식어를 걷은 질의
    // (`generalizePlaceQuery`)가 다르면 한 번만 더 찾는다 — 웨딩 업체 질의로 되돌아가는
    // 일반화는 그 함수가 이미 막는다.
    if (items.length === 0) {
      const generalized = generalizePlaceQuery(searchQuery);
      if (generalized && generalized !== effectiveQuery) {
        const generalizedData = await fetchNaverSearch(
          config,
          "local",
          { query: generalized, display: "5", start: "1", sort: "comment" },
          5000,
        ).catch(() => null);
        const generalizedItems = generalizedData
          ? recordItems(generalizedData).slice(0, 5)
          : [];
        if (generalizedItems.length > 0) {
          items = generalizedItems;
          effectiveQuery = generalized;
        }
      }
    }

    if (items.length === 0) {
      return {
        toolName: "search_nearby_places",
        toolInput: input,
        toolOutput: {
          places: [],
          query,
          provider: config.provider,
          providerUnavailable: false,
          resultCount: 0,
          effectiveQuery,
          searchedAt,
        },
        success: true,
        displayMessage: `'${query}' 검색 결과가 없습니다. 다른 검색어를 시도해보세요.`,
      };
    }

    const basePlaces: PlaceSearchResult[] = buildPlacesFromItems(items, {
      idPrefix: "naver-",
      regionLabel: null,
    });

    // 필터를 지나고 남은 것이 3곳 미만이면 종류를 일반화해 **한 번만** 더 찾는다.
    // 줄인 재시도(`shortened`)를 이미 썼으면 하지 않는다 — 지역 검색 호출은 어느
    // 갈래에서도 최대 2회다(한 지역: 첫 시도 + [줄인 재시도 | 보충 검색] 중 하나,
    // 두 지역: 지역당 1회씩 2회). 기준점 조회 1회와 사진 조회는 여기 셈과 별개로
    // 예전과 같다. 웨딩업체 차단은 이 지점에 닿지 않는다(위에서 이미 돌아갔다).
    let supplementQuery: string | null = null;
    if (shortened === null && basePlaces.length < PLACE_SUPPLEMENT_MIN_RESULTS) {
      const generalized = generalizePlaceQuery(searchQuery);
      if (generalized) {
        const supplementData = await fetchNaverSearch(
          config,
          "local",
          { query: generalized, display: "5", start: "1", sort: "comment" },
          5000,
        ).catch(() => null);
        // 보충이 실패해도 처음 찾은 곳은 그대로 보여준다.
        if (supplementData) {
          supplementQuery = generalized;
          appendUniquePlaces(
            basePlaces,
            buildPlacesFromItems(recordItems(supplementData).slice(0, 5), {
              idPrefix: "naver-g-",
              regionLabel: null,
            }),
            5,
          );
        }
      }
    }
    // 실제로 네이버에 보낸 검색어를 모두 적는다(모델이 듣는 값도 이것이다).
    const searchedQuery = supplementQuery
      ? `${effectiveQuery}, ${supplementQuery}`
      : effectiveQuery;

    // 기준점에서 가까운 순으로 다시 세우고 5개로 줄인다. 기준점을 못 구했거나 좌표를
    // 확신할 수 없으면 `rankPlacesByDistance` 가 순서를 손대지 않으므로, 그때의 결과는
    // 리뷰 많은 순 — 오늘과 같다.
    const anchorItem = anchorData ? recordItems(anchorData)[0] : undefined;
    const anchorPoint = anchorItem
      ? parseNaverPoint(stringField(anchorItem, "mapx"), stringField(anchorItem, "mapy"))
      : null;
    const rankedPlaces = rankPlacesByDistance(basePlaces, anchorPoint)
      .slice(0, 5)
      .map(({ place, distanceMeters }) => ({
        ...place,
        distanceMeters,
        // 걷는 거리인 척하지 않는다. 문구가 "직선"이라고 먼저 말한다.
        distanceLabel: anchorName ? describeDistance(anchorName, distanceMeters) : null,
      }));
    basePlaces.length = 0;
    basePlaces.push(...rankedPlaces);

    if (basePlaces.length === 0) {
      return {
        toolName: "search_nearby_places",
        toolInput: input,
        toolOutput: {
          places: [],
          query,
          provider: config.provider,
          providerUnavailable: false,
          partial: false,
          warnings: [],
          resultCount: 0,
          effectiveQuery: searchedQuery,
          searchedAt,
        },
        success: true,
        displayMessage: `'${query}'에서 일반 장소 검색 결과를 찾지 못했습니다.`,
      };
    }

    return await buildPlaceSearchSuccess(config, {
      input,
      query,
      effectiveQuery: searchedQuery,
      searchedAt,
      basePlaces,
      rankByKind: true,
      hasDistance: rankedPlaces.some((place) => place.distanceMeters !== null),
    });
  } catch (error) {
    const status = error instanceof NaverSearchError ? error.status : null;
    const errorCode = error instanceof NaverSearchError
      ? `naver_${error.kind}_search_failed`
      : "naver_search_unavailable";
    console.error("search_nearby_places error", { errorCode, status, provider: config.provider });
    return {
      toolName: "search_nearby_places",
      toolInput: input,
      toolOutput: {
        places: [],
        query,
        error: errorCode,
        provider: config.provider,
        providerUnavailable: true,
        handoff: buildNaverHandoff(query),
        status,
        resultCount: 0,
        searchedAt,
      },
      success: false,
      displayMessage: "네이버 장소 검색을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.",
    };
  }
}

/**
 * 사진을 붙이고 결과를 확정한다. 한 지역 갈래와 두 지역 갈래가 같은 자리를
 * 쓰도록 뺐다(2026-09-03).
 */
async function buildPlaceSearchSuccess(
  config: NaverSearchConfig,
  args: {
    input: Record<string, unknown>;
    query: string;
    effectiveQuery: string;
    searchedAt: string;
    basePlaces: PlaceSearchResult[];
    rankByKind: boolean;
    hasDistance?: boolean;
  },
): Promise<ToolExecutionResult> {
  const { input, query, effectiveQuery, searchedAt, basePlaces } = args;
  const imageResults = await Promise.allSettled(
    basePlaces.map((place) => {
      const placeQuery = [place.name, place.address].filter(Boolean).join(" ");
      return fetchNaverSearch(
        config,
        "image",
        { query: placeQuery, display: "3", start: "1", sort: "sim", filter: "large" },
        3000
      );
    })
  );

  const warnings = new Set<string>();
  const places = basePlaces.map((place, idx) => {
    const imageResult = imageResults[idx];
    const nextPlace = { ...place };

    if (imageResult.status === "fulfilled") {
      const imageItems = recordItems(imageResult.value);
      const selectedImage = imageItems.find((imageItem) =>
        imageMatchesPlace(place.name, imageItem)
        && Boolean(safePstaticImageUrl(imageItem.thumbnail))
      );
      if (selectedImage) {
        nextPlace.imageUrl = safePstaticImageUrl(selectedImage.thumbnail);
        nextPlace.imageTitle = stripHtmlTags(stringField(selectedImage, "title")) || null;
      } else if (imageItems.length > 0) {
        warnings.add("image_identity_unverified");
      }
    } else {
      warnings.add("image_enrichment_failed");
    }

    return nextPlace;
  });

  const warningList = [...warnings];
  const partialMessage = warningList.length > 0
    ? " 일부 사진 정보는 불러오지 못했습니다."
    : "";
  const orderedPlaces = args.rankByKind ? rankPlacesByQueryKind(places, query) : places;
  return {
    toolName: "search_nearby_places",
    toolInput: input,
    toolOutput: {
      places: orderedPlaces,
      query,
      provider: config.provider,
      providerUnavailable: false,
      partial: warningList.length > 0,
      warnings: warningList,
      resultCount: orderedPlaces.length,
      orderBasis: !args.rankByKind ? "region_kind" : args.hasDistance ? "kind_distance" : "kind_provider",
      effectiveQuery,
      searchedAt,
    },
    success: true,
    displayMessage: `'${query}' 검색 결과 ${places.length}곳을 찾았습니다.${partialMessage}`,
  };
}
