import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { writeJsonFile } from "../io.js";
import {
  SCANNER_PARSER_VERSION,
  SKIPPED_SOURCE_NOTICE_PREFIX,
  regionCodeFromDirectory,
  scanSources,
} from "../scan.js";

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

test("scan removes disclosure-only hall and standard-form suffixes from vendor identities", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-identity-suffix-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));

  const hallDir = path.join(rootDir, "hall", "gangwon");
  await mkdir(hallDir, { recursive: true });
  await writeFile(path.join(hallDir, "(강원도)_베로나지디_예식장.xlsx"), "hall fixture");
  await writeFile(path.join(hallDir, "스카이나인스 표준양식.xlsx"), "standard fixture");

  const manifest = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  const byDisplayName = new Map(manifest.units.map((unit) => [unit.display_name, unit.parsed]));

  assert.deepEqual(byDisplayName.get("(강원도)_베로나지디_예식장.xlsx"), {
    region_code: "gangwon",
    raw_name: "베로나지디",
    normalized_name: "베로나지디",
    corporate_name: null,
    kind_hint: "hall",
  });
  assert.deepEqual(byDisplayName.get("스카이나인스 표준양식.xlsx"), {
    region_code: "gangwon",
    raw_name: "스카이나인스",
    normalized_name: "스카이나인스",
    corporate_name: null,
    kind_hint: "hall",
  });
});

test("scan keeps an entire nested registered corporate owner separate from the venue name", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-nested-corporate-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));

  const hallDir = path.join(rootDir, "hall", "jeolla");
  await mkdir(hallDir, { recursive: true });
  const cases = new Map([
    ["(전라도)_힐스코트(태성산업(주)).xlsx", ["힐스코트", "태성산업(주)"]],
    ["(전라도)_화목원 웨딩홀(농업회사법인마중물(주)).xlsx", ["화목원 웨딩홀", "농업회사법인마중물(주)"]],
    ["(전라도)_PJ호텔 웨딩홀(오일관광(주)).xlsx", ["PJ호텔 웨딩홀", "오일관광(주)"]],
    ["(전라도)_빌라드지디 논현(라비에벨(주)).xlsx", ["빌라드지디 논현", "라비에벨(주)"]],
    ["(전라도)_더파티 김해점(더리본(주)더파티김해점).xlsx", ["더파티 김해점", "더리본(주)더파티김해점"]],
    ["(전라도)_W웨딩 마리나컨벤션웨딩홀(더리본(주)마리나웨딩지점).xlsx", ["W웨딩 마리나컨벤션웨딩홀", "더리본(주)마리나웨딩지점"]],
    ["(전라도)_W웨딩시티 웨딩홀(더리본(주)누리엔웨딩지점).xlsx", ["W웨딩시티 웨딩홀", "더리본(주)누리엔웨딩지점"]],
  ] as const);
  let fixtureIndex = 0;
  for (const displayName of cases.keys()) {
    await writeFile(path.join(hallDir, displayName), `corporate fixture ${fixtureIndex++}`);
  }

  const manifest = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  const byDisplayName = new Map(manifest.units.map((unit) => [unit.display_name, unit.parsed]));

  for (const [displayName, [rawName, corporateName]] of cases) {
    const parsed = byDisplayName.get(displayName);
    assert.equal(parsed?.raw_name, rawName, displayName);
    assert.equal(parsed?.corporate_name, corporateName, displayName);
  }
});

test("scan recognizes the parenthesized corporate symbol without absorbing it into the vendor name", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-corporate-symbol-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));

  const hallDir = path.join(rootDir, "hall", "busan");
  const agencyDir = path.join(rootDir, "agency", "busan");
  await Promise.all([mkdir(hallDir, { recursive: true }), mkdir(agencyDir, { recursive: true })]);
  const hallCases = new Map([
    ["(부산)_더파티 센텀점(더리본㈜더파티센텀).xlsx", ["더파티 센텀점", "더리본㈜더파티센텀"]],
    ["(부산)_목화웨딩컨벤션(더리본㈜더파티아이목화점).xlsx", ["목화웨딩컨벤션", "더리본㈜더파티아이목화점"]],
    ["(부산)_W웨딩 국민연금웨딩홀(㈜더블유웨딩).xlsx", ["W웨딩 국민연금웨딩홀", "㈜더블유웨딩"]],
    ["(부산)_W웨딩 팔레드시즈웨딩홀(더리본㈜더파티해운대지점).xlsx", ["W웨딩 팔레드시즈웨딩홀", "더리본㈜더파티해운대지점"]],
    ["(부산)_웨스턴라이프호텔&컨벤션(㈜디에스에이치글로벌 익산지점)_예식장.xlsx", ["웨스턴라이프호텔&컨벤션", "㈜디에스에이치글로벌 익산지점"]],
  ] as const);
  for (const [index, displayName] of [...hallCases.keys()].entries()) {
    await writeFile(path.join(hallDir, displayName), `symbol hall fixture ${index}`);
  }
  const agencyDisplayName = "(부산)_웨스턴라이프호텔&컨벤션(㈜디에스에이치글로벌 익산지점)_결혼준비대행.xlsx";
  await writeFile(path.join(agencyDir, agencyDisplayName), "symbol agency fixture");

  const manifest = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  const byDisplayName = new Map(manifest.units.map((unit) => [unit.display_name, unit.parsed]));
  for (const [displayName, [rawName, corporateName]] of hallCases) {
    const parsed = byDisplayName.get(displayName);
    assert.equal(parsed?.raw_name, rawName, displayName);
    assert.equal(parsed?.corporate_name, corporateName, displayName);
  }
  assert.equal(byDisplayName.get(agencyDisplayName)?.raw_name, "웨스턴라이프호텔&컨벤션");
  assert.equal(
    byDisplayName.get(agencyDisplayName)?.corporate_name,
    "㈜디에스에이치글로벌 익산지점",
  );
});

test("scan removes a delimiter-bound residual region prefix but keeps a vendor name that merely starts alike", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-residual-region-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));

  const regionDir = path.join(rootDir, "hall", "daejeon");
  const hotelDir = path.join(regionDir, "대전_호텔인터시티");
  await mkdir(hotelDir, { recursive: true });
  await writeFile(path.join(hotelDir, "가격표.pdf"), "hotel fixture");
  await writeFile(path.join(regionDir, "대전웨딩.xlsx"), "lookalike fixture");

  const manifest = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  const byDisplayName = new Map(manifest.units.map((unit) => [unit.display_name, unit.parsed.raw_name]));
  assert.equal(byDisplayName.get("대전_호텔인터시티"), "호텔인터시티");
  assert.equal(byDisplayName.get("대전웨딩.xlsx"), "대전웨딩");
});

test("scan removes a filesystem copy suffix without removing a meaningful branch qualifier", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-copy-suffix-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));

  const hallDir = path.join(rootDir, "hall", "chungcheong");
  await mkdir(hallDir, { recursive: true });
  const displayName = "(충청도)_셀레네하우스웨딩(천안, 청주점) (1).xlsx";
  await writeFile(path.join(hallDir, displayName), "copy fixture");

  const manifest = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  assert.equal(manifest.units[0].parsed.raw_name, "셀레네하우스웨딩(천안, 청주점)");
  assert.equal(manifest.units[0].parsed.normalized_name, "셀레네하우스웨딩천안청주점");
});

test("scan preserves duplicate complete source sets as convertible units with a durable notice", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-identical-copy-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));

  const hallDir = path.join(rootDir, "hall", "chungcheong");
  await mkdir(hallDir, { recursive: true });
  const original = "(충청도)_셀레네하우스웨딩(천안, 청주점).xlsx";
  const copy = "(충청도)_셀레네하우스웨딩(천안, 청주점) (1).xlsx";
  await Promise.all([
    writeFile(path.join(hallDir, original), "byte-identical source"),
    writeFile(path.join(hallDir, copy), "byte-identical source"),
  ]);

  const manifest = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });

  assert.equal(manifest.units.length, 2, "scanner must not destroy either immutable provenance path");
  assert.equal(new Set(manifest.units.map((unit) => unit.unit_id)).size, 2);
  for (const unit of manifest.units) {
    assert.equal(unit.stage, "scanned");
    assert.match(unit.notices.join("\n"), /duplicate_source_content/u);
  }
});

test("scan does not call two differently hashed snapshots a content duplicate", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-distinct-copy-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));

  const hallDir = path.join(rootDir, "hall", "chungcheong");
  await mkdir(hallDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(hallDir, "(충청도)_샘플웨딩.xlsx"), "first snapshot"),
    writeFile(path.join(hallDir, "(충청도)_샘플웨딩 (1).xlsx"), "changed snapshot"),
  ]);

  const manifest = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  assert.equal(manifest.units.length, 2);
  assert.ok(manifest.units.every((unit) => unit.stage === "scanned"));
  assert.ok(manifest.units.every((unit) => !unit.notices.some(
    (notice) => notice.startsWith("duplicate_source_content:"),
  )));
});

test("scan clears its duplicate block after the extra immutable path is removed", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-resolved-copy-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));

  const hallDir = path.join(rootDir, "hall", "chungcheong");
  await mkdir(hallDir, { recursive: true });
  const originalPath = path.join(hallDir, "(충청도)_샘플웨딩.xlsx");
  const copyPath = path.join(hallDir, "(충청도)_샘플웨딩 (1).xlsx");
  await Promise.all([
    writeFile(originalPath, "same source"),
    writeFile(copyPath, "same source"),
  ]);
  const blocked = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  assert.ok(blocked.units.every((unit) => unit.stage === "scanned"));

  await rm(copyPath);
  const resolved = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });

  assert.equal(resolved.units.length, 1);
  assert.equal(resolved.units[0].stage, "scanned");
  assert.doesNotMatch(resolved.units[0].notices.join("\n"), /duplicate_source_content/u);
});

test("scan reports an unreadable sibling source file instead of dropping it silently", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-unsupported-sibling-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));

  const vendorDir = path.join(rootDir, "결혼준비대행서비스", "강남", "샘플가나웨딩");
  await mkdir(vendorDir, { recursive: true });
  await writeFile(path.join(vendorDir, "제휴업체_가격표.xlsx"), "dummy-xlsx");
  await writeFile(path.join(vendorDir, "제휴업체_위약금.csv"), "업체명,위약금\n샘플스튜디오,계약금 전액");

  const manifest = await scanSources({ rootDir, stateDir });

  assert.equal(manifest.units.length, 1);
  const unit = manifest.units[0];
  assert.equal(unit.source_files.length, 1, "only the xlsx is a convertible source");
  assert.match(
    unit.notices.join("\n"),
    new RegExp(`${SKIPPED_SOURCE_NOTICE_PREFIX}.*제휴업체_위약금\\.csv`, "u"),
    "the dropped 위약금 file must stay visible on the unit that lost it",
  );

  const skipped = manifest.skipped_sources;
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].ext, "csv");
  assert.equal(skipped[0].unit_id, unit.unit_id, "a covered file is attributed to its unit");
  assert.match(skipped[0].path, /제휴업체_위약금\.csv$/u);
});

test("scan keeps a vendor visible when every one of its files is an unsupported format", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-unsupported-only-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));

  const regionDir = path.join(rootDir, "결혼준비대행서비스", "강남");
  const csvOnlyVendor = path.join(regionDir, "샘플다라웨딩");
  const jpgOnlyVendor = path.join(regionDir, "샘플사아웨딩");
  await mkdir(csvOnlyVendor, { recursive: true });
  await mkdir(jpgOnlyVendor, { recursive: true });
  // A convertible unit has to exist, otherwise scan refuses the whole raw root.
  await writeFile(path.join(regionDir, "샘플기준웨딩.xlsx"), "dummy-xlsx");
  await writeFile(path.join(csvOnlyVendor, "제휴업체.csv"), "업체명,가격\n샘플드레스,1500000");
  await writeFile(path.join(jpgOnlyVendor, "가격표.jpg"), "dummy-jpeg-bytes");
  await writeFile(path.join(regionDir, "샘플마바웨딩.csv"), "업체명,가격\n샘플메이크업,300000");

  const manifest = await scanSources({ rootDir, stateDir });

  assert.equal(manifest.units.length, 1, "unsupported-only vendors produce no convertible unit");
  const uncovered = manifest.skipped_sources.filter((entry) => entry.unit_id === null);
  assert.equal(
    uncovered.length,
    3,
    "every vendor with no convertible file must still be recorded as uncovered",
  );
  assert.deepEqual(
    uncovered.map((entry) => entry.ext).sort(),
    ["csv", "csv", "jpg"],
  );
  assert.ok(
    uncovered.some((entry) => /샘플다라웨딩\/제휴업체\.csv$/u.test(entry.path)),
    "a vendor folder holding only unsupported files must not disappear",
  );
  assert.ok(
    uncovered.some((entry) => /샘플마바웨딩\.csv$/u.test(entry.path)),
    "a region-level unsupported file must not disappear",
  );
});

test("scan attributes a region-level unsupported file to the unit that shares its stem", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-unsupported-stem-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));

  const regionDir = path.join(rootDir, "결혼준비대행서비스", "강남");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "샘플가나웨딩.xlsx"), "dummy-xlsx");
  await writeFile(path.join(regionDir, "샘플가나웨딩.csv"), "업체명,위약금\n샘플,전액");
  await writeFile(path.join(regionDir, "샘플홀로웨딩.csv"), "업체명,가격\n샘플,1000");

  const manifest = await scanSources({ rootDir, stateDir });

  assert.equal(manifest.units.length, 1);
  const unit = manifest.units[0];
  assert.equal(unit.parsed.raw_name, "샘플가나웨딩");

  const covered = manifest.skipped_sources.filter((entry) => entry.unit_id !== null);
  assert.equal(covered.length, 1, "the same-stem CSV belongs to its vendor, not to a phantom one");
  assert.equal(covered[0].unit_id, unit.unit_id);
  assert.match(covered[0].path, /샘플가나웨딩\.csv$/u);

  const uncovered = manifest.skipped_sources.filter((entry) => entry.unit_id === null);
  assert.equal(uncovered.length, 1);
  assert.match(uncovered[0].path, /샘플홀로웨딩\.csv$/u);
});

test("scan does not report operating-system metadata files as lost vendor data", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-os-metadata-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));

  const vendorDir = path.join(rootDir, "결혼준비대행서비스", "강남", "샘플오에스웨딩");
  await mkdir(vendorDir, { recursive: true });
  await writeFile(path.join(vendorDir, "가격표.xlsx"), "dummy-xlsx");
  await writeFile(path.join(vendorDir, ".DS_Store"), "mac-metadata");
  await writeFile(path.join(vendorDir, "Thumbs.db"), "windows-metadata");
  await writeFile(path.join(vendorDir, "._가격표.xlsx"), "apple-double");

  const manifest = await scanSources({ rootDir, stateDir });

  assert.equal(manifest.units.length, 1);
  assert.deepEqual(manifest.skipped_sources, [], "OS metadata is not vendor data");
  assert.doesNotMatch(manifest.units[0].notices.join("\n"), /unsupported_source_file/u);
});

test("scan keeps the unsupported-source notice across a rescan that reuses downstream state", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-unsupported-rescan-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));

  const vendorDir = path.join(rootDir, "결혼준비대행서비스", "강남", "샘플재검사웨딩");
  await mkdir(vendorDir, { recursive: true });
  await writeFile(path.join(vendorDir, "가격표.xlsx"), "dummy-xlsx");
  await writeFile(path.join(vendorDir, "위약금.csv"), "업체명,위약금\n샘플,전액");

  const first = await scanSources({ rootDir, stateDir });
  first.units[0].stage = "converted";
  await writeJsonFile(path.join(stateDir, "manifest.json"), first);

  const second = await scanSources({ rootDir, stateDir });

  assert.equal(second.units[0].stage, "converted", "an unsupported sibling does not invalidate conversion");
  assert.match(
    second.units[0].notices.join("\n"),
    new RegExp(`${SKIPPED_SOURCE_NOTICE_PREFIX}.*위약금\\.csv`, "u"),
    "the notice must survive the reuse path that copies previous notices",
  );
  assert.equal(second.skipped_sources.length, 1);
});
