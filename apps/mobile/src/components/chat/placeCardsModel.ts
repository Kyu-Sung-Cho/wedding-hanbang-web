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
  imageUrl: string | null;
  searchUrl: string | null;
  mapsUrl: string | null;
  blogSearchUrl: string | null;
  /** 두 지역을 한 번에 찾았을 때 이 후보가 나온 지역. 보통은 null. (2026-09-03) */
  regionLabel: string | null;
}

export type PlaceCardsModel =
  | { state: "error"; message: string }
  /** 웨딩 업체 질의라 여기서 찾지 않는 경우. 실패가 아니라 안내다. (2026-09-03) */
  | { state: "notice"; title: string; message: string }
  /**
   * 다시 열었을 때. 네이버 항목은 저장하지 않으므로 우리 값만 남는다. (2026-09-03)
   */
  | {
      state: "placeholder";
      query: string;
      resultCount: number;
      searchedAtLabel: string | null;
    }
  | { state: "handoff"; message: string; query: string | null; searchUrl: string | null; mapsUrl: string | null }
  | { state: "empty"; message: string; query: string | null }
  | {
      state: "places";
      places: PlaceCardModel[];
      query: string | null;
      /** 조회 시각(KST 시:분). 실행기가 시각을 안 줬으면 null. (2026-09-03) */
      searchedAtLabel: string | null;
    };

/**
 * 조회 시각을 KST 시:분으로 적는다. (2026-09-03)
 *
 * 기기 시간대를 그대로 쓰면 해외에서 열었을 때 다른 시각이 뜬다.
 * `hourCycle: "h23"` 은 자정을 `24:00` 이 아니라 `00:00` 으로 쓰기 위한 것이다.
 */
const SEARCHED_AT_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatPlaceSearchedAtLabel(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return SEARCHED_AT_FORMATTER.format(parsed);
}

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

/**
 * 받침에 맞는 조사. '대전 식당'으로 / '강남 카페'로. (2026-09-03)
 * 한글 음절이 아니면 '로' 로 둔다 — 웹 카드와 같은 규칙이다.
 */
export function withRoParticle(word: string): string {
  const last = word.trim().slice(-1);
  if (!last) return "로";
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return "로";
  const jongseong = (code - 0xac00) % 28;
  return jongseong === 0 || jongseong === 8 ? "로" : "으로";
}

export function getPlaceCardsModel(result: PlaceSearchToolResult): PlaceCardsModel {
  const output = isRecord(result.toolOutput) ? result.toolOutput : {};
  const query = asString(output.query) ?? asString(result.toolInput.query);

  // 저장된 결과에는 제공자 텍스트가 없고 질의·시각·개수만 있다. 그대로 두면
  // "검색된 장소가 없어요" 로 그려져 결과가 0곳이었던 것처럼 보인다.
  if (output.displayOnlyPlaceholder === true) {
    return {
      state: "placeholder",
      query: query ?? "",
      resultCount: typeof output.resultCount === "number" ? output.resultCount : 0,
      searchedAtLabel: formatPlaceSearchedAtLabel(output.searchedAt),
    };
  }

  // 웨딩 업체 질의 차단은 안내다. 빨간 오류 카드로 그리지 않는다.
  if (output.reason === "wedding_vendor_query_blocked") {
    return {
      state: "notice",
      title: "예식장·웨딩홀은 업체 탐색에서 볼 수 있어요",
      message: asString(result.displayMessage)
        ?? "예식장·웨딩홀은 여기서 검색하지 않고 업체 탐색에서 볼 수 있어요.",
    };
  }
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
      imageUrl: safeProviderUrl(value.imageUrl, "pstatic.net"),
      searchUrl: safeProviderUrl(value.searchUrl, "naver.com")
        ?? safeProviderUrl(value.link, "naver.com"),
      mapsUrl,
      blogSearchUrl: safeProviderUrl(value.blogSearchUrl, "naver.com"),
      regionLabel: asString(value.regionLabel),
    }];
  });

  if (places.length === 0) {
    return {
      state: "empty",
      query,
      message: asString(result.displayMessage)
        ?? (query
          ? `'${query}' 검색 결과를 찾지 못했어요. 다른 키워드나 조금 더 넓은 지역으로 말해 주시면 다시 찾아볼게요.`
          : "장소 검색 결과를 찾지 못했어요. 지역과 종류를 함께 말해 주시면 다시 찾아볼게요."),
    };
  }

  return {
    state: "places",
    places,
    query,
    searchedAtLabel: formatPlaceSearchedAtLabel(output.searchedAt),
  };
}
