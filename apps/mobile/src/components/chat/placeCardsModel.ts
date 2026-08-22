export interface PlaceSearchToolResult {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput: Record<string, unknown>;
  success: boolean;
  displayMessage: string;
}

export interface PlaceCardModel {
  id: string;
  name: string;
  address: string;
  category: string;
  description: string | null;
  telephone: string | null;
  priceRange: string | null;
  hasPrivateRoom: boolean;
  blogReviewCount: number | null;
  /** 블로그 글에서 그 가게를 말한 한 줄. 출처를 밝혀 보여준다. */
  blogSnippet: string | null;
  imageUrl: string | null;
  searchUrl: string | null;
  mapsUrl: string | null;
  blogSearchUrl: string | null;
}

export type PlaceCardsModel =
  | { state: "error"; message: string }
  | { state: "handoff"; message: string; query: string | null; searchUrl: string | null; mapsUrl: string | null }
  | { state: "empty"; message: string; query: string | null }
  | { state: "places"; places: PlaceCardModel[]; query: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeProviderUrl(value: unknown, domain: "naver.com" | "pstatic.net"): string | null {
  const raw = asString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const allowedHost = url.hostname === domain || url.hostname.endsWith(`.${domain}`);
    return url.protocol === "https:" && allowedHost && !url.username && !url.password
      ? raw
      : null;
  } catch {
    return null;
  }
}

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

export function getPlaceCardsModel(result: PlaceSearchToolResult): PlaceCardsModel {
  const output = isRecord(result.toolOutput) ? result.toolOutput : {};
  const query = asString(output.query) ?? asString(result.toolInput.query);
  const handoff = isRecord(output.handoff) ? output.handoff : {};
  const handoffSearchUrl = safeProviderUrl(handoff.searchUrl, "naver.com");
  const handoffMapsUrl = safeProviderUrl(handoff.mapsUrl, "naver.com");

  if (output.providerUnavailable === true && (handoffSearchUrl || handoffMapsUrl)) {
    return {
      state: "handoff",
      query,
      searchUrl: handoffSearchUrl,
      mapsUrl: handoffMapsUrl,
      message: "검색 결과 연결이 지연되고 있어 네이버의 최신 검색 화면으로 바로 이어드려요.",
    };
  }

  if (!result.success) {
    return {
      state: "error",
      message: asString(result.displayMessage) ?? "장소 검색을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.",
    };
  }

  const rawPlaces = Array.isArray(output.places) ? output.places : [];
  const places = rawPlaces.flatMap((value, index): PlaceCardModel[] => {
    if (!isRecord(value)) return [];
    const name = asString(value.name);
    if (!name) return [];

    const mapsUrl = safeProviderUrl(value.mapsUrl, "naver.com");
    return [{
      id: asString(value.id) ?? `place-${index}`,
      name,
      address: asString(value.address) ?? asString(value.roadAddress) ?? "주소 정보 없음",
      category: asString(value.category) ?? asString(value.cuisineType) ?? asString(value.categoryFull) ?? "카테고리 정보 없음",
      description: asString(value.description),
      telephone: asString(value.telephone),
      priceRange: asString(value.priceRange),
      hasPrivateRoom: value.hasPrivateRoom === true,
      blogReviewCount: asCount(value.blogReviewCount),
      blogSnippet: asString(value.blogSnippet),
      imageUrl: safeProviderUrl(value.imageUrl, "pstatic.net"),
      searchUrl: safeProviderUrl(value.searchUrl, "naver.com")
        ?? safeProviderUrl(value.link, "naver.com"),
      mapsUrl,
      blogSearchUrl: safeProviderUrl(value.blogSearchUrl, "naver.com"),
    }];
  });

  if (places.length === 0) {
    return {
      state: "empty",
      query,
      message: asString(result.displayMessage)
        ?? (query ? `'${query}' 검색 결과를 찾지 못했어요.` : "장소 검색 결과를 찾지 못했어요."),
    };
  }

  return { state: "places", places, query };
}
