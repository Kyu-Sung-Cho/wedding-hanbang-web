import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  REPOSITORY_PRODUCTION_PROJECT_REFS,
  SupabaseDestinationError,
  verifySupabaseServiceDestination,
} from "../lib/supabase-service-destination.mjs";

const PROJECT_REF = "abcdefghijklmnopqrst";
const OTHER_REF = "zyxwvutsrqponmlkjihg";
const URL = `https://${PROJECT_REF}.supabase.co`;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PRODUCTION_REF = REPOSITORY_PRODUCTION_PROJECT_REFS[0];
const PRODUCTION_URL = `https://${PRODUCTION_REF}.supabase.co`;

function jwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}

function validInput(overrides = {}) {
  return {
    url: URL,
    serviceRoleKey: jwt({ iss: "supabase", ref: PROJECT_REF, role: "service_role" }),
    expectedUrl: URL,
    expectedProjectRef: PROJECT_REF,
    productionProjectRef: OTHER_REF,
    access: "read",
    ...overrides,
  };
}

test("service destination accepts a matching URL, ref and service-role JWT", () => {
  assert.deepEqual(
    verifySupabaseServiceDestination(validInput()),
    { url: URL, projectRef: PROJECT_REF, keyKind: "jwt" },
  );
});

test("service destination rejects cross-project URL and JWT contamination", () => {
  assert.throws(
    () => verifySupabaseServiceDestination(validInput({ expectedProjectRef: OTHER_REF })),
    (error) => error instanceof SupabaseDestinationError && error.code === "URL_REF_MISMATCH",
  );
  assert.throws(
    () => verifySupabaseServiceDestination(validInput({
      serviceRoleKey: jwt({ iss: "supabase", ref: OTHER_REF, role: "service_role" }),
    })),
    (error) => error instanceof SupabaseDestinationError && error.code === "JWT_REF_MISMATCH",
  );
});

test("production write access needs the exact project-scoped confirmation", () => {
  assert.throws(
    () => verifySupabaseServiceDestination(validInput({
      access: "operator-write",
      productionProjectRef: PROJECT_REF,
    })),
    (error) => error instanceof SupabaseDestinationError
      && error.code === "PRODUCTION_WRITE_CONFIRMATION_REQUIRED",
  );
  assert.equal(
    verifySupabaseServiceDestination(validInput({
      access: "operator-write",
      productionProjectRef: PROJECT_REF,
      productionWriteConfirmation: `OPERATOR_WRITE:${PROJECT_REF}`,
    })).projectRef,
    PROJECT_REF,
  );
});

// 이 fence의 "여기가 운영인가" 판정이 SUPABASE_PRODUCTION_PROJECT_REF 하나에만
// 걸려 있었다. 그 값은 목적지를 정하는 env가 함께 정하므로, 로컬 모양의 env가
// 운영 ref를 잘못 적어두면 목적지는 진짜 운영인데 fence는 "운영이 아니다"로
// 읽고 확인 문자열 없이 service-role 쓰기를 통과시켰다.
function productionDestinationInput(overrides = {}) {
  return {
    url: PRODUCTION_URL,
    serviceRoleKey: jwt({ iss: "supabase", ref: PRODUCTION_REF, role: "service_role" }),
    expectedUrl: PRODUCTION_URL,
    expectedProjectRef: PRODUCTION_REF,
    // 목적지는 운영이지만, env는 운영을 다른 프로젝트라고 주장한다.
    productionProjectRef: OTHER_REF,
    access: "operator-write",
    ...overrides,
  };
}

test("repository-pinned production refuses writes when env misstates production", () => {
  for (const access of ["operator-write", "runtime"]) {
    assert.throws(
      () => verifySupabaseServiceDestination(productionDestinationInput({ access })),
      (error) => error instanceof SupabaseDestinationError
        && error.code === "PRODUCTION_WRITE_CONFIRMATION_REQUIRED",
      `${access} against the pinned production project must demand a confirmation`,
    );
  }

  assert.equal(
    verifySupabaseServiceDestination(productionDestinationInput({
      productionWriteConfirmation: `OPERATOR_WRITE:${PRODUCTION_REF}`,
    })).projectRef,
    PRODUCTION_REF,
  );
  assert.equal(
    verifySupabaseServiceDestination(productionDestinationInput({ access: "read" })).projectRef,
    PRODUCTION_REF,
  );
});

test("the repository production pin is identical in every fence copy", async () => {
  // 세 곳이 각자 상수를 들고 있다. 하나만 고치고 나머지를 두면 그 경로가 다시
  // 운영을 운영으로 보지 않는다.
  const pinnedRefsIn = async (relativePath) => {
    const source = await readFile(join(REPO_ROOT, relativePath), "utf8");
    const block = source.match(
      /REPOSITORY_PRODUCTION_PROJECT_REFS[^=]*=\s*Object\.freeze\(\[([\s\S]*?)\]/,
    );
    assert.ok(block, `${relativePath} must declare REPOSITORY_PRODUCTION_PROJECT_REFS`);
    return [...block[1].matchAll(/"([a-z0-9]{20})"/g)].map((match) => match[1]);
  };

  const copies = {
    "scripts/ingest/destination.ts": await pinnedRefsIn("scripts/ingest/destination.ts"),
    "scripts/lib/supabase-service-destination.mjs": await pinnedRefsIn(
      "scripts/lib/supabase-service-destination.mjs",
    ),
    "apps/web/src/lib/supabase/destinationFence.ts": await pinnedRefsIn(
      "apps/web/src/lib/supabase/destinationFence.ts",
    ),
  };

  for (const [path, refs] of Object.entries(copies)) {
    assert.ok(refs.length > 0, `${path} must pin at least one production project ref`);
    assert.deepEqual(
      refs,
      [...REPOSITORY_PRODUCTION_PROJECT_REFS],
      `${path} drifted from the runtime production pin`,
    );
  }
});

test("errors never reveal the service-role secret", () => {
  const secret = "do-not-print-this-service-role-secret";
  assert.throws(
    () => verifySupabaseServiceDestination(validInput({ serviceRoleKey: secret })),
    (error) => error instanceof SupabaseDestinationError && !String(error).includes(secret),
  );
});

test("web production code cannot construct an unfenced service-role client", async () => {
  const sourceRoot = join(REPO_ROOT, "apps", "web", "src");
  const entries = await readdir(sourceRoot, { recursive: true, withFileTypes: true });
  const offenders = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name);
    const relativePath = relative(sourceRoot, path).replaceAll("\\", "/");
    if (relativePath.includes("/__tests__/") || /\.test\.[^.]+$/.test(relativePath)) continue;
    const source = await readFile(path, "utf8");
    if (relativePath === "lib/supabase/admin.ts") continue;
    if (/createClient[\s\S]{0,400}SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY[\s\S]{0,400}createClient/.test(source)) {
      offenders.push(relativePath);
    }
  }
  assert.deepEqual(offenders, []);

  const instrumentation = await readFile(join(sourceRoot, "instrumentation.ts"), "utf8");
  assert.match(instrumentation, /verifyRuntimeSupabaseServiceDestination\(\)/);
});

test("every service-role operator/read script invokes the destination verifier", async () => {
  const scriptPaths = [
    "scripts/amora-cost-report.mjs",
    "scripts/audit-community-media-urls.mjs",
    // 운영에 임시 계정·커플·메시지를 실제로 만드는 E2E다. `e162f2da`로 저장소에
    // 들어올 때 이 목록에 없어, service-role로 운영에 쓰면서 목적지 검증만
    // 통과하지 않는 유일한 경로였다(2026-07-27 발견).
    "scripts/audit/saved-notes-real-path-e2e.mjs",
    "scripts/check-amora-production-env.mjs",
    "apps/web/scripts/amora-preview-integration.mjs",
    "apps/web/scripts/amora-engine-v2-hosted-integration.mjs",
  ];
  for (const relativePath of scriptPaths) {
    const source = await readFile(join(REPO_ROOT, relativePath), "utf8");
    assert.match(
      source,
      /verifySupabaseServiceDestination(?:FromEnv)?\(/,
      `${relativePath} must verify its destination before service-role access`,
    );
  }

  const demoSession = await readFile(join(REPO_ROOT, "apps/web/src/lib/demoSession.ts"), "utf8");
  assert.doesNotMatch(demoSession, /SUPABASE_SERVICE_ROLE_KEY|ADMIN_PASSWORD/);
  const costReport = await readFile(join(REPO_ROOT, "scripts/amora-cost-report.mjs"), "utf8");
  assert.doesNotMatch(
    costReport.match(/function pseudonymousCoupleLabel[\s\S]*?\n}/)?.[0] ?? "",
    /SUPABASE_SERVICE_ROLE_KEY/,
  );
});
