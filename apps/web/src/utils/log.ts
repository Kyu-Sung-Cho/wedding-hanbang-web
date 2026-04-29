// 환경 분리 로거 — 프로덕션 console 노출 방지
//
// 사용 예:
//   import { log } from "@/utils/log";
//   log.error("Failed to load X", err);
//
// 점진 마이그레이션: 기존 console.error는 그대로 두고, 새 코드부터 log.* 사용.
// (기존 코드 일괄 변경은 회귀 위험으로 보류)

const isDev = process.env.NODE_ENV === "development";

type LogPayload = unknown;

export const log = {
  error: (msg: string, err?: LogPayload) => {
    if (isDev) {
      // eslint-disable-next-line no-console
      console.error(msg, err);
    }
    // 프로덕션: Sentry 연결 시 여기에 capture
    // (현재 Sentry DSN 미연결 — devDependency만 있음)
  },

  warn: (msg: string, payload?: LogPayload) => {
    if (isDev) {
      // eslint-disable-next-line no-console
      console.warn(msg, payload);
    }
  },

  info: (msg: string, payload?: LogPayload) => {
    if (isDev) {
      // eslint-disable-next-line no-console
      console.info(msg, payload);
    }
  },

  debug: (msg: string, payload?: LogPayload) => {
    if (isDev) {
      // eslint-disable-next-line no-console
      console.debug(msg, payload);
    }
  },
};
