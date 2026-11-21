/**
 * 맡은 일의 서버 실패를 Sentry 로 올릴 때 넘길 오류를 만든다.
 *
 * 5xx 를 돌려주는 자리는 `log.error` 로 보고한다(`scripts/tests/no-silent-5xx-catch.test.mjs`, `utils/log.ts`).
 * `console.error` 는 Vercel 런타임 로그에만 남고 Sentry 로 가지 않는다.
 *
 * 원래 오류는 넘기지 않는다. `log.error` 는 받은 Error 를 그대로 올리는데, DB 오류 문장은 행의 값을 인용할 수 있다.
 * 그래서 실패한 자리(code), 오류 종류(name), DB 오류 코드만 남긴다. 셋 다 모양을 확인한 뒤에만 싣는다.
 */
const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,60}$/;
const SAFE_DB_CODE = /^[A-Z0-9]{2,12}$/;

export function amoraTaskFailure(code: string, error: unknown): Error {
  const rawName = error instanceof Error ? error.name : "";
  const name = SAFE_NAME.test(rawName) ? rawName : "UnknownError";
  const rawDbCode = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  const dbCode = typeof rawDbCode === "string" && SAFE_DB_CODE.test(rawDbCode) ? ` ${rawDbCode}` : "";
  return new Error(`${code} (${name}${dbCode})`);
}
