// @vitest-environment node
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WEDDING_CODE36_BUILD_MARKERS } from "../../../../../scripts/wedding-code36-release-build-contract.mjs";
import { assertVendorDisclosureProductionBuild, expectedProductionAuthorizationSha256,
  VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID, VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED,
  VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID } from "../../../vendorDisclosureProductionBuildFence";

const sourceRoot = resolve(import.meta.dirname, "../../../../..");
const manifestFile = "supabase/release-contracts/wedding-code36-v1.json";
const snapshotFile = "supabase/release-contracts/wedding-code36-predecessor-build-inputs-v1.json";
let fixtureRoot: string;
const production = (root: string, authorization: string | undefined = expectedProductionAuthorizationSha256(root)) =>
  assertVendorDisclosureProductionBuild({ repoRoot: root, environment: {
    VERCEL_ENV: "production", VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION: authorization,
  } });

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "wc36-production-fence-"));
  const snapshot: { files: { file: string }[] } = JSON.parse(readFileSync(join(sourceRoot, snapshotFile), "utf8"));
  const manifest: { artifacts: { file: string }[] } = JSON.parse(readFileSync(join(sourceRoot, manifestFile), "utf8"));
  const files = new Set([manifestFile, ...WEDDING_CODE36_BUILD_MARKERS,
    ...snapshot.files.map(pin => pin.file), ...manifest.artifacts.map(pin => pin.file)]);
  let vendorFile: string | undefined = "supabase/release-manifests/vendor-disclosure-v2-20260718.json";
  for (let depth = 0; vendorFile && depth < 16; depth++) {
    files.add(vendorFile);
    const vendor: { predecessorManifest?: { file: string } } = JSON.parse(readFileSync(join(sourceRoot, vendorFile), "utf8"));
    vendorFile = vendor.predecessorManifest?.file;
  }
  for (const file of files) {
    mkdirSync(dirname(join(fixtureRoot, file)), { recursive: true });
    copyFileSync(join(sourceRoot, file), join(fixtureRoot, file));
  }
});
afterAll(() => { if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true }); });

describe("registered 36-question production build, separate from hosted release evidence", () => {
  it("accepts exact243 without Git history and still requires the existing owner signature", () => {
    expect(() => production(fixtureRoot)).not.toThrow();
    expect(() => assertVendorDisclosureProductionBuild({ repoRoot: fixtureRoot, environment: { VERCEL_ENV: "production" } }))
      .toThrow(VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED);
    expect(() => production(fixtureRoot, "0".repeat(64))).toThrow(VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID);
  });

  it.each(WEDDING_CODE36_BUILD_MARKERS.filter((file: string) => !file.endsWith(".ts")))("cannot fall back after a registered marker is missing: %s", file => {
    const path = join(fixtureRoot, file), bytes = readFileSync(path);
    try {
      rmSync(path);
      expect(() => production(fixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
    } finally { writeFileSync(path, bytes); }
  });

  it("cannot downgrade to the predecessor by removing all new evidence while the 36-question app remains", () => {
    const removed = WEDDING_CODE36_BUILD_MARKERS.filter((file: string) => !file.endsWith(".ts"))
      .map((file: string) => ({ path: join(fixtureRoot, file), bytes: readFileSync(join(fixtureRoot, file)) }));
    try {
      for (const entry of removed) rmSync(entry.path);
      expect(() => production(fixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
    } finally { for (const entry of removed) writeFileSync(entry.path, entry.bytes); }
  });

  it("cannot fall back after a registered manifest is corrupted", () => {
    const path = join(fixtureRoot, manifestFile), bytes = readFileSync(path);
    try {
      writeFileSync(path, "{}\n");
      expect(() => production(fixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
    } finally { writeFileSync(path, bytes); }
  });
});
