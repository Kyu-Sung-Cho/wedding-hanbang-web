// 환경 분리 로거 — 프로덕션 console 노출 방지
//
// 사용 예:
//   import { log } from "@/utils/log";
//   log.error("Failed to load X", err);
//
// 점진 마이그레이션: 기존 console.error는 그대로 두고, 새 코드부터 log.* 사용.
// (기존 코드 일괄 변경은 회귀 위험으로 보류)

import * as Sentry from "@sentry/nextjs";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";

const isDev = process.env.NODE_ENV === "development";

type LogPayload = unknown;

export const log = {
  error: (msg: string, err?: LogPayload) => {
    const diagnostic = safeErrorDiagnostic(err);
    if (isDev) {
      console.error(msg, diagnostic);
      return;
    }
    // Provider errors can embed request data in message/detail fields. Keep
    // only bounded operational tokens; the original object never reaches Sentry.
    Sentry.captureException(new Error("OPERATIONAL_FAILURE"), {
      tags: {
        "error.name": diagnostic.name,
        "error.code": diagnostic.code,
        "error.status": diagnostic.status === null ? "unknown" : String(diagnostic.status),
      },
    });
  },

  warn: (msg: string, payload?: LogPayload) => {
    if (isDev) {
      console.warn(msg, safeErrorDiagnostic(payload));
    }
  },

  info: (msg: string, payload?: LogPayload) => {
    if (isDev) {
      console.info(msg, safeErrorDiagnostic(payload));
    }
  },

  debug: (msg: string, payload?: LogPayload) => {
    if (isDev) {
      console.debug(msg, safeErrorDiagnostic(payload));
    }
  },
};
