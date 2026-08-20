import {
  DevServerDestinationError,
  assertDevServerDestination,
} from "../../scripts/lib/dev-server-destination-guard.mjs";

/**
 * dev 서버가 운영 Supabase 를 가리키면 **Next 부팅 자체를 실패시킨다.**
 *
 * `scripts/web-dev-safely.mjs` 는 `pnpm dev` 경로만 막는다. `npx next dev` 를 직접
 * 치면 런처를 건너뛰므로 그대로 떴다. 이 펜스는 next.config 평가 시점에 걸리므로
 * 어떤 방식으로 `next dev` 를 띄우든 통과해야 한다.
 *
 * **dev 서버에서만 돈다.** 프로덕션 빌드와 프로덕션 런타임은 정당하게 운영을
 * 가리키므로 건드리면 안 된다. 실측(2026-08-20, next 16.2.11)으로 확인한 구분:
 *
 * | 명령          | NODE_ENV      | config 평가 |
 * |---------------|---------------|-------------|
 * | `next dev`    | development   | 1회         |
 * | `next build`  | production    | 2회(워커)   |
 * | `next start`  | production    | -           |
 *
 * `NEXT_PHASE` 는 셋 다 비어 있어 쓸 수 없었다.
 */
export function assertDevServerDestinationFence({
  appRoot,
  environment = process.env,
  argv = process.argv.slice(2),
  log = console.log,
  logError = console.error,
}: {
  appRoot: string;
  environment?: Record<string, string | undefined>;
  argv?: readonly string[];
  log?: (message: string) => void;
  logError?: (message: string) => void;
}): void {
  if (environment.NODE_ENV !== "development") return;

  try {
    const { banner } = assertDevServerDestination({
      appRoot,
      argv: [...argv],
      processEnv: environment,
    });
    log(`\n${banner}\n`);
  } catch (error) {
    if (!(error instanceof DevServerDestinationError)) throw error;
    // next.config 로드 실패는 곧 기동 실패다. 메시지를 먼저 찍고 다시 던진다 —
    // Next 가 감싸 출력하면 긴 한국어 안내가 스택 사이에 묻힌다.
    logError(`\n${error.message}\n`);
    throw error;
  }
}
