// dev 서버가 **운영 Supabase** 를 가리킨 채로 뜨는 것을 기동 전에 막는다.
//
// 왜 필요한가: 2026-08-20, 스테이징인 줄 알고 누른 「커플 초기화」가 운영 DB를 보고 있던
// 다른 워크트리의 dev 서버(포트 3200)로 갔고, 파운더 본인의 커플 연결이 영구히 끊어졌다.
// 화면만 봐서는 어느 DB인지 알 수 없다.
//
// destinationFence.ts 는 "핀끼리 어긋나는 것"만 막는다 — URL·EXPECTED·PRODUCTION 이
// 전부 운영을 가리키면 그냥 통과한다. 게다가 브라우저/SSR anon 경로는 펜스를 아예 타지 않는다.
// 그래서 이 가드는 런처 단계에서, 펜스와는 다른 질문을 한다:
// "이 dev 서버가 붙으려는 프로젝트가 **알려진 운영 프로젝트**인가?"
//
// 운영 데이터가 정말 필요한 경우는 남겨둔다. 다만 실수로는 불가능해야 하므로,
// 옵트인은 그 실행에만 주는 명령줄 환경변수로만 인정한다(.env 파일에 적은 값은 무시).

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { PRODUCTION_DATABASE_SYSTEM_IDENTIFIERS } from "./production-database-identity.mjs";

const PROJECT_REF = /^[a-z0-9]{20}$/;
const SUPABASE_HOST = /^(?:db\.)?([a-z0-9]{20})\.supabase\.co$/;

/** Next.js 가 `next dev` 에서 읽는 env 파일 — 우선순위가 높은 것부터. */
export const DEV_ENV_FILE_ORDER = Object.freeze([
  ".env.development.local",
  ".env.local",
  ".env.development",
  ".env",
]);

/** dev 서버의 목적지를 결정하는 env 키. 하나라도 운영을 가리키면 기동을 거부한다. */
export const DESTINATION_ENV_KEYS = Object.freeze([
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_EXPECTED_URL",
  "SUPABASE_EXPECTED_PROJECT_REF",
]);

/** 운영 접속 옵트인. **명령줄 환경변수로 준 경우에만** 인정한다. */
export const PRODUCTION_OPT_IN_ENV_KEY = "HANBANG_DEV_ALLOW_PRODUCTION_SUPABASE";

/**
 * 코드에 박힌 운영 프로젝트 목록. env 로 덮을 수 없다는 점이 핵심이다 —
 * `.env.local` 이 스스로를 "운영이 아니다"라고 주장해도 여기서 걸린다.
 */
export const KNOWN_PRODUCTION_PROJECT_REFS = Object.freeze(
  Object.keys(PRODUCTION_DATABASE_SYSTEM_IDENTIFIERS).filter((ref) => PROJECT_REF.test(ref)),
);

/** 안내 문구에서만 쓰는 스테이징 프로젝트 힌트. 판정에는 쓰지 않는다. */
export const STAGING_PROJECT_REF_HINT = "rgxdizztidbgwnsbadml";

export class DevServerDestinationError extends Error {
  constructor(code, message, evaluation) {
    super(message);
    this.name = "DevServerDestinationError";
    this.code = code;
    this.evaluation = evaluation;
  }
}

export function parseEnvFile(text) {
  const values = {};
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().replace(/^export\s+/, "");
    if (!key) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

/** `https://<ref>.supabase.co` 도, 맨 ref 도 같은 프로젝트 ref 로 정규화한다. */
export function projectRefFromDestinationValue(value) {
  const candidate = String(value ?? "").trim();
  if (!candidate) return null;
  // 맨 ref 는 소문자로 맞춰 본다. 대문자로 적었다고 검사를 빠져나가면 안 된다.
  if (PROJECT_REF.test(candidate.toLowerCase())) return candidate.toLowerCase();
  let hostname;
  try {
    hostname = new URL(candidate).hostname;
  } catch {
    return null;
  }
  const matched = SUPABASE_HOST.exec(hostname);
  return matched ? matched[1] : null;
}

function defaultReadEnvFile(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") return null;
    throw error;
  }
}

/**
 * `next dev` 가 실제로 보게 될 환경을 런처 쪽에서 재구성한다.
 * Next 는 process.env 에 이미 있는 키를 파일 값으로 덮어쓰지 않으므로 process.env 를 마지막에 얹는다.
 */
export function resolveDevServerEnvironment({
  appRoot,
  processEnv = process.env,
  readEnvFile = defaultReadEnvFile,
  fileOrder = DEV_ENV_FILE_ORDER,
} = {}) {
  const env = {};
  const sources = {};
  for (const fileName of [...fileOrder].reverse()) {
    const text = readEnvFile(path.join(appRoot, fileName));
    if (text === null || text === undefined) continue;
    for (const [key, value] of Object.entries(parseEnvFile(text))) {
      env[key] = value;
      sources[key] = `apps/web/${fileName}`;
    }
  }
  for (const [key, value] of Object.entries(processEnv)) {
    if (value === undefined) continue;
    env[key] = value;
    sources[key] = "명령줄/셸 환경변수";
  }
  return { env, sources };
}

export function resolveDevServerPort({ argv = [], env = {} } = {}) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] ?? "");
    if (arg === "-p" || arg === "--port") {
      const next = String(argv[index + 1] ?? "");
      if (/^\d+$/.test(next)) return next;
      continue;
    }
    const matched = /^(?:--port=|-p=?)(\d+)$/.exec(arg);
    if (matched) return matched[1];
  }
  const fromEnv = String(env.PORT ?? "").trim();
  if (/^\d+$/.test(fromEnv)) return fromEnv;
  return "3000";
}

export function evaluateDevServerDestination({
  env = {},
  sources = {},
  processEnv = process.env,
} = {}) {
  const productionProjectRefs = new Set(KNOWN_PRODUCTION_PROJECT_REFS);
  const declaredProductionRef = projectRefFromDestinationValue(env.SUPABASE_PRODUCTION_PROJECT_REF);
  if (declaredProductionRef) productionProjectRefs.add(declaredProductionRef);

  const productionMatches = [];
  for (const key of DESTINATION_ENV_KEYS) {
    const projectRef = projectRefFromDestinationValue(env[key]);
    if (!projectRef || !productionProjectRefs.has(projectRef)) continue;
    productionMatches.push({ key, projectRef, source: sources[key] ?? "알 수 없음" });
  }

  const projectRef =
    projectRefFromDestinationValue(env.NEXT_PUBLIC_SUPABASE_URL) ??
    projectRefFromDestinationValue(env.SUPABASE_EXPECTED_PROJECT_REF) ??
    projectRefFromDestinationValue(env.SUPABASE_EXPECTED_URL) ??
    null;

  const projectRefSource =
    projectRef === null
      ? null
      : (DESTINATION_ENV_KEYS.map((key) =>
          projectRefFromDestinationValue(env[key]) === projectRef ? sources[key] : null,
        ).find(Boolean) ?? null);

  // 옵트인은 process.env 에서만 읽는다. 해석된 env 를 쓰면 `.env.local` 한 줄로
  // 영구 옵트인이 되어 "그 실행에만"이라는 성질이 사라진다.
  const optInValue = String(processEnv[PRODUCTION_OPT_IN_ENV_KEY] ?? "").trim();
  const optInSource = sources[PRODUCTION_OPT_IN_ENV_KEY] ?? null;
  const optInFromFileOnly =
    !optInValue && optInSource !== null && optInSource !== "명령줄/셸 환경변수" ? optInSource : null;

  const base = {
    projectRef,
    projectRefSource,
    productionMatches,
    productionProjectRefs: [...productionProjectRefs].sort(),
    optInValue: optInValue || null,
    optInFromFileOnly,
  };

  if (productionMatches.length === 0) {
    return { ...base, productionTarget: false, allowed: true, code: "SAFE" };
  }

  const matchedRefs = [...new Set(productionMatches.map((match) => match.projectRef))];
  const optInSatisfied =
    optInValue.length > 0 && matchedRefs.length === 1 && matchedRefs[0] === optInValue;

  if (optInSatisfied) {
    return { ...base, productionTarget: true, allowed: true, code: "PRODUCTION_OPT_IN" };
  }

  return {
    ...base,
    productionTarget: true,
    allowed: false,
    code: optInValue.length > 0 ? "PRODUCTION_OPT_IN_MISMATCH" : "PRODUCTION_BLOCKED",
  };
}

const RULE = "=".repeat(78);
const ALARM = "#".repeat(78);

function describeMatches(productionMatches) {
  return productionMatches.map(
    (match) => `    - ${match.key} = ${match.projectRef}   <- ${match.source}`,
  );
}

export function formatDestinationRefusal(evaluation, { port } = {}) {
  const target = evaluation.productionMatches[0]?.projectRef ?? evaluation.projectRef ?? "(불명)";
  const lines = [
    RULE,
    "  dev 서버 기동을 거부했습니다 — 이 설정은 운영(PRODUCTION) Supabase 를 가리킵니다.",
    "",
    `  포트          : ${port ?? "(불명)"}`,
    `  운영 프로젝트 : ${target}`,
    "",
    "  운영을 가리키는 값:",
    ...describeMatches(evaluation.productionMatches),
    "",
    "  화면만 봐서는 어느 DB인지 알 수 없습니다. 이 서버에서 「커플 초기화」 같은 버튼을",
    "  누르면 실제 사용자 데이터가 되돌릴 수 없게 바뀝니다(2026-08-20에 실제로 일어났습니다).",
    "",
    "  고치는 방법 — 위에서부터 시도하세요.",
    "",
    "   1) 실제 데이터가 필요 없다면: 합성 자격증명 런처로 띄웁니다.",
    "      어떤 실제 프로젝트에도 붙지 않습니다.",
    "",
    "        node ./scripts/dev-web-local.mjs",
    "",
    `   2) 스테이징 데이터로 작업한다면: 이 워크트리의 apps/web/.env.local 에서`,
    `      아래 3개를 스테이징 프로젝트(${STAGING_PROJECT_REF_HINT})로 바꿉니다.`,
    "",
    "        NEXT_PUBLIC_SUPABASE_URL / SUPABASE_EXPECTED_URL / SUPABASE_EXPECTED_PROJECT_REF",
    "",
    "      다른 워크트리의 .env.local 은 건드리지 마세요. 그건 그 세션의 것입니다.",
    "",
    "   3) 정말로 운영 데이터가 필요하다면: 이 실행에만 옵트인합니다.",
    "",
    "        PowerShell:",
    `          $env:${PRODUCTION_OPT_IN_ENV_KEY}='${target}'; pnpm --filter @hanbang/web dev`,
    "",
    "        bash:",
    `          ${PRODUCTION_OPT_IN_ENV_KEY}=${target} pnpm --filter @hanbang/web dev`,
    "",
  ];

  if (evaluation.code === "PRODUCTION_OPT_IN_MISMATCH") {
    lines.push(
      `  옵트인 값이 대상과 다릅니다: 준 값 '${evaluation.optInValue}', 붙으려는 운영 프로젝트 '${target}'.`,
      "  붙을 프로젝트 ref 를 정확히 적어야 통과합니다 — 손이 미끄러진 옵트인은 옵트인이 아닙니다.",
      "",
    );
  }

  if (evaluation.optInFromFileOnly) {
    lines.push(
      `  참고: ${PRODUCTION_OPT_IN_ENV_KEY} 가 ${evaluation.optInFromFileOnly} 에 적혀 있지만 무시했습니다.`,
      "  파일에 적어두면 그 다음 실행부터는 다시 「실수로」가 되기 때문입니다.",
      "",
    );
  } else {
    lines.push(
      "  옵트인은 명령줄 환경변수로만 인정됩니다. .env 파일에 적어두면 무시됩니다.",
      "",
    );
  }

  lines.push(RULE);
  return lines.join("\n");
}

export function formatDestinationBanner(evaluation, { port } = {}) {
  const projectRef = evaluation.projectRef ?? "(설정 없음)";
  const source = evaluation.projectRefSource ? `   <- ${evaluation.projectRefSource}` : "";

  if (!evaluation.productionTarget) {
    return [
      RULE,
      `  dev 서버 기동   포트 ${port}   http://localhost:${port}`,
      `  Supabase 대상   ${projectRef}${source}`,
      RULE,
    ].join("\n");
  }

  const target = evaluation.productionMatches[0]?.projectRef ?? projectRef;
  return [
    ALARM,
    "##",
    "##   경고: 이 dev 서버는 운영(PRODUCTION) Supabase 에 붙습니다.",
    "##",
    `##   포트            ${port}   http://localhost:${port}`,
    `##   Supabase 대상   ${target}   (운영)`,
    `##   옵트인          ${PRODUCTION_OPT_IN_ENV_KEY}=${evaluation.optInValue}`,
    "##",
    "##   여기서 누르는 모든 버튼은 실제 사용자 데이터를 바꿉니다.",
    "##   「커플 초기화」처럼 되돌릴 수 없는 조작은 하지 마세요.",
    "##",
    ALARM,
  ].join("\n");
}

/**
 * 런처에서 쓰는 진입점. 운영을 가리키면 던지고, 아니면 배너 문자열을 돌려준다.
 */
export function assertDevServerDestination({
  appRoot,
  argv = [],
  processEnv = process.env,
  readEnvFile,
} = {}) {
  const { env, sources } = resolveDevServerEnvironment({ appRoot, processEnv, readEnvFile });
  const port = resolveDevServerPort({ argv, env: processEnv });
  const evaluation = evaluateDevServerDestination({ env, sources, processEnv });

  if (!evaluation.allowed) {
    throw new DevServerDestinationError(
      evaluation.code,
      formatDestinationRefusal(evaluation, { port }),
      evaluation,
    );
  }

  return { evaluation, port, banner: formatDestinationBanner(evaluation, { port }) };
}
