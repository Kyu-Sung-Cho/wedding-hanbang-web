// 환경 분리 로거 — 브라우저 콘솔 노출은 막고, 서버 오류는 Sentry 로 올린다
//
// 사용 예:
//   import { log } from "@/utils/log";
//   log.error("[api/chat] POST 실패", err);
//
// 알아 둘 것 (2026-08-31 확인):
//   - `log.error` 만 Sentry 로 간다.
//   - `warn`/`info`/`debug` 는 **운영에서 아무 일도 하지 않는다**(isDev 일 때만
//     콘솔에 찍는다). 그러니 "운영에서 보고 싶은 것"을 warn 에 넣으면 사라진다.
//     보고 싶으면 error 를 쓰거나 별도 경로를 만들 것.

import * as Sentry from "@sentry/nextjs";
import { redactSentryText } from "@hanbang/shared";

const isDev = process.env.NODE_ENV === "development";

type LogPayload = unknown;

// Sentry tag 값 상한은 200자다. 잘려서 버려지지 않도록 여기서 먼저 자른다.
const MAX_SCOPE_TAG_LENGTH = 180;

/**
 * `msg` 를 Sentry tag 로 실을 수 있게 다듬는다.
 *
 * tag 는 `beforeSend`(sanitizeSentryEvent)가 **건드리지 않는** 자리다. 그래서
 * 스크러버에 기대지 않고 여기서 직접 지운다. 호출자는 정적 문자열을 쓰는 것이
 * 원칙이지만, 누군가 값을 끼워 넣더라도 이메일·전화·URL·토큰은 나가지 않는다.
 */
function scopeTag(msg: string): string {
  const redacted = redactSentryText(msg) ?? "";
  return redacted.slice(0, MAX_SCOPE_TAG_LENGTH) || "unknown";
}

/**
 * Sentry 로 보낼 예외를 고른다.
 *
 * `JSON.parse` 가 던지는 `SyntaxError` 는 **입력을 메시지에 그대로 인용한다**:
 *
 *     SyntaxError: Unexpected token '예', "예비신부입니다 예산은 5천만원" is not valid JSON
 *
 * `request.json()` 을 try 안에서 부르고 그 catch 가 `log.error` 를 부르는 라우트가
 * 다섯이다(amora/actions · chat/feedback · chat/messages · money · money/[id]).
 * 그대로 넘기면 사용자가 친 한국어가 Sentry 이벤트 제목이 된다.
 * `beforeSend` 의 스크러버는 이메일·전화·URL·토큰 패턴만 보므로 한글 자유문은
 * 하나도 안 지운다(실측).
 *
 * 그래서 이 종류는 **원본을 넘기지 않는다.** 어디서 무엇이 실패했는지는 남고
 * (호출자의 `msg` + 예외 종류), 인용된 본문만 사라진다. 스택은 파싱 실패 지점이라
 * 어차피 진단에 쓸모가 없다.
 *
 * 남는 한계: 다른 라이브러리가 사용자 값을 메시지에 넣어 던지면 그건 그대로
 * 나간다. 여기서 목록으로 막을 수 있는 종류가 아니라, 호출자가 원본을 넘길지
 * 판단해야 하는 문제다.
 */
function toSentryError(msg: string, err: unknown): Error {
  if (err instanceof SyntaxError) return new Error(`${msg} (SyntaxError)`);
  return err instanceof Error ? err : new Error(msg);
}

export const log = {
  error: (msg: string, err?: LogPayload) => {
    if (isDev) {
      console.error(msg, err);
      return;
    }

    // 서버에서는 콘솔 줄을 그대로 남긴다. Vercel 런타임 로그가 사고 조사의 1차
    // 자료이므로, `console.error` 를 `log.error` 로 바꾸는 일이 그 자료를 지우는
    // 결과가 되면 안 된다. 브라우저에서는 남기지 않는다 — 이 모듈이 애초에
    // 막으려던 것이 사용자 콘솔에 내부 오류가 찍히는 것이다.
    if (typeof window === "undefined") {
      console.error(msg, err);
    }

    // `extra` 에는 아무것도 싣지 않는다. `beforeSend` 가 `extra` 를 통째로
    // 지우므로 실어도 도착하지 않고, 스크러버가 빠진 런타임이 생기면 임의
    // payload 가 그대로 나가는 자리가 된다. payload 는 위 서버 콘솔에 남는다.
    //
    // 대신 `msg` 는 tag 로 남긴다: `err` 가 Error 이면 포착되는 예외가 그 에러라
    // 제목이 원인 문구가 되고, "어느 라우트에서 났는지"인 `msg` 는 사라진다.
    Sentry.captureException(toSentryError(msg, err), {
      tags: { log_scope: scopeTag(msg) },
    });
  },

  // 아래 셋은 운영에서 no-op 이다(위 주석 참고).
  warn: (msg: string, payload?: LogPayload) => {
    if (isDev) {
      console.warn(msg, payload);
    }
  },

  info: (msg: string, payload?: LogPayload) => {
    if (isDev) {
      console.info(msg, payload);
    }
  },

  debug: (msg: string, payload?: LogPayload) => {
    if (isDev) {
      console.debug(msg, payload);
    }
  },
};
