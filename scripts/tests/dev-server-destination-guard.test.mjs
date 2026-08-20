import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  DEV_ENV_FILE_ORDER,
  DevServerDestinationError,
  KNOWN_PRODUCTION_PROJECT_REFS,
  PRODUCTION_OPT_IN_ENV_KEY,
  assertDevServerDestination,
  evaluateDevServerDestination,
  formatDestinationBanner,
  formatDestinationRefusal,
  parseEnvFile,
  projectRefFromDestinationValue,
  resolveDevServerEnvironment,
  resolveDevServerPort,
} from "../lib/dev-server-destination-guard.mjs";
import { SYNTHETIC_SUPABASE_ENVIRONMENT } from "../lib/synthetic-supabase-environment.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");
const appRoot = path.join(repoRoot, "apps/web");
const launcher = path.join(repoRoot, "scripts/web-dev-safely.mjs");

const PRODUCTION_REF = "slrtobkksjmxgzatjyqb";
const STAGING_REF = "rgxdizztidbgwnsbadml";

// 2026-08-20 사고를 낸 워크트리의 `.env.local` 과 같은 모양이다.
const ACCIDENT_ENV_LOCAL = [
  `NEXT_PUBLIC_SUPABASE_URL=https://${PRODUCTION_REF}.supabase.co`,
  "NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-placeholder",
  `SUPABASE_EXPECTED_URL=https://${PRODUCTION_REF}.supabase.co`,
  `SUPABASE_EXPECTED_PROJECT_REF=${PRODUCTION_REF}`,
  `SUPABASE_PRODUCTION_PROJECT_REF=${PRODUCTION_REF}`,
  `SUPABASE_PRODUCTION_WRITE_CONFIRM=RUNTIME_WRITE:${PRODUCTION_REF}`,
].join("\n");

const STAGING_ENV_LOCAL = [
  `NEXT_PUBLIC_SUPABASE_URL=https://${STAGING_REF}.supabase.co`,
  `SUPABASE_EXPECTED_URL=https://${STAGING_REF}.supabase.co`,
  `SUPABASE_EXPECTED_PROJECT_REF=${STAGING_REF}`,
  `SUPABASE_PRODUCTION_PROJECT_REF=${PRODUCTION_REF}`,
  "SUPABASE_PRODUCTION_WRITE_CONFIRM=",
].join("\n");

function evaluateWith(files, processEnv = {}) {
  const { env, sources } = resolveDevServerEnvironment({
    appRoot: "/repo/apps/web",
    processEnv,
    readEnvFile: (filePath) => files[path.basename(filePath)] ?? null,
  });
  return evaluateDevServerDestination({ env, sources });
}

test("운영 프로젝트 목록은 코드에 박혀 있고 env 로 지울 수 없다", () => {
  assert.ok(KNOWN_PRODUCTION_PROJECT_REFS.includes(PRODUCTION_REF));
});

test("env 파일 파서는 주석·따옴표·export·CRLF·값 속 등호를 견딘다", () => {
  const parsed = parseEnvFile(
    [
      "# comment",
      "",
      `NEXT_PUBLIC_SUPABASE_URL="https://${STAGING_REF}.supabase.co"`,
      "export SUPABASE_EXPECTED_PROJECT_REF='abcdefghijklmnopqrst'",
      "SUPABASE_PRODUCTION_WRITE_CONFIRM=RUNTIME_WRITE:abc=def",
      "NOT_AN_ASSIGNMENT",
    ].join("\r\n"),
  );

  assert.equal(parsed.NEXT_PUBLIC_SUPABASE_URL, `https://${STAGING_REF}.supabase.co`);
  assert.equal(parsed.SUPABASE_EXPECTED_PROJECT_REF, "abcdefghijklmnopqrst");
  assert.equal(parsed.SUPABASE_PRODUCTION_WRITE_CONFIRM, "RUNTIME_WRITE:abc=def");
  assert.equal("NOT_AN_ASSIGNMENT" in parsed, false);
});

test("프로젝트 ref 는 URL 형태에서도, 맨 ref 에서도 같은 값으로 정규화된다", () => {
  assert.equal(projectRefFromDestinationValue(`https://${PRODUCTION_REF}.supabase.co`), PRODUCTION_REF);
  assert.equal(projectRefFromDestinationValue(`https://db.${PRODUCTION_REF}.supabase.co`), PRODUCTION_REF);
  assert.equal(projectRefFromDestinationValue(PRODUCTION_REF), PRODUCTION_REF);
  assert.equal(projectRefFromDestinationValue(`https://${PRODUCTION_REF}.supabase.co/`), PRODUCTION_REF);
  assert.equal(projectRefFromDestinationValue(PRODUCTION_REF.toUpperCase()), PRODUCTION_REF);
  assert.equal(projectRefFromDestinationValue(`  ${PRODUCTION_REF}  `), PRODUCTION_REF);
  assert.equal(projectRefFromDestinationValue("https://example.com"), null);
  assert.equal(projectRefFromDestinationValue(""), null);
  assert.equal(projectRefFromDestinationValue(undefined), null);
});

test("env 해석 순서는 Next 와 같다 — process.env 가 어떤 파일보다 세다", () => {
  const { env, sources } = resolveDevServerEnvironment({
    appRoot: "/repo/apps/web",
    processEnv: { NEXT_PUBLIC_SITE_URL: "http://localhost:3200" },
    readEnvFile: (filePath) => {
      const name = path.basename(filePath);
      if (name === ".env") return "A=from-env\nB=from-env\nC=from-env\nD=from-env";
      if (name === ".env.development") return "B=from-development\nC=from-development\nD=from-development";
      if (name === ".env.local") return "C=from-local\nD=from-local";
      if (name === ".env.development.local") return "D=from-development-local";
      return null;
    },
  });

  assert.deepEqual(DEV_ENV_FILE_ORDER, [
    ".env.development.local",
    ".env.local",
    ".env.development",
    ".env",
  ]);
  assert.equal(env.A, "from-env");
  assert.equal(env.B, "from-development");
  assert.equal(env.C, "from-local");
  assert.equal(env.D, "from-development-local");
  assert.equal(sources.C, "apps/web/.env.local");
  assert.equal(sources.NEXT_PUBLIC_SITE_URL, "명령줄/셸 환경변수");
});

test("사고 재현: 운영을 가리키는 .env.local 이면 기동을 거부한다", () => {
  const evaluation = evaluateWith({ ".env.local": ACCIDENT_ENV_LOCAL });

  assert.equal(evaluation.allowed, false);
  assert.equal(evaluation.code, "PRODUCTION_BLOCKED");
  assert.equal(evaluation.productionTarget, true);
  assert.deepEqual(
    evaluation.productionMatches.map((match) => match.key),
    ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_EXPECTED_URL", "SUPABASE_EXPECTED_PROJECT_REF"],
  );
  assert.equal(evaluation.productionMatches[0].source, "apps/web/.env.local");
});

test("EXPECTED 핀이 아예 없고 URL 만 운영이어도 거부한다", () => {
  // destinationFence 는 핀끼리 어긋나는 것만 본다. 핀이 없는 이 모양은 펜스를 통과하고,
  // 브라우저/SSR anon 경로는 운영 데이터를 그대로 읽고 쓴다.
  const evaluation = evaluateWith({
    ".env.local": `NEXT_PUBLIC_SUPABASE_URL=https://${PRODUCTION_REF}.supabase.co`,
  });

  assert.equal(evaluation.allowed, false);
  assert.equal(evaluation.code, "PRODUCTION_BLOCKED");
  assert.deepEqual(
    evaluation.productionMatches.map((match) => match.key),
    ["NEXT_PUBLIC_SUPABASE_URL"],
  );
});

test("SUPABASE_PRODUCTION_PROJECT_REF 가 다른 값을 주장해도 코드에 박힌 운영 ref 가 이긴다", () => {
  const evaluation = evaluateWith({
    ".env.local": [
      `NEXT_PUBLIC_SUPABASE_URL=https://${PRODUCTION_REF}.supabase.co`,
      `SUPABASE_EXPECTED_PROJECT_REF=${PRODUCTION_REF}`,
      "SUPABASE_PRODUCTION_PROJECT_REF=zyxwvutsrqponmlkjihg",
    ].join("\n"),
  });

  assert.equal(evaluation.allowed, false);
  assert.equal(evaluation.code, "PRODUCTION_BLOCKED");
});

test("스테이징을 가리키면 통과하고, 배너에 포트와 대상 ref 가 함께 찍힌다", () => {
  const evaluation = evaluateWith({ ".env.local": STAGING_ENV_LOCAL });

  assert.equal(evaluation.allowed, true);
  assert.equal(evaluation.code, "SAFE");
  assert.equal(evaluation.productionTarget, false);
  assert.equal(evaluation.projectRef, STAGING_REF);

  const banner = formatDestinationBanner(evaluation, { port: "3300" });
  assert.match(banner, /3300/);
  assert.match(banner, new RegExp(STAGING_REF));
  assert.match(banner, /apps\/web\/\.env\.local/);
  assert.doesNotMatch(banner, /운영\(PRODUCTION\)/);
});

test("합성 자격증명 런처는 운영 .env.local 위에서도 통과한다", () => {
  const evaluation = evaluateWith(
    { ".env.local": ACCIDENT_ENV_LOCAL },
    { ...SYNTHETIC_SUPABASE_ENVIRONMENT },
  );

  assert.equal(evaluation.allowed, true);
  assert.equal(evaluation.code, "SAFE");
  assert.equal(evaluation.projectRef, "abcdefghijklmnopqrst");
});

test("명령줄 옵트인에 정확한 운영 ref 를 주면 통과하되 배너가 크게 경고한다", () => {
  const evaluation = evaluateWith(
    { ".env.local": ACCIDENT_ENV_LOCAL },
    { [PRODUCTION_OPT_IN_ENV_KEY]: PRODUCTION_REF },
  );

  assert.equal(evaluation.allowed, true);
  assert.equal(evaluation.code, "PRODUCTION_OPT_IN");
  assert.equal(evaluation.productionTarget, true);

  const banner = formatDestinationBanner(evaluation, { port: "3200" });
  assert.match(banner, /3200/);
  assert.match(banner, new RegExp(PRODUCTION_REF));
  assert.match(banner, /운영\(PRODUCTION\)/);
  assert.match(banner, new RegExp(`${PRODUCTION_OPT_IN_ENV_KEY}=${PRODUCTION_REF}`));
});

test("옵트인이 .env 파일에만 적혀 있으면 무시하고 거부한다", () => {
  // 파일에 적어두면 그 다음 실행부터는 다시 「실수로」가 된다.
  const evaluation = evaluateWith({
    ".env.local": `${ACCIDENT_ENV_LOCAL}\n${PRODUCTION_OPT_IN_ENV_KEY}=${PRODUCTION_REF}`,
  });

  assert.equal(evaluation.allowed, false);
  assert.equal(evaluation.code, "PRODUCTION_BLOCKED");
  assert.equal(evaluation.optInValue, null);
  assert.equal(evaluation.optInFromFileOnly, "apps/web/.env.local");

  const refusal = formatDestinationRefusal(evaluation, { port: "3200" });
  assert.match(refusal, /무시했습니다/);
});

test("Next 가 .env.local 옵트인을 process.env 에 부어 놓아도 인정하지 않는다", () => {
  // next.config 안에서 가드가 돌 때 Next 는 이미 `.env.local` 을 process.env 에 부어 둔다
  // (2026-08-20 실측). 그때 process.env 만 보면 파일 한 줄이 영구 옵트인이 된다.
  const optInLine = `${PRODUCTION_OPT_IN_ENV_KEY}=${PRODUCTION_REF}`;
  const evaluation = evaluateWith(
    { ".env.local": `${ACCIDENT_ENV_LOCAL}
${optInLine}` },
    {
      // Next 가 부어 놓은 모양 그대로: 파일과 값이 같다.
      [PRODUCTION_OPT_IN_ENV_KEY]: PRODUCTION_REF,
      NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
      SUPABASE_EXPECTED_URL: `https://${PRODUCTION_REF}.supabase.co`,
      SUPABASE_EXPECTED_PROJECT_REF: PRODUCTION_REF,
    },
  );

  assert.equal(evaluation.allowed, false);
  assert.equal(evaluation.code, "PRODUCTION_BLOCKED");
  assert.equal(evaluation.optInValue, null);
  assert.equal(evaluation.optInFromFileOnly, "apps/web/.env.local");
});

test("파일에 다른 값이 있어도 셸에서 준 옵트인은 인정한다", () => {
  const evaluation = evaluateWith(
    { ".env.local": `${ACCIDENT_ENV_LOCAL}
${PRODUCTION_OPT_IN_ENV_KEY}=stale-value` },
    { [PRODUCTION_OPT_IN_ENV_KEY]: PRODUCTION_REF },
  );

  assert.equal(evaluation.allowed, true);
  assert.equal(evaluation.code, "PRODUCTION_OPT_IN");
});

test("목적지 값도 파일과 같은 값이면 출처를 파일로 센다", () => {
  // 배너의 "<- 어디서 왔나"가 next.config 경로에서 전부 '명령줄'로 찍히면
  // 어느 파일을 고쳐야 하는지 알 수 없게 된다.
  const evaluation = evaluateWith(
    { ".env.local": STAGING_ENV_LOCAL },
    { NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_REF}.supabase.co` },
  );

  assert.equal(evaluation.projectRefSource, "apps/web/.env.local");
});

test("옵트인 값이 붙으려는 운영 ref 와 다르면 거부한다", () => {
  for (const wrong of ["true", "1", "yes", STAGING_REF, "slrtobkksjmxgzatjyq"]) {
    const evaluation = evaluateWith(
      { ".env.local": ACCIDENT_ENV_LOCAL },
      { [PRODUCTION_OPT_IN_ENV_KEY]: wrong },
    );
    assert.equal(evaluation.allowed, false, `옵트인 값 '${wrong}' 이 통과했다`);
    assert.equal(evaluation.code, "PRODUCTION_OPT_IN_MISMATCH");
  }
});

test("거부 메시지는 무엇이 잘못됐고 어떻게 고치는지 한국어로 다 말한다", () => {
  const evaluation = evaluateWith({ ".env.local": ACCIDENT_ENV_LOCAL });
  const refusal = formatDestinationRefusal(evaluation, { port: "3200" });

  assert.match(refusal, /거부했습니다/);
  assert.match(refusal, /포트\s+: 3200/);
  assert.match(refusal, new RegExp(`운영 프로젝트 : ${PRODUCTION_REF}`));
  assert.match(refusal, /NEXT_PUBLIC_SUPABASE_URL = slrtobkksjmxgzatjyqb {3}<- apps\/web\/\.env\.local/);
  assert.match(refusal, /node \.\/scripts\/dev-web-local\.mjs/);
  assert.match(refusal, new RegExp(STAGING_REF));
  assert.match(refusal, new RegExp(`\\$env:${PRODUCTION_OPT_IN_ENV_KEY}='${PRODUCTION_REF}'`));
  assert.match(refusal, new RegExp(`${PRODUCTION_OPT_IN_ENV_KEY}=${PRODUCTION_REF} pnpm`));
  assert.match(refusal, /다른 워크트리의 \.env\.local 은 건드리지 마세요/);
});

test("포트는 next dev 인자와 PORT 환경변수에서 같은 규칙으로 읽는다", () => {
  assert.equal(resolveDevServerPort({ argv: [], env: {} }), "3000");
  assert.equal(resolveDevServerPort({ argv: ["-p", "3200"], env: {} }), "3200");
  assert.equal(resolveDevServerPort({ argv: ["--port", "3200"], env: {} }), "3200");
  assert.equal(resolveDevServerPort({ argv: ["--port=3200"], env: {} }), "3200");
  assert.equal(resolveDevServerPort({ argv: ["-p3200"], env: {} }), "3200");
  assert.equal(resolveDevServerPort({ argv: [], env: { PORT: "3101" } }), "3101");
  assert.equal(resolveDevServerPort({ argv: ["-p", "3200"], env: { PORT: "3101" } }), "3200");
  assert.equal(resolveDevServerPort({ argv: ["--turbo"], env: { PORT: "not-a-port" } }), "3000");
});

test("assertDevServerDestination 은 거부 시 DevServerDestinationError 를 던진다", () => {
  assert.throws(
    () =>
      assertDevServerDestination({
        appRoot: "/repo/apps/web",
        argv: ["-p", "3200"],
        processEnv: {},
        readEnvFile: (filePath) =>
          path.basename(filePath) === ".env.local" ? ACCIDENT_ENV_LOCAL : null,
      }),
    (error) => {
      assert.ok(error instanceof DevServerDestinationError);
      assert.equal(error.code, "PRODUCTION_BLOCKED");
      assert.match(error.message, /3200/);
      return true;
    },
  );

  const allowed = assertDevServerDestination({
    appRoot: "/repo/apps/web",
    argv: ["--port=3300"],
    processEnv: {},
    readEnvFile: (filePath) =>
      path.basename(filePath) === ".env.local" ? STAGING_ENV_LOCAL : null,
  });
  assert.equal(allowed.port, "3300");
  assert.match(allowed.banner, /3300/);
  assert.match(allowed.banner, new RegExp(STAGING_REF));
});

test("런처는 목적지 검사를 연구/빌드 락보다 먼저 한다", () => {
  // 거부된 실행이 락을 남기면, 다음 dev 서버가 엉뚱한 이유로 막힌다.
  const source = readFileSync(launcher, "utf8");
  const guardAt = source.indexOf("assertDevServerDestination(");
  const lockAt = source.indexOf("acquireWeddingCodeResearchLock(");

  assert.ok(guardAt > 0, "런처가 목적지 가드를 호출하지 않는다");
  assert.ok(lockAt > 0);
  assert.ok(guardAt < lockAt, "목적지 검사가 락 획득보다 뒤에 있다");
});

test("런처를 운영 목적지로 실행하면 Next 를 띄우지 않고 종료 코드 1 로 죽는다", () => {
  const env = { ...process.env };
  delete env[PRODUCTION_OPT_IN_ENV_KEY];
  env.NEXT_PUBLIC_SUPABASE_URL = `https://${PRODUCTION_REF}.supabase.co`;
  env.SUPABASE_EXPECTED_URL = `https://${PRODUCTION_REF}.supabase.co`;
  env.SUPABASE_EXPECTED_PROJECT_REF = PRODUCTION_REF;
  env.PORT = "3200";
  // 이 테스트를 깨뜨려보는 사람(가드를 지우고 돌려보는 사람)이 진짜 운영 dev 서버를
  // 띄우게 되면 안 된다. 자격증명은 못 쓰는 값으로 덮어 둔다.
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "invalid-anon-key-for-test";
  env.SUPABASE_SERVICE_ROLE_KEY = "";

  const result = spawnSync(process.execPath, [launcher], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    timeout: 20_000,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /dev 서버 기동을 거부했습니다/);
  assert.match(result.stderr, new RegExp(PRODUCTION_REF));
  assert.match(result.stderr, /3200/);
  assert.doesNotMatch(result.stdout ?? "", /Ready in/);
});

test("런처를 건너뛰고 next dev 를 직접 쳐도 운영 목적지면 뜨지 못한다", () => {
  // 런처(`pnpm dev`)만 막으면 `npx next dev` 로 그대로 우회된다.
  // 이건 next.config 의 devServerDestinationFence 가 잡아야 한다.
  const nextCli = path.join(appRoot, "node_modules/next/dist/bin/next");
  assert.ok(
    statSync(nextCli).isFile(),
    "next 바이너리가 없다 — 이 테스트는 의존성 설치 후에만 의미가 있다",
  );

  const env = { ...process.env };
  delete env[PRODUCTION_OPT_IN_ENV_KEY];
  delete env.PORT;
  env.NEXT_PUBLIC_SUPABASE_URL = `https://${PRODUCTION_REF}.supabase.co`;
  env.SUPABASE_EXPECTED_URL = `https://${PRODUCTION_REF}.supabase.co`;
  env.SUPABASE_EXPECTED_PROJECT_REF = PRODUCTION_REF;
  // 이 테스트를 깨뜨려보는 사람이 진짜 운영 dev 서버를 띄우면 안 된다.
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "invalid-anon-key-for-test";
  env.SUPABASE_SERVICE_ROLE_KEY = "";

  const result = spawnSync(process.execPath, [nextCli, "dev", "-p", "3989"], {
    cwd: appRoot,
    env,
    encoding: "utf8",
    timeout: 120_000,
  });

  // 타임아웃으로 죽은 것은 "막았다"가 아니다 — dev 서버가 떠서 살아 있었다는 뜻이다.
  assert.equal(result.error, undefined, "next dev 가 스스로 끝나지 않았다 = 막지 못했다");
  assert.ok(
    typeof result.status === "number" && result.status !== 0,
    `next dev 가 종료코드 ${result.status} 로 끝났다`,
  );

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.match(output, /dev 서버 기동을 거부했습니다/);
  assert.match(output, new RegExp(PRODUCTION_REF));
  assert.match(output, /3989/);
});

test("가드는 dev 서버가 실제로 쓰는 apps/web 의 env 파일들을 읽는다", () => {
  assert.ok(statSync(appRoot).isDirectory());

  const read = [];
  assertDevServerDestination({
    appRoot,
    argv: [],
    processEnv: {},
    readEnvFile: (filePath) => {
      read.push(filePath);
      return null;
    },
  });

  assert.deepEqual(
    read,
    [...DEV_ENV_FILE_ORDER].reverse().map((name) => path.join(appRoot, name)),
  );
});
