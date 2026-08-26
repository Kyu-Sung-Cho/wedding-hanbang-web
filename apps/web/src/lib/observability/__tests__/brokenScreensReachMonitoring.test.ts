import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachClientErrorSink,
  reportClientError,
  resetClientErrorSinkForTest,
} from "../clientErrorReport";
import { resolveDeploymentEnvironment } from "../deploymentEnvironment";

/**
 * 화면이 깨져도 모니터링에 안 남았다. 그리고 프리뷰 오류가 운영 오류로 보였다.
 *
 * ## ① 에러 경계는 window error 를 만들지 않는다
 *
 * `instrumentation-client.ts` 는 `window` 의 `error`·`unhandledrejection` 만 듣는데,
 * **React 에러 경계가 잡은 오류는 그 둘 중 아무것도 발생시키지 않는다.** React 는
 * 경계가 잡은 오류를 `console.error` 로만 넘긴다.
 *
 * 그래서 `app/error.tsx`·`app/global-error.tsx` 가 뜨는 상황 — 사용자가 실제로
 * 깨진 화면을 보는 바로 그 경우 — 이 통째로 빠져 있었다. 2026-08-26 실측으로
 * 웹이 의도적으로 Sentry 에 보내던 오류는 AI 원장 실패 3줄이 전부였다.
 *
 * ## ② 프리뷰와 운영이 같은 이름으로 찍혔다
 *
 * 세 런타임 모두 `environment: process.env.NODE_ENV` 였는데 **Vercel 은 프리뷰도
 * `NODE_ENV=production` 으로 빌드**하고, `NEXT_PUBLIC_SENTRY_DSN` 은
 * Preview·Production 양쪽에 켜져 있다(`vercel env ls` 실측). 알림을 켜면 브랜치
 * 배포 오류가 운영 오류와 구분이 안 된다.
 *
 * ## 왜 상태를 window 에 두는가
 *
 * `instrumentation-client.ts` 는 Next 가 따로 잡는 진입점이라 번들러가 이 모듈의
 * 사본을 두 개 만들 수 있다. 모듈 스코프 변수였다면 에러 경계가 담아 둔 것이
 * **조용히** 안 나간다. 아래 "사본이 둘이어도" 검사가 그 가정을 잠근다.
 */

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..", "..");
const WEB = join(REPO_ROOT, "apps", "web");
const read = (rel: string) => readFileSync(join(WEB, rel), "utf8");

/**
 * 주석을 뺀 실행되는 코드만. **처음엔 이걸 안 해서 내 주석에 걸렸다** — 무엇이
 * 잘못이었는지 적어 두려고 옛 코드를 주석에 인용했더니 그게 위반으로 세어졌다.
 * 이 저장소에서 같은 실수를 세 번 했다.
 */
const body = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

/**
 * 주석에 더해 `import` 줄까지 걷어낸 것. **변형 검사가 이걸 요구했다** —
 * `expect(source).toContain("reportClientError")` 는 호출을 통째로 지워도
 * **import 줄에 남은 같은 이름이 대신 답해서** 통과했다. 이름이 어딘가 있느냐가
 * 아니라 그게 실제로 불리느냐를 물어야 한다.
 */
const calls = (text: string) =>
  body(text)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("import "))
    .join("\n");

afterEach(() => {
  resetClientErrorSinkForTest();
});

describe("측정기가 살아 있다", () => {
  it("파일을 실제로 읽는다", () => {
    for (const f of [
      "src/app/error.tsx",
      "src/app/global-error.tsx",
      "src/instrumentation-client.ts",
      "sentry.server.config.ts",
      "sentry.edge.config.ts",
    ]) {
      expect(read(f).length, f).toBeGreaterThan(300);
    }
  });

  it("검사마다 window 상태가 초기화된다", () => {
    expect((window as unknown as Record<string, unknown>).__hanbangClientErrorSink).toBeUndefined();
  });
});

describe("SDK 가 붙기 전에 깨져도 잃지 않는다", () => {
  it("먼저 담아 뒀다가 붙는 순간 흘린다 — 첫 렌더 크래시가 이 경우다", () => {
    const boom = new Error("첫 렌더에서 터짐");
    reportClientError(boom);

    const capture = vi.fn();
    attachClientErrorSink(capture);

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(boom, { digest: undefined });
  });

  it("붙은 뒤에 오는 것은 곧바로 보낸다", () => {
    const capture = vi.fn();
    attachClientErrorSink(capture);

    const later = new Error("나중에 터짐");
    reportClientError(later);

    expect(capture).toHaveBeenCalledWith(later, { digest: undefined });
  });

  it("두 번 붙어도 같은 오류를 두 번 보내지 않는다", () => {
    reportClientError(new Error("한 번"));

    const first = vi.fn();
    const second = vi.fn();
    attachClientErrorSink(first);
    attachClientErrorSink(second);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(0);
  });

  it("SDK 가 끝내 안 붙어도 무한정 쌓이지 않는다 — 상한 20", () => {
    for (let i = 0; i < 50; i += 1) reportClientError(new Error(`오류 ${i}`));

    const capture = vi.fn();
    attachClientErrorSink(capture);

    expect(capture).toHaveBeenCalledTimes(20);
  });

  it("담긴 순서를 지킨다", () => {
    reportClientError("첫째");
    reportClientError("둘째");

    const seen: unknown[] = [];
    attachClientErrorSink((e) => seen.push(e));

    expect(seen).toEqual(["첫째", "둘째"]);
  });
});

describe("서버 렌더 오류가 한 이슈로 뭉치지 않는다", () => {
  /**
   * 운영 빌드에서 서버 컴포넌트 렌더가 실패하면 Next 는 원문을 지우고 **모든
   * 라우트에서 똑같은** 문구만 클라이언트로 넘기고 스택도 비운다. 우리 스크러버가
   * `event.request` 까지 지우므로 라우트를 알 단서가 하나도 안 남는다.
   *
   * 그러면 Sentry 기본 그룹핑이 전 라우트를 한 이슈로 묶고, "새 이슈가 생기면
   * 알린다" 규칙에서 **두 번째 이후로 깨지는 화면은 영영 알림을 못 만든다.**
   * 알림을 켜는 것이 목적인데 그 목적이 무너진다.
   */
  it("digest 를 함께 넘긴다 — 이걸로 이슈를 가른다", () => {
    const seen: Array<{ error: unknown; context: { digest?: string } }> = [];
    attachClientErrorSink((error, context) => seen.push({ error, context }));

    const serverError = Object.assign(
      new Error("An error occurred in the Server Components render."),
      { digest: "3849572019" },
    );
    reportClientError(serverError);

    expect(seen[0]?.context.digest, "digest 가 안 넘어간다 — 전 라우트가 한 이슈로 뭉친다")
      .toBe("3849572019");
  });

  it("담아 뒀다가 흘릴 때도 digest 를 잃지 않는다", () => {
    reportClientError(Object.assign(new Error("서버 렌더 실패"), { digest: "abc123" }));

    const seen: Array<{ digest?: string }> = [];
    attachClientErrorSink((_error, context) => seen.push(context));

    expect(seen[0]?.digest).toBe("abc123");
  });

  it("digest 가 없는 평범한 오류는 그대로 둔다", () => {
    const seen: Array<{ digest?: string }> = [];
    attachClientErrorSink((_error, context) => seen.push(context));

    reportClientError(new Error("브라우저에서 난 오류"));
    reportClientError("문자열도 온다");

    expect(seen.map((c) => c.digest)).toEqual([undefined, undefined]);
  });

  it("instrumentation-client 가 digest 를 fingerprint 와 태그에 싣는다", () => {
    const source = body(read("src/instrumentation-client.ts"));
    expect(source, "digest 를 fingerprint 에 안 넣으면 이슈가 안 갈린다").toContain("fingerprint");
    expect(source).toContain("next_digest");
    // `{{ default }}` 를 함께 둬야 digest 가 없는 오류의 기존 그룹핑이 유지된다.
    expect(source).toContain("{{ default }}");
  });
});

describe("사본이 둘이어도 하나로 동작한다", () => {
  it("모듈 스코프가 아니라 window 에 상태를 둔다", () => {
    reportClientError(new Error("사본 A 에서 담김"));

    // 번들러가 사본을 하나 더 만든 상황을 흉내낸다 — 새 사본은 모듈 변수를
    // 공유하지 않지만 window 는 공유한다.
    const holder = window as unknown as Record<string, { buffered: unknown[] } | undefined>;
    expect(holder.__hanbangClientErrorSink, "상태가 window 에 없다 — 사본이 갈리면 조용히 잃는다")
      .toBeDefined();
    expect(holder.__hanbangClientErrorSink!.buffered).toHaveLength(1);
  });
});

/**
 * 앱의 **모든** 에러 경계. 목록을 손으로 적으면 안 된다 — 처음에 루트 둘만 적었더니
 * `/price` 아래 세 개가 통로를 안 쓰는데도 이 describe 가 초록불이었다.
 *
 * React 에러 경계는 **가장 가까운 하나만** 잡고 위로 올리지 않는다. 게다가 Next 는
 * 프로덕션에서 사용자가 만든 error.tsx 가 잡은 오류에 대해 `window` 의 error 이벤트를
 * 만들지 않는다(내장 경계일 때만 만든다). 그래서 중첩 경계 하나를 놓치면 그 서브트리
 * 전체가 모니터링에서 사라진다 — `/price` 는 비로그인으로 열리는 공개 표면이다.
 */
const BOUNDARIES = readdirSync(join(WEB, "src", "app"), { recursive: true, encoding: "utf8" })
  .filter((entry) => /(^|[\\/])(global-)?error\.tsx$/u.test(entry))
  .map((entry) => [entry.replace(/\\/gu, "/"), join("src", "app", entry)] as const);

describe("에러 경계가 이 통로를 실제로 쓴다", () => {
  it("경계를 전수로 찾았다 — 0건이면 아래 it.each 가 통째로 비어 초록불이 된다", () => {
    expect(BOUNDARIES.length, "src/app 스캔이 비었다").toBeGreaterThanOrEqual(5);
    const names = BOUNDARIES.map(([n]) => n);
    expect(names).toContain("error.tsx");
    expect(names).toContain("global-error.tsx");
    expect(names.some((n) => n.startsWith("price/")), "/price 중첩 경계를 못 찾았다").toBe(true);
  });

  it.each(BOUNDARIES)("%s 가 reportClientError 를 부른다", (_name, file) => {
    const source = calls(read(file));
    expect(source, "이름만 import 하고 정작 부르지는 않는다").toContain("reportClientError(error)");
    // console.error 만 하던 것이 원래 문제였다. 그 줄은 남기되 리포트가 함께 있어야 한다.
    expect(source).toContain("console.error");
  });

  it("global-error 는 무거운 것을 새로 끌어오지 않는다 — 그 화면은 이미 다 깨진 뒤다", () => {
    const source = body(read("src/app/global-error.tsx"));
    expect(source, "global-error 가 Sentry SDK 를 직접 import 한다").not.toContain("@sentry/nextjs");
    // 통로 모듈 자체도 의존성이 없어야 의미가 있다.
    const sink = readFileSync(join(WEB, "src/lib/observability/clientErrorReport.ts"), "utf8");
    expect(sink.match(/^import\s/gmu) ?? [], "통로 모듈이 무언가를 import 한다").toHaveLength(0);
  });

  it("instrumentation-client 가 SDK 를 붙이는 쪽을 연결한다", () => {
    const source = body(read("src/instrumentation-client.ts"));
    expect(source).toContain("attachClientErrorSink");
    // init 이 끝난 뒤에 붙어야 한다. 그 전에 붙이면 클라이언트 없이 capture 가 나간다.
    const initAt = source.indexOf("mod.init(");
    const attachAt = source.indexOf("attachClientErrorSink(");
    expect(initAt, "mod.init 을 못 찾았다").toBeGreaterThan(0);
    expect(attachAt, "attachClientErrorSink 가 init 보다 먼저다").toBeGreaterThan(initAt);
  });
});

describe("프리뷰를 운영으로 착각하지 않는다", () => {
  it("Vercel 이 알려주면 그 값을 그대로 쓴다", () => {
    expect(
      resolveDeploymentEnvironment({ vercelEnv: "preview", hostname: "hanbang.ai", nodeEnv: "production" }),
    ).toBe("preview");
  });

  it.each([
    ["hanbang.ai", "production"],
    ["www.hanbang.ai", "production"],
    ["HANBANG.AI", "production"],
    ["wedding-hanbang-web-git-fix-abc.vercel.app", "preview"],
    ["localhost", "development"],
    ["127.0.0.1", "development"],
  ])("Vercel 변수가 없으면 호스트로 가른다: %s → %s", (hostname, expected) => {
    expect(resolveDeploymentEnvironment({ hostname, nodeEnv: "production" })).toBe(expected);
  });

  it("프리뷰 호스트가 NODE_ENV=production 에 속지 않는다 — 이게 그 버그다", () => {
    const preview = resolveDeploymentEnvironment({
      hostname: "wedding-hanbang-web-git-fix-abc.vercel.app",
      nodeEnv: "production",
    });
    expect(preview, "프리뷰가 운영으로 찍힌다").not.toBe("production");
  });

  it("모르는 호스트는 옛 동작으로 떨어진다 — 지금보다 나빠지지 않는다", () => {
    expect(resolveDeploymentEnvironment({ hostname: "staging.example.com", nodeEnv: "production" }))
      .toBe("production");
  });

  it("아무것도 없으면 unknown 이다 — 조용히 production 이라고 하지 않는다", () => {
    expect(resolveDeploymentEnvironment({})).toBe("unknown");
    expect(resolveDeploymentEnvironment({ vercelEnv: "  ", hostname: "", nodeEnv: "" })).toBe("unknown");
  });
});

describe("세 런타임 모두 NODE_ENV 를 환경 이름으로 쓰지 않는다", () => {
  it.each([
    ["server", "sentry.server.config.ts"],
    ["edge", "sentry.edge.config.ts"],
    ["client", "src/instrumentation-client.ts"],
  ])("%s 설정에 environment: process.env.NODE_ENV 가 없다", (_label, file) => {
    const dense = body(read(file)).replace(/\s+/gu, "");
    expect(dense, "프리뷰와 운영이 같은 이름으로 찍힌다")
      .not.toContain("environment:process.env.NODE_ENV");
  });

  it.each([
    ["server", "sentry.server.config.ts"],
    ["edge", "sentry.edge.config.ts"],
  ])("%s 는 VERCEL_ENV 를 먼저 본다", (_label, file) => {
    expect(body(read(file)).replace(/\s+/gu, "")).toContain("process.env.VERCEL_ENV||process.env.NODE_ENV");
  });

  it("클라이언트는 NEXT_PUBLIC_VERCEL_ENV 를 본다 — 서버 변수는 브라우저에 안 온다", () => {
    const source = body(read("src/instrumentation-client.ts"));
    expect(source).toContain("NEXT_PUBLIC_VERCEL_ENV");
    // `process.env.VERCEL_ENV` 를 브라우저에서 읽으면 언제나 undefined 다.
    expect(source).not.toMatch(/(?<!NEXT_PUBLIC_)process\.env\.VERCEL_ENV\b/u);
  });

  it("turbo 가 NEXT_PUBLIC_VERCEL_ENV 를 빌드로 통과시킨다 — 없으면 값이 안 박힌다", () => {
    const turbo = readFileSync(join(REPO_ROOT, "turbo.json"), "utf8");
    const hits = turbo.match(/"NEXT_PUBLIC_VERCEL_ENV"/gu) ?? [];
    // globalEnv 와 build 태스크 두 곳. 한 곳만 있으면 캐시가 값을 섞는다.
    expect(hits.length, "turbo.json 통과 목록에 한 곳만 등록됐다").toBe(2);
  });

  it("스크러버 배선은 그대로다 — 환경 이름을 고치면서 이걸 떨어뜨리면 안 된다", () => {
    for (const f of ["sentry.server.config.ts", "sentry.edge.config.ts", "src/instrumentation-client.ts"]) {
      const source = calls(read(f));
      // `toContain("beforeSend")` 는 **`beforeSendTransaction` 에 걸려서** 정작
      // beforeSend 를 지운 변형을 놓쳤다. 콜론까지 붙여 그 키만 본다.
      expect(source, `${f}: beforeSend 훅이 없다`).toMatch(/beforeSend\s*:/u);
      expect(source, `${f}: 이벤트 스크러버가 안 물려 있다`).toContain("sanitizeSentryEvent(");
    }
  });
});
