// @vitest-environment node
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AMORA_TASKS_BUILD_MARKERS } from "../../../../../scripts/amora-tasks-release-build-contract.mjs";
import { assertVendorDisclosureProductionBuild, expectedProductionAuthorizationSha256,
  VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID, VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED,
  VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID } from "../../../vendorDisclosureProductionBuildFence";

// 아모라 맡은 일 판(정확히 245개)의 운영 빌드 펜스. 웨딩홀 문의 판 시험(productionBuildHallInquiry.test.ts)과 같은 꼴이다.
const sourceRoot = resolve(import.meta.dirname, "../../../../..");
const manifestFile = "supabase/release-contracts/amora-tasks-v1.json";
const snapshotFile = "supabase/release-contracts/amora-tasks-predecessor-build-inputs-v1.json";
// 이 판은 웨딩홀 문의 길과 36문항 길의 고정 원문이 그대로인지도 본다. 그래서 두 길의 매니페스트와 고정 원문도 옮긴다.
const previousLaneManifestFiles = ["supabase/release-contracts/hall-inquiry-v1.json", "supabase/release-contracts/wedding-code36-v1.json"];
const markerFiles = AMORA_TASKS_BUILD_MARKERS.filter((file: string) => !file.endsWith(".ts"));
let fixtureRoot: string;
const production = (root: string, authorization: string | undefined = expectedProductionAuthorizationSha256(root)) =>
  assertVendorDisclosureProductionBuild({ repoRoot: root, environment: {
    VERCEL_ENV: "production", VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION: authorization,
  } });
const pinnedFiles = (file: string): string[] =>
  (JSON.parse(readFileSync(join(sourceRoot, file), "utf8")) as { artifacts: { file: string }[] }).artifacts.map(pin => pin.file);
function withoutFiles(files: string[], check: () => void) {
  const removed = files.map(file => ({ path: join(fixtureRoot, file), bytes: readFileSync(join(fixtureRoot, file)) }));
  try {
    for (const entry of removed) rmSync(entry.path);
    check();
  } finally { for (const entry of removed) writeFileSync(entry.path, entry.bytes); }
}

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "amora-tasks-production-fence-"));
  const snapshot: { files: { file: string }[] } = JSON.parse(readFileSync(join(sourceRoot, snapshotFile), "utf8"));
  const files = new Set([manifestFile, ...previousLaneManifestFiles, ...AMORA_TASKS_BUILD_MARKERS,
    ...snapshot.files.map(pin => pin.file), ...pinnedFiles(manifestFile), ...previousLaneManifestFiles.flatMap(pinnedFiles)]);
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

describe("registered amora-tasks production build, separate from hosted release evidence", () => {
  it("accepts exact245 without Git history and still requires the existing owner signature", () => {
    expect(() => production(fixtureRoot)).not.toThrow();
    expect(() => assertVendorDisclosureProductionBuild({ repoRoot: fixtureRoot, environment: { VERCEL_ENV: "production" } }))
      .toThrow(VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_NOT_IMPLEMENTED);
    expect(() => production(fixtureRoot, "0".repeat(64))).toThrow(VENDOR_DISCLOSURE_EXTERNAL_AUTHORIZATION_INVALID);
  });

  it.each(markerFiles)("cannot fall back after a registered marker is missing: %s", file => {
    withoutFiles([file], () => expect(() => production(fixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID));
  });

  it("cannot downgrade to the hall-inquiry contract by removing all new evidence while the amora-tasks app remains", () => {
    withoutFiles(markerFiles, () => expect(() => production(fixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID));
  });

  it("cannot fall back after a registered manifest is corrupted", () => {
    const path = join(fixtureRoot, manifestFile), bytes = readFileSync(path);
    try {
      writeFileSync(path, "{}\n");
      expect(() => production(fixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
    } finally { writeFileSync(path, bytes); }
  });

  it("blocks an extra unreviewed migration even with the owner signature", () => {
    const path = join(fixtureRoot, "supabase/migrations/20990101000000_unreviewed.sql");
    try {
      writeFileSync(path, "SELECT 1;\n", { flag: "wx" });
      expect(() => production(fixtureRoot)).toThrow(VENDOR_DISCLOSURE_STATIC_CONTRACT_INVALID);
    } finally { rmSync(path, { force: true }); }
  });
});
