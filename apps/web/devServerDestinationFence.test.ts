import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assertDevServerDestinationFence } from "./devServerDestinationFence";

const PRODUCTION_REF = "slrtobkksjmxgzatjyqb";
const STAGING_REF = "rgxdizztidbgwnsbadml";
const OPT_IN_KEY = "HANBANG_DEV_ALLOW_PRODUCTION_SUPABASE";

const PRODUCTION_ENV_LOCAL = [
  `NEXT_PUBLIC_SUPABASE_URL=https://${PRODUCTION_REF}.supabase.co`,
  `SUPABASE_EXPECTED_URL=https://${PRODUCTION_REF}.supabase.co`,
  `SUPABASE_EXPECTED_PROJECT_REF=${PRODUCTION_REF}`,
  `SUPABASE_PRODUCTION_PROJECT_REF=${PRODUCTION_REF}`,
  "",
].join("\n");

const STAGING_ENV_LOCAL = [
  `NEXT_PUBLIC_SUPABASE_URL=https://${STAGING_REF}.supabase.co`,
  `SUPABASE_EXPECTED_URL=https://${STAGING_REF}.supabase.co`,
  `SUPABASE_EXPECTED_PROJECT_REF=${STAGING_REF}`,
  `SUPABASE_PRODUCTION_PROJECT_REF=${PRODUCTION_REF}`,
  "",
].join("\n");

describe("assertDevServerDestinationFence", () => {
  let appRoot: string;
  let logged: string[];
  let errored: string[];

  const run = (environment: Record<string, string | undefined>) =>
    assertDevServerDestinationFence({
      appRoot,
      environment,
      argv: [],
      log: (message) => logged.push(message),
      logError: (message) => errored.push(message),
    });

  beforeEach(() => {
    appRoot = mkdtempSync(join(tmpdir(), "hanbang-devfence-"));
    logged = [];
    errored = [];
  });

  afterEach(() => {
    rmSync(appRoot, { recursive: true, force: true });
  });

  it("운영을 가리키는 dev 서버는 부팅을 막는다", () => {
    writeFileSync(join(appRoot, ".env.local"), PRODUCTION_ENV_LOCAL);

    expect(() => run({ NODE_ENV: "development", PORT: "3200" })).toThrow(
      /dev 서버 기동을 거부했습니다/,
    );
    expect(errored.join("\n")).toContain(PRODUCTION_REF);
    expect(errored.join("\n")).toContain("3200");
  });

  it("프로덕션 빌드와 프로덕션 런타임은 건드리지 않는다", () => {
    // 운영 빌드는 정당하게 운영을 가리킨다. 여기서 던지면 배포가 죽는다.
    writeFileSync(join(appRoot, ".env.local"), PRODUCTION_ENV_LOCAL);

    expect(() => run({ NODE_ENV: "production", VERCEL_ENV: "production" })).not.toThrow();
    expect(() => run({})).not.toThrow();
    expect(logged).toEqual([]);
    expect(errored).toEqual([]);
  });

  it("스테이징이면 통과하고 포트와 대상 ref 를 배너에 찍는다", () => {
    writeFileSync(join(appRoot, ".env.local"), STAGING_ENV_LOCAL);

    expect(() => run({ NODE_ENV: "development", PORT: "3300" })).not.toThrow();

    const banner = logged.join("\n");
    expect(banner).toContain("3300");
    expect(banner).toContain(STAGING_REF);
    expect(banner).not.toContain("운영(PRODUCTION)");
  });

  it("셸에서 준 옵트인은 통과시키되 배너가 운영이라고 크게 알린다", () => {
    writeFileSync(join(appRoot, ".env.local"), PRODUCTION_ENV_LOCAL);

    expect(() =>
      run({ NODE_ENV: "development", PORT: "3200", [OPT_IN_KEY]: PRODUCTION_REF }),
    ).not.toThrow();

    const banner = logged.join("\n");
    expect(banner).toContain("운영(PRODUCTION)");
    expect(banner).toContain(PRODUCTION_REF);
    expect(banner).toContain("3200");
  });

  it("Next 가 .env.local 옵트인을 process.env 에 부어 놓아도 막는다", () => {
    // next.config 안에서는 Next 가 이미 .env.local 을 process.env 에 부어 둔 상태다.
    // 파일에 적은 옵트인이 그 경로로 살아나면 「그 실행에만」이 아니게 된다.
    writeFileSync(
      join(appRoot, ".env.local"),
      `${PRODUCTION_ENV_LOCAL}${OPT_IN_KEY}=${PRODUCTION_REF}\n`,
    );

    expect(() =>
      run({
        NODE_ENV: "development",
        PORT: "3200",
        [OPT_IN_KEY]: PRODUCTION_REF,
        NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
        SUPABASE_EXPECTED_PROJECT_REF: PRODUCTION_REF,
      }),
    ).toThrow(/dev 서버 기동을 거부했습니다/);
    expect(errored.join("\n")).toContain("무시했습니다");
  });
});
