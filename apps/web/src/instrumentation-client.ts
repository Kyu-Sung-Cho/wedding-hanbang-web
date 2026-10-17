// Sentry 브라우저 SDK는 gzip 147KB로 이 앱 클라이언트 JS의 최대 덩어리다
// (2026-07-25 실측: 전체 388KB 중 Sentry 147 + PostHog 64). 초기 번들에 두면
// 하이드레이션과 경쟁해 "누르면 반응이 늦다"는 체감을 만든다.
//
// 그래서 유휴 시점에 동적 로드하되, 로드 전 구간이 감시 사각지대가 되지
// 않도록 그 사이의 error·unhandledrejection을 버퍼에 담았다가 준비되면
// 그대로 흘려보낸다. 결과적으로 잡히는 에러는 이전과 같고 첫 화면만 가벼워진다.
//
// Sentry(@sentry/nextjs, apps/web/package.json 의 ^10.66.0)를 올릴 때 다시 볼 곳.
// 웨딩코드·라운지 웨딩코드 화면의 차단은 아래 세 가지 SDK 내부 동작에 기댄다. 시험(sentryScrub.test.ts,
// weddingCodeLikertInstrumentation.test.ts)은 이 동작을 흉내 낸 것이라 SDK 쪽이 바뀌어도 초록으로 남는다.
// 올린 뒤에는 세 곳을 node_modules 의 @sentry/core·@sentry/browser-utils(옛 판 이름은 @sentry-internal/browser-utils)
// 원본과 직접 대조한다.
//  1. beforeSendSpan 의 null 함정: core 10.66 `envelope.js` 의 `createSpanEnvelope` 는 콜백이 null 을 돌려주면 경고만
//     띄우고 원본 span 을 그대로 싣는다. 그래서 `sanitizeSpanForSentry` 는 늘 지운 객체를 돌려주고, 버리기는 전송 경계
//     (`weddingCodeSafeTransport`)가 맡는다. 같은 곳에서 `isStreamedBeforeSendSpanCallback` 이 참이면 콜백을 아예 부르지
//     않으므로, span streaming 을 켜거나 콜백 감싸는 방식을 바꾸면 이 정제가 통째로 빠진다.
//  2. span 필드 이름: span JSON 의 `start_timestamp`·`op`·`description`·`parent_span_id`·`trace_id`·`data`(`spanRecord`),
//     트랜잭션의 `start_timestamp`·`transaction`·`contexts.trace.op`·`parent_span_id`·`trace_id`(`transactionRecord`).
//     이름이 바뀌면 머문 구간 판정(`startedDuringLikertStay`)이 아무것도 잡지 못한다. span 시각 기준
//     (`browserPerformanceTimeOrigin`, `timestampInSeconds`, `likertTimeOriginMs` 주석)도 함께 본다.
//  3. browser-utils 선택자 칸: 요소 선택자(`htmlTreeAsString`)를 싣는 data 칸 `lcp.element`·`cls.source.N`, 요소 id 원문
//     칸 `lcp.id`(span streaming 은 `browser.web_vital.` 접두), 그리고 INP·LCP·CLS span 이름. 칸 목록은
//     packages/shared/src/safety/sentryScrub.ts 의 `SELECTOR_VALUE_KEY`·`ELEMENT_ID_KEY`·`isSelectorNamedSpan` 이다.
//     새 칸이나 새 op 가 생기면 id·class 에 든 문항 번호(`wc64-stmt-…`)와 고른 상태가 그대로 나간다.
import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentrySpan,
  sanitizeSentryTransaction,
} from "@hanbang/shared";

import { attachClientErrorSink, clearBufferedClientErrors } from "@/lib/observability/clientErrorReport";
import { resolveDeploymentEnvironment } from "@/lib/observability/deploymentEnvironment";
import { registerClientMonitoringPathCommit } from "@/lib/observability/clientMonitoringPathCommit";
import { isWeddingCodeLikertPath } from "@/lib/analyticsPrivacy";

type SentryModule = typeof import("@sentry/nextjs");

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

/** 프리뷰 배포를 운영으로 착각하지 않게 하는 값. 판정 규칙과 이유는 도우미에 있다. */
function resolveEnvironment(): string {
  return resolveDeploymentEnvironment({
    vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV,
    hostname: typeof window !== "undefined" ? window.location.hostname : undefined,
    nodeEnv: process.env.NODE_ENV,
  });
}

let sentry: SentryModule | null = null;
const buffered: unknown[] = [];
const MAX_BUFFERED = 20;
let initializationPending = false;
let listenersAttached = false;
let errorSinkAttached = false;

function isLikertPage(): boolean {
  return typeof window !== "undefined" && isWeddingCodeLikertPath(window.location.pathname);
}

/** 경로(`/...`)나 절대 URL 모양 값이면 그 pathname, 아니면 null. */
function locationPathname(value: unknown): string | null {
  if (typeof value !== "string" || (!value.startsWith("/") && !/^https?:\/\//i.test(value))) return null;
  try {
    return new URL(value, "https://hanbang.invalid").pathname;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * 지금 경로가 보호 경로이거나, 머문 구간이 아직 열려 있거나(`likertStayIsOpen`), 값 안의 주소 모양 문자열 중 하나의
 * pathname 이 보호 경로이면 참.
 *
 * 뒤로·앞으로 가기(traverse)는 주소를 먼저 목적지로 바꾸지만 라운지 화면은 경로 확정까지 남아 있고 눌린다
 * (next 16.3.8 은 ACTION_RESTORE 를 startTransition 안에서 확정한다). 그 사이 클릭 기록과 오류는 지금 경로만 봐서는
 * 라운지 것인지 알 수 없으므로, 구간이 열려 있는 동안은 모두 보호 경로의 것으로 본다.
 *
 * `?redirect=` 같은 쿼리 안의 주소는 열어 보지 않는다. 로그인하지 않은 사람이 라운지 웨딩코드를 열면 미들웨어가
 * `/login?redirect=/wedding/preparation-style` 로 보내는데, 쿼리까지 보면 로그인·온보딩 화면의 오류가 통째로 사라진다.
 * wc64 는 답을 주소에 싣지 않고, 나가는 주소의 `?`·`#` 꼬리는 정제기(`sanitizeSentryEvent` 등)가 뗀다.
 * PostHog 쪽 판정(`valueTouchesWeddingCodeLikertPath`)은 쿼리 안의 주소를 열되, 라운지 주소는 거기서 막지 않는다
 * (공개 답 링크 경로와 판·화면 이름 밖의 쿼리가 붙은 라운지 주소만 막는다). 그래서 두 판정 모두 로그인·온보딩 화면을 살린다.
 * 쿼리 꼬리를 떼지 않고 보내는 PostHog 만 쿼리 안의 공개 답 링크를 따로 막는다.
 */
function touchesLikertPath(value: unknown): boolean {
  if (isLikertPage()) return true;
  if (likertStayIsOpen()) return true;
  const pending: unknown[] = [value];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const item = pending.pop();
    if (isWeddingCodeLikertPath(locationPathname(item))) return true;
    if (!Array.isArray(item) && !isPlainObject(item)) continue;
    if (visited.has(item)) continue;
    visited.add(item);
    for (const nested of Object.values(item)) pending.push(nested);
  }
  return false;
}

/**
 * 보호 경로에 머문 구간(`performance.now()` 기준 ms, end 가 없으면 아직 머무는 중).
 *
 * INP span 은 화면을 떠난 뒤 탭이 가려질 때 만들어지고, 그때의 이름표(transaction)는 라운지가 아니다
 * (들어갈 때 이동 기록을 건너뛰므로 scope 이름이 앞 화면 그대로다). 그래서 지금 경로나 span 의 주소로는
 * 라운지에서 누른 것인지 알 수 없다. span 이 시작한 시각이 이 구간 안이면 라운지에서 생긴 것으로 본다.
 */
/**
 * 구간은 보호 경로를 떠나는 이동이 **확정(commit)될 때** 닫는다. App Router 는 새 화면이 확정될 때까지 라운지 화면을
 * 그대로 보여 주고 사용자는 그 화면을 계속 누를 수 있으므로, 이동 시작에서 닫으면 그 사이의 상호작용이 구간 밖으로 샌다.
 * `leaving` 은 떠나는 이동을 시작한 tick 이다. 그 뒤에 시작한 목적지 이동 기록(`isDestinationNavigation`)만 구간 판정에서 뺀다.
 */
type LikertStay = { start: number; end?: number; leaving?: number };
const likertStays: LikertStay[] = [];
/** 이보다 많아지면 가장 오래된 두 구간을 하나로 합친다. 버리면 늦게 오는 span 이 빠져나가므로 넓혀서 덮는다. */
const MAX_LIKERT_STAYS = 8;
/** 구간에 걸린 span 에 다는 표식. 전송 경계가 이 경로를 보고 봉투째 버린다. */
const LIKERT_SPAN_MARKER = "/wedding/preparation-style";

function monotonicNowMs(): number {
  const perf = globalThis.performance;
  return typeof perf?.now === "function" ? perf.now() : Date.now();
}

let spanTimeOriginMs: number | undefined;

/**
 * Sentry 가 web vital span 시각을 셀 때 쓰는 기준(core 10.66 `browserPerformanceTimeOrigin`)을 그대로 따른다.
 * `timeOrigin` 이 지금 시계와 5분 넘게 어긋나면 `navigationStart`, 그것도 어긋나면 `Date.now() - performance.now()`.
 * Sentry 가 처음 셀 때와 같은 순간(초기화 직후)에 한 번 정해 둔다.
 */
function likertTimeOriginMs(): number {
  if (spanTimeOriginMs !== undefined) return spanTimeOriginMs;
  const perf = globalThis.performance as (Performance & { timing?: { navigationStart?: number } }) | undefined;
  if (typeof perf?.now !== "function") return (spanTimeOriginMs = 0);
  const now = perf.now();
  const date = Date.now();
  const origin = [perf.timeOrigin, perf.timing?.navigationStart].find(
    candidate => typeof candidate === "number" && Math.abs(candidate + now - date) < 300_000,
  );
  return (spanTimeOriginMs = origin ?? date - now);
}

function openLikertStay(start = monotonicNowMs()) {
  const last = likertStays[likertStays.length - 1];
  if (last && last.end === undefined) {
    // 떠나려다 다시 보호 경로로 오면(또는 보호 경로로 확정되면) 떠나는 중이 아니다.
    last.leaving = undefined;
    return;
  }
  likertStays.push({ start });
  if (likertStays.length > MAX_LIKERT_STAYS) {
    const [first, second] = likertStays.splice(0, 2);
    likertStays.unshift({ start: first.start, end: second.end, leaving: second.leaving });
  }
}

/** 보호 경로가 아닌 곳으로 이동을 시작했다. 구간은 닫지 않고 그 tick 만 적는다(처음 한 번). */
function markLeavingLikertStay() {
  const last = likertStays[likertStays.length - 1];
  if (last && last.end === undefined && last.leaving === undefined) last.leaving = monotonicNowMs();
}

/** 경로 확정 콜백에서만 부른다. */
function closeLikertStay() {
  const last = likertStays[likertStays.length - 1];
  if (last && last.end === undefined) last.end = monotonicNowMs();
}

/** 마지막 구간이 아직 닫히지 않았다(보호 경로에 있거나, 보호 경로를 떠나는 이동이 아직 확정되지 않았다). */
function likertStayIsOpen(): boolean {
  const last = likertStays[likertStays.length - 1];
  return last !== undefined && last.end === undefined;
}

/**
 * Sentry 와 같은 초 단위 식으로 비교한다. Sentry 는 `timestampInSeconds()`·`msToSec(origin + startTime)` 로
 * `(origin + tick) / 1000` 을 만든다. 같은 tick 이면 정확히 같은 값이 되어야 경계(`>=`·`<`)가 흔들리지 않는다.
 * `epochSeconds * 1000 - origin` 으로 되돌리면 소수가 붙은 실제 timeOrigin 에서 정밀도를 잃는다.
 */
function atOrAfterTick(epochSeconds: number, tickMs: number, originMs: number): boolean {
  return epochSeconds >= (originMs + tickMs) / 1000;
}

/**
 * span 시각의 기준은 둘이다. web vital·LoAF·resource·pageload 는 `browserPerformanceTimeOrigin`(`likertTimeOriginMs`)을,
 * 실시간으로 찍는 span(navigation 루트, fetch)은 core 10.66 `timestampInSeconds` 의 `performance.timeOrigin` 을 쓰고
 * 어긋남을 확인하지 않는다. 잠자기 뒤 오래 열린 탭처럼 둘이 5분 넘게 어긋나면 한 기준으로는 라운지 span 이 구간 밖으로
 * 보인다. 그래서 두 기준 중 하나로라도 구간 안이면 구간 안으로 본다(어긋난 탭에서만 조금 더 버린다).
 */
function likertTimeOriginsMs(): number[] {
  const primary = likertTimeOriginMs();
  const raw = globalThis.performance?.timeOrigin;
  return typeof raw === "number" && Number.isFinite(raw) && raw !== primary ? [primary, raw] : [primary];
}

function stayContaining(epochSeconds: unknown, originMs: number): LikertStay | undefined {
  if (typeof epochSeconds !== "number" || !Number.isFinite(epochSeconds) || likertStays.length === 0) return undefined;
  return likertStays.find(stay => atOrAfterTick(epochSeconds, stay.start, originMs)
    && (stay.end === undefined || !atOrAfterTick(epochSeconds, stay.end, originMs)));
}

/** 목적지 이동 기록의 trace. 같은 봉투의 자식 span 을 루트와 같이 다루려고 몇 개만 기억한다. */
const destinationNavigationTraces: string[] = [];
const MAX_DESTINATION_TRACES = 8;

function rememberDestinationTrace(traceId: unknown) {
  if (typeof traceId !== "string" || traceId === "" || destinationNavigationTraces.includes(traceId)) return;
  destinationNavigationTraces.push(traceId);
  if (destinationNavigationTraces.length > MAX_DESTINATION_TRACES) destinationNavigationTraces.shift();
}

/** 화면에서 생긴 일을 적는 span(눌린 요소·화면 측정). 떠나는 중에 생겼으면 라운지 화면의 것이다. */
function isScreenSpanOp(op: unknown): boolean {
  return typeof op === "string" && (op.startsWith("ui.interaction") || op.startsWith("ui.webvital"));
}

type StartedRecord = {
  start: unknown;
  op: unknown;
  name: unknown;
  parentSpanId: unknown;
  traceId: unknown;
};

/**
 * 떠나는 이동이 연 목적지 이동 기록인가: op 'navigation' 인 루트이고 이름이 보호 경로가 아니며 떠나기 시작한
 * tick 이후에 시작했다. 그 기록의 자식 span(같은 trace, 부모 있음) 중 화면 span 이 아닌 것도 함께 뺀다.
 * 목적지 RSC 요청 같은 자식에 표식이 붙으면 전송 경계가 이동 기록 봉투를 통째로 버리기 때문이다.
 */
function isDestinationNavigation(record: StartedRecord, stay: LikertStay, originMs: number): boolean {
  if (stay.leaving === undefined || typeof record.start !== "number" || !atOrAfterTick(record.start, stay.leaving, originMs)) return false;
  if (!record.parentSpanId) {
    if (record.op !== "navigation" || typeof record.name !== "string" || isWeddingCodeLikertPath(locationPathname(record.name))) return false;
    rememberDestinationTrace(record.traceId);
    return true;
  }
  return !isScreenSpanOp(record.op) && typeof record.traceId === "string" && destinationNavigationTraces.includes(record.traceId);
}

/** span·transaction 이 보호 경로에 머문 구간 안에서 시작했는가(목적지 이동 기록은 뺀다). 두 시각 기준 중 하나라도 걸리면 참. */
function startedDuringLikertStay(record: StartedRecord): boolean {
  return likertTimeOriginsMs().some(originMs => {
    const stay = stayContaining(record.start, originMs);
    return stay !== undefined && !isDestinationNavigation(record, stay, originMs);
  });
}

function spanRecord(span: SpanJson): StartedRecord {
  return { start: span.start_timestamp, op: span.op, name: span.description, parentSpanId: span.parent_span_id, traceId: span.trace_id };
}

function transactionRecord(event: { start_timestamp?: unknown; transaction?: unknown; contexts?: unknown }): StartedRecord {
  const trace = isPlainObject(event.contexts) && isPlainObject(event.contexts.trace) ? event.contexts.trace : {};
  return { start: event.start_timestamp, op: trace.op, name: event.transaction, parentSpanId: trace.parent_span_id, traceId: trace.trace_id };
}

/**
 * 페이지 로드 기록은 다른 화면에서 시작해도 끝나기 전에 라운지에 머문 구간에 걸칠 수 있다(라운지로 들어갈 때는 이동 기록을
 * 열지 않으므로 앞 화면의 페이지 로드 기록이 이어진다). 그 기록의 LCP·CLS 값은 걸친 구간의 라운지 화면 것일 수 있으므로
 * [시작, 끝] 이 어느 구간과든 겹치면 통째로 버린다. 끝 시각이 없으면 끝나지 않은 것으로 본다.
 */
function pageloadOverlapsLikertStay(event: { start_timestamp?: unknown; timestamp?: unknown; transaction?: unknown; contexts?: unknown }): boolean {
  const record = transactionRecord(event);
  const start = record.start;
  if (record.op !== "pageload" || typeof start !== "number" || !Number.isFinite(start)) return false;
  const end = typeof event.timestamp === "number" && Number.isFinite(event.timestamp) ? event.timestamp : Infinity;
  return likertTimeOriginsMs().some(originMs => likertStays.some(stay => atOrAfterTick(end, stay.start, originMs)
    && (stay.end === undefined || !atOrAfterTick(start, stay.end, originMs))));
}

/** 시험에서만 쓴다. 구간 기록이 상한을 넘지 않는지 본다. */
export function likertStayCountForTest(): number {
  return likertStays.length;
}

function weddingCodeSafeTransport(
  mod: SentryModule,
  options: Parameters<SentryModule["makeFetchTransport"]>[0],
): ReturnType<SentryModule["makeFetchTransport"]> {
  const transport = mod.makeFetchTransport(options);
  return {
    // session·client_report 봉투는 beforeSend를 거치지 않아 마지막 전송 경계에서도 막는다.
    send: envelope => touchesLikertPath(envelope) ? Promise.resolve({}) : transport.send(envelope),
    flush: timeout => transport.flush(timeout),
  };
}

function isLikertDestination(value: unknown): boolean {
  return isWeddingCodeLikertPath(locationPathname(value));
}

const SPAN_REDACTED = "[redacted]";

type SpanJson = { description?: string; data?: unknown; [key: string]: unknown };

/**
 * 웨딩코드·라운지 웨딩코드 화면에서 생긴 span 은 이름과 문자열 값을 전부 지운다. null 을 돌려주면 Sentry 가
 * 원본을 그대로 보내므로(core 10.66 `createSpanEnvelope`·`_processBeforeSend`) 버리지 못하고 지운 객체를 돌려준다.
 * 보호 경로를 가리키는 주소 값만은 `?`·`#` 꼬리를 뗀 경로로 남긴다. 화면을 떠난 뒤 늦게 나가는 봉투도
 * 전송 경계(`weddingCodeSafeTransport`)가 그 경로를 보고 버리게 하려는 것이다. 실제 INP span 에는 주소가 없으므로
 * 그런 span 은 시작 시각(`startedDuringLikertStay`)으로 잡아 `transaction` 에 보호 경로 표식을 단다.
 */
function redactLikertSpan(span: SpanJson): SpanJson {
  const data = span.data && typeof span.data === "object" && !Array.isArray(span.data)
    ? Object.fromEntries(Object.entries(span.data).map(([key, value]) => [
      key,
      typeof value !== "string"
        ? value
        : isLikertDestination(value)
          ? new URL(value, "https://hanbang.invalid").pathname
          : SPAN_REDACTED,
    ]))
    : span.data;
  return { ...span, description: SPAN_REDACTED, data };
}

function sanitizeSpanForSentry(span: SpanJson): SpanJson {
  const scrubbed = sanitizeSentrySpan(span);
  if (startedDuringLikertStay(spanRecord(span))) {
    const redacted = redactLikertSpan(scrubbed);
    const data = redacted.data && typeof redacted.data === "object" && !Array.isArray(redacted.data) ? redacted.data : {};
    return { ...redacted, data: { ...data, transaction: LIKERT_SPAN_MARKER } };
  }
  return touchesLikertPath(span) ? redactLikertSpan(scrubbed) : scrubbed;
}

function detachBufferedListeners() {
  if (!listenersAttached) return;
  window.removeEventListener("error", bufferError);
  window.removeEventListener("unhandledrejection", bufferRejection);
  listenersAttached = false;
}

function attachBufferedListeners() {
  if (listenersAttached || isLikertPage()) return;
  window.addEventListener("error", bufferError);
  window.addEventListener("unhandledrejection", bufferRejection);
  listenersAttached = true;
}

function clearPendingErrors() {
  buffered.length = 0;
  clearBufferedClientErrors();
}

// 구간이 열려 있으면(뒤로가기로 주소만 먼저 바뀐 경우 포함) 라운지 화면의 오류로 보고 담지 않는다.
// 구간을 열 때 버퍼를 이미 비웠으므로 여기서는 이번 것만 버린다.
function bufferError(event: ErrorEvent) {
  if (isLikertPage()) { clearPendingErrors(); return; }
  if (likertStayIsOpen()) return;
  if (buffered.length < MAX_BUFFERED) buffered.push(event.error ?? event.message);
}

function bufferRejection(event: PromiseRejectionEvent) {
  if (isLikertPage()) { clearPendingErrors(); return; }
  if (likertStayIsOpen()) return;
  if (buffered.length < MAX_BUFFERED) buffered.push(event.reason);
}

function whenIdle(run: () => void) {
  const idle = (window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
  }).requestIdleCallback;
  if (idle) idle(run, { timeout: 3_000 });
  else window.setTimeout(run, 1_200);
}

function attachSentryErrorSink(mod: SentryModule) {
  if (errorSinkAttached || isLikertPage()) return;
  attachClientErrorSink((error, context) => {
    if (isLikertPage()) return;
    mod.captureException(
      error,
      context.digest
        ? { tags: { next_digest: context.digest }, fingerprint: ["{{ default }}", context.digest] }
        : undefined,
    );
  });
  errorSinkAttached = true;
}

function scheduleSentryInitialization(allowLeavingLikert = false) {
  if (typeof window === "undefined" || !dsn || sentry || initializationPending
    || (isLikertPage() && !allowLeavingLikert)) return;
  initializationPending = true;
  attachBufferedListeners();

  whenIdle(() => {
    if (isLikertPage()) {
      clearPendingErrors();
      detachBufferedListeners();
      initializationPending = false;
      return;
    }
    attachBufferedListeners();
    void import("@sentry/nextjs")
      .then((mod) => {
        if (isLikertPage()) { clearPendingErrors(); return; }
        mod.init({
          dsn,
          enabled: true,
          environment: resolveEnvironment(),
          tracesSampleRate: 0.1,
          transport: (options: Parameters<SentryModule["makeFetchTransport"]>[0]) => weddingCodeSafeTransport(mod, options),
          // 브라우저에서 잡히는 오류에는 사용자가 입력한 문장이 그대로 실릴 수 있다.
          // 서버·edge와 같은 규칙으로 나가기 전에 지운다.
          beforeSend: (event) => touchesLikertPath(event) ? null : sanitizeSentryEvent(event as never) as typeof event,
          // 라운지에 곧장 들어왔다 떠난 뒤 초기화되면 SDK 는 지금 화면 이름으로 페이지 로드 기록을 만들지만, 그 시작은
          // 페이지를 연 순간이라 LCP 와 자원 시간은 라운지 것이다. 시작 시각이 머문 구간 안이면 통째로 버린다.
          // 앞 화면에서 시작한 페이지 로드 기록도 머문 구간과 겹치면 버린다(`pageloadOverlapsLikertStay`).
          beforeSendTransaction: (event) =>
            touchesLikertPath(event) || startedDuringLikertStay(transactionRecord(event)) || pageloadOverlapsLikertStay(event)
              ? null
              : sanitizeSentryTransaction(event as never) as typeof event,
          beforeBreadcrumb: (breadcrumb) =>
            touchesLikertPath(breadcrumb) ? null : sanitizeSentryBreadcrumb(breadcrumb as never) as typeof breadcrumb,
          // INP·LCP·CLS span 은 위 세 훅을 거치지 않고, 이름에 눌린 요소의 aria-label 이 붙는다.
          // 이 훅은 null 을 돌려줘도 원본이 나가므로 늘 지운 객체를 돌려준다. 버리기는 transport 가 한다.
          beforeSendSpan: (span) => sanitizeSpanForSentry(span as never) as unknown as typeof span,
        });
        sentry = mod;
        likertTimeOriginMs();
        if (isLikertPage()) clearPendingErrors();
        else for (const error of buffered) mod.captureException(error);
        buffered.length = 0;
        // 에러 경계가 담아 둔 것도 여기서 함께 흘린다. 경계가 잡은 오류는 위의
        // window 리스너에 안 걸리므로 이 통로가 유일하다.
        //
        // digest 를 fingerprint 에 넣는 이유: 운영 빌드의 서버 컴포넌트 오류는
        // 라우트와 무관하게 문구가 같고 스택도 비어 있어, 그냥 두면 전 라우트가
        // 한 이슈로 뭉쳐 "새 이슈" 알림이 한 번만 울린다.
        attachSentryErrorSink(mod);
      })
      .catch(() => {
        // 모니터링 로드 실패가 서비스를 막으면 안 된다.
      })
      .finally(() => {
        initializationPending = false;
        detachBufferedListeners();
      });
  });
}

// 페이지를 보호 경로에서 열었으면 페이지 시작부터 머문 것으로 친다. 떠난 뒤 초기화된 SDK 가 버퍼에 남은
// 라운지의 상호작용·LCP 를 늦게 집어 가도 그 시각이 이 구간 안에 든다.
if (typeof window !== "undefined" && isLikertPage()) openLikertStay(0);

if (typeof window !== "undefined" && dsn) {
  registerClientMonitoringPathCommit(() => {
    if (isLikertPage()) {
      openLikertStay();
      clearPendingErrors();
      detachBufferedListeners();
      return;
    }
    // 떠나는 이동은 여기(경로 확정)서 구간을 닫는다. 확정 전까지는 라운지 화면이 그대로 보이고 눌린다.
    // 구간을 열 때 버퍼를 비웠으므로 지금 남은 것(에러 경계가 담아 둔 것 포함)은 확정 전 라운지 화면의 오류다. 닫기 전에 비운다.
    if (likertStayIsOpen()) clearPendingErrors();
    closeLikertStay();
    scheduleSentryInitialization();
    if (sentry) attachSentryErrorSink(sentry);
  });
}

scheduleSentryInitialization();

// Next가 라우트 전환마다 동기로 호출한다 — SDK가 아직 없으면 조용히 넘긴다.
export function onRouterTransitionStart(
  ...args: Parameters<SentryModule["captureRouterTransitionStart"]>
) {
  if (isLikertDestination(args[0])) {
    openLikertStay();
    clearPendingErrors();
    return;
  }
  // 구간은 닫지 않는다(경로 확정 콜백이 닫는다). 목적지 이동 기록보다 먼저 떠나기 시작한 tick 을 적는다.
  markLeavingLikertStay();
  if (isLikertPage()) {
    clearPendingErrors();
    scheduleSentryInitialization(true);
    // 보호 경로를 떠날 때는 목적지 이동 기록을 연다. 없으면 다음 화면의 오류가 라운지 앞 화면 이름을 달고 간다.
    // 목적지는 보호 경로가 아니므로 라운지에 대한 것은 실리지 않는다.
    sentry?.captureRouterTransitionStart(...args);
    return;
  }
  scheduleSentryInitialization();
  if (sentry) attachSentryErrorSink(sentry);
  sentry?.captureRouterTransitionStart(...args);
}
