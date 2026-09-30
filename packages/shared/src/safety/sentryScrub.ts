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
 * 않으려고 `#` 뒤에 둔 것이 여기서 새어 나간다. 주소는 도메인과 경로만 남긴다.
 *
 * 주소 모양이 아닌 값(`sentry.op`, 측정값)은 그대로 둔다. 어느 화면이 느렸는지는 알아야 하기 때문이다.
 * `url.query`·`url.fragment` 처럼 이름이 꼬리를 뜻하는 칸은 통째로 버린다.
 */
const URL_TAIL = /[?#][\s\S]*$/;
const URL_TAIL_KEY = /(?:^|[._])(?:query|fragment|hash|search)$/i;
const MAX_CONTEXT_DEPTH = 6;

function stripUrlTails(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return /^https?:\/\//i.test(value) ? value.replace(URL_TAIL, "") : value;
  if (value === null || typeof value !== "object" || depth >= MAX_CONTEXT_DEPTH) return value;
  if (Array.isArray(value)) return value.map(item => stripUrlTails(item, depth + 1));

  const cleaned: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (URL_TAIL_KEY.test(key)) continue;
    cleaned[key] = stripUrlTails(item, depth + 1);
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

export function sanitizeSentryBreadcrumb<T extends ScrubbableBreadcrumb>(breadcrumb: T): T {
  const withoutAttributeValues = breadcrumb.message?.replace(
    DOM_ATTRIBUTE_WITH_USER_TEXT,
    `[$1="${REDACTED}"]`,
  );

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
    span.description = redactSentryText(span.description);
    span.data = {};
  }

  return event;
}
