// 오류 리포팅은 사고를 보기 위한 것이지 대화를 보기 위한 것이 아니다.
// 목표 아키텍처 §6 불변식 9: 로그·분석·오류·push·URL에 대화·첨부 원문을 넣지 않는다.
//
// 웹과 모바일이 서로 다른 Sentry SDK를 쓰므로 여기서는 SDK 타입에 묶이지 않는 구조적
// 타입만 사용한다. 규칙이 한 벌이어야 한쪽만 고쳐지는 일이 없다.

const REDACTED = "[redacted]";

export interface ScrubbableBreadcrumb {
  message?: string;
  data?: unknown;
  [key: string]: unknown;
}

export interface ScrubbableEvent {
  user?: unknown;
  request?: unknown;
  extra?: unknown;
  contexts?: unknown;
  message?: string;
  transaction?: string;
  breadcrumbs?: ScrubbableBreadcrumb[];
  logentry?: { message?: string; params?: unknown };
  exception?: { values?: Array<{ value?: string }> };
  [key: string]: unknown;
}

export interface ScrubbableTransaction extends ScrubbableEvent {
  spans?: Array<{ description?: string; data?: unknown }>;
}

/** `beforeSendSpan` 이 받는 span JSON 중 우리가 손대는 칸만 적는다. */
export interface ScrubbableSpan {
  description?: string;
  data?: unknown;
  [key: string]: unknown;
}

/**
 * 자유 문장 안에 섞여 나가는 식별자를 지운다. 이것만으로 모든 민감 정보를 잡을 수는
 * 없으므로, 아래 필드 제거(`extra`·`user`·`request`·breadcrumb data)와 함께 써야 한다.
 */
export function redactSentryText(value: string | undefined): string | undefined {
  if (!value) return value;

  return value
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, REDACTED)
    .replace(/(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g, REDACTED)
    .replace(/\b\d{6}-?[1-4]\d{6}\b/g, REDACTED)
    .replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{12,}(?:\.[A-Za-z0-9_-]{12,})?\b/g, REDACTED)
    .replace(/\b(?:sk|sbp|sntrys)_[A-Za-z0-9_-]{16,}\b/g, REDACTED);
}

/**
 * 브라우저 SDK 는 페이지 로드 성능 이벤트에 `contexts.trace.data["url.full"]` 로 **주소 전체**를 싣는다
 * (2026-09-29 운영에서 확인: `…/wedding-code?utm_source=x#v=…&a=<답 코드>`). `request` 를 지워도 이 자리는 남는다.
 * 웨딩코드 링크는 `#` 뒤에 답 전체와 함께 보기 접근 키를, `?` 뒤에는 유입 표식을 싣고 다니므로 서버에 보내지
 * 않으려고 `#` 뒤에 둔 것이 여기서 새어 나간다. 주소는 도메인과 경로만 남긴다. `/` 로 시작하는 상대 경로도
 * 주소로 보고 같은 꼬리를 뗀다(`/invite#<초대 코드>`).
 *
 * 주소 모양이 아닌 값(`sentry.op`, 측정값)은 그대로 둔다. 어느 화면이 느렸는지는 알아야 하기 때문이다.
 * `url.query`·`url.fragment` 처럼 이름이 꼬리를 뜻하는 칸은 통째로 버린다.
 *
 * 성능 이벤트는 같은 자리에 요소 선택자도 싣는다(`lcp.element`, `cls.source.1` 등). 선택자에는 아래
 * `DOM_ATTRIBUTE_WITH_USER_TEXT` 가 말하는 속성값이 그대로 붙으므로, 주소가 아닌 문자열에는 그 값만 지운다.
 * 선택자 칸(`SELECTOR_VALUE_KEY`)은 id·class 에 문항 번호와 고른 상태가 실리므로 태그 이름만 남긴다(`tagNamesOnly`).
 */
const URL_TAIL = /[?#][\s\S]*$/;
const URL_TAIL_KEY = /(?:^|[._])(?:query|fragment|hash|search)$/i;
const MAX_CONTEXT_DEPTH = 6;
/**
 * browser-utils 10.66 이 `htmlTreeAsString` 값을 싣는 속성 이름. 기본 설정에서는 pageload 의 `contexts.trace.data`
 * (`browserMetrics.js` `lcp.element`·`cls.source.N`)에, 따로 선 span 에서는 span data(`lcp.js`·`cls.js` 같은 이름,
 * span streaming 의 `webVitalSpans.js` 는 `browser.web_vital.` 접두)에 온다.
 */
const SELECTOR_VALUE_KEY = /^(?:browser\.web_vital\.)?(?:lcp\.element|cls\.source\.\d+)$/;
/**
 * 같은 자리에 browser-utils 10.66 은 LCP 요소의 id 속성 원문도 싣는다(`browserMetrics.js`·`lcp.js` 의 `lcp.id`,
 * `webVitalSpans.js` 의 `browser.web_vital.lcp.id`). wc64 는 문항을 가리키는 id(`wc64-stmt-…`)를 쓰므로 태그 이름으로
 * 줄일 것이 없어 칸째로 버린다.
 */
const ELEMENT_ID_KEY = /^(?:browser\.web_vital\.)?lcp\.id$/;

function stripUrlTails(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    // `/invite#<초대 코드>` 같은 상대 경로도 주소다. 절대 주소만 보면 꼬리가 그대로 나간다.
    return /^(?:https?:\/\/|\/)/i.test(value) ? value.replace(URL_TAIL, "") : redactDomAttributeValues(value);
  }
  if (value === null || typeof value !== "object" || depth >= MAX_CONTEXT_DEPTH) return value;
  if (Array.isArray(value)) return value.map(item => stripUrlTails(item, depth + 1));

  const cleaned: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (URL_TAIL_KEY.test(key)) continue;
    if (ELEMENT_ID_KEY.test(key)) continue;
    cleaned[key] = SELECTOR_VALUE_KEY.test(key) && typeof item === "string"
      ? tagNamesOnly(item)
      : stripUrlTails(item, depth + 1);
  }
  return cleaned;
}

function removeCommonPrivateFields<T extends ScrubbableEvent>(event: T): T {
  // `extra`는 임의 payload가 실리는 자리다. 마스킹이 아니라 통째로 버린다.
  event.user = undefined;
  event.request = undefined;
  event.extra = undefined;
  if (event.contexts !== undefined) event.contexts = stripUrlTails(event.contexts);
  event.message = redactSentryText(event.message);
  event.transaction = redactSentryText(event.transaction);
  event.breadcrumbs = event.breadcrumbs?.map(sanitizeSentryBreadcrumb);
  return event;
}

/**
 * Sentry의 DOM breadcrumb은 클릭된 요소를 CSS 선택자처럼 적으면서
 * `["aria-label","type","name","title","alt"]` 속성값을 **그대로** 붙인다.
 * 이 앱에서 그 자리에 오는 것은 사용자 자신의 글이다:
 *
 *     button[aria-label="상견례_견적_최종.pdf 첨부 제거"]     ← 첨부 파일명
 *     a[aria-label="…게시글 보기"]                            ← 커뮤니티 글 제목
 *     img[alt="예비신부수민"]                                  ← 닉네임
 *
 * `redactSentryText`는 URL·이메일·전화·주민번호·토큰 패턴만 보므로 한글 문장은
 * 하나도 안 걸린다. 그래서 값만 지우고 **구조(태그·class·id)는 남긴다** — 어디를
 * 눌렀는지는 알아야 사고를 재현한다.
 *
 * `type`은 남긴다. `button`·`submit` 같은 고정값이라 사용자 자료가 아니다.
 *
 * 값 안에 따옴표가 들어가도 놓치지 않도록 `"]`까지 최소 매칭한다.
 */
const DOM_ATTRIBUTE_WITH_USER_TEXT = /\[(aria-label|title|alt|name)="[\s\S]*?"\]/g;

function redactDomAttributeValues(value: string): string;
function redactDomAttributeValues(value: string | undefined): string | undefined;
function redactDomAttributeValues(value: string | undefined): string | undefined {
  return value?.replace(DOM_ATTRIBUTE_WITH_USER_TEXT, `[$1="${REDACTED}"]`);
}

export function sanitizeSentryBreadcrumb<T extends ScrubbableBreadcrumb>(breadcrumb: T): T {
  const withoutAttributeValues = redactDomAttributeValues(breadcrumb.message);

  return {
    ...breadcrumb,
    message: redactSentryText(withoutAttributeValues),
    // breadcrumb data에는 요청 본문과 상태가 그대로 실린다.
    data: undefined,
  };
}

export function sanitizeSentryEvent<T extends ScrubbableEvent>(event: T): T {
  removeCommonPrivateFields(event);

  if (event.logentry) {
    event.logentry.message = redactSentryText(event.logentry.message) ?? REDACTED;
    event.logentry.params = undefined;
  }

  for (const exception of event.exception?.values ?? []) {
    exception.value = redactSentryText(exception.value);
  }

  return event;
}

export function sanitizeSentryTransaction<T extends ScrubbableTransaction>(event: T): T {
  removeCommonPrivateFields(event);

  for (const span of event.spans ?? []) {
    // `enableInteractions` 를 켜면 클릭 자식 span(`ui.interaction.click`)의 이름도 요소 선택자다(`browserMetrics.js`).
    const description = typeof span.description === "string" && isSelectorNamedSpan(span)
      ? tagNamesOnly(span.description)
      : span.description;
    span.description = redactSentryText(redactDomAttributeValues(description));
    span.data = {};
  }

  return event;
}

/**
 * 브라우저 SDK(browser-utils 10.66 `htmlTreeAsString`)는 INP(`ui.interaction.click` 등)·CLS(`ui.webvital.cls`)·
 * LCP(`ui.webvital.lcp`) span 의 이름을 `body > div > h2#wc64-stmt-PLAN-A1.selected[aria-label="…"]` 꼴의 요소 선택자로
 * 만든다. id 와 class 에는 문항 번호·고른 상태가 실리므로 aria-label 값만 지워서는 모자란다. 마디마다 태그 이름만 남긴다.
 * 요소가 없을 때 SDK 가 쓰는 고정 이름(`<unknown>`, `Layout shift`, `Largest contentful paint`)은 그대로 둔다.
 */
const SELECTOR_FREE_SPAN_NAMES = new Set(["<unknown>", "Layout shift", "Largest contentful paint"]);
const SELECTOR_ATTRIBUTE = /\[[\w-]+="[\s\S]*?"\]/g;
/** 태그 이름 바로 뒤는 끝이거나 `#`·`.`·`[` 이어야 한다. 속성값이 남긴 낱말 조각(`b"]`)을 태그로 읽지 않는다. */
const LEADING_TAG = /^[A-Za-z][\w-]*(?=$|[#.[])/;

function isSelectorNamedSpan(span: ScrubbableSpan): boolean {
  const data = span.data && typeof span.data === "object" && !Array.isArray(span.data)
    ? span.data as Record<string, unknown>
    : undefined;
  const op = typeof span.op === "string" ? span.op : data?.["sentry.op"];
  return typeof op === "string" && (op.startsWith("ui.interaction") || op.startsWith("ui.webvital"));
}

function tagNamesOnly(description: string): string {
  if (SELECTOR_FREE_SPAN_NAMES.has(description)) return description;
  // 속성값 안의 ` > ` 에 마디가 잘리지 않게 속성 덩어리를 먼저 걷어낸다.
  const tags = description
    .replace(SELECTOR_ATTRIBUTE, "")
    .split(" > ")
    .map(segment => LEADING_TAG.exec(segment.trim())?.[0])
    .filter((tag): tag is string => Boolean(tag));
  return tags.length > 0 ? tags.join(" > ") : REDACTED;
}

/**
 * `beforeSendSpan` 용. 브라우저 SDK 는 INP·LCP·CLS 를 따로 선 span 으로도 보내는데, 그 이름(description)이
 * 눌린 요소의 선택자라 `button[aria-label="…"]` 꼴로 사용자 글이 붙는다. 이 span 들은 `beforeSend`·
 * `beforeSendTransaction` 을 거치지 않는다.
 *
 * **반드시 객체를 돌려준다.** Sentry core 10.66 은 `beforeSendSpan` 이 null 을 돌려주면 경고만 띄우고 원본
 * span 을 그대로 보낸다(`envelope.js` `createSpanEnvelope`, `client.js` `_processBeforeSend`). 그래서 이 함수로는
 * 버리지 못하고 지우기만 한다. 버리는 일은 전송 경계가 맡는다.
 *
 * 측정값·op 는 남겨 어느 화면이 느렸는지는 알 수 있게 한다. 상호작용·웹바이탈 span(op 가 `ui.interaction`·
 * `ui.webvital` 로 시작)의 이름은 요소 선택자뿐이라 태그 이름만 남긴다(`tagNamesOnly`).
 */
export function sanitizeSentrySpan<T extends ScrubbableSpan>(span: T): T {
  const cleaned: T = { ...span };
  if (typeof span.description === "string") {
    const description = isSelectorNamedSpan(span) ? tagNamesOnly(span.description) : span.description;
    cleaned.description = redactSentryText(redactDomAttributeValues(description));
  }
  if (span.data !== undefined) cleaned.data = stripUrlTails(span.data);
  return cleaned;
}
