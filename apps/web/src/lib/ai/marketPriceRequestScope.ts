export const MARKET_PRICE_CATEGORY_KEYS = ["hall", "studio", "dress", "makeup"] as const;
type MarketPriceCategory = typeof MARKET_PRICE_CATEGORY_KEYS[number];

// 현재 질문에 명시한 분야를 다른 분야의 유효한 인수로 바꿔 조회하지 않게 한다.
// 일반 준비 범위나 자연어 전체를 판정하지 않고 아래 명시 분야·제외 표현만 확인한다.
const UNSUPPORTED_TARGET = /신\s*혼\s*여\s*행|허니문|예물|결혼\s*반지|웨딩\s*링|가전(?:\s*제품)?|가구|생활\s*용품|혼수|신혼\s*집|한복|예단|청첩장|초대장|답례품|본식\s*(?:스냅|영상)|\bhoneymoon\b|\b(?:home\s+)?appliances?\b|\bfurniture\b|\bwedding\s+rings?\b|\bjewel(?:ry|lery)\b|\bhousing\b/iu;
const SUPPORTED_TARGETS: ReadonlyArray<readonly [MarketPriceCategory, RegExp]> = [
  ["hall", /웨딩\s*홀|예식\s*장|결혼\s*식장|식장|\b(?:wedding\s+)?hall\b|\bvenue\b/giu],
  ["studio", /스\s*튜\s*디\s*오|웨딩\s*(?:사진\s*)?촬영|웨딩\s*사진|\bstudio\b/giu],
  ["dress", /드\s*레\s*스|\bdresses?\b/giu],
  ["makeup", /메\s*이\s*크\s*업|\bmake[\s-]*up\b/giu],
];
const EXCLUDED_AFTER = /^\s*(?:의\s*)?(?:(?:공시(?:\s*가격)?|가격|비용|자료|통계|견적|분야)(?:은|는|을|를|이|가)?\s*){0,2}(?:은|는|을|를|이|가)?\s*(?:말고|말구|제외|빼고|아닌|아니라|아니고|필요\s*없|조회(?:는)?\s*하지\s*마|찾지\s*마)/u;
const EXCLUDED_BEFORE = /(?:\b(?:not|no|except|excluding|without|instead\s+of)(?:\s+(?:the|a|an|any|wedding))*|제외할|빼려는|필요\s*없는)\s*$/iu;
const COORDINATED_LIST = /^(?:\s|[,，·/&+]|와|과|및|또는|하고|이랑|랑|이나|나|혹은|그리고|가격|비용|공시|자료|통계|은|는|의|\band\b|\bor\b)*$/iu;

/** 서버 사용자 발화만 읽는다. 실행 경계에서는 context.currentUserText로만 범위를 확인한다. */
export function assessMarketPriceRequestScope(currentUserText: string | undefined): {
  hasUnsupportedTarget: boolean;
  hadExplicitTarget: boolean;
  requestedSupportedCategories: ReadonlySet<MarketPriceCategory>;
} {
  const text = (currentUserText ?? "").normalize("NFKC");
  const requested = new Set<MarketPriceCategory>();
  const hasUnsupportedTarget = UNSUPPORTED_TARGET.test(text);
  const mentions: Array<{ start: number; end: number; category: MarketPriceCategory | null }> = [];
  for (const [category, pattern] of SUPPORTED_TARGETS) {
    for (const mention of text.matchAll(pattern)) {
      mentions.push({ start: mention.index, end: mention.index + mention[0].length, category });
    }
  }
  for (const mention of text.matchAll(new RegExp(UNSUPPORTED_TARGET.source, "giu"))) {
    mentions.push({ start: mention.index, end: mention.index + mention[0].length, category: null });
  }
  // 미지원 여행의 식대·대관료를 결혼식장으로 바꾸지 않는다. 지원 분야끼리의 전환은 보존한다.
  if (!hasUnsupportedTarget) {
    for (const mention of text.matchAll(/식대|대관료/gu)) {
      mentions.push({ start: mention.index, end: mention.index + mention[0].length, category: "hall" });
    }
  }
  mentions.sort((left, right) => left.start - right.start);
  // "스튜디오와 드레스 말고"는 두 항목 모두 제외한다. 다른 절의 긍정 요청은 묶지 않는다.
  let group: typeof mentions = [];
  const collect = () => {
    const excluded = group.some(({ start, end }) => EXCLUDED_AFTER.test(text.slice(end, end + 80))
      || EXCLUDED_BEFORE.test(text.slice(Math.max(0, start - 40), start)));
    if (!excluded) for (const mention of group) if (mention.category) requested.add(mention.category);
  };
  for (const mention of mentions) {
    const prior = group.at(-1);
    if (prior && !COORDINATED_LIST.test(text.slice(prior.end, mention.start))) { collect(); group = []; }
    group.push(mention);
  }
  collect();
  // "그럼 전국은?"처럼 대상을 다시 말하지 않은 후속 질문은 기존 도구 문맥을 보존한다.
  return { hasUnsupportedTarget, hadExplicitTarget: mentions.length > 0, requestedSupportedCategories: requested };
}

export function isSupportedMarketPriceCategory(value: unknown): value is MarketPriceCategory {
  return typeof value === "string" && (MARKET_PRICE_CATEGORY_KEYS as readonly string[]).includes(value);
}
