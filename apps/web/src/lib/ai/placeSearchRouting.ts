import type { AiToolDefinition } from "@/lib/ai/toolDefinition";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

export const PLACE_SEARCH_TOOL_NAME = "search_nearby_places";

const PLACE_KIND_RE =
  /(상견례\s*(?:식당|장소)?|식당|음식점|맛집|레스토랑|카페|한정식|중식당?|일식집?|양식집?|뷔페|다이닝|술집|와인바)/i;
const LOCATION_RE =
  /(내\s*근처|우리\s*동네|서울|부산|대구|인천|광주|대전|울산|세종|제주|강남|홍대|건대|신촌|잠실|판교|분당|수원|일산|여의도|성수|청담|압구정|연남|[가-힣0-9]{1,12}(?:시|군|구|동|읍|면|역|로|길)(?=\s|에서|근처|주변|쪽|에|$))/i;
const SEARCH_ACTION_RE =
  /(찾아\s*줘|찾아\s*주세요|찾아\s*봐|검색해\s*줘|검색해\s*주세요|검색해\s*봐|추천해\s*줘|추천해\s*주세요|추천해\s*봐|추천\s*해줘|골라\s*줘|알아봐\s*줘|어디가\s*(?:좋아|괜찮아)|어디\s*(?:있어|있나요))/i;
const NEGATED_SEARCH_RE =
  /(찾지\s*마|검색하지\s*마|추천하지\s*마|알아보지\s*마|찾을\s*필요\s*(?:없어|없습니다))/i;

/**
 * 명시적인 외부 장소 검색 발화만 강제 도구 호출로 보낸다.
 * 예절 질문이나 웨딩 업체 추천을 잘못 네이버 지역 검색으로 보내지 않도록
 * 장소 종류와 검색 행동이 모두 있는 경우로 범위를 좁힌다.
 */
export function isExplicitPlaceSearchIntent(userText: string): boolean {
  const normalized = userText.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized || NEGATED_SEARCH_RE.test(normalized)) return false;
  return LOCATION_RE.test(normalized) && PLACE_KIND_RE.test(normalized) && SEARCH_ACTION_RE.test(normalized);
}

export function getAvailableChatTools(options: {
  requestKind: "chat" | "initial_greeting" | "mediation";
  isDurableUserMessageBound: boolean;
  tools?: AiToolDefinition[];
}): AiToolDefinition[] {
  if (options.requestKind !== "chat") return [];
  const tools = options.tools ?? BETA_SAFE_TOOLS;
  if (options.isDurableUserMessageBound) return tools;

  // Legacy/mobile/demo turns are not allowed to mutate durable state, but the
  // NAVER place lookup is read-only and should remain useful in those clients.
  return tools.filter((tool) => tool.name === PLACE_SEARCH_TOOL_NAME);
}

export function getPlaceSearchToolChoice(options: {
  userText: string;
  round: number;
  tools: AiToolDefinition[];
}): { type: "function"; name: typeof PLACE_SEARCH_TOOL_NAME } | undefined {
  if (options.round !== 0 || !isExplicitPlaceSearchIntent(options.userText)) {
    return undefined;
  }
  if (!options.tools.some((tool) => tool.name === PLACE_SEARCH_TOOL_NAME)) {
    return undefined;
  }
  return { type: "function", name: PLACE_SEARCH_TOOL_NAME };
}
