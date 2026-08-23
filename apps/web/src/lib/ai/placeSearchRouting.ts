import { isMutatingTool } from "@/lib/ai/mutationTools";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

export const PLACE_SEARCH_TOOL_NAME = "search_nearby_places";

const PLACE_KIND_RE =
  /(상견례\s*(?:식당|장소)?|식당|음식점|맛집|레스토랑|카페|한정식|중식당?|일식집?|양식집?|뷔페|다이닝|술집|와인바)/i;
/**
 * 실제로 "먹을 곳" 을 가리키는 말. `PLACE_KIND_RE` 의 맨 "상견례" 는 예절 질문
 * ("상견례 예절 알려줘")에도 붙으므로 도구를 줄지 판단할 때는 이쪽을 본다.
 */
const VENUE_KIND_RE =
  /(상견례\s*(?:식당|장소|자리)|식당|음식점|맛집|레스토랑|카페|한정식|중식당?|일식집?|양식집?|뷔페|다이닝|술집|와인바)/i;
/**
 * 부탁이 아니라 물음으로 오는 경우. 사람은 "찾아줘" 만 쓰지 않는다 —
 * "어디가 좋을까", "괜찮은 곳 알려줘", "어때" 로도 같은 것을 묻는다.
 */
const SOFT_ASK_RE =
  /(알려\s*줘|알려\s*주세요|어디|좋을까|괜찮은\s*(?:곳|데)|있을까|없을까|어때|부탁|보여\s*줘|리스트|목록)/i;
const LOCATION_RE =
  /(내\s*근처|우리\s*동네|서울|부산|대구|인천|광주|대전|울산|세종|제주|강남|홍대|건대|신촌|잠실|판교|분당|수원|일산|여의도|성수|청담|압구정|연남|[가-힣0-9]{1,12}(?:시|군|구|동|읍|면|역|로|길)(?=\s|에서|근처|주변|쪽|에|$))/i;
const SEARCH_ACTION_RE =
  /(찾아\s*줘|찾아\s*주세요|찾아\s*봐|찾아\s*달라|검색해\s*줘|검색해\s*주세요|검색해\s*봐|추천해\s*줘|추천해\s*주세요|추천해\s*봐|추천\s*해줘|추천해\s*달라|추천\s*좀|골라\s*줘|알아봐\s*줘|어디가\s*(?:좋아|괜찮아)|어디\s*(?:있어|있나요))/i;
const NEGATED_SEARCH_RE =
  /(찾지\s*마|검색하지\s*마|추천하지\s*마|알아보지\s*마|찾을\s*필요\s*(?:없어|없습니다))/i;

/**
 * 동네 이름은 목록으로 관리할 수 없다.
 *
 * 실측(2026-08-23): 사용자가 "공덕에 상견례 한정식집 찾아줘" 라고 했는데 아모라가
 * **"직접 검색하는 기능은 지금 없어요"** 라고 답했다. 거짓말이 아니었다 — 위
 * `LOCATION_RE` 에 공덕이 없어서 도구가 모델에게 아예 주어지지 않았다. 같은 문장의
 * "강남" 판은 카드가 나왔다. 마포·합정·서초도 같은 이유로 막힌다.
 *
 * 그래서 접미사(구·동·역…)나 이름 목록에 기대지 않고 **조사**를 본다. 한국어에서
 * 장소는 "공덕에", "합정 근처", "마포에서" 처럼 온다. 다만 "주말에", "다음 주에"
 * 처럼 시간도 같은 조사를 쓰므로 그것만 따로 뺀다.
 */
const TIME_WORD_RE =
  /^(오늘|내일|모레|주말|평일|아침|점심|저녁|밤|낮|새벽|이번\s*주|다음\s*주|이번\s*달|다음\s*달|올해|내년|[0-9]{1,2}월|[0-9]{1,2}일|[0-9]{1,2}시)$/;
const PARTICLE_PLACE_RE =
  /([가-힣]{2,12})\s*(?:에서|에|근처|주변|쪽)(?=\s|$)/g;

function mentionsSomewhere(normalized: string): boolean {
  if (LOCATION_RE.test(normalized)) return true;
  PARTICLE_PLACE_RE.lastIndex = 0;
  for (
    let match = PARTICLE_PLACE_RE.exec(normalized);
    match !== null;
    match = PARTICLE_PLACE_RE.exec(normalized)
  ) {
    const token = match[1];
    if (TIME_WORD_RE.test(token)) continue;
    // 종류를 가리키는 말이 조사를 달고 나온 것("한정식집에")은 장소 이름이 아니다.
    if (PLACE_KIND_RE.test(token)) continue;
    return true;
  }
  return false;
}

/**
 * 이 발화에 **장소 검색 도구를 줄지** 정한다(강제 호출과는 별개).
 *
 * 예전에는 강제 호출 판정 하나가 두 일을 겸했다. 그래서 지역을 못 알아보면
 * 도구 자체가 목록에서 빠졌고, 아모라는 **없는 기능이라고 말할 수밖에** 없었다.
 * 사용자에게는 제품이 못 하는 것으로 보인다.
 *
 * 이제 먹을 곳을 가리키는 말과 묻는 형태만 있으면 도구를 준다. 지역이 없으면
 * 어디서 찾을지 되묻는 것은 정당한 되묻기다 — "기능이 없다"는 답과 다르다.
 *
 * **넉넉하게 주는 것이 옳다.** 이건 네이버 지역 검색이고, 결과에서 웨딩업체는
 * `placeSearchTools` 가 항목 단위로 걸러낸다(질의 차단 + 결과 필터 두 겹).
 * 앞단에서 막으면 사용자는 제품이 못 하는 것으로 받아들이지만, 뒤에서 거르면
 * 잘못 섞인 것만 사라진다.
 */
export function isPlaceSearchCandidate(userText: string): boolean {
  const normalized = userText.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized || NEGATED_SEARCH_RE.test(normalized)) return false;
  if (!VENUE_KIND_RE.test(normalized)) return false;
  return SEARCH_ACTION_RE.test(normalized) || SOFT_ASK_RE.test(normalized);
}

export function isExplicitPlaceSearchIntent(userText: string): boolean {
  const normalized = userText.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized || NEGATED_SEARCH_RE.test(normalized)) return false;
  // 강제는 "줄지" 판정 위에 **지역이 있는가** 만 얹는다. 두 판정이 갈라지면
  // 도구는 있는데 안 부르거나, 강제하는데 도구가 없는 상태가 생긴다.
  return isPlaceSearchCandidate(normalized) && mentionsSomewhere(normalized);
}

export function getAvailableChatTools(options: {
  requestKind: "chat" | "initial_greeting" | "mediation";
  isDurableUserMessageBound: boolean;
  tools?: AiToolDefinition[];
}): AiToolDefinition[] {
  if (options.requestKind !== "chat") return [];
  const tools = options.tools ?? BETA_SAFE_TOOLS;
  if (options.isDurableUserMessageBound) return tools;

  // 이 게이트의 목적은 "변경을 durable 메시지 행에 묶는 것"이므로 조회 도구에는
  // 적용되지 않는다. 예전에는 네이버 장소 검색 하나만 통과시켰는데, 그 탓에
  // 체험 상담·모바일에서 search_vendors까지 잘려 아모라가 자사 공시 업체를
  // "확인할 수 없다"며 외부 검색을 권하는 응답을 만들었다(2026-07-25 실측).
  return tools.filter((tool) => !isMutatingTool(tool.name));
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
