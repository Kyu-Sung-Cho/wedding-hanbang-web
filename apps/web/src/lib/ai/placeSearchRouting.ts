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
// "식당/자리에서 나눌 질문"의 장소는 상담 배경이다. 뒤의 "알려줘"와
// 결합해 검색 대상으로 읽지 않는다. 별도로 요청한 식당·곳은 그대로 남긴다.
const PLACE_CONTEXT_RE = new RegExp(
  `(?:${VENUE_KIND_RE.source}|곳|자리|장소)(?:집)?(?:에서(?:는)?|에선)`,
  "gi",
);
const GENERIC_PLACE_NOUN_RE = /^(?:자리|장소|곳)$/u;
/**
 * 사람은 가게 종류를 대지 않는다.
 *
 * 실측(2026-08-26, 운영): "공덕 근처 상견례 할 만한 곳 알려줘" 에 아모라가
 * **"공덕 근처 업체를 직접 검색하거나 예약할 수는 없어요"** 라고 답했다. 위
 * `VENUE_KIND_RE` 가 `상견례` 뒤에 `식당|장소|자리` 중 하나를 요구하는데
 * "상견례 **할 만한 곳**" 에는 그 낱말이 없어서 도구가 목록에서 빠졌다.
 * 실제 말투 14개로 재니 5개만 열렸다.
 *
 * 그래서 "무엇을 파는 가게인가" 대신 **먹거나 마주 앉는 자리인가**로 본다.
 * 두 조각이 함께 있어야 한다 —
 *
 *   먹는 맥락(밥·식사·상견례·부모님 뵙기)  +  자리를 가리키는 말(곳·데·자리·어디)
 *
 * 한쪽만으로는 열지 않는다. "곳" 하나로 열면 "드레스 볼 곳", "예식장 알아볼 곳"
 * 까지 네이버 검색이 열리고, 그건 지금 보류해 둔 업체 추천을 뒷문으로 여는 것이다.
 */
const MEAL_CONTEXT_RE =
  /(상견례|밥|식사|끼니|먹을|먹기|먹는|드실|드시|모시고|뵙|어른|양가|부모님)/i;
/**
 * `어디` 를 그냥 넣었더니 장소가 아닌 뜻이 줄줄이 걸렸다 — 함정 12문장 중 7개가
 * 열렸다("상견례 **어디까지** 준비해야 해", "비용은 **어디서 나오는**", "예절
 * **어디서 배울**"). 그래서 `어디` 는 **어디서 하느냐**를 묻는 꼴일 때만 센다.
 */
// 의존 명사 "데"만 장소로 읽고 연결 어미 "만나는데"의 끝을 장소로 만들지 않는다.
const GENERIC_PLACE_RE =
  /(곳|(?:^|\s|만한|좋은|괜찮은|갈|먹을|모실|뵐)데(?=\s|$|를|가|는|도|에)|자리|장소|어디\s*(?:서|에서)?\s*(?:하|할|함))/i;

/** 먹거나 마주 앉을 자리를 묻고 있는가. 가게 종류를 대지 않아도 알아본다. */
function mentionsSomewhereToEat(normalized: string): boolean {
  if (VENUE_KIND_RE.test(normalized)) return true;
  return MEAL_CONTEXT_RE.test(normalized) && GENERIC_PLACE_RE.test(normalized);
}
/**
 * 부탁이 아니라 물음으로 오는 경우. 사람은 "찾아줘" 만 쓰지 않는다 —
 * "어디가 좋을까", "괜찮은 곳 알려줘", "어때" 로도 같은 것을 묻는다.
 */
const SOFT_ASK_RE =
  // 맨 "추천" 도 부탁이다 — "상견례 하기 좋은 한정식 추천" 이 어형 때문에 막혔다.
  /(알려\s*줘|알려\s*주세요|어디|좋을까|괜찮은\s*(?:곳|데)|있을까|없을까|어때|부탁|보여\s*줘|리스트|목록|추천)/i;
const LOCATION_RE =
  /(내\s*근처|우리\s*동네|서울|부산|대구|인천|광주|대전|울산|세종|제주|강남|홍대|건대|신촌|잠실|판교|분당|수원|일산|여의도|성수|청담|압구정|연남|[가-힣0-9]{1,12}(?:시|군|구|동|읍|면|역|로|길)(?=\s|에서|근처|주변|쪽|에|$))/i;
const SEARCH_ACTION_RE =
  /(찾아\s*줘|찾아\s*주세요|찾아\s*봐|찾아\s*달라|검색해\s*줘|검색해\s*주세요|검색해\s*봐|추천해\s*줘|추천해\s*주세요|추천해\s*봐|추천\s*해줘|추천해\s*달라|추천\s*좀|골라\s*줘|알아봐\s*줘|어디가\s*(?:좋아|괜찮아)|어디\s*(?:있어|있나요))/i;
const POLITE_SEARCH_ACTION_RE =
  /(?:찾아|검색해)\s*(?:줄\s*수\s*있(?:어요?|나요|을까요?)|주실\s*수\s*있(?:나요|을까요?)|줄래요?|주시겠어요)(?=$|[\s?!.。])(?!\s*(?:라고|라는|라며))/iu;

function removeQuotedSearchQuestions(text: string): string {
  // 상호명 인용은 보존하되, 검색 부탁 자체를 인용한 문장을 현재 요청으로 읽지 않는다.
  return text.replace(/“[^”]*”|‘[^’]*’|"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/gu,
    quote => POLITE_SEARCH_ACTION_RE.test(quote.slice(1, -1)) ? " " : quote);
}
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
    if (PLACE_KIND_RE.test(token) || GENERIC_PLACE_NOUN_RE.test(token)) continue;
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
  const requestedPlaces = removeQuotedSearchQuestions(normalized).replace(PLACE_CONTEXT_RE, " ");
  if (!mentionsSomewhereToEat(requestedPlaces)) return false;
  return SEARCH_ACTION_RE.test(requestedPlaces) || SOFT_ASK_RE.test(requestedPlaces)
    || POLITE_SEARCH_ACTION_RE.test(requestedPlaces);
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

/**
 * 사용자가 **안을 이미 늘어놓고** 고르라고 하는 꼴.
 *
 * 2026-09-03 실측(2차 Turn 24): "식당 예식, 일반 컨벤션 예식, 제주 가족식 세 안 중
 * … 1순위로 골라줘" 에 강제 호출이 걸렸다(`식당` + `골라 줘` + `제주`). 모델은 답을
 * 쓰기 전에 네이버 검색을 부르고, 그 질의에 예식장류가 들어가 차단되면 화면에는
 * 빨간 "장소 검색을 완료하지 못했어요" 카드가 먼저 뜬다. 사용자가 원한 것은 검색이
 * 아니라 판단이었다.
 *
 * **도구는 그대로 준다** — 빼면 "그런 기능 없어요" 회귀가 난다(2026-08-23). 강제만
 * 풀어 모델이 부를지 스스로 정하게 한다.
 *
 * 맨 `골라 줘`·`정해 줘` 는 여기 넣지 않는다. "제주 식당 골라줘" 는 안이 없는 진짜
 * 검색 요청이고, 그것까지 풀면 원래 되던 문장의 강제가 사라진다. 가르는 것은
 * **늘어놓은 안이 있는가**(…중) 와 **순위를 매겨 달라는가**(1순위) 다.
 */
const CHOICE_AMONG_OPTIONS_RE =
  /(?:[2-9]|둘|두|셋|세|넷|네|여러|몇)\s*(?:안|가지|개|곳|것|군데|개소)?\s*중|중에서?\s*(?:하나|한\s*(?:개|곳|군데))|[1-9]\s*순위|순위\s*(?:를|로)?\s*(?:매겨|정해)/i;

/** 검색이 아니라 판단·선택을 요구하는 발화인가. */
export function isChoiceAmongOptionsRequest(userText: string): boolean {
  const normalized = userText.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return CHOICE_AMONG_OPTIONS_RE.test(normalized);
}

export function getPlaceSearchToolChoice(options: {
  userText: string;
  round: number;
  tools: AiToolDefinition[];
}): { type: "function"; name: typeof PLACE_SEARCH_TOOL_NAME } | undefined {
  if (options.round !== 0 || !isExplicitPlaceSearchIntent(options.userText)) {
    return undefined;
  }
  // 선택·판단 요구에는 강제하지 않는다. 도구 목록은 건드리지 않으므로
  // `isPlaceSearchCandidate` 로 열린 제공(route.ts `offersPlaceSearch`)은 그대로다.
  if (isChoiceAmongOptionsRequest(options.userText)) {
    return undefined;
  }
  if (!options.tools.some((tool) => tool.name === PLACE_SEARCH_TOOL_NAME)) {
    return undefined;
  }
  return { type: "function", name: PLACE_SEARCH_TOOL_NAME };
}
