import type { ToolExecutionResult } from "@/types/database.types";

type NaverSearchKind = "local" | "image";
type NaverProvider = "api_hub" | "legacy";

interface NaverSearchConfig {
  provider: NaverProvider;
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

  // Existing production applications can keep using the Developers API until
  // their migration is complete. These variables must remain server-only.
  const legacyClientId = process.env.NAVER_CLIENT_ID?.trim();
  const legacyClientSecret = process.env.NAVER_CLIENT_SECRET?.trim();
  if (legacyClientId && legacyClientSecret) {
    return {
      provider: "legacy",
      baseUrl: "https://openapi.naver.com",
      headers: {
        "X-Naver-Client-Id": legacyClientId,
        "X-Naver-Client-Secret": legacyClientSecret,
      },
    };
  }

  return null;
}

function buildNaverSearchUrl(
  config: NaverSearchConfig,
  kind: NaverSearchKind,
  params: Record<string, string>
): string {
  const path = config.provider === "api_hub"
    ? `/search/v1/${kind}`
    : `/v1/search/${kind}.json`;
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

  const config = readNaverSearchConfig();
  if (!config) {
    return {
      toolName: "search_nearby_places",
      toolInput: input,
      toolOutput: { places: [], query, error: "naver_api_not_configured" },
      success: false,
      displayMessage: "네이버 API 키가 설정되지 않았습니다.",
    };
  }

  try {
    const localData = await fetchNaverSearch(
      config,
      "local",
      { query, display: "5", start: "1", sort: "comment" },
      5000
    );
    const items = recordItems(localData).slice(0, 5);

    if (items.length === 0) {
      return {
        toolName: "search_nearby_places",
        toolInput: input,
        toolOutput: { places: [], query, provider: config.provider },
        success: true,
        displayMessage: `'${query}' 검색 결과가 없습니다. 다른 검색어를 시도해보세요.`,
      };
    }

    const basePlaces: PlaceSearchResult[] = items.map((item, idx) => {
      const name = stripHtmlTags(stringField(item, "title"));
      const roadAddress = stringField(item, "roadAddress");
      const address = roadAddress || stringField(item, "address");
      const category = parseCategory(stringField(item, "category"));
      const description = stripHtmlTags(stringField(item, "description"));
      const searchTerm = [name, address].filter(Boolean).join(" ");

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
        const selectedImage = imageItems.find((imageItem) => safePstaticImageUrl(imageItem.thumbnail));
        if (selectedImage) {
          nextPlace.imageUrl = safePstaticImageUrl(selectedImage.thumbnail);
          // Keep the whole-card destination on NAVER. Image search can point
          // at arbitrary third-party hosts, so source links are label-only.
          nextPlace.imageSourceUrl = null;
          nextPlace.imageTitle = stripHtmlTags(stringField(selectedImage, "title")) || null;
        } else if (imageItems.length > 0) {
          warnings.add("image_url_rejected");
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
    return {
      toolName: "search_nearby_places",
      toolInput: input,
      toolOutput: {
        places,
        query,
        provider: config.provider,
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
        status,
      },
      success: false,
      displayMessage: "네이버 장소 검색을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.",
    };
  }
}
