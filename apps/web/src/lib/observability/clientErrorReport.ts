/**
 * 에러 경계에서 잡힌 오류를 모니터링으로 흘리는 통로.
 *
 * ## 왜 따로 필요한가
 *
 * `instrumentation-client.ts` 는 `window` 의 `error`·`unhandledrejection` 을 듣는다.
 * 그런데 **React 에러 경계가 잡은 오류는 그 둘 중 아무것도 발생시키지 않는다** —
 * React 는 경계가 잡은 오류를 `console.error` 로만 넘긴다. 그래서
 * `app/error.tsx` 와 `app/global-error.tsx` 가 뜨는 상황, 즉 사용자가 실제로
 * 깨진 화면을 보는 바로 그 경우가 모니터링에서 통째로 빠져 있었다.
 *
 * 웹이 의도적으로 Sentry 에 보내던 오류는 AI 원장 실패 3줄이 전부였다
 * (`ai-log.ts`, `amoraProviderCallLedger.ts`).
 *
 * ## 왜 상태를 window 에 두는가
 *
 * `instrumentation-client.ts` 는 Next 가 따로 잡는 진입점이라, 번들러가 이 모듈의
 * **사본을 두 개 만들 수 있다.** 그러면 모듈 스코프 변수는 서로 안 보이고, 에러
 * 경계가 담아 둔 것이 영영 안 나간다 — 게다가 그건 조용히 실패한다.
 * `window` 는 사본이 몇 개든 하나뿐이라 그 가정을 아예 없앤다.
 *
 * ## 왜 버퍼가 필요한가
 *
 * Sentry SDK 는 gzip 147KB 라 유휴 시점에 지연 로드된다(최대 3초). 첫 렌더에서
 * 터지는 오류가 가장 중요한데 그건 대개 그 3초 안에 일어난다. 그래서 준비되기
 * 전 것은 담아 뒀다가 붙는 순간 흘린다.
 */

/** 사본이 여럿이어도 하나를 가리키도록 window 에 박는 키. */
const SINK_KEY = "__hanbangClientErrorSink";

/**
 * 담아 둘 수 있는 최대 개수. `instrumentation-client.ts` 의 버퍼와 같은 값이다 —
 * 상한을 두는 이유는 SDK 로드가 실패했을 때 오류 객체를 무한정 붙들지 않기 위해서다.
 */
const MAX_BUFFERED = 20;

/**
 * 오류와 함께 넘기는 부가 정보.
 *
 * `digest` 는 Next 가 서버 컴포넌트 오류에 붙이는 해시다. **이게 없으면 알림이
 * 무의미해진다** — 운영 빌드에서 서버 렌더가 실패하면 Next 는 원문을 지우고
 * *모든 라우트에서 똑같은* 문구만 클라이언트로 넘기고 스택까지 비운다
 * (`resolveErrorProd` 가 `error.stack = "Error: " + error.message` 로 덮는다).
 * 게다가 우리 스크러버가 `event.request` 를 지워서 URL 도 없다.
 *
 * 그러면 Sentry 기본 그룹핑이 **전 라우트를 한 이슈로 뭉치고**, "새 이슈가 생기면
 * 알린다" 규칙에서 두 번째 이후로 깨지는 화면은 영영 알림을 못 만든다.
 * digest 를 fingerprint 에 넣어 갈라 주고, 같은 digest 를 가진 서버 쪽 이벤트와
 * 짝지을 수 있게 태그로도 싣는다. digest 는 해시라 사용자 자료가 아니다.
 */
export type ClientErrorContext = {
  digest?: string;
};

type ErrorSink = {
  /** SDK 가 붙으면 채워진다. 그 전에는 null. */
  capture: ((error: unknown, context: ClientErrorContext) => void) | null;
  /** SDK 가 붙기 전에 들어온 것들. */
  buffered: Array<{ error: unknown; context: ClientErrorContext }>;
};

function digestOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = (error as { digest?: unknown }).digest;
  return typeof value === "string" && value ? value : undefined;
}

function sink(): ErrorSink | null {
  if (typeof window === "undefined") return null;
  const holder = window as unknown as Record<string, ErrorSink | undefined>;
  const existing = holder[SINK_KEY];
  if (existing) return existing;
  const created: ErrorSink = { capture: null, buffered: [] };
  holder[SINK_KEY] = created;
  return created;
}

/**
 * Sentry 가 준비되면 `instrumentation-client.ts` 가 부른다. 밀려 있던 것부터 흘린다.
 *
 * 두 번 불려도 안전하다 — 버퍼를 비우고 넘기므로 같은 오류가 두 번 가지 않는다.
 */
export function attachClientErrorSink(
  capture: (error: unknown, context: ClientErrorContext) => void,
): void {
  const current = sink();
  if (!current) return;
  current.capture = capture;
  const pending = current.buffered.splice(0, current.buffered.length);
  for (const entry of pending) capture(entry.error, entry.context);
}

/**
 * 에러 경계에서 부른다. SDK 가 아직 없으면 담아 뒀다가 준비되면 보낸다.
 *
 * DSN 이 없으면 `attachClientErrorSink` 가 영영 안 불리고, 담긴 것은 상한까지만
 * 쌓였다가 그대로 버려진다 — 그게 "모니터링을 끈 상태" 의 옳은 동작이다.
 */
export function reportClientError(error: unknown): void {
  const current = sink();
  if (!current) return;
  const context: ClientErrorContext = { digest: digestOf(error) };
  if (current.capture) {
    current.capture(error, context);
    return;
  }
  if (current.buffered.length < MAX_BUFFERED) current.buffered.push({ error, context });
}

/** 테스트에서만 쓴다. window 에 박힌 상태를 지운다. */
export function resetClientErrorSinkForTest(): void {
  if (typeof window === "undefined") return;
  delete (window as unknown as Record<string, unknown>)[SINK_KEY];
}
