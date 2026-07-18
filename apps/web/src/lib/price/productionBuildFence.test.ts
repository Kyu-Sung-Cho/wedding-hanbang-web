// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertVendorDisclosureProductionBuild,
  VendorDisclosureProductionBuildBlocked,
  VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED,
  VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID,
} from "../../../vendorDisclosureProductionBuildFence";

const RELEASE = "vendor-disclosure-v2-20260718";
const PROJECT_REF = "slrtobkksjmxgzatjyqb";
const PREDECESSOR_FILE =
  "supabase/release-manifests/amora-engine-v2-20260716.json";
const PREDECESSOR_MIGRATION = "20260716117000_predecessor.sql";
const SUCCESSOR_MIGRATION = "20260718120000_vendor_disclosure.sql";
const MANIFEST_FILE =
  "supabase/release-manifests/vendor-disclosure-v2-20260718.json";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function sha256(text: string): string {
  return createHash("sha256")
    .update(text.replace(/\r\n?/g, "\n"), "utf8")
    .digest("hex");
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

type Fixture = Awaited<ReturnType<typeof createBlockedFixture>>;

async function createBlockedFixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), "vendor-build-fence-"));
  roots.push(repoRoot);
  const manifestDirectory = join(repoRoot, "supabase", "release-manifests");
  const migrationDirectory = join(repoRoot, "supabase", "migrations");
  await Promise.all([
    mkdir(manifestDirectory, { recursive: true }),
    mkdir(migrationDirectory, { recursive: true }),
  ]);

  const predecessorSql = "select 'predecessor';\n";
  const successorSql = "select 'successor';\n";
  await Promise.all([
    writeFile(
      join(migrationDirectory, PREDECESSOR_MIGRATION),
      predecessorSql,
      "utf8",
    ),
    writeFile(
      join(migrationDirectory, SUCCESSOR_MIGRATION),
      successorSql,
      "utf8",
    ),
  ]);

  const predecessor = {
    release: "amora-engine-v2-20260716",
    projectRef: PROJECT_REF,
    expandMigrations: [
      { file: PREDECESSOR_MIGRATION, sha256: sha256(predecessorSql) },
    ],
  };
  const predecessorText = json(predecessor);
  await writeFile(join(repoRoot, PREDECESSOR_FILE), predecessorText, "utf8");

  const manifest = {
    release: RELEASE,
    projectRef: PROJECT_REF,
    status: "deployment_blocked",
    predecessorManifest: {
      file: PREDECESSOR_FILE,
      sha256: sha256(predecessorText),
    },
    requiredRemoteHead: PREDECESSOR_MIGRATION.slice(0, 14),
    migrationFloor: SUCCESSOR_MIGRATION.slice(0, 14),
    expandMigrations: [
      { file: SUCCESSOR_MIGRATION, sha256: sha256(successorSql) },
    ],
    deploymentEvidence: {
      hostedStaging: "missing",
      backup: "missing",
      hostedRestore: "missing",
      storage: "missing",
      finalizer: "missing",
    },
  };
  const manifestPath = join(repoRoot, MANIFEST_FILE);
  await writeFile(manifestPath, json(manifest), "utf8");

  return { repoRoot, manifest, manifestPath, migrationDirectory };
}

function assertProduction(repoRoot: string) {
  return assertVendorDisclosureProductionBuild({
    repoRoot,
    environment: { VERCEL_ENV: "production" },
  });
}

function expectBlockedWithCode(action: () => void, code: string) {
  try {
    action();
    throw new Error("expected production build to be blocked");
  } catch (error) {
    expect(error).toBeInstanceOf(VendorDisclosureProductionBuildBlocked);
    expect((error as VendorDisclosureProductionBuildBlocked).code).toBe(code);
    return error as VendorDisclosureProductionBuildBlocked;
  }
}

async function writeManifest(fixture: Fixture) {
  await writeFile(fixture.manifestPath, json(fixture.manifest), "utf8");
}

describe("vendor disclosure production build fence", () => {
  it("allows preview and local builds without touching the release checkout", () => {
    expect(() => assertVendorDisclosureProductionBuild({
      repoRoot: "does-not-need-to-exist",
      environment: { VERCEL_ENV: "preview" },
    })).not.toThrow();
    expect(() => assertVendorDisclosureProductionBuild({
      repoRoot: "does-not-need-to-exist",
      environment: {},
    })).not.toThrow();
  });

  it("keeps the repository manifest deployment-blocked with every evidence class missing", async () => {
    const repoRoot = resolve(process.cwd(), "../..");
    const manifest = JSON.parse(
      await readFile(join(repoRoot, MANIFEST_FILE), "utf8"),
    ) as {
      status: string;
      deploymentEvidence: Record<string, unknown>;
    };
    expect(manifest.status).toBe("deployment_blocked");
    expect(Object.values(manifest.deploymentEvidence)).toEqual([
      "missing",
      "missing",
      "missing",
      "missing",
      "missing",
    ]);

    const error = expectBlockedWithCode(
      () => assertProduction(repoRoot),
      VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED,
    );
    expect(error.message).toMatch(/static validation is not production authorization/i);
  });

  it("always blocks a statically valid fixture until external signed authorization exists", async () => {
    const fixture = await createBlockedFixture();
    const error = expectBlockedWithCode(
      () => assertProduction(fixture.repoRoot),
      VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED,
    );
    expect(error.message).toMatch(/successor release controller are not implemented/i);
  });

  it("rejects the former synthetic authorized receipt path before reading its booleans", async () => {
    const fixture = await createBlockedFixture();
    const manifest = fixture.manifest as unknown as {
      status: string;
      deploymentEvidence: Record<string, unknown>;
    };
    manifest.status = "deployment_authorized";
    manifest.deploymentEvidence = {
      hostedStaging: { receiptVersion: 1, status: "verified_success" },
      backup: { receiptVersion: 1, status: "verified_success" },
      hostedRestore: { receiptVersion: 1, status: "verified_success" },
      storage: { receiptVersion: 1, status: "verified_success" },
      finalizer: { receiptVersion: 1, status: "verified_success" },
    };
    await writeManifest(fixture);

    const error = expectBlockedWithCode(
      () => assertProduction(fixture.repoRoot),
      VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID,
    );
    expect(error.message).toMatch(/DEPLOYMENT_STATUS_INVALID/);
  });

  it("propagates a missing predecessor rejection from the shared validator", async () => {
    const fixture = await createBlockedFixture();
    await unlink(join(fixture.repoRoot, PREDECESSOR_FILE));

    const error = expectBlockedWithCode(
      () => assertProduction(fixture.repoRoot),
      VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID,
    );
    expect(error.message).toMatch(/PIN_MISSING/);
  });

  it("propagates unmanifested successor migration drift from the shared validator", async () => {
    const fixture = await createBlockedFixture();
    await writeFile(
      join(fixture.migrationDirectory, "20260718130000_unmanifested.sql"),
      "select 'unmanifested';\n",
      "utf8",
    );

    const error = expectBlockedWithCode(
      () => assertProduction(fixture.repoRoot),
      VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID,
    );
    expect(error.message).toMatch(/MIGRATION_SET_DRIFT/);
  });
});
