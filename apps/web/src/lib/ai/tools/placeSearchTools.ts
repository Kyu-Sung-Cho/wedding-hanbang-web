import type { ToolExecutionResult } from "@/types/database.types";

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

function extractPriceRange(texts: string[]): string | null {
  const combined = texts.join(" ");
  const perPersonPatterns = [
    /인당\s*(\d[\d,]*)\s*원/,
    /1인\s*(\d[\d,]*)\s*원/,
    /인당\s*(\d+)\s*만\s*원?/,
    /1인\s*(\d+)\s*만\s*원?/,
    /인당\s*약?\s*(\d+)\s*만/,
  ];
  for (const pattern of perPersonPatterns) {
    const match = combined.match(pattern);
    if (match) {
      const raw = match[1].replace(/,/g, "");
      const num = parseInt(raw, 10);
      if (num >= 10000) return `인당 약 ${(num / 10000).toFixed(0)}만원`;
      if (num > 0 && num <= 100) return `인당 약 ${num}만원`;
      if (num > 100) return `인당 약 ${num.toLocaleString()}원`;
    }
  }

  const rangeMatch = combined.match(/(\d+)\s*[~\-]\s*(\d+)\s*만\s*원/);
  if (rangeMatch) {
    return `인당 ${rangeMatch[1]}~${rangeMatch[2]}만원`;
  }

  const courseMatch = combined.match(/코스[요리]?\s*(\d+)\s*만\s*원?/);
  if (courseMatch) {
    return `코스 ${courseMatch[1]}만원`;
  }
  return null;
}

function detectPrivateRoom(texts: string[]): boolean {
  const combined = texts.join(" ").toLowerCase();
  const roomKeywords = ["룸", "개별룸", "프라이빗", "private", "개인실", "독립공간", "단체석", "별실", "개인공간", "단독룸"];
  return roomKeywords.some((keyword) => combined.includes(keyword));
}

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 4000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export async function executeSearchNearbyPlaces(
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const query = input.query as string;
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
    const items = localData.items || [];

    if (items.length === 0) {
      return {
        toolName: "search_nearby_places",
        toolInput: input,
        toolOutput: { places: [], query },
        success: true,
        displayMessage: `'${query}' 검색 결과가 없습니다. 다른 검색어를 시도해보세요.`,
      };
    }

    const basePlaces = items.map(
      (item: {
        title: string;
        link: string;
        category: string;
        description: string;
        telephone: string;
        address: string;
        roadAddress: string;
        mapx: string;
        mapy: string;
      }, idx: number) => {
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

    const blogResults = await Promise.allSettled(
      basePlaces.map(async (place: { name: string; address: string }) => {
        const blogResponse = await fetchWithTimeout(
          `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(`"${place.name}" 후기`)}&display=3&sort=sim`,
          { headers: naverHeaders },
          3000
        );
        if (!blogResponse.ok) return null;
        return await blogResponse.json();
      })
    );

    const places = basePlaces.map((place: typeof basePlaces[number], idx: number) => {
      const blogResult = blogResults[idx];
      if (blogResult.status === "fulfilled" && blogResult.value) {
        const blogData = blogResult.value;
        place.blogReviewCount = blogData.total || 0;
        const blogItems = blogData.items || [];
        const allSnippets: string[] = blogItems.map(
          (blogItem: { description: string }) => stripHtmlTags(blogItem.description || "")
        );
        if (allSnippets.length > 0) {
          place.blogSnippet = allSnippets[0].slice(0, 100);
        }
        place.priceRange = extractPriceRange(allSnippets);
        place.hasPrivateRoom = detectPrivateRoom(allSnippets);
      }
      return place;
    });

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
