import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  executeHostedStagingRlsProbe,
  loadApprovedHostedStagingBinding,
  OWNED_APPLICATION_TABLES,
  ProbeFailure,
  PUBLIC_DISCLOSURE_VIEWS,
  readGitState,
  validateProbeEnvironment,
  VENDOR_DISCLOSURE_BASE_TABLES,
} from "../vendor-public-rls-probe.mjs";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";
const UUID_D = "44444444-4444-4444-8444-444444444444";
const UUID_E = "55555555-5555-4555-8555-555555555555";
const UUID_F = "66666666-6666-4666-8666-666666666666";
const STAGING_REF = "stagingprojectref123";
const PRODUCTION_REF = "productionproject123";
const PUBLIC_VIEW_DEFINITIONS = Object.freeze(Object.fromEntries(
  PUBLIC_DISCLOSURE_VIEWS.map(({ name }) => [
    name,
    `SELECT approved_columns FROM public.${name} WHERE evidence_is_public`,
  ]),
));

function git(repoRoot, args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function initializeGitRepo(repoRoot, marker) {
  await mkdir(repoRoot, { recursive: true });
  await writeFile(join(repoRoot, "marker.txt"), `${marker}\n`);
  git(repoRoot, ["init", "--quiet"]);
  git(repoRoot, ["config", "user.name", "RLS Probe Test"]);
  git(repoRoot, ["config", "user.email", "rls-probe@example.invalid"]);
  git(repoRoot, ["add", "--all"]);
  git(repoRoot, ["commit", "--quiet", "-m", `fixture ${marker}`]);
  return git(repoRoot, ["rev-parse", "HEAD"]);
}

test("Git environment variables cannot redirect repository binding to a sibling checkout", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "vendor-rls-git-env-"));
  const targetRoot = join(workspace, "target");
  const siblingRoot = join(workspace, "sibling");
  const targetCommit = await initializeGitRepo(targetRoot, "target");
  const siblingCommit = await initializeGitRepo(siblingRoot, "sibling");
  assert.notEqual(targetCommit, siblingCommit);
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const previousGitDir = process.env.GIT_DIR;
  const previousGitWorkTree = process.env.GIT_WORK_TREE;
  process.env.GIT_DIR = join(siblingRoot, ".git");
  process.env.GIT_WORK_TREE = siblingRoot;
  try {
    assert.equal(readGitState(targetRoot).commit, targetCommit);
  } finally {
    if (previousGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previousGitDir;
    if (previousGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = previousGitWorkTree;
  }
});

test("an unapproved repo-owned staging contract cannot be bypassed by environment input", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "vendor-rls-staging-pin-"));
  const repoRoot = join(workspace, "repo");
  const contractDir = join(repoRoot, "supabase", "release-contracts");
  await mkdir(contractDir, { recursive: true });
  await writeFile(
    join(contractDir, "vendor-disclosure-hosted-staging-v2-20260718.json"),
    `${JSON.stringify({
      contractVersion: 1,
      kind: "vendor-disclosure-hosted-staging-v2",
      release: "vendor-disclosure-v2-20260718",
      productionProjectRef: PRODUCTION_REF,
      status: "blocked_pending_dedicated_staging",
      approved: false,
      projectRef: null,
      approvalEvidence: null,
      publicViewDefinitionSha256: null,
    }, null, 2)}\n`,
  );
  t.after(() => rm(workspace, { recursive: true, force: true }));

  assert.throws(
    () => loadApprovedHostedStagingBinding({ repoRoot, productionProjectRef: PRODUCTION_REF }),
    (error) => error instanceof ProbeFailure
      && error.code === "STAGING_PROJECT_PIN_MISSING",
  );
});

function validEnv(overrides = {}) {
  return {
    NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test_only_anon_key",
    SUPABASE_ACCESS_TOKEN: "supabase-personal-access-token-test-only",
    SUPABASE_STAGING_PROJECT_REF: STAGING_REF,
    SUPABASE_PRODUCTION_PROJECT_REF: PRODUCTION_REF,
    RLS_PROBE_EXPECTED_COMMIT: "a".repeat(40),
    RLS_PROBE_EXPECTED_SUCCESSOR_MIGRATION_SET_SHA256: "b".repeat(64),
    RLS_PROBE_RECEIPT_OUT: join(tmpdir(), "vendor-rls.json"),
    RLS_PROBE_PUBLIC_VENDOR_ID: UUID_A,
    RLS_PROBE_PUBLIC_PRICE_ID: UUID_A,
    RLS_PROBE_PUBLIC_OPTION_ID: UUID_A,
    RLS_PROBE_PUBLIC_AGENCY_PACKAGE_ID: UUID_A,
    RLS_PROBE_NONPUBLIC_VENDOR_ID: UUID_C,
    RLS_PROBE_NONPUBLIC_PRICE_ID: UUID_D,
    RLS_PROBE_NONPUBLIC_OPTION_ID: UUID_E,
    RLS_PROBE_NONPUBLIC_AGENCY_PACKAGE_ID: UUID_F,
    RLS_PROBE_USER_A_EMAIL: "rls-a@example.invalid",
    RLS_PROBE_USER_A_PASSWORD: "test-password-a",
    RLS_PROBE_USER_A_ID: UUID_A,
    RLS_PROBE_USER_A_VENDOR_ID: UUID_A,
    RLS_PROBE_USER_A_COMBO_ID: UUID_A,
    RLS_PROBE_USER_B_EMAIL: "rls-b@example.invalid",
    RLS_PROBE_USER_B_PASSWORD: "test-password-b",
    RLS_PROBE_USER_B_ID: UUID_B,
    RLS_PROBE_USER_B_VENDOR_ID: UUID_B,
    RLS_PROBE_USER_B_COMBO_ID: UUID_B,
    ...overrides,
  };
}

function sha256(text) {
  return createHash("sha256")
    .update(text.replace(/\r\n?/g, "\n"), "utf8")
    .digest("hex");
}

async function createReleaseFixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), "vendor-rls-probe-"));
  const repoRoot = join(workspace, "repo");
  const receiptDir = join(workspace, "receipts");
  await mkdir(join(repoRoot, "supabase", "release-manifests"), { recursive: true });
  await mkdir(join(repoRoot, "supabase", "release-contracts"), { recursive: true });
  await mkdir(join(repoRoot, "supabase", "migrations"), { recursive: true });
  await mkdir(receiptDir);
  const migrationFile = "20260718120000_probe_fixture.sql";
  const migrationText = "BEGIN;\nSELECT 1;\nCOMMIT;\n";
  const migrationSha256 = sha256(migrationText);
  const predecessorMigrationFile = "20260716117000_predecessor_probe.sql";
  const predecessorMigrationText = "BEGIN;\nSELECT 0;\nCOMMIT;\n";
  const predecessorMigrationSha256 = sha256(predecessorMigrationText);
  const predecessorManifest = {
    release: "amora-engine-v2-20260716",
    projectRef: PRODUCTION_REF,
    expandMigrations: [{
      file: predecessorMigrationFile,
      sha256: predecessorMigrationSha256,
    }],
  };
  const predecessorManifestText = `${JSON.stringify(predecessorManifest, null, 2)}\n`;
  const manifest = {
    deploymentEvidence: {
      backup: "missing",
      finalizer: "missing",
      hostedRestore: "missing",
      hostedStaging: "missing",
      storage: "missing",
    },
    expandMigrations: [{ file: migrationFile, sha256: migrationSha256 }],
    migrationFloor: "20260718120000",
    predecessorManifest: {
      file: "supabase/release-manifests/amora-engine-v2-20260716.json",
      sha256: sha256(predecessorManifestText),
    },
    projectRef: PRODUCTION_REF,
    release: "vendor-disclosure-v2-20260718",
    requiredRemoteHead: "20260716117000",
    status: "deployment_blocked",
  };
  await writeFile(
    join(repoRoot, "supabase", "release-manifests", "amora-engine-v2-20260716.json"),
    predecessorManifestText,
  );
  await writeFile(
    join(repoRoot, "supabase", "release-manifests", "vendor-disclosure-v2-20260718.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(
    join(
      repoRoot,
      "supabase",
      "release-contracts",
      "vendor-disclosure-hosted-staging-v2-20260718.json",
    ),
    `${JSON.stringify({
      contractVersion: 1,
      kind: "vendor-disclosure-hosted-staging-v2",
      release: "vendor-disclosure-v2-20260718",
      productionProjectRef: PRODUCTION_REF,
      status: "approved_for_hosted_rls_probe",
      approved: true,
      projectRef: STAGING_REF,
      approvalEvidence: "change-control/test-staging-approval",
      publicViewDefinitionSha256: Object.fromEntries(
        Object.entries(PUBLIC_VIEW_DEFINITIONS).map(([name, definition]) => [
          name,
          sha256(`${definition}\n`),
        ]),
      ),
    }, null, 2)}\n`,
  );
  await writeFile(
    join(repoRoot, "supabase", "migrations", predecessorMigrationFile),
    predecessorMigrationText,
  );
  await writeFile(
    join(repoRoot, "supabase", "migrations", migrationFile),
    migrationText,
  );
  const commit = await initializeGitRepo(repoRoot, "release fixture");
  t.after(() => rm(workspace, { recursive: true, force: true }));
  return {
    repoRoot,
    receiptOut: join(receiptDir, "vendor-rls.json"),
    migrationSetSha256: sha256(`${migrationFile}:${migrationSha256}\n`),
    migrationVersion: migrationFile.slice(0, 14),
    commit,
  };
}

function validFixtureEnv(fixture, overrides = {}) {
  return validEnv({
    RLS_PROBE_EXPECTED_COMMIT: fixture.commit,
    RLS_PROBE_EXPECTED_SUCCESSOR_MIGRATION_SET_SHA256:
      fixture.migrationSetSha256,
    RLS_PROBE_RECEIPT_OUT: fixture.receiptOut,
    ...overrides,
  });
}

function commitFixtureChange(fixture, message) {
  git(fixture.repoRoot, ["add", "--all"]);
  git(fixture.repoRoot, ["commit", "--quiet", "-m", message]);
  fixture.commit = git(fixture.repoRoot, ["rev-parse", "HEAD"]);
}

async function assertHiddenTrackedChangeRejected(t, indexFlag, tamperedText) {
  const fixture = await createReleaseFixture(t);
  const env = validFixtureEnv(fixture);
  git(fixture.repoRoot, ["update-index", indexFlag, "marker.txt"]);
  await writeFile(join(fixture.repoRoot, "marker.txt"), `${tamperedText}\n`);
  assert.equal(
    git(fixture.repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"]),
    "",
    "the fixture must reproduce a tracked change hidden from git status",
  );
  let hostedRequestCount = 0;

  await assert.rejects(
    executeHostedStagingRlsProbe({
      env,
      repoRoot: fixture.repoRoot,
      fetchImpl: async () => {
        hostedRequestCount += 1;
        return jsonResponse([]);
      },
      persistReceipt: true,
    }),
    (error) => error instanceof ProbeFailure
      && error.code === "GIT_INDEX_FLAGS_UNSAFE",
  );
  assert.equal(hostedRequestCount, 0);
  await assert.rejects(
    readFile(fixture.receiptOut, "utf8"),
    (error) => error?.code === "ENOENT",
  );
}

test("a skip-worktree change is rejected before hosted reads or receipt creation", async (t) => {
  await assertHiddenTrackedChangeRejected(
    t,
    "--skip-worktree",
    "tampered behind skip-worktree",
  );
});

test("an assume-unchanged change is rejected before hosted reads or receipt creation", async (t) => {
  await assertHiddenTrackedChangeRejected(
    t,
    "--assume-unchanged",
    "tampered behind assume-unchanged",
  );
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function successfulInventoryRow(overrides = {}) {
  return {
    ledger_head: "20260718120000",
    invalid_ledger_version_count: 0,
    required_remote_head_count: 1,
    successor_versions: ["20260718120000"],
    base_columns: VENDOR_DISCLOSURE_BASE_TABLES.map((table_name) => ({
      table_name,
      column_name: "id",
    })),
    owned_columns: OWNED_APPLICATION_TABLES.map((table_name) => ({
      table_name,
      column_name: "id",
    })),
    public_view_inventory: PUBLIC_DISCLOSURE_VIEWS.map(({ name, allowedColumns }) => ({
      view_name: name,
      columns: allowedColumns,
      reloptions: ["security_barrier=true", "security_invoker=false"],
      definition: PUBLIC_VIEW_DEFINITIONS[name],
    })),
    positive_fixtures_verified: Object.fromEntries(
      PUBLIC_DISCLOSURE_VIEWS.map(({ name }) => [name, true]),
    ),
    public_view_invariant_violation_counts: Object.fromEntries(
      PUBLIC_DISCLOSURE_VIEWS.map(({ name }) => [name, 0]),
    ),
    nonpublic_fixtures_verified: Object.fromEntries(
      PUBLIC_DISCLOSURE_VIEWS.map(({ name }) => [name, true]),
    ),
    ...overrides,
  };
}

function successfulHostedFetch(env, requests) {
  const tokens = new Map([
    [env.RLS_PROBE_USER_A_EMAIL, "fixture-access-token-user-a"],
    [env.RLS_PROBE_USER_B_EMAIL, "fixture-access-token-user-b"],
  ]);
  const usersByToken = new Map([
    ["fixture-access-token-user-a", {
      id: env.RLS_PROBE_USER_A_ID,
      vendorId: env.RLS_PROBE_USER_A_VENDOR_ID,
      comboId: env.RLS_PROBE_USER_A_COMBO_ID,
    }],
    ["fixture-access-token-user-b", {
      id: env.RLS_PROBE_USER_B_ID,
      vendorId: env.RLS_PROBE_USER_B_VENDOR_ID,
      comboId: env.RLS_PROBE_USER_B_COMBO_ID,
    }],
  ]);
  const publicFixtures = new Map([
    ["v_public_vendors", ["id", env.RLS_PROBE_PUBLIC_VENDOR_ID]],
    ["v_public_prices", ["official_price_id", env.RLS_PROBE_PUBLIC_PRICE_ID]],
    ["v_public_price_options", ["id", env.RLS_PROBE_PUBLIC_OPTION_ID]],
    ["v_public_agency_packages", ["id", env.RLS_PROBE_PUBLIC_AGENCY_PACKAGE_ID]],
  ]);
  const ownedRows = new Map([
    ["vendor_favorites", new Map([
      [`${env.RLS_PROBE_USER_A_ID}:${env.RLS_PROBE_USER_A_VENDOR_ID}`, {
        user_id: env.RLS_PROBE_USER_A_ID,
        vendor_id: env.RLS_PROBE_USER_A_VENDOR_ID,
      }],
      [`${env.RLS_PROBE_USER_B_ID}:${env.RLS_PROBE_USER_B_VENDOR_ID}`, {
        user_id: env.RLS_PROBE_USER_B_ID,
        vendor_id: env.RLS_PROBE_USER_B_VENDOR_ID,
      }],
    ])],
    ["wishlists", new Map([
      [`${env.RLS_PROBE_USER_A_ID}:${env.RLS_PROBE_USER_A_VENDOR_ID}`, {
        user_id: env.RLS_PROBE_USER_A_ID,
        vendor_id: env.RLS_PROBE_USER_A_VENDOR_ID,
      }],
      [`${env.RLS_PROBE_USER_B_ID}:${env.RLS_PROBE_USER_B_VENDOR_ID}`, {
        user_id: env.RLS_PROBE_USER_B_ID,
        vendor_id: env.RLS_PROBE_USER_B_VENDOR_ID,
      }],
    ])],
    ["price_alerts", new Map([
      [`${env.RLS_PROBE_USER_A_ID}:${env.RLS_PROBE_USER_A_VENDOR_ID}`, {
        user_id: env.RLS_PROBE_USER_A_ID,
        vendor_id: env.RLS_PROBE_USER_A_VENDOR_ID,
      }],
      [`${env.RLS_PROBE_USER_B_ID}:${env.RLS_PROBE_USER_B_VENDOR_ID}`, {
        user_id: env.RLS_PROBE_USER_B_ID,
        vendor_id: env.RLS_PROBE_USER_B_VENDOR_ID,
      }],
    ])],
    ["combos", new Map([
      [env.RLS_PROBE_USER_A_COMBO_ID, {
        id: env.RLS_PROBE_USER_A_COMBO_ID,
        user_id: env.RLS_PROBE_USER_A_ID,
      }],
      [env.RLS_PROBE_USER_B_COMBO_ID, {
        id: env.RLS_PROBE_USER_B_COMBO_ID,
        user_id: env.RLS_PROBE_USER_B_ID,
      }],
    ])],
  ]);

  const rowKey = (relation, row) => relation === "combos"
    ? row.id
    : `${row.user_id}:${row.vendor_id}`;

  return async (input, init = {}) => {
    const url = new URL(input);
    requests.push({ url, init });
    if (url.hostname === "api.supabase.com") {
      return jsonResponse([successfulInventoryRow()], 201);
    }
    if (url.pathname === "/auth/v1/token") {
      const credentials = JSON.parse(init.body);
      const accessToken = tokens.get(credentials.email);
      const user = [...usersByToken.entries()]
        .find(([token]) => token === accessToken)?.[1];
      return jsonResponse({ access_token: accessToken, user: { id: user?.id } });
    }

    const relation = url.pathname.split("/").at(-1);
    const bearer = init.headers?.Authorization?.replace("Bearer ", "");
    if (VENDOR_DISCLOSURE_BASE_TABLES.includes(relation)) {
      return jsonResponse({ message: "denied" }, bearer === env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 401 : 403);
    }
    if (publicFixtures.has(relation)) {
      const [idColumn, id] = publicFixtures.get(relation);
      const requestedId = url.searchParams.get(idColumn)?.replace(/^eq\./, "");
      return requestedId === id
        ? jsonResponse([{ [idColumn]: id }])
        : jsonResponse([]);
    }
    if (OWNED_APPLICATION_TABLES.includes(relation)) {
      if (bearer === env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        return jsonResponse({ message: "denied" }, 401);
      }
      const observer = usersByToken.get(bearer);
      if (!observer) return jsonResponse({ message: "denied" }, 403);
      const rows = ownedRows.get(relation);
      const method = init.method ?? "GET";
      const subjectId = url.searchParams.get("user_id")?.replace(/^eq\./, "");
      const vendorId = url.searchParams.get("vendor_id")?.replace(/^eq\./, "");
      const comboId = url.searchParams.get("id")?.replace(/^eq\./, "");
      const matchesFilter = (row) => relation === "combos"
        ? comboId === undefined || row.id === comboId
        : (subjectId === undefined || row.user_id === subjectId)
          && (vendorId === undefined || row.vendor_id === vendorId);
      const visible = [...rows.values()].filter(
        (row) => row.user_id === observer.id && matchesFilter(row),
      );
      if (method === "GET") return jsonResponse(visible);

      if (relation === "combos" && ["POST", "PATCH"].includes(method)) {
        return jsonResponse({ message: "permission denied" }, 403);
      }

      if (method === "POST") {
        const row = JSON.parse(init.body);
        if (row.user_id !== observer.id) {
          return jsonResponse({ message: "row-level security" }, 403);
        }
        const key = rowKey(relation, row);
        if (rows.has(key)) return jsonResponse({ message: "duplicate" }, 409);
        rows.set(key, row);
        return jsonResponse([row], 201);
      }
      if (method === "PATCH") {
        if (["vendor_favorites", "wishlists"].includes(relation)) {
          return jsonResponse({ message: "permission denied" }, 403);
        }
        const body = JSON.parse(init.body);
        for (const row of visible) Object.assign(row, body);
        return jsonResponse(visible);
      }
      if (method === "DELETE") {
        for (const row of visible) rows.delete(rowKey(relation, row));
        return jsonResponse(visible);
      }
      return jsonResponse({ message: "method not allowed" }, 405);
    }
    return jsonResponse({ message: "unexpected relation" }, 404);
  };
}

test("a remote staging ledger head or successor set mismatch blocks the receipt", async (t) => {
  const fixture = await createReleaseFixture(t);
  const env = validFixtureEnv(fixture);
  const baseFetch = successfulHostedFetch(env, []);
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    if (url.hostname === "api.supabase.com") {
      return jsonResponse([successfulInventoryRow({
        ledger_head: "20260718130000",
        successor_versions: ["20260718120000", "20260718130000"],
      })], 201);
    }
    return baseFetch(input, init);
  };

  await assert.rejects(
    executeHostedStagingRlsProbe({
      env,
      repoRoot: fixture.repoRoot,
      fetchImpl,
      persistReceipt: false,
    }),
    (error) => error instanceof ProbeFailure
      && error.code === "REMOTE_MIGRATION_LEDGER_MISMATCH",
  );
});

test("an unverifiable Management API ledger response blocks before authentication", async (t) => {
  const fixture = await createReleaseFixture(t);
  const env = validFixtureEnv(fixture);
  let authRequests = 0;
  const baseFetch = successfulHostedFetch(env, []);
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    if (url.hostname === "api.supabase.com") {
      return jsonResponse({ message: "not a ledger row" }, 200);
    }
    if (url.pathname === "/auth/v1/token") authRequests += 1;
    return baseFetch(input, init);
  };

  await assert.rejects(
    executeHostedStagingRlsProbe({
      env,
      repoRoot: fixture.repoRoot,
      fetchImpl,
      persistReceipt: false,
    }),
    (error) => error instanceof ProbeFailure
      && error.code === "REMOTE_LEDGER_UNVERIFIABLE",
  );
  assert.equal(authRequests, 0);
});

test("a repo-approved staging ref cannot be replaced by another environment ref", async (t) => {
  const fixture = await createReleaseFixture(t);
  const otherRef = "x".repeat(20);
  const env = validFixtureEnv(fixture, {
    NEXT_PUBLIC_SUPABASE_URL: `https://${otherRef}.supabase.co`,
    SUPABASE_STAGING_PROJECT_REF: otherRef,
  });
  let requestCount = 0;

  await assert.rejects(
    executeHostedStagingRlsProbe({
      env,
      repoRoot: fixture.repoRoot,
      fetchImpl: async () => {
        requestCount += 1;
        return jsonResponse([]);
      },
      persistReceipt: false,
    }),
    (error) => error instanceof ProbeFailure
      && error.code === "STAGING_PROJECT_PIN_MISMATCH",
  );
  assert.equal(requestCount, 0);
});

test("the common successor contract rejects shape, predecessor, and migration-set drift before requests", async (t) => {
  const scenarios = [
    {
      name: "unexpected successor field",
      mutate: async (fixture) => {
        const path = join(
          fixture.repoRoot,
          "supabase",
          "release-manifests",
          "vendor-disclosure-v2-20260718.json",
        );
        const manifest = JSON.parse(await readFile(path, "utf8"));
        manifest.unreviewedBypass = true;
        await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
      },
    },
    {
      name: "predecessor hash drift",
      mutate: async (fixture) => {
        await writeFile(
          join(
            fixture.repoRoot,
            "supabase",
            "release-manifests",
            "amora-engine-v2-20260716.json",
          ),
          "{}\n",
        );
      },
    },
    {
      name: "unmanifested successor migration",
      mutate: async (fixture) => {
        await writeFile(
          join(
            fixture.repoRoot,
            "supabase",
            "migrations",
            "20260718130000_unmanifested_probe.sql",
          ),
          "BEGIN;\nSELECT 2;\nCOMMIT;\n",
        );
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async (st) => {
      const fixture = await createReleaseFixture(st);
      await scenario.mutate(fixture);
      commitFixtureChange(fixture, scenario.name);
      const env = validFixtureEnv(fixture);
      let requestCount = 0;

      await assert.rejects(
        executeHostedStagingRlsProbe({
          env,
          repoRoot: fixture.repoRoot,
          fetchImpl: async () => {
            requestCount += 1;
            return jsonResponse([]);
          },
          persistReceipt: false,
        }),
        (error) => error instanceof ProbeFailure
          && error.code === "RELEASE_BINDING_INVALID",
      );
      assert.equal(requestCount, 0);
    });
  }
});

test("the hosted RLS probe refuses the production project before any request", () => {
  const env = validEnv({
    NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
    SUPABASE_STAGING_PROJECT_REF: PRODUCTION_REF,
  });

  assert.throws(
    () => validateProbeEnvironment(env),
    (error) => error instanceof ProbeFailure
      && error.code === "PRODUCTION_TARGET_FORBIDDEN",
  );
});

test("a passing receipt binds staging, commit, and the exact successor migrations without credentials", async (t) => {
  const fixture = await createReleaseFixture(t);
  const env = validFixtureEnv(fixture);
  const requests = [];

  const { receipt, receiptPath, receiptSha256 } = await executeHostedStagingRlsProbe({
    env,
    repoRoot: fixture.repoRoot,
    fetchImpl: successfulHostedFetch(env, requests),
    now: () => new Date("2026-07-19T01:02:03.000Z"),
    persistReceipt: true,
  });

  assert.equal(receiptPath, fixture.receiptOut);
  assert.equal(receipt.receiptVersion, 2);
  assert.equal(receipt.scope, "hosted_staging_only");
  assert.equal(receipt.productionReadiness, false);
  assert.equal(receipt.deploymentAuthorization, false);
  assert.equal(receipt.projectRef, STAGING_REF);
  assert.equal(receipt.releaseTargetProjectRef, PRODUCTION_REF);
  assert.equal(receipt.gitCommit, env.RLS_PROBE_EXPECTED_COMMIT);
  assert.equal(receipt.successorMigrationSetSha256, fixture.migrationSetSha256);
  assert.match(receipt.hostedStagingContractSha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.gitRepositoryBindingSha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.baseColumnInventorySha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.ownedColumnInventorySha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.publicViewContractSha256, /^[a-f0-9]{64}$/);
  assert.equal(receipt.hostedStagingMigrationLedgerHead, fixture.migrationVersion);
  assert.equal(receipt.checks.hostedStagingLedgerMatchesSuccessorManifest, true);
  assert.equal(receipt.checks.anonymousBaseColumnsDenied, VENDOR_DISCLOSURE_BASE_TABLES.length);
  assert.equal(receipt.checks.authenticatedBaseColumnsDenied, VENDOR_DISCLOSURE_BASE_TABLES.length);
  assert.equal(receipt.checks.anonymousPublicFixturesRead, PUBLIC_DISCLOSURE_VIEWS.length);
  assert.equal(receipt.checks.authenticatedPublicFixturesRead, PUBLIC_DISCLOSURE_VIEWS.length);
  assert.equal(receipt.checks.positivePublicBaseFixturesVerified, PUBLIC_DISCLOSURE_VIEWS.length);
  assert.equal(receipt.checks.publicViewInvariantViolations, 0);
  assert.equal(receipt.checks.ownPrivateFixturesRead, 8);
  assert.equal(receipt.checks.crossUserPrivateRowsVisible, 0);
  assert.deepEqual(receipt.checks.ownedTables, OWNED_APPLICATION_TABLES);
  assert.equal(
    receipt.checks.anonymousOwnedColumnsDenied,
    OWNED_APPLICATION_TABLES.length,
  );
  assert.equal(
    receipt.checks.anonymousOwnedTableOperationsDenied,
    OWNED_APPLICATION_TABLES.length * 4,
  );
  assert.equal(receipt.checks.ownerPolicyInsertsAllowed, 3);
  assert.equal(receipt.checks.ownerDirectComboInsertsDenied, 1);
  assert.equal(receipt.checks.ownerPolicyUpdatesAllowed, 1);
  assert.equal(receipt.checks.ownerPolicyUpdateDeniedByContract, 3);
  assert.equal(receipt.checks.ownerPolicyDeletesAllowed, 3);
  assert.equal(receipt.checks.ownerComboDeleteTransportAllowed, 1);
  assert.equal(receipt.checks.crossUserPolicyInsertsDenied, 4);
  assert.equal(receipt.checks.crossUserPolicyUpdatesAffectedRows, 0);
  assert.equal(receipt.checks.crossUserPolicyDeletesAffectedRows, 0);
  assert.equal(receipt.checks.crossUserExistingComboDeleteRetained, true);
  assert.equal(receipt.checks.policyProbeRowsRetained, 0);
  const ownedMethods = new Set(requests
    .filter(({ url }) => OWNED_APPLICATION_TABLES.some(
      (table) => url.pathname.endsWith(`/rest/v1/${table}`),
    ))
    .map(({ init }) => init.method ?? "GET"));
  assert.equal(
    ["GET", "POST", "PATCH", "DELETE"].every((method) => ownedMethods.has(method)),
    true,
  );
  const updateBodies = requests
    .filter(({ url, init }) => OWNED_APPLICATION_TABLES.some(
      (table) => url.pathname.endsWith(`/rest/v1/${table}`),
    ) && init.method === "PATCH")
    .map(({ init }) => JSON.parse(init.body));
  assert.equal(updateBodies.length > 0, true);
  assert.equal(updateBodies.every((body) => !("user_id" in body)), true);
  assert.equal(updateBodies.some((body) => typeof body.name === "string"), true);
  assert.equal(updateBodies.some((body) => typeof body.created_at === "string"), true);
  const managementRequests = requests.filter(
    ({ url }) => url.hostname === "api.supabase.com",
  );
  assert.equal(managementRequests.length, 1);
  assert.equal(
    managementRequests[0].url.href,
    `https://api.supabase.com/v1/projects/${STAGING_REF}/database/query/read-only`,
  );
  assert.equal(managementRequests[0].init.method, "POST");
  assert.equal(
    managementRequests[0].init.headers.Authorization,
    `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
  );
  const managementBody = JSON.parse(managementRequests[0].init.body);
  assert.deepEqual(managementBody.parameters, []);
  assert.match(managementBody.query, /supabase_migrations\.schema_migrations/);
  assert.match(managementBody.query, /nonpublic_fixtures_verified/);
  assert.match(managementBody.query, /positive_fixtures_verified/);
  assert.match(managementBody.query, /public_view_invariant_violation_counts/);
  assert.match(managementBody.query, /pg_catalog\.pg_get_viewdef/);
  assert.match(managementBody.query, /relation\.reloptions/);
  assert.match(managementBody.query, /IS DISTINCT FROM 'approved'/);
  assert.match(managementBody.query, /'vendor_favorites'/);
  for (const table of VENDOR_DISCLOSURE_BASE_TABLES) {
    assert.match(managementBody.query, new RegExp(`'${table}'`));
  }

  const serialized = JSON.stringify(receipt);
  const receiptText = await readFile(receiptPath, "utf8");
  assert.deepEqual(JSON.parse(receiptText), receipt);
  assert.equal(receiptSha256, sha256(receiptText));
  for (const secret of [
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    env.SUPABASE_ACCESS_TOKEN,
    env.RLS_PROBE_USER_A_EMAIL,
    env.RLS_PROBE_USER_A_PASSWORD,
    env.RLS_PROBE_USER_B_EMAIL,
    env.RLS_PROBE_USER_B_PASSWORD,
    "fixture-access-token-user-a",
    "fixture-access-token-user-b",
    env.RLS_PROBE_USER_A_ID,
    env.RLS_PROBE_USER_B_ID,
    env.RLS_PROBE_NONPUBLIC_VENDOR_ID,
    env.RLS_PROBE_NONPUBLIC_PRICE_ID,
    env.RLS_PROBE_NONPUBLIC_OPTION_ID,
    env.RLS_PROBE_NONPUBLIC_AGENCY_PACKAGE_ID,
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("an authenticated base-table 200 response fails closed", async (t) => {
  const fixture = await createReleaseFixture(t);
  const env = validFixtureEnv(fixture);
  const baseFetch = successfulHostedFetch(env, []);
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    const bearer = init?.headers?.Authorization?.replace("Bearer ", "");
    if (url.pathname.endsWith("/official_prices")
        && bearer === "fixture-access-token-user-a") {
      return jsonResponse([]);
    }
    return baseFetch(input, init);
  };

  await assert.rejects(
    executeHostedStagingRlsProbe({
      env,
      repoRoot: fixture.repoRoot,
      fetchImpl,
      persistReceipt: false,
    }),
    (error) => error instanceof ProbeFailure && error.code === "BASE_TABLE_EXPOSED",
  );
});

test("each catalogued base column is denied independently", async (t) => {
  const fixture = await createReleaseFixture(t);
  const env = validFixtureEnv(fixture);
  const baseFetch = successfulHostedFetch(env, []);
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    if (url.hostname === "api.supabase.com") {
      return jsonResponse([successfulInventoryRow({
        base_columns: [
          ...VENDOR_DISCLOSURE_BASE_TABLES.map((table_name) => ({
            table_name,
            column_name: "id",
          })),
          { table_name: "official_prices", column_name: "source_quote" },
        ],
      })], 201);
    }
    const bearer = init?.headers?.Authorization?.replace("Bearer ", "");
    if (url.pathname.endsWith("/official_prices")
        && url.searchParams.get("select") === "source_quote"
        && bearer === "fixture-access-token-user-a") {
      return jsonResponse([]);
    }
    return baseFetch(input, init);
  };

  await assert.rejects(
    executeHostedStagingRlsProbe({
      env,
      repoRoot: fixture.repoRoot,
      fetchImpl,
      persistReceipt: false,
    }),
    (error) => error instanceof ProbeFailure && error.code === "BASE_TABLE_EXPOSED",
  );
});

test("positive public fixtures must prove approved, evidenced, current base state", async (t) => {
  const fixture = await createReleaseFixture(t);
  const env = validFixtureEnv(fixture);
  const baseFetch = successfulHostedFetch(env, []);
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    if (url.hostname === "api.supabase.com") {
      return jsonResponse([successfulInventoryRow({
        positive_fixtures_verified: {
          ...successfulInventoryRow().positive_fixtures_verified,
          v_public_prices: false,
        },
      })], 201);
    }
    return baseFetch(input, init);
  };

  await assert.rejects(
    executeHostedStagingRlsProbe({
      env,
      repoRoot: fixture.repoRoot,
      fetchImpl,
      persistReceipt: false,
    }),
    (error) => error instanceof ProbeFailure
      && error.code === "PUBLIC_POSITIVE_FIXTURE_INVALID",
  );
});

test("every live public row must satisfy the approved evidence invariants", async (t) => {
  const fixture = await createReleaseFixture(t);
  const env = validFixtureEnv(fixture);
  const baseFetch = successfulHostedFetch(env, []);
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    if (url.hostname === "api.supabase.com") {
      return jsonResponse([successfulInventoryRow({
        public_view_invariant_violation_counts: {
          ...successfulInventoryRow().public_view_invariant_violation_counts,
          v_public_price_options: 1,
        },
      })], 201);
    }
    return baseFetch(input, init);
  };

  await assert.rejects(
    executeHostedStagingRlsProbe({
      env,
      repoRoot: fixture.repoRoot,
      fetchImpl,
      persistReceipt: false,
    }),
    (error) => error instanceof ProbeFailure
      && error.code === "PUBLIC_VIEW_INVARIANT_VIOLATION",
  );
});

test("public view columns, security options, and exact repo-pinned definitions fail closed on drift", async (t) => {
  const scenarios = [
    {
      name: "column allow-list drift",
      mutate: (entry) => ({ ...entry, columns: [...entry.columns, "source_quote"] }),
    },
    {
      name: "security option drift",
      mutate: (entry) => ({
        ...entry,
        reloptions: ["security_barrier=true", "security_invoker=true"],
      }),
    },
    {
      name: "view definition drift",
      mutate: (entry) => ({ ...entry, definition: `${entry.definition} UNION ALL SELECT leak` }),
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async (st) => {
      const fixture = await createReleaseFixture(st);
      const env = validFixtureEnv(fixture);
      const baseFetch = successfulHostedFetch(env, []);
      const baseRow = successfulInventoryRow();
      const fetchImpl = async (input, init) => {
        const url = new URL(input);
        if (url.hostname === "api.supabase.com") {
          return jsonResponse([successfulInventoryRow({
            public_view_inventory: baseRow.public_view_inventory.map((entry) => (
              entry.view_name === "v_public_prices"
                ? scenario.mutate(entry)
                : entry
            )),
          })], 201);
        }
        return baseFetch(input, init);
      };

      await assert.rejects(
        executeHostedStagingRlsProbe({
          env,
          repoRoot: fixture.repoRoot,
          fetchImpl,
          persistReceipt: false,
        }),
        (error) => error instanceof ProbeFailure
          && error.code === "PUBLIC_VIEW_CONTRACT_INVALID",
      );
    });
  }
});

test("a missing public fixture fails instead of accepting a vacuous view read", async (t) => {
  const fixture = await createReleaseFixture(t);
  const env = validFixtureEnv(fixture);
  const baseFetch = successfulHostedFetch(env, []);
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/v_public_prices")) return jsonResponse([]);
    return baseFetch(input, init);
  };

  await assert.rejects(
    executeHostedStagingRlsProbe({
      env,
      repoRoot: fixture.repoRoot,
      fetchImpl,
      persistReceipt: false,
    }),
    (error) => error instanceof ProbeFailure && error.code === "PUBLIC_FIXTURE_MISSING",
  );
});

test("a non-public fixture must exist in a rejected, pending, or unpublished base state", async (t) => {
  const fixture = await createReleaseFixture(t);
  const env = validFixtureEnv(fixture);
  const baseFetch = successfulHostedFetch(env, []);
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    if (url.hostname === "api.supabase.com") {
      return jsonResponse([successfulInventoryRow({
        nonpublic_fixtures_verified: {
          ...successfulInventoryRow().nonpublic_fixtures_verified,
          v_public_prices: false,
        },
      })], 201);
    }
    return baseFetch(input, init);
  };

  await assert.rejects(
    executeHostedStagingRlsProbe({
      env,
      repoRoot: fixture.repoRoot,
      fetchImpl,
      persistReceipt: false,
    }),
    (error) => error instanceof ProbeFailure
      && error.code === "NONPUBLIC_FIXTURE_UNVERIFIABLE",
  );
});

test("a rejected, pending, or unpublished exact fixture visible in a public view fails", async (t) => {
  const fixture = await createReleaseFixture(t);
  const env = validFixtureEnv(fixture);
  const baseFetch = successfulHostedFetch(env, []);
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/v_public_prices")
        && url.searchParams.get("official_price_id")
          === `eq.${env.RLS_PROBE_NONPUBLIC_PRICE_ID}`) {
      return jsonResponse([{
        official_price_id: env.RLS_PROBE_NONPUBLIC_PRICE_ID,
      }]);
    }
    return baseFetch(input, init);
  };

  await assert.rejects(
    executeHostedStagingRlsProbe({
      env,
      repoRoot: fixture.repoRoot,
      fetchImpl,
      persistReceipt: false,
    }),
    (error) => error instanceof ProbeFailure
      && error.code === "NONPUBLIC_FIXTURE_EXPOSED",
  );
});

test("visibility of the other fixture user's wishlist fails two-user isolation", async (t) => {
  const fixture = await createReleaseFixture(t);
  const env = validFixtureEnv(fixture);
  const baseFetch = successfulHostedFetch(env, []);
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    const bearer = init?.headers?.Authorization?.replace("Bearer ", "");
    if (url.pathname.endsWith("/wishlists")
        && bearer === "fixture-access-token-user-a"
        && url.searchParams.get("user_id") === `eq.${env.RLS_PROBE_USER_B_ID}`) {
      return jsonResponse([{
        user_id: env.RLS_PROBE_USER_B_ID,
        vendor_id: env.RLS_PROBE_USER_B_VENDOR_ID,
      }]);
    }
    return baseFetch(input, init);
  };

  await assert.rejects(
    executeHostedStagingRlsProbe({
      env,
      repoRoot: fixture.repoRoot,
      fetchImpl,
      persistReceipt: false,
    }),
    (error) => error instanceof ProbeFailure && error.code === "CROSS_USER_ROW_EXPOSED",
  );
});

test("the real vendor_favorites API relation is included in two-user isolation", async (t) => {
  const fixture = await createReleaseFixture(t);
  const env = validFixtureEnv(fixture);
  const baseFetch = successfulHostedFetch(env, []);
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    const bearer = init?.headers?.Authorization?.replace("Bearer ", "");
    if (url.pathname.endsWith("/vendor_favorites")
        && bearer === "fixture-access-token-user-a"
        && url.searchParams.get("user_id") === `eq.${env.RLS_PROBE_USER_B_ID}`) {
      return jsonResponse([{
        user_id: env.RLS_PROBE_USER_B_ID,
        vendor_id: env.RLS_PROBE_USER_B_VENDOR_ID,
      }]);
    }
    return baseFetch(input, init);
  };

  await assert.rejects(
    executeHostedStagingRlsProbe({
      env,
      repoRoot: fixture.repoRoot,
      fetchImpl,
      persistReceipt: false,
    }),
    (error) => error instanceof ProbeFailure && error.code === "CROSS_USER_ROW_EXPOSED",
  );
});

test("an owned table returning 200 to anon fails even when the row set is empty", async (t) => {
  const fixture = await createReleaseFixture(t);
  const env = validFixtureEnv(fixture);
  const baseFetch = successfulHostedFetch(env, []);
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    const bearer = init?.headers?.Authorization?.replace("Bearer ", "");
    if (url.pathname.endsWith("/wishlists")
        && (init?.method ?? "GET") === "GET"
        && bearer === env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return jsonResponse([]);
    }
    return baseFetch(input, init);
  };

  await assert.rejects(
    executeHostedStagingRlsProbe({
      env,
      repoRoot: fixture.repoRoot,
      fetchImpl,
      persistReceipt: false,
    }),
    (error) => error instanceof ProbeFailure
      && error.code === "ANON_OWNED_TABLE_EXPOSED",
  );
});

test("every live owned-table column is denied to anon, not only an id sample", async (t) => {
  const fixture = await createReleaseFixture(t);
  const env = validFixtureEnv(fixture);
  const baseFetch = successfulHostedFetch(env, []);
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    if (url.hostname === "api.supabase.com") {
      return jsonResponse([successfulInventoryRow({
        owned_columns: [
          ...successfulInventoryRow().owned_columns,
          { table_name: "vendor_favorites", column_name: "created_at" },
        ],
      })], 201);
    }
    const bearer = init?.headers?.Authorization?.replace("Bearer ", "");
    if (url.pathname.endsWith("/vendor_favorites")
        && url.searchParams.get("select") === "created_at"
        && bearer === env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return jsonResponse([]);
    }
    return baseFetch(input, init);
  };

  await assert.rejects(
    executeHostedStagingRlsProbe({
      env,
      repoRoot: fixture.repoRoot,
      fetchImpl,
      persistReceipt: false,
    }),
    (error) => error instanceof ProbeFailure
      && error.code === "ANON_OWNED_TABLE_EXPOSED",
  );
});

test("a combo owner PATCH returning success fails the direct-write fence", async (t) => {
  const fixture = await createReleaseFixture(t);
  const env = validFixtureEnv(fixture);
  const baseFetch = successfulHostedFetch(env, []);
  let injectedNoOp = false;
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    const bearer = init?.headers?.Authorization?.replace("Bearer ", "");
    if (!injectedNoOp
        && url.pathname.endsWith("/combos")
        && init?.method === "PATCH"
        && bearer === "fixture-access-token-user-a") {
      injectedNoOp = true;
      return jsonResponse([{
        id: url.searchParams.get("id").replace(/^eq\./, ""),
        user_id: env.RLS_PROBE_USER_A_ID,
        name: "Hosted RLS owner probe",
      }]);
    }
    return baseFetch(input, init);
  };

  await assert.rejects(
    executeHostedStagingRlsProbe({
      env,
      repoRoot: fixture.repoRoot,
      fetchImpl,
      persistReceipt: false,
    }),
    (error) => error instanceof ProbeFailure
      && error.code === "OWNER_POLICY_UPDATE_CONTRACT_BROKEN",
  );
  assert.equal(injectedNoOp, true);
});

test("a combo owner POST returning success fails the direct-write fence", async (t) => {
  const fixture = await createReleaseFixture(t);
  const env = validFixtureEnv(fixture);
  const baseFetch = successfulHostedFetch(env, []);
  let injectedExposure = false;
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    const bearer = init?.headers?.Authorization?.replace("Bearer ", "");
    if (!injectedExposure
        && url.pathname.endsWith("/combos")
        && init?.method === "POST"
        && bearer === "fixture-access-token-user-a") {
      injectedExposure = true;
      return jsonResponse([JSON.parse(init.body)], 201);
    }
    return baseFetch(input, init);
  };

  await assert.rejects(
    executeHostedStagingRlsProbe({
      env,
      repoRoot: fixture.repoRoot,
      fetchImpl,
      persistReceipt: false,
    }),
    (error) => error instanceof ProbeFailure
      && error.code === "OWNER_COMBO_DIRECT_INSERT_EXPOSED",
  );
  assert.equal(injectedExposure, true);
});

test("cross-user DELETE exposure fails and deterministic policy rows are cleaned", async (t) => {
  const fixture = await createReleaseFixture(t);
  const env = validFixtureEnv(fixture);
  const requests = [];
  const baseFetch = successfulHostedFetch(env, requests);
  let injectedExposure = false;
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    const bearer = init?.headers?.Authorization?.replace("Bearer ", "");
    if (!injectedExposure
        && url.pathname.endsWith("/combos")
        && init?.method === "DELETE"
        && bearer === "fixture-access-token-user-b"
        && url.searchParams.get("id") !== `eq.${env.RLS_PROBE_USER_B_COMBO_ID}`) {
      injectedExposure = true;
      return jsonResponse([{
        id: url.searchParams.get("id").replace(/^eq\./, ""),
        user_id: env.RLS_PROBE_USER_A_ID,
      }]);
    }
    return baseFetch(input, init);
  };

  await assert.rejects(
    executeHostedStagingRlsProbe({
      env,
      repoRoot: fixture.repoRoot,
      fetchImpl,
      persistReceipt: false,
    }),
    (error) => error instanceof ProbeFailure
      && error.code === "CROSS_USER_POLICY_DELETE_EXPOSED",
  );
  assert.equal(injectedExposure, true);
  const comboCleanupRequests = requests.filter(({ url, init }) => (
    url.pathname.endsWith("/combos")
    && init.method === "DELETE"
    && init.headers.Authorization === "Bearer fixture-access-token-user-a"
  ));
  assert.equal(comboCleanupRequests.length >= 1, true);
});

test("an empty cross-user combo DELETE response still requires owner-row retention", async (t) => {
  const fixture = await createReleaseFixture(t);
  const env = validFixtureEnv(fixture);
  const baseFetch = successfulHostedFetch(env, []);
  let crossDeleteObserved = false;
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const bearer = init.headers?.Authorization?.replace("Bearer ", "");
    const targetsOwnerCombo = url.pathname.endsWith("/combos")
      && url.searchParams.get("id") === `eq.${env.RLS_PROBE_USER_A_COMBO_ID}`;
    if (targetsOwnerCombo
        && init.method === "DELETE"
        && bearer === "fixture-access-token-user-b") {
      crossDeleteObserved = true;
      return jsonResponse([]);
    }
    if (crossDeleteObserved
        && targetsOwnerCombo
        && (init.method ?? "GET") === "GET"
        && bearer === "fixture-access-token-user-a") {
      return jsonResponse([]);
    }
    return baseFetch(input, init);
  };

  await assert.rejects(
    executeHostedStagingRlsProbe({
      env,
      repoRoot: fixture.repoRoot,
      fetchImpl,
      persistReceipt: false,
    }),
    (error) => error instanceof ProbeFailure
      && error.code === "CROSS_USER_COMBO_DELETE_RETENTION_UNVERIFIED",
  );
  assert.equal(crossDeleteObserved, true);
});

test("owner and cross cleanup both verify zero rows even when both DELETE requests fail", async (t) => {
  const fixture = await createReleaseFixture(t);
  const env = validFixtureEnv(fixture);
  const baseFetch = successfulHostedFetch(env, []);
  const deleteCounts = new Map();
  const failedCleanupKeys = new Set();
  const verifiedAfterFailure = new Set();
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const bearer = init.headers?.Authorization?.replace("Bearer ", "");
    if (url.pathname.endsWith("/vendor_favorites")) {
      const rowId = `${url.searchParams.get("user_id")}:${url.searchParams.get("vendor_id")}`;
      const key = `${bearer}:${rowId}`;
      if (init.method === "DELETE"
          && ["fixture-access-token-user-a", "fixture-access-token-user-b"].includes(bearer)) {
        const count = (deleteCounts.get(bearer) ?? 0) + 1;
        deleteCounts.set(bearer, count);
        if (count === 2) {
          failedCleanupKeys.add(key);
          return jsonResponse({ message: "injected cleanup failure" }, 500);
        }
      }
      if ((init.method ?? "GET") === "GET" && failedCleanupKeys.has(key)) {
        verifiedAfterFailure.add(key);
      }
    }
    return baseFetch(input, init);
  };

  await assert.rejects(
    executeHostedStagingRlsProbe({
      env,
      repoRoot: fixture.repoRoot,
      fetchImpl,
      persistReceipt: false,
    }),
    (error) => error instanceof ProbeFailure
      && error.code === "POLICY_PROBE_CLEANUP_FAILED",
  );
  assert.equal(failedCleanupKeys.size, 2);
  assert.deepEqual(verifiedAfterFailure, failedCleanupKeys);
});

test("a dirty checkout fails before authentication or hosted reads", async (t) => {
  const fixture = await createReleaseFixture(t);
  const env = validFixtureEnv(fixture);
  await writeFile(join(fixture.repoRoot, "dirty-after-commit.txt"), "dirty\n");
  let requestCount = 0;

  await assert.rejects(
    executeHostedStagingRlsProbe({
      env,
      repoRoot: fixture.repoRoot,
      fetchImpl: async () => {
        requestCount += 1;
        return jsonResponse([]);
      },
      persistReceipt: false,
    }),
    (error) => error instanceof ProbeFailure && error.code === "GIT_TREE_DIRTY",
  );
  assert.equal(requestCount, 0);
});

test("Git state is revalidated after external reads and before receipt creation", async (t) => {
  const fixture = await createReleaseFixture(t);
  const env = validFixtureEnv(fixture);
  const baseFetch = successfulHostedFetch(env, []);
  let externalReadStarted = false;
  let authRequests = 0;
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    if (url.pathname === "/auth/v1/token") authRequests += 1;
    const response = await baseFetch(input, init);
    if (!externalReadStarted && url.hostname === "api.supabase.com") {
      externalReadStarted = true;
      await writeFile(join(fixture.repoRoot, "changed-during-probe.txt"), "dirty\n");
    }
    return response;
  };

  await assert.rejects(
    executeHostedStagingRlsProbe({
      env,
      repoRoot: fixture.repoRoot,
      fetchImpl,
      persistReceipt: false,
    }),
    (error) => error instanceof ProbeFailure && error.code === "GIT_TREE_DIRTY",
  );
  assert.equal(externalReadStarted, true);
  assert.equal(authRequests, 0);
});

test("commit and migration-set mismatches fail before authentication", async (t) => {
  const fixture = await createReleaseFixture(t);
  const baseEnv = validFixtureEnv(fixture);

  for (const scenario of [
    {
      name: "commit",
      env: {
        ...baseEnv,
        RLS_PROBE_EXPECTED_COMMIT: "c".repeat(40),
      },
      expectedCode: "GIT_COMMIT_MISMATCH",
    },
    {
      name: "migration set",
      env: {
        ...baseEnv,
        RLS_PROBE_EXPECTED_SUCCESSOR_MIGRATION_SET_SHA256: "c".repeat(64),
      },
      expectedCode: "MIGRATION_SET_MISMATCH",
    },
  ]) {
    let requestCount = 0;
    await assert.rejects(
      executeHostedStagingRlsProbe({
        env: scenario.env,
        repoRoot: fixture.repoRoot,
        fetchImpl: async () => {
          requestCount += 1;
          return jsonResponse([]);
        },
        persistReceipt: false,
      }),
      (error) => error instanceof ProbeFailure
        && error.code === scenario.expectedCode,
      scenario.name,
    );
    assert.equal(requestCount, 0, scenario.name);
  }
});

test("CI fails the final quality gate while production readiness is blocked", async () => {
  const repoRoot = new URL("../..", import.meta.url);
  const [workflow, packageText, stagingContractText] = await Promise.all([
    readFile(new URL(".github/workflows/ci.yml", repoRoot), "utf8"),
    readFile(new URL("package.json", repoRoot), "utf8"),
    readFile(new URL(
      "supabase/release-contracts/vendor-disclosure-hosted-staging-v2-20260718.json",
      repoRoot,
    ), "utf8"),
  ]);
  const packageJson = JSON.parse(packageText);
  const stagingContract = JSON.parse(stagingContractText);

  assert.match(workflow, /^name: CI$/m);
  assert.match(workflow, /static_release_contracts:\n\s+name: Static Release Contracts \(Non-Deploy\)/);
  assert.match(workflow, /production_readiness:\n\s+name: "Production Readiness: BLOCKED \(Hosted Evidence Required\)"/);
  assert.match(workflow, /Static contracts are not deployment evidence/);
  assert.match(workflow, /Fail closed while hosted deployment evidence is missing/);
  assert.match(workflow, /ci:\n\s+name: Quality Gate/);
  assert.match(workflow, /needs: \[[^\]]*production_readiness[^\]]*\]/);
  assert.match(workflow, /PRODUCTION_READINESS_RESULT: \$\{\{ needs\.production_readiness\.result \}\}/);
  assert.match(workflow, /\[ "\$PRODUCTION_READINESS_RESULT" != "success" \]/);
  const readinessJob = workflow.slice(
    workflow.indexOf("\n  production_readiness:"),
    workflow.indexOf("\n  ci:"),
  );
  const finalGateJob = workflow.slice(workflow.indexOf("\n  ci:"));
  assert.match(readinessJob, /if: \$\{\{ always\(\) \}\}/);
  assert.match(readinessJob, /\n\s+exit 1\s*$/m);
  assert.match(finalGateJob, /if: \$\{\{ always\(\) \}\}/);
  assert.match(
    packageJson.scripts["supabase:release:test"],
    /vendor-public-rls-probe\.test\.mjs/,
  );
  assert.deepEqual(
    {
      status: stagingContract.status,
      approved: stagingContract.approved,
      projectRef: stagingContract.projectRef,
    },
    {
      status: "blocked_pending_dedicated_staging",
      approved: false,
      projectRef: null,
    },
  );
});
