import type { ToolExecutionResult } from "@/types/database.types";

const WEDDING_VENDOR_QUERY_PATTERN =
  /웨딩\s*(?:홀|스튜디오|드레스|메이크업|플래너|업체|촬영|사진)|결혼\s*(?:식장|준비\s*업체)|예식\s*(?:장|업체)|웨딩홀|스드메|스튜디오|드레스|(?:혼주\s*)?메이크업|본식(?:\s*(?:스냅|영상))?/i;

type NaverSearchKind = "local" | "image" | "blog";

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
  priceRange: string | null;
  hasPrivateRoom: boolean;
  searchUrl: string;
  mapsUrl: string;
  blogSearchUrl: string;
  blogReviewCount: number;
  blogSnippet: string | null;
  imageUrl: string | null;
  imageSourceUrl: string | null;
  imageTitle: string | null;
  link: string | null;
  mapx: string | null;
  mapy: string | null;
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
const PLACE_QUERY_FILLER =
  /^(?:근처|주변|가까운|인근|하기|좋은|괜찮은|괜찮는|만한|추천|추천해줘|조용한|분위기|있는|없는|잘하는|유명한|맛있는|예쁜|양쪽|우리|저희|같이|함께|모임|자리|장소|곳|데|를|을|좀)$/u;
const PLACE_QUERY_MAX_TOKENS = 3;

/**
 * 블로그 글에서 **그 가게를 실제로 말한 것만** 추린다.
 *
 * 지역 검색만으로는 카드에 이름·주소·사진밖에 못 채운다. 사용자가 알고 싶은
 * "사람들이 뭐라고 하나", "얼마쯤 하나" 는 네이버 지역 API 에 아예 없다.
 * 블로그 검색이 그 자리를 메우는 유일한 출처다.
 *
 * 다만 **검색 결과에 가게 이름이 없으면 그 글은 그 가게 이야기가 아니다.**
 * 제목·본문 어디에도 이름이 없는 글까지 세면 아무 가게나 후기가 많아 보인다.
 * 그래서 이름이 들어간 글만 센다.
 *
 * 가격은 블로그가 말한 것을 **그대로 옮길 뿐** 우리가 계산하지 않는다. 카드도
 * "블로그 언급" 이라고 출처를 밝혀 보여준다.
 */
const BLOG_PRICE_RE = /([1-9]\d{0,2}(?:,\d{3})*|\d+(?:\.\d+)?)\s*(만원|만\s?원|원)/u;
const BLOG_PRIVATE_ROOM_RE = /(?:룸|별실|개별\s?룸|프라이빗\s?룸|독립\s?공간)/u;
const MAX_BLOG_SNIPPET_CHARS = 90;

export function summarizeBlogMentions(
  placeName: string,
  data: unknown,
): {
  count: number;
  snippet: string | null;
  priceRange: string | null;
  hasPrivateRoom: boolean;
} {
  const identity = normalizePlaceIdentity(placeName);
  if ([...identity].length < 2) {
    return { count: 0, snippet: null, priceRange: null, hasPrivateRoom: false };
  }

  const mentioning = recordItems(data).filter((item) => {
    const text = normalizePlaceIdentity(
      `${stripHtmlTags(stringField(item, "title"))} ${stripHtmlTags(stringField(item, "description"))}`,
    );
    return text.includes(identity);
  });

  if (mentioning.length === 0) {
    return { count: 0, snippet: null, priceRange: null, hasPrivateRoom: false };
  }

  const bodies = mentioning.map((item) =>
    stripHtmlTags(stringField(item, "description")).replace(/\s+/g, " ").trim());
  const snippetSource = bodies.find((body) => body.length > 0) ?? null;
  const joined = bodies.join(" ");
  const price = BLOG_PRICE_RE.exec(joined);

  // 우리가 읽는 것은 앞의 다섯 글뿐이라, 그중 몇 개가 이름을 말했는지를 세면
  // **최대 5** 를 넘을 수 없다. 그 숫자를 "블로그 검색 N건" 으로 보여주면
  // 수천 건 있는 가게가 3건짜리로 보인다.
  //
  // 그래서 화면에 낼 수는 네이버가 알려준 **검색 결과 총 수**를 쓴다. 다만
  // 표본 다섯 중 하나도 그 가게를 말하지 않았다면 그 검색은 엉뚱한 것이므로
  // (위에서 이미 0으로 돌려보낸다) 여기까지 오지 않는다.
  const reportedTotal = isRecord(data) && typeof data.total === "number"
    && Number.isFinite(data.total) && data.total >= 0
    ? Math.floor(data.total)
    : null;

  return {
    count: reportedTotal !== null
      ? Math.max(reportedTotal, mentioning.length)
      : mentioning.length,
    snippet: snippetSource
      ? snippetSource.slice(0, MAX_BLOG_SNIPPET_CHARS)
      : null,
    priceRange: price ? `${price[1]}${price[2].replace(/\s/g, "")}` : null,
    hasPrivateRoom: BLOG_PRIVATE_ROOM_RE.test(joined),
  };
}

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

export async function executeSearchNearbyPlaces(
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query) {
    return {
      toolName: "search_nearby_places",
      toolInput: input,
      toolOutput: { places: [], query, error: "invalid_query" },
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
      },
      success: false,
      displayMessage: "웨딩 업체 검색은 검수된 공시가 탐색을 이용해주세요.",
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
      },
      success: false,
      // 사용자에게 우리 설정 사정을 말하지 않는다. 정상 경로에서는 라우트가
      // `isPlaceSearchConfigured()` 로 걸러 이 도구를 아예 주지 않으므로 여기까지
      // 오지 않는다 — 이 문구는 그 필터가 뚫렸을 때의 마지막 방어다.
      displayMessage: "지금은 장소를 찾아드릴 수 없어요. 찾으시는 지역과 종류를 알려주시면 확인할 방법을 같이 정리해 드릴게요.",
    };
  }

  try {
    const localData = await fetchNaverSearch(
      config,
      "local",
      { query, display: "5", start: "1", sort: "comment" },
      5000
    );
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
    const shortened = items.length === 0 ? shortenPlaceQuery(query) : null;
    if (shortened !== null) {
      const retryData = await fetchNaverSearch(
        config,
        "local",
        { query: shortened, display: "5", start: "1", sort: "comment" },
        5000
      );
      items = recordItems(retryData).slice(0, 5);
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
        },
        success: true,
        displayMessage: `'${query}' 검색 결과가 없습니다. 다른 검색어를 시도해보세요.`,
      };
    }

    const generalPlaceItems = items.filter((item) => !WEDDING_VENDOR_QUERY_PATTERN.test([
      stripHtmlTags(stringField(item, "title")),
      stringField(item, "category"),
      stripHtmlTags(stringField(item, "description")),
    ].join(" ")));

    const basePlaces: PlaceSearchResult[] = generalPlaceItems.map((item, idx) => {
      const name = stripHtmlTags(stringField(item, "title"));
      const roadAddress = stringField(item, "roadAddress");
      const address = roadAddress || stringField(item, "address");
      const category = parseCategory(stringField(item, "category"));
      const description = stripHtmlTags(stringField(item, "description"));
      const searchTerm = placeLinkQuery(name, address);

      return {
        id: `naver-${idx}`,
        name,
        address,
        category: category.sub || category.main,
        categoryFull: category.full,
        cuisineType: category.main,
        description: description || null,
        telephone: stringField(item, "telephone") || null,
        priceRange: null,
        hasPrivateRoom: false,
        searchUrl: `https://search.naver.com/search.naver?query=${encodeURIComponent(searchTerm)}`,
        mapsUrl: `https://map.naver.com/p/search/${encodeURIComponent(searchTerm)}`,
        blogSearchUrl: `https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(`${searchTerm} 후기`)}`,
        blogReviewCount: 0,
        blogSnippet: null,
        imageUrl: null,
        imageSourceUrl: null,
        imageTitle: null,
        link: safeHttpsUrl(item.link),
        mapx: stringField(item, "mapx") || null,
        mapy: stringField(item, "mapy") || null,
      };
    });

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
        },
        success: true,
        displayMessage: `'${query}'에서 일반 장소 검색 결과를 찾지 못했습니다.`,
      };
    }

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

    // 블로그 언급은 **있으면 좋은 것**이지 필수가 아니다. API HUB 에서 블로그
    // 상품을 신청하지 않으면 401 로 거절되는데(2026-08-23 실측: "요청한 API는 이
    // Application에서 활성화되어 있지 않습니다"), 그때 장소 카드까지 못 내면
    // 안 된다. 실패는 조용히 넘기고 카드는 이름·주소·사진으로 그대로 나간다.
    // 콘솔에서 블로그를 켜면 코드를 고치지 않아도 언급이 붙는다.
    const blogResults = await Promise.allSettled(
      basePlaces.map((place) => fetchNaverSearch(
        config,
        "blog",
        { query: `${place.name} 후기`, display: "5", start: "1", sort: "sim" },
        3000
      ))
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

      // 블로그가 꺼져 있으면 여기서 조용히 지나간다 — 경고도 남기지 않는다.
      // 신청하지 않은 상품은 고장이 아니다.
      const blogResult = blogResults[idx];
      if (blogResult.status === "fulfilled") {
        const mention = summarizeBlogMentions(place.name, blogResult.value);
        nextPlace.blogReviewCount = mention.count;
        nextPlace.blogSnippet = mention.snippet;
        nextPlace.priceRange = mention.priceRange;
        nextPlace.hasPrivateRoom = mention.hasPrivateRoom;
      }

      return nextPlace;
    });

    const warningList = [...warnings];
    const partialMessage = warningList.length > 0
      ? " 일부 사진 정보는 불러오지 못했습니다."
      : "";
    return {
      toolName: "search_nearby_places",
      toolInput: input,
      toolOutput: {
        places,
        query,
        provider: config.provider,
        providerUnavailable: false,
        partial: warningList.length > 0,
        warnings: warningList,
      },
      success: true,
      displayMessage: `'${query}' 검색 결과 ${places.length}곳을 찾았습니다.${partialMessage}`,
    };
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
      },
      success: false,
      displayMessage: "네이버 장소 검색을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.",
    };
  }
}
