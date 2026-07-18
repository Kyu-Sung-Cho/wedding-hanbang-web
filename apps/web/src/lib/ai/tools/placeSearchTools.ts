import type { ToolExecutionResult } from "@/types/database.types";

const WEDDING_VENDOR_QUERY_PATTERN =
  /웨딩\s*(?:홀|스튜디오|드레스|메이크업|플래너|업체|촬영|사진)|결혼\s*(?:식장|준비\s*업체)|예식\s*(?:장|업체)|웨딩홀|스드메|스튜디오|드레스|(?:혼주\s*)?메이크업|본식(?:\s*(?:스냅|영상))?/i;

interface NaverLocalItem {
  title: string;
  link: string;
  category: string;
  description: string;
  telephone: string;
  address: string;
  roadAddress: string;
  mapx: string;
  mapy: string;
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
  const parts = raw.split(">").map((part) => part.trim());
  if (parts.length >= 3) return { main: parts[1], sub: parts[2], full: raw };
  if (parts.length === 2) return { main: parts[1], sub: null, full: raw };
  return { main: parts[0], sub: null, full: raw };
}

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 4000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export async function executeSearchNearbyPlaces(
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const query = typeof input.query === "string" ? input.query.trim() : "";

  if (WEDDING_VENDOR_QUERY_PATTERN.test(query)) {
    return {
      toolName: "search_nearby_places",
      toolInput: input,
      toolOutput: { query, reason: "wedding_vendor_query_blocked" },
      success: false,
      displayMessage: "웨딩 업체 검색은 검수된 공시가 탐색을 이용해주세요.",
    };
  }

  const clientId = process.env.NAVER_CLIENT_ID ?? process.env.NEXT_PUBLIC_NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return {
      toolName: "search_nearby_places",
      toolInput: input,
      toolOutput: {},
      success: false,
      displayMessage: "네이버 API 키가 설정되지 않았습니다.",
    };
  }

  const naverHeaders = {
    "X-Naver-Client-Id": clientId,
    "X-Naver-Client-Secret": clientSecret,
  };

  try {
    const localResponse = await fetchWithTimeout(
      `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=5&sort=comment`,
      { headers: naverHeaders },
      5000
    );

    if (!localResponse.ok) {
      const errText = await localResponse.text();
      throw new Error(`Naver API error: ${localResponse.status} ${errText}`);
    }

    const localData = await localResponse.json();
    const items: NaverLocalItem[] = Array.isArray(localData.items) ? localData.items : [];

    if (items.length === 0) {
      return {
        toolName: "search_nearby_places",
        toolInput: input,
        toolOutput: { places: [], query },
        success: true,
        displayMessage: `'${query}' 검색 결과가 없습니다. 다른 검색어를 시도해보세요.`,
      };
    }

    const generalPlaceItems = items.filter((item) => !WEDDING_VENDOR_QUERY_PATTERN.test([
      stripHtmlTags(item.title || ""),
      item.category || "",
      stripHtmlTags(item.description || ""),
    ].join(" ")));

    const basePlaces = generalPlaceItems.map(
      (item, idx: number) => {
        const name = stripHtmlTags(item.title);
        const roadAddr = item.roadAddress || item.address;
        const category = parseCategory(item.category);
        const description = stripHtmlTags(item.description || "");
        const cuisineType = category.main;
        const mapsUrl = `https://map.naver.com/v5/search/${encodeURIComponent(name)}`;
        const blogSearchUrl = `https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(name + " " + (category.sub || category.main) + " 후기")}`;

        return {
          id: `naver-${idx}`,
          name,
          address: roadAddr,
          category: category.sub || category.main,
          categoryFull: category.full,
          cuisineType,
          description: description || null,
          telephone: item.telephone || null,
          priceRange: null as string | null,
          hasPrivateRoom: false,
          mapsUrl,
          blogSearchUrl,
          blogReviewCount: 0,
          blogSnippet: null as string | null,
          link: item.link || null,
        };
      }
    );

    const places = basePlaces;

    if (places.length === 0) {
      return {
        toolName: "search_nearby_places",
        toolInput: input,
        toolOutput: { places: [], query },
        success: true,
        displayMessage: `'${query}'에서 일반 장소 검색 결과를 찾지 못했습니다.`,
      };
    }

    return {
      toolName: "search_nearby_places",
      toolInput: input,
      toolOutput: { places, query },
      success: true,
      displayMessage: `'${query}' 검색 결과 ${places.length}곳을 찾았습니다.`,
    };
  } catch (err) {
    const errMsg = String(err);
    console.error("search_nearby_places 에러:", errMsg);
    return {
      toolName: "search_nearby_places",
      toolInput: input,
      toolOutput: { error: errMsg },
      success: false,
      displayMessage: "장소 검색 중 오류가 발생했습니다. 다시 시도해주세요.",
    };
  }
}
