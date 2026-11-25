/**
 * 찾아보기(search_web·read_page) 카드가 웹과 앱에서 같은 칸·같은 문장을 쓰게 한다. 2026-11-20 D-85.
 *
 * - 검색 결과는 네이버 순서 그대로 보인다. 순서를 바꾸거나 합치지 않는다(네이버 오픈 API 이용약관의
 *   "가공 없이"·순위 수정 금지, `apps/web/src/lib/ai/webLookup/naverWebLookup.ts`). 출처 "네이버 검색"과
 *   원본으로 가는 링크를 함께 둔다.
 * - 가격은 업체 공식 페이지에 적힌 줄만 보이고, 없으면 "업체에 확인해 주세요" 다(2026-11-22 파운더 결정 2).
 * - 순위·추천·평판·후기 표시는 없다.
 * - 저장된 페이지 카드(`storedCopy`)에는 페이지 제목·금액 줄·확인 시각만 있고 업체 주소·도메인은 없다
 *   (2026-11-22 파운더 결정 4). 그래서 제목은 도메인 없는 문장이고 "페이지 열기" 링크가 없다.
 *   방금 받은 실시간 카드는 그대로 도메인과 링크를 보인다.
 * - 화면 문장은 이 파일에만 있다. 바꾸려면 파운더 승인(D-12)을 받는다.
 */

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export const WEB_LOOKUP_NEEDS_VENDOR_CHECK = "업체에 확인해 주세요";

export const WEB_LOOKUP_COPY = Object.freeze({
  sourceName: "네이버 검색",
  columns: Object.freeze({ name: "업체", area: "지역", category: "분류", page: "공식 페이지", item: "항목", price: "가격" }),
  orderNote: "네이버 검색 순서 그대로예요.",
  verifyNote: "가격과 예약 가능 여부는 업체에 직접 확인해 주세요.",
  openNaver: "네이버에서 보기",
  openPage: "페이지 열기",
  linkOnly: "링크만 열 수 있어요",
  placeholderBody: "검색 결과는 저장하지 않아서 다시 열면 보이지 않아요. 다시 찾아볼까요?",
  pagePriceNote: "공식 페이지에 적힌 그대로예요. 실제 계약 금액과 다를 수 있어요.",
  pageNoPrice: "이 페이지에는 가격이 적혀 있지 않아요.",
  pageTextless: "글이 거의 없는 페이지라 가격을 읽지 못했을 수 있어요.",
  // 도메인을 모를 때(저장된 페이지 카드)의 제목. 2026-11-22 새 문장, 승인 대기(D-12).
  pageTitleWithoutDomain: "공식 페이지에서 확인했어요",
});

/** @param {unknown} value */
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/** @param {unknown} value */
function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** 받침이 있으면 "으로", 없거나 ㄹ 받침이면 "로". 따옴표 밖에 붙인다. @param {string} word */
function roParticle(word) {
  const last = word.trim().slice(-1);
  const code = last ? last.charCodeAt(0) : 0;
  if (code < 0xac00 || code > 0xd7a3) return "로";
  const jongseong = (code - 0xac00) % 28;
  return jongseong === 0 || jongseong === 8 ? "로" : "으로";
}

/** "2026.11.20 16:30" (한국 시각). @param {unknown} value */
export function formatWebLookupDate(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(DATE_FORMAT.formatToParts(date).map(({ type, value: part }) => [type, part]));
  return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`;
}

/** http·https 이고 계정 정보가 없는 주소만 링크로 쓴다. @param {unknown} value */
export function safeWebLookupHref(value) {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** @param {unknown} value */
function hostLabel(value) {
  const href = safeWebLookupHref(value);
  if (!href) return null;
  return new URL(href).hostname.toLowerCase().replace(/^www\./u, "");
}

/** "서울특별시 강남구 테헤란로 1" → "강남구". 구·군이 없으면 광역이 아닌 시. @param {string | null} address */
function areaOf(address) {
  if (!address) return null;
  const tokens = address.split(/\s+/u);
  return tokens.find((token) => /^[가-힣]{1,10}(?:구|군)$/u.test(token))
    ?? tokens.find((token) => /^[가-힣]{2,10}시$/u.test(token) && !/(?:특별시|광역시|특별자치시|특별자치도)$/u.test(token))
    ?? null;
}

/** "연애,결혼>예식장" → "예식장". @param {string | null} category */
function categoryOf(category) {
  if (!category) return null;
  const parts = category.split(">").map((part) => part.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

const SEARCH_FAILURE = Object.freeze({
  couple_daily_cap: "오늘 찾아볼 수 있는 횟수를 다 썼어요. 내일 다시 찾을 수 있어요.",
  global_daily_cap: "오늘은 더 찾아볼 수 없어요. 내일 다시 찾을 수 있어요.",
  global_cost_cap: "오늘은 더 찾아볼 수 없어요. 내일 다시 찾을 수 있어요.",
  invalid_query: "어느 지역의 어떤 업체를 찾을지 알려 주시면 다시 찾아볼게요.",
});
const SEARCH_FAILURE_DEFAULT = "지금은 인터넷에서 찾아보지 못했어요. 잠시 뒤에 다시 해 주세요.";
/** 사용자에게 보일 까닭이 없는 실패(모델·턴 한도). 카드를 그리지 않는다. */
const SILENT_FAILURES = new Set(["turn_search_limit", "turn_read_limit", "url_not_from_search", "web_lookup_unavailable", "disabled"]);

/**
 * @param {unknown} rawOutput
 * @param {boolean} success
 */
export function getWebLookupSearchCard(rawOutput, success) {
  const output = record(rawOutput) ?? {};
  const query = text(output.query);
  const checkedAtLabel = formatWebLookupDate(output.checkedAt);
  if (!success) {
    const reason = text(output.error) ?? "search_unavailable";
    if (SILENT_FAILURES.has(reason)) return null;
    return {
      kind: "failed",
      title: "인터넷에서 찾아보지 못했어요",
      body: SEARCH_FAILURE[reason] ?? SEARCH_FAILURE_DEFAULT,
    };
  }
  if (output.displayOnlyPlaceholder === true) {
    const count = typeof output.resultCount === "number" && output.resultCount >= 0 ? output.resultCount : 0;
    return {
      kind: "placeholder",
      title: `${checkedAtLabel ? `${checkedAtLabel}에 ` : ""}${query ? `'${query}'${roParticle(query)}` : "인터넷에서"} ${count}곳을 찾았어요`,
      body: WEB_LOOKUP_COPY.placeholderBody,
    };
  }
  const hits = Array.isArray(output.hits) ? output.hits.map(record).filter(Boolean) : [];
  const rows = hits.map((hit) => {
    const address = text(hit.address);
    const href = safeWebLookupHref(hit.url);
    return {
      ref: text(hit.ref) ?? "",
      name: text(hit.name) ?? "",
      area: areaOf(address),
      address,
      category: categoryOf(text(hit.category)),
      telephone: text(hit.telephone),
      description: text(hit.description),
      href,
      hrefLabel: hostLabel(hit.url),
      readable: hit.readable === true,
      isWebDocument: hit.source === "naver_web",
    };
  }).filter((row) => row.name);
  if (rows.length === 0) {
    return {
      kind: "empty",
      title: query ? `'${query}'${roParticle(query)} 찾은 곳이 없어요` : "찾은 곳이 없어요",
      body: "지역이나 업체 이름을 바꿔 볼까요?",
    };
  }
  return {
    kind: "results",
    title: `${WEB_LOOKUP_COPY.sourceName}에서 ${rows.length}곳을 찾았어요`,
    subtitle: `${checkedAtLabel ? `${checkedAtLabel}에 확인했어요. ` : ""}${WEB_LOOKUP_COPY.orderNote}`,
    rows,
    naverHref: query ? `https://search.naver.com/search.naver?query=${encodeURIComponent(query)}` : null,
  };
}

const PAGE_FAILURE = Object.freeze({
  blocked_by_terms: "이 사이트는 약관상 자동으로 읽지 않아요. 직접 열어 확인해 주세요.",
  blocked_by_robots: "이 사이트가 자동 읽기를 허락하지 않아 읽지 않았어요. 직접 열어 확인해 주세요.",
  robots_unreachable: "이 사이트의 읽기 허락을 확인하지 못해 읽지 않았어요. 직접 열어 확인해 주세요.",
  not_a_page: "글로 된 페이지가 아니라 읽지 못했어요. 직접 열어 확인해 주세요.",
  couple_daily_cap: "오늘 찾아볼 수 있는 횟수를 다 썼어요. 내일 다시 확인할 수 있어요.",
  global_daily_cap: "오늘은 더 확인할 수 없어요. 내일 다시 확인할 수 있어요.",
  global_cost_cap: "오늘은 더 확인할 수 없어요. 내일 다시 확인할 수 있어요.",
});
const PAGE_FAILURE_DEFAULT = "페이지를 열지 못했어요. 직접 열어 확인해 주세요.";

/**
 * @param {unknown} rawOutput
 * @param {boolean} success
 */
export function getWebLookupPageCard(rawOutput, success) {
  const output = record(rawOutput) ?? {};
  // 저장본은 주소·도메인을 남기지 않는다. 옛 행에 남아 있어도 그리지 않는다(2026-11-22 파운더 결정 4).
  const stored = output.storedCopy === true;
  const href = stored ? null : safeWebLookupHref(output.url);
  const domain = stored ? null : (text(output.domain) ?? hostLabel(output.url));
  if (!success) {
    const reason = text(output.error) ?? "fetch_failed";
    if (SILENT_FAILURES.has(reason)) return null;
    return {
      kind: "failed",
      title: domain ? `${domain} 페이지를 읽지 못했어요` : "페이지를 읽지 못했어요",
      body: PAGE_FAILURE[reason] ?? PAGE_FAILURE_DEFAULT,
      href,
    };
  }
  const prices = Array.isArray(output.prices)
    ? output.prices.map(record).filter(Boolean).flatMap((fact) => {
        const label = text(fact.label);
        const amount = text(fact.amount);
        return label && amount ? [{ label, amount, quote: text(fact.quote) }] : [];
      })
    : [];
  const checkedAtLabel = formatWebLookupDate(output.checkedAt);
  return {
    kind: "page",
    title: domain ? `${domain} 공식 페이지에서 확인했어요` : WEB_LOOKUP_COPY.pageTitleWithoutDomain,
    pageTitle: text(output.title),
    subtitle: checkedAtLabel ? `${checkedAtLabel}에 확인했어요.` : null,
    prices,
    priceCell: prices.length > 0 ? null : WEB_LOOKUP_NEEDS_VENDOR_CHECK,
    note: prices.length > 0
      ? WEB_LOOKUP_COPY.pagePriceNote
      : output.textless === true ? WEB_LOOKUP_COPY.pageTextless : WEB_LOOKUP_COPY.pageNoPrice,
    href,
    domain,
  };
}
