import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { writeJsonFile } from "../io.js";
import { SCANNER_PARSER_VERSION, regionCodeFromDirectory, scanSources } from "../scan.js";

test("scan groups a vendor folder into one unit and trusts the region folder", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-scan-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));

  const vendorDir = path.join(
    rootDir,
    "결혼준비대행서비스",
    "강남",
    "[서울(강남)]_샘플다파일웨딩((주)샘플법인)",
  );
  await mkdir(vendorDir, { recursive: true });
  await writeFile(path.join(vendorDir, "가격표.xlsx"), "dummy-xlsx");
  await writeFile(path.join(vendorDir, "안내.pdf"), "dummy-pdf");

  const manifest = await scanSources({ rootDir, stateDir });

  assert.equal(manifest.units.length, 1);
  const unit = manifest.units[0];
  assert.equal(unit.parsed.kind_hint, "agency");
  assert.equal(unit.parsed.region_code, "seoul_gangnam3");
  assert.equal(unit.parsed.raw_name, "샘플다파일웨딩");
  assert.equal(unit.parsed.normalized_name, "샘플다파일웨딩");
  assert.equal(unit.parsed.corporate_name, "(주)샘플법인");
  assert.equal(unit.source_files.length, 2);
  assert.match(unit.unit_id, /^[a-f0-9]{64}$/);
  assert.equal(unit.stage, "scanned");
});

test("scan preserves a completed stage when source hashes have not changed", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-rescan-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));

  const regionDir = path.join(rootDir, "예식장", "광주");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(광주)_샘플가나다웨딩.xlsx"), "dummy-xlsx");

  const first = await scanSources({ rootDir, stateDir });
  first.units[0].stage = "converted";
  await writeJsonFile(path.join(stateDir, "manifest.json"), first);

  const second = await scanSources({ rootDir, stateDir });

  assert.equal(second.units[0].unit_id, first.units[0].unit_id);
  assert.equal(second.units[0].source_fingerprint, first.units[0].source_fingerprint);
  assert.equal(second.units[0].stage, "converted");
  assert.equal(second.scanner_parser_version, SCANNER_PARSER_VERSION);
});

test("scan resets downstream state when a legacy parser version sees the same raw hashes", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-parser-version-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "예식장", "광주");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(광주)_파서버전.xlsx"), "same immutable bytes");

  const first = await scanSources({ rootDir, stateDir });
  const legacy = structuredClone(first) as unknown as Record<string, unknown>;
  delete legacy.scanner_parser_version;
  const legacyUnits = legacy.units as Array<Record<string, unknown>>;
  legacyUnits[0].stage = "loaded";
  legacyUnits[0].conversion = { stale: true };
  legacyUnits[0].extraction = { stale: true };
  legacyUnits[0].validation = { stale: true };
  await writeJsonFile(path.join(stateDir, "manifest.json"), legacy);

  const rescanned = await scanSources({ rootDir, stateDir });
  assert.equal(rescanned.scanner_parser_version, SCANNER_PARSER_VERSION);
  assert.equal(rescanned.units[0].source_fingerprint, first.units[0].source_fingerprint);
  assert.equal(rescanned.units[0].stage, "scanned");
  assert.equal(rescanned.units[0].conversion, undefined);
  assert.equal(rescanned.units[0].extraction, undefined);
  assert.equal(rescanned.units[0].validation, undefined);
});

test("scan canonicalizes mixed and same-extension files by portable codepoint path", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-source-order-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const vendorDir = path.join(rootDir, "agency", "jeju", "ordered-vendor");
  await mkdir(vendorDir, { recursive: true });
  // Deliberately create reverse order; filesystem enumeration is not trusted.
  await writeFile(path.join(vendorDir, "z-last.pdf"), "%PDF z");
  await writeFile(path.join(vendorDir, "m-middle.docx"), "docx fixture");
  await writeFile(path.join(vendorDir, "a-first.pdf"), "%PDF a");

  const manifest = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  assert.deepEqual(manifest.units[0].source_files.map((source) => path.posix.basename(source.path)), [
    "a-first.pdf",
    "m-middle.docx",
    "z-last.pdf",
  ]);
});

test("scan groups an HWP and its same-stem replacement PDF into one stable unit", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-hwp-pair-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "agency", "jeolla");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "sample-replacement.hwp"), "generated hwp fixture");

  const first = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  await writeFile(path.join(regionDir, "sample-replacement.pdf"), "%PDF generated replacement fixture");
  const second = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });

  assert.equal(first.units.length, 1);
  assert.equal(second.units.length, 1);
  assert.equal(second.units[0].unit_id, first.units[0].unit_id);
  assert.deepEqual(second.units[0].source_files.map((source) => source.ext).sort(), ["hwp", "pdf"]);
});

test("scan refuses to place generated state inside the immutable raw source tree", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-state-fence-"));
  t.after(async () => rm(rootDir, { recursive: true, force: true }));

  await assert.rejects(
    scanSources({
      rootDir,
      stateDir: path.join(rootDir, "generated-state"),
      agencyDir: "agency",
      hallDir: "hall",
    }),
    /state.*raw|raw.*state|outside/iu,
  );
});

test("scan refuses agency and hall roots that escape the declared raw root", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-root-fence-"));
  const outsideDir = `${rootDir}-outside`;
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(outsideDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const outsideRegion = path.join(outsideDir, "제주");
  await mkdir(outsideRegion, { recursive: true });
  await writeFile(path.join(outsideRegion, "(제주)_샘플외부업체.xlsx"), "generated fixture");

  await assert.rejects(
    scanSources({
      rootDir,
      stateDir,
      agencyDir: path.relative(rootDir, outsideDir),
      hallDir: "hall",
    }),
    /agency.*raw root|raw root.*agency|outside|escape/iu,
  );
  await assert.rejects(
    scanSources({
      rootDir,
      stateDir,
      agencyDir: "agency",
      hallDir: outsideDir,
    }),
    /hall.*raw root|raw root.*hall|outside|escape/iu,
  );
});

test("scan refuses a symlink or junction whose real path escapes the declared raw root", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-realpath-root-fence-"));
  const outsideDir = `${rootDir}-outside`;
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(outsideDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const outsideRegion = path.join(outsideDir, "제주");
  await mkdir(outsideRegion, { recursive: true });
  await writeFile(path.join(outsideRegion, "(제주)_외부링크업체.xlsx"), "generated fixture");
  try {
    await symlink(outsideDir, path.join(rootDir, "agency"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error instanceof Error && "code" in error && ["EPERM", "EACCES", "ENOTSUP"].includes(String(error.code))) {
      t.skip(`symlink unavailable: ${String(error.code)}`);
      return;
    }
    throw error;
  }

  await assert.rejects(
    scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" }),
    /realpath|raw root|escape|outside/iu,
  );
});

test("scan refuses an empty or wrong raw root without overwriting an existing manifest", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-wrong-root-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  await writeJsonFile(path.join(stateDir, "manifest.json"), { sentinel: "preserve" });

  await assert.rejects(
    scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" }),
    /supported|source|root|file/iu,
  );
  assert.deepEqual(await import("../io.js").then(({ readJsonFile }) => readJsonFile(path.join(stateDir, "manifest.json"))), { sentinel: "preserve" });
});

test("all fourteen supported region groups map explicitly and unknown regions are blocked", async (t) => {
  const supported = new Map([
    ["서울(강남3구)", "seoul_gangnam3"],
    ["서울(강남 외)", "seoul_etc"],
    ["제주", "jeju"],
    ["강원", "gangwon"],
    ["경상", "gyeongsang"],
    ["전라", "jeolla"],
    ["충청", "chungcheong"],
    ["경기", "gyeonggi"],
    ["울산", "ulsan"],
    ["광주", "gwangju"],
    ["대전", "daejeon"],
    ["부산", "busan"],
    ["인천", "incheon"],
    ["대구", "daegu"],
  ]);
  for (const [label, code] of supported) assert.equal(regionCodeFromDirectory(label), code);

  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-unknown-region-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "agency", "unsupported-region");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "generated.docx"), "fixture");
  const manifest = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  assert.equal(manifest.units[0].stage, "error");
  assert.match(manifest.units[0].notices.join("\n"), /unknown_region/u);
});

test("scan covers every disclosure filename shape from the ingestion acceptance set", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-acceptance-names-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));

  const agencyGangnam = path.join(rootDir, "결혼준비대행서비스", "강남");
  const hallGangnam = path.join(rootDir, "예식장", "강남");
  const hallSeoulEtc = path.join(rootDir, "예식장", "서울(강남 외)");
  const agencyGyeongsang = path.join(rootDir, "결혼준비대행서비스", "경상도");
  const agencyJeolla = path.join(rootDir, "결혼준비대행서비스", "전라도");
  await Promise.all([
    mkdir(agencyGangnam, { recursive: true }),
    mkdir(hallGangnam, { recursive: true }),
    mkdir(hallSeoulEtc, { recursive: true }),
    mkdir(agencyGyeongsang, { recursive: true }),
    mkdir(agencyJeolla, { recursive: true }),
  ]);
  await writeFile(path.join(agencyGangnam, "[서울(강남)]_샘플가나다웨딩플랜.xlsx"), "generated fixture");
  const multiFileVendor = path.join(agencyGangnam, "[서울(강남)]_샘플다파일웨딩((주)샘플다파일법인)");
  await mkdir(multiFileVendor, { recursive: true });
  await writeFile(path.join(multiFileVendor, "가격표.xlsx"), "generated fixture");
  await writeFile(path.join(multiFileVendor, "안내.pdf"), "generated fixture");
  await writeFile(path.join(hallGangnam, "[서울(강남)]_샘플컨벤션 신사지점((유)샘플법인).xlsx"), "generated fixture");
  await writeFile(path.join(hallSeoulEtc, "[서울(강남 외)]_(주)샘플앞법인웨딩.xlsx"), "generated fixture");
  await writeFile(path.join(agencyGyeongsang, "(경남)_샘플방송컨벤션진주_결혼준비대행.xlsx"), "generated fixture");
  await writeFile(path.join(agencyJeolla, "(전라도)_샘플전라웨딩.hwp"), "generated fixture");

  const manifest = await scanSources({ rootDir, stateDir });
  const byName = new Map(manifest.units.map((unit) => [unit.parsed.raw_name, unit]));

  assert.equal(byName.get("샘플가나다웨딩플랜")?.parsed.kind_hint, "agency");
  assert.equal(byName.get("샘플가나다웨딩플랜")?.parsed.region_code, "seoul_gangnam3");
  assert.equal(byName.get("샘플다파일웨딩")?.source_files.length, 2);
  assert.equal(byName.get("샘플다파일웨딩")?.parsed.corporate_name, "(주)샘플다파일법인");
  assert.equal(byName.get("샘플컨벤션 신사지점")?.parsed.kind_hint, "hall");
  assert.equal(byName.get("샘플컨벤션 신사지점")?.parsed.corporate_name, "(유)샘플법인");
  assert.equal(byName.get("(주)샘플앞법인웨딩")?.parsed.normalized_name, "샘플앞법인웨딩");
  assert.equal(byName.get("샘플방송컨벤션진주")?.parsed.region_code, "gyeongsang");
  assert.doesNotMatch(byName.get("샘플방송컨벤션진주")?.notices.join("\n") ?? "", /region_mismatch/u);
  assert.equal(byName.get("샘플전라웨딩")?.source_files[0].ext, "hwp");
});
