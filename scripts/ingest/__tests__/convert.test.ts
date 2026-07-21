import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import * as XLSX from "xlsx";

import {
  convertManifest,
  PdfRasterizerUnavailableError,
  rasterizePdfSafely,
  validateDocxArchiveLimits,
  validateDocxArchiveHeader,
  validatePdfRasterLimits,
  validatePdfTextLimits,
  validateXlsxArchiveHeader,
  validateXlsxArchiveLimits,
  validateXlsxFormulaLimits,
  workbookToMarkdown,
} from "../convert.js";
import { writeJsonFile } from "../io.js";
import { loadManifest, saveManifest } from "../manifest.js";
import { scanSources } from "../scan.js";
import { getIngestStatus } from "../status.js";

test("convert sends an HWP-only unit to the manual conversion queue", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-hwp-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));

  const regionDir = path.join(rootDir, "결혼준비대행서비스", "전라도");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(전라도)_샘플전라웨딩.hwp"), "dummy-hwp");
  await scanSources({ rootDir, stateDir });

  const result = await convertManifest({ stateDir });

  assert.equal(result.units[0].stage, "needs_manual_conversion");
  assert.match(result.units[0].notices.join("\n"), /PDF.*같은 위치.*scan/u);
  const queue = await readFile(
    path.join(stateDir, ".converted", "needs-manual-conversion.json"),
    "utf8",
  );
  assert.match(queue, /샘플전라웨딩\.hwp/u);
});

test("convert processes duplicate-content units while preserving their provenance notice", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-duplicate-convert-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "hall", "chungcheong");
  await mkdir(regionDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(regionDir, "샘플홀.pdf"), "%PDF identical fixture"),
    writeFile(path.join(regionDir, "샘플홀 (1).pdf"), "%PDF identical fixture"),
  ]);
  const scanned = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  assert.ok(scanned.units.every((unit) => unit.stage === "scanned"));
  let extractionCalls = 0;

  const converted = await convertManifest({ stateDir }, {
    extractPdfText: async () => {
      extractionCalls += 1;
      return "duplicate source evidence";
    },
    rasterizePdf: async (_sourcePath, outputDirectory) => {
      await mkdir(outputDirectory, { recursive: true });
      const outputPath = path.join(outputDirectory, "page-1.png");
      await writeFile(outputPath, Buffer.from("generated-page"));
      return [outputPath];
    },
  });

  assert.equal(extractionCalls, 2);
  assert.ok(converted.units.every((unit) => unit.stage === "converted"));
  assert.ok(converted.units.every((unit) => unit.conversion !== undefined));
  assert.ok(converted.units.every((unit) => unit.notices.some(
    (notice) => notice.startsWith("duplicate_source_content:"),
  )));
  assert.equal(await readFile(path.join(regionDir, "샘플홀.pdf"), "utf8"), "%PDF identical fixture");
  assert.equal(await readFile(path.join(regionDir, "샘플홀 (1).pdf"), "utf8"), "%PDF identical fixture");
});

test("convert refuses to remove a cache path that escapes through a symlink or junction", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-duplicate-reparse-"));
  const stateDir = `${rootDir}-state`;
  const outsideDir = `${rootDir}-outside`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
    rm(outsideDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "hall", "chungcheong");
  await mkdir(regionDir, { recursive: true });
  const rawPaths = [
    path.join(regionDir, "샘플홀.pdf"),
    path.join(regionDir, "샘플홀 (1).pdf"),
  ];
  await Promise.all(rawPaths.map((rawPath) => writeFile(rawPath, "%PDF identical fixture")));
  const scanned = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  const unit = scanned.units[0];
  assert.ok(unit);
  const escapedConversionDirectory = path.join(outsideDir, unit.source_fingerprint);
  const escapedArtifact = path.join(escapedConversionDirectory, "1-sheets.txt");
  await mkdir(escapedConversionDirectory, { recursive: true });
  await writeFile(escapedArtifact, "must stay outside the state boundary");
  const convertedRoot = path.join(stateDir, ".converted");
  await mkdir(convertedRoot, { recursive: true });
  const reparseUnitRoot = path.join(convertedRoot, unit.unit_id);
  try {
    await symlink(
      outsideDir,
      reparseUnitRoot,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (
      error instanceof Error
      && "code" in error
      && ["EACCES", "EPERM", "ENOTSUP"].includes(String(error.code))
    ) {
      t.skip(`symlink/junction creation unavailable: ${String(error.code)}`);
      return;
    }
    throw error;
  }

  const converted = await convertManifest({ stateDir });

  assert.equal((await lstat(reparseUnitRoot)).isSymbolicLink(), true);
  assert.equal(await readFile(escapedArtifact, "utf8"), "must stay outside the state boundary");
  assert.match(converted.units[0].notices.join("\n"), /convert_cache_cleanup_blocked/u);
  for (const rawPath of rawPaths) {
    assert.equal(await readFile(rawPath, "utf8"), "%PDF identical fixture");
  }
});

test("convert preserves merged XLSX values and extracts embedded media for sparse sheets", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-xlsx-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));

  const regionDir = path.join(rootDir, "결혼준비대행서비스", "강남");
  await mkdir(regionDir, { recursive: true });
  const sourcePath = path.join(regionDir, "[서울(강남)]_샘플웨딩.xlsx");
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([["패키지", null], ["기본가", "290만원"]]);
  worksheet["!merges"] = [XLSX.utils.decode_range("A1:B1")];
  XLSX.utils.book_append_sheet(workbook, worksheet, "가격표");
  XLSX.writeFile(workbook, sourcePath);

  const zip = await JSZip.loadAsync(await readFile(sourcePath));
  zip.file(
    "xl/media/image1.png",
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64"),
  );
  await writeFile(sourcePath, await zip.generateAsync({ type: "nodebuffer" }));

  await scanSources({ rootDir, stateDir });
  const result = await convertManifest({ stateDir });
  const conversion = result.units[0].conversion;

  assert.equal(result.units[0].stage, "converted");
  assert.ok(conversion);
  assert.equal(conversion.cell_count, 3);
  const convertedText = await readFile(conversion.text_artifacts[0], "utf8");
  assert.match(convertedText, /## 시트: 가격표/u);
  assert.match(convertedText, /가격표!A1: 패키지/u);
  assert.match(convertedText, /가격표!B2: 290만원/u);
  assert.match(convertedText, /\| B1 \| 패키지 \|/u);
  assert.match(convertedText, /\| B2 \| 290만원 \|/u);
  assert.equal(conversion.image_artifacts.length, 1);
  assert.match(conversion.image_artifacts[0], /1-media[\\/]image1\.png$/u);
});

test("convert preserves bounded embedded XLSX media even when the workbook is text-rich", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-xlsx-rich-media-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "강남");
  await mkdir(regionDir, { recursive: true });
  const sourcePath = path.join(regionDir, "[서울(강남)]_텍스트풍부.xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(Array.from({ length: 60 }, (_, index) => [`상품 ${index}`, `${index}만원`])),
    "가격표",
  );
  XLSX.writeFile(workbook, sourcePath);
  const zip = await JSZip.loadAsync(await readFile(sourcePath));
  zip.file("xl/media/image1.png", Buffer.from("generated-image"));
  await writeFile(sourcePath, await zip.generateAsync({ type: "nodebuffer" }));
  await scanSources({ rootDir, stateDir });

  const result = await convertManifest({ stateDir });

  assert.ok((result.units[0].conversion?.cell_count ?? 0) >= 100);
  assert.equal(result.units[0].conversion?.image_artifacts.length, 1);
});

test("convert preserves rich XLSX drawing text with a deterministic source locator", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-xlsx-drawing-text-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "예식장", "경기도");
  await mkdir(regionDir, { recursive: true });
  const sourcePath = path.join(regionDir, "(경기도)_라온제나 분당.xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["예식비", "500만원"]]), "가격표");
  XLSX.writeFile(workbook, sourcePath);
  const zip = await JSZip.loadAsync(await readFile(sourcePath));
  zip.file(
    "xl/drawings/drawing1.xml",
    '<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:oneCellAnchor><xdr:sp><xdr:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>[ </a:t></a:r><a:r><a:t>총비용 </a:t></a:r><a:r><a:t>= </a:t></a:r><a:r><a:t>예식비 </a:t></a:r><a:r><a:t>+ </a:t></a:r><a:r><a:t>식대총액 </a:t></a:r><a:r><a:t>]</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>',
  );
  await writeFile(sourcePath, await zip.generateAsync({ type: "nodebuffer" }));
  await scanSources({ rootDir, stateDir });

  const result = await convertManifest({ stateDir });
  const artifactPath = result.units[0].conversion?.text_artifacts[0];

  assert.equal(result.units[0].stage, "converted");
  assert.ok(artifactPath);
  const text = await readFile(artifactPath, "utf8");
  assert.match(
    text,
    /XLSX_DRAWING xl\/drawings\/drawing1\.xml#text-box-1: \[ 총비용 = 예식비 \+ 식대총액 \]/u,
  );
});

test("convert preserves XLSX formulas as non-executed source evidence linked to cached cells", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-xlsx-formulas-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "강남");
  await mkdir(regionDir, { recursive: true });
  const sourcePath = path.join(regionDir, "[서울(강남)]_케이트웨딩플랜.xlsx");
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([["계약서"]]);
  worksheet.B20 = { t: "n", f: "SUM(C12,C14,C16)", v: 4_160_000, z: "#,##0" };
  worksheet.B25 = { t: "n", f: "(B20-B24)*0.6", v: 2_196_000, z: "#,##0" };
  worksheet.B26 = { t: "n", f: "B20-B24-B25", v: 1_464_000, z: "#,##0" };
  worksheet.C28 = { t: "n", f: "TODAY()", v: 46_185, z: "yyyy-mm-dd" };
  worksheet["!ref"] = "A1:C28";
  XLSX.utils.book_append_sheet(workbook, worksheet, "계약서");
  XLSX.writeFile(workbook, sourcePath);
  await scanSources({ rootDir, stateDir });

  const result = await convertManifest({ stateDir });
  const artifactPath = result.units[0].conversion?.text_artifacts[0];

  assert.equal(result.units[0].stage, "converted");
  assert.ok(artifactPath);
  const text = await readFile(artifactPath, "utf8");
  const formulaLines = text.split(/\r?\n/u).filter((line) => line.startsWith("XLSX_FORMULA "));
  assert.equal(formulaLines.length, 4);
  assert.match(
    formulaLines[0],
    /^XLSX_FORMULA \[sheet=%EA%B3%84%EC%95%BD%EC%84%9C;cell=B20;part=xl\/worksheets\/sheet1\.xml#cell-B20\]: expression=SUM\(C12,C14,C16\) \| cached_value_locator=\[sheet=%EA%B3%84%EC%95%BD%EC%84%9C;cell=B20\] \| evaluation=not_executed$/u,
  );
  assert.match(formulaLines[3], /cell=C28;.*expression=TODAY\(\).*evaluation=not_executed$/u);
  assert.equal(formulaLines.some((line) => /4,?160,?000|2,?196,?000|1,?464,?000|46185/u.test(line)), false);
  assert.match(text, /계약서!B20: 4,160,000/u);
});

test("convert records dangerous XLSX formulas literally without evaluating them", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-xlsx-dangerous-formula-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "예식장", "강남");
  await mkdir(regionDir, { recursive: true });
  const sourcePath = path.join(regionDir, "[서울(강남)]_외부수식.xlsx");
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([["검증"]]);
  worksheet.B2 = {
    t: "s",
    f: 'WEBSERVICE("https://example.invalid/should-never-run")',
    v: "cached-only",
  };
  worksheet["!ref"] = "A1:B2";
  XLSX.utils.book_append_sheet(workbook, worksheet, "검증");
  XLSX.writeFile(workbook, sourcePath);
  await scanSources({ rootDir, stateDir });

  const result = await convertManifest({ stateDir });
  const artifactPath = result.units[0].conversion?.text_artifacts[0];

  assert.equal(result.units[0].stage, "converted");
  assert.ok(artifactPath);
  const text = await readFile(artifactPath, "utf8");
  assert.match(text, /expression=WEBSERVICE\("https:\/\/example\.invalid\/should-never-run"\)/u);
  assert.match(text, /evaluation=not_executed/u);
});

test("XLSX formula count and character limits enforce exact boundaries", () => {
  assert.doesNotThrow(() => validateXlsxFormulaLimits({
    formulaCount: 10_000,
    expressionCharacters: 8_192,
    totalExpressionCharacters: 200_000,
  }));
  assert.throws(
    () => validateXlsxFormulaLimits({
      formulaCount: 10_001,
      expressionCharacters: 1,
      totalExpressionCharacters: 10_001,
    }),
    /xlsx_formula_count_limit/u,
  );
  assert.throws(
    () => validateXlsxFormulaLimits({
      formulaCount: 1,
      expressionCharacters: 8_193,
      totalExpressionCharacters: 8_193,
    }),
    /xlsx_formula_character_limit/u,
  );
  assert.throws(
    () => validateXlsxFormulaLimits({
      formulaCount: 10_000,
      expressionCharacters: 20,
      totalExpressionCharacters: 200_001,
    }),
    /xlsx_formula_total_character_limit/u,
  );
});

test("convert fails closed for shared XLSX formula semantics", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-xlsx-shared-formula-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "강남");
  await mkdir(regionDir, { recursive: true });
  const sourcePath = path.join(regionDir, "[서울(강남)]_공유수식.xlsx");
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([[1, 2]]);
  worksheet.C1 = { t: "n", f: "SUM(A1:B1)", v: 3 };
  worksheet["!ref"] = "A1:C1";
  XLSX.utils.book_append_sheet(workbook, worksheet, "계약서");
  XLSX.writeFile(workbook, sourcePath);
  const zip = await JSZip.loadAsync(await readFile(sourcePath));
  const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  zip.file("xl/worksheets/sheet1.xml", sheet.replace("<f>", '<f t="shared" si="0">'));
  await writeFile(sourcePath, await zip.generateAsync({ type: "nodebuffer" }));
  await scanSources({ rootDir, stateDir });

  const result = await convertManifest({ stateDir });

  assert.equal(result.units[0].stage, "error");
  assert.match(result.units[0].notices.join("\n"), /xlsx_formula_structure_unsupported/u);
});

test("convert fails closed for malformed or unsupported XLSX drawing text", async (t) => {
  for (const fixture of [
    {
      name: "malformed",
      xml: '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:sp><xdr:txBody><a:p><a:r><a:t>미완성</a:t></a:r></a:p></xdr:sp>',
      code: "xlsx_drawing_xml_malformed",
    },
    {
      name: "unsupported",
      xml: '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:sp><a:t>본문 밖 텍스트</a:t></xdr:sp></xdr:wsDr>',
      code: "xlsx_drawing_text_structure_unsupported",
    },
  ] as const) {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), `hanbang-ingest-xlsx-drawing-${fixture.name}-`));
    const stateDir = `${rootDir}-state`;
    t.after(async () => Promise.all([
      rm(rootDir, { recursive: true, force: true }),
      rm(stateDir, { recursive: true, force: true }),
    ]));
    const regionDir = path.join(rootDir, "예식장", "경기도");
    await mkdir(regionDir, { recursive: true });
    const sourcePath = path.join(regionDir, `(경기도)_도형-${fixture.name}.xlsx`);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["가격", "100만원"]]), "가격표");
    XLSX.writeFile(workbook, sourcePath);
    const zip = await JSZip.loadAsync(await readFile(sourcePath));
    zip.file("xl/drawings/drawing1.xml", fixture.xml);
    await writeFile(sourcePath, await zip.generateAsync({ type: "nodebuffer" }));
    await scanSources({ rootDir, stateDir });

    const result = await convertManifest({ stateDir });

    assert.equal(result.units[0].stage, "error");
    assert.equal(result.units[0].conversion, undefined);
    assert.match(result.units[0].notices.join("\n"), new RegExp(fixture.code, "u"));
  }
});

test("convert fails closed with remediation when XLSX contains unsupported WMF media", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-xlsx-wmf-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "예식장", "강남");
  await mkdir(regionDir, { recursive: true });
  const sourcePath = path.join(regionDir, "[서울(강남)]_조선 팰리스.xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([["대관료", "1,000만원"]]),
    "가격표",
  );
  XLSX.writeFile(workbook, sourcePath);
  const zip = await JSZip.loadAsync(await readFile(sourcePath));
  zip.file("xl/media/image1.wmf", Buffer.from("generated-wmf-fixture"));
  await writeFile(sourcePath, await zip.generateAsync({ type: "nodebuffer" }));
  const originalSource = await readFile(sourcePath);
  await scanSources({ rootDir, stateDir });
  const previous = await loadManifest(stateDir);
  const previousUnit = previous.units[0];
  const staleCurrentDirectory = path.join(
    stateDir,
    ".converted",
    previousUnit.unit_id,
    previousUnit.source_fingerprint,
  );
  const staleCurrentArtifact = path.join(staleCurrentDirectory, "1-sheets.txt");
  await mkdir(staleCurrentDirectory, { recursive: true });
  await writeFile(staleCurrentArtifact, "stale generated conversion");
  previousUnit.stage = "validated";
  previousUnit.conversion = {
    converter_version: "v4-complete-pdf-page-vision",
    source_fingerprint: previousUnit.source_fingerprint,
    text_artifacts: [path.join(stateDir, ".converted", "stale-v4.txt")],
    image_artifacts: [],
    text_characters: 10,
    cell_count: 2,
    artifact_fingerprint: "a".repeat(64),
    converted_at: new Date().toISOString(),
  };
  previousUnit.extraction = {
    fingerprint: "b".repeat(64),
    source_fingerprint: previousUnit.source_fingerprint,
    artifact_fingerprint: "a".repeat(64),
    prompt_version: "stale-v4-prompt",
    model: "gpt-5.6-luna",
    artifact_path: path.join(stateDir, ".cache", "extract", "stale-v4.json"),
    cache_hit: true,
    attempts: 1,
    input_tokens: 1,
    output_tokens: 1,
    extracted_at: new Date().toISOString(),
  };
  previousUnit.validation = {
    fingerprint: "c".repeat(64),
    artifact_path: path.join(stateDir, "validated", "stale-v4.json"),
    review_status: "pending",
    issue_count: 0,
    validated_at: new Date().toISOString(),
  };
  await saveManifest(previous);

  const result = await convertManifest({ stateDir });
  const status = await getIngestStatus({ stateDir });

  assert.equal(result.units[0].stage, "error");
  assert.equal(result.units[0].conversion, undefined);
  assert.equal(result.units[0].extraction, undefined);
  assert.equal(result.units[0].validation, undefined);
  assert.match(result.units[0].notices.join("\n"), /xlsx_media_format_unsupported/u);
  assert.match(result.units[0].notices.join("\n"), /PNG.*scan/u);
  assert.equal(status.current_by_stage.error, 1);
  assert.equal(status.stale_by_stage.error, 0);
  await assert.rejects(readFile(staleCurrentArtifact), /ENOENT/u);
  assert.deepEqual(await readFile(sourcePath), originalSource);
});

test("convert rasterizes embedded XLSX EMF media to a validated content-addressed PNG", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-xlsx-emf-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "hall", "seoul_gangnam3");
  await mkdir(regionDir, { recursive: true });
  const sourcePath = path.join(regionDir, "generated-emf.xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([["venue fee", "10,000,000"]]),
    "prices",
  );
  XLSX.writeFile(workbook, sourcePath);
  const emf = Buffer.from("generated-emf-fixture");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
    "base64",
  );
  const zip = await JSZip.loadAsync(await readFile(sourcePath));
  zip.file("xl/media/image1.emf", emf);
  await writeFile(sourcePath, await zip.generateAsync({ type: "nodebuffer" }));
  await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  let rasterCalls = 0;

  const result = await convertManifest({ stateDir }, {
    rasterizeXlsxEmf: async (content) => {
      rasterCalls += 1;
      assert.deepEqual(content, emf);
      return png;
    },
  });
  const imageArtifacts = result.units[0].conversion?.image_artifacts ?? [];
  const contentHash = createHash("sha256").update(emf).digest("hex");

  assert.equal(rasterCalls, 1);
  assert.equal(result.units[0].stage, "converted");
  assert.equal(imageArtifacts.length, 1);
  assert.equal(path.basename(imageArtifacts[0]), `${contentHash}.png`);
  assert.deepEqual(await readFile(imageArtifacts[0]), png);
});

test("convert fails closed when an XLSX EMF rasterizer returns an oversized PNG canvas", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-xlsx-emf-bounds-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "hall", "seoul_gangnam3");
  await mkdir(regionDir, { recursive: true });
  const sourcePath = path.join(regionDir, "generated-emf-bounds.xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["price", "100"]]), "prices");
  XLSX.writeFile(workbook, sourcePath);
  const zip = await JSZip.loadAsync(await readFile(sourcePath));
  zip.file("xl/media/image1.emf", Buffer.from("generated-emf-fixture"));
  await writeFile(sourcePath, await zip.generateAsync({ type: "nodebuffer" }));
  await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  const oversizedCanvas = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(oversizedCanvas);
  oversizedCanvas.writeUInt32BE(13, 8);
  oversizedCanvas.write("IHDR", 12, "ascii");
  oversizedCanvas.writeUInt32BE(8_193, 16);
  oversizedCanvas.writeUInt32BE(1, 20);

  const result = await convertManifest({ stateDir }, {
    rasterizeXlsxEmf: async () => oversizedCanvas,
  });

  assert.equal(result.units[0].stage, "error");
  assert.equal(result.units[0].conversion, undefined);
  assert.match(result.units[0].notices.join("\n"), /xlsx_emf_png_dimension_limit/u);
});

test("convert keeps embedded XLSX media source-scoped when one unit has multiple workbooks", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-multi-xlsx-media-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));

  const vendorDir = path.join(rootDir, "agency", "jeju", "generated-vendor");
  await mkdir(vendorDir, { recursive: true });
  for (const [fileName, marker] of [["a-price.xlsx", "first-image"], ["b-price.xlsx", "second-image"]] as const) {
    const sourcePath = path.join(vendorDir, fileName);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["price", "100"]]), "sheet");
    XLSX.writeFile(workbook, sourcePath);
    const zip = await JSZip.loadAsync(await readFile(sourcePath));
    zip.file("xl/media/image1.png", marker);
    await writeFile(sourcePath, await zip.generateAsync({ type: "nodebuffer" }));
  }

  await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  const result = await convertManifest({ stateDir });
  const artifacts = result.units[0].conversion?.image_artifacts ?? [];

  assert.equal(result.units[0].source_files.length, 2);
  assert.deepEqual(artifacts.map((artifact) => path.relative(stateDir, artifact).replace(/\\/g, "/")), [
    `.converted/${result.units[0].unit_id}/${result.units[0].source_fingerprint}/1-media/image1.png`,
    `.converted/${result.units[0].unit_id}/${result.units[0].source_fingerprint}/2-media/image1.png`,
  ]);
  assert.deepEqual(await Promise.all(artifacts.map((artifact) => readFile(artifact, "utf8"))), [
    "first-image",
    "second-image",
  ]);
});

test("convert extracts DOCX text and carries a PNG into the vision inputs", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-docx-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));

  const vendorDir = path.join(rootDir, "결혼준비대행서비스", "제주", "(제주)_샘플플래너");
  await mkdir(vendorDir, { recursive: true });
  const docx = new JSZip();
  docx.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  docx.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  docx.file(
    "word/document.xml",
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>더미 기본 패키지 290만원</w:t></w:r></w:p></w:body></w:document>',
  );
  await writeFile(path.join(vendorDir, "안내.docx"), await docx.generateAsync({ type: "nodebuffer" }));
  await writeFile(
    path.join(vendorDir, "가격표.png"),
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64"),
  );

  await scanSources({ rootDir, stateDir });
  const result = await convertManifest({ stateDir });
  const conversion = result.units[0].conversion;

  assert.ok(conversion);
  assert.equal(result.units[0].stage, "converted");
  assert.match(await readFile(conversion.text_artifacts[0], "utf8"), /더미 기본 패키지 290만원/u);
  assert.equal(conversion.image_artifacts.length, 1);
  assert.match(conversion.image_artifacts[0], /가격표\.png$/u);
});

test("convert extracts embedded DOCX media into source-scoped vision inputs", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-docx-media-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));

  const regionDir = path.join(rootDir, "agency", "jeju");
  await mkdir(regionDir, { recursive: true });
  const docx = new JSZip();
  docx.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  docx.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  docx.file(
    "word/document.xml",
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>본문 가격 100만원</w:t></w:r></w:p></w:body></w:document>',
  );
  docx.file(
    "word/media/image1.png",
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64"),
  );
  await writeFile(
    path.join(regionDir, "embedded.docx"),
    await docx.generateAsync({ type: "nodebuffer" }),
  );

  await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  const result = await convertManifest({ stateDir });
  const artifacts = result.units[0].conversion?.image_artifacts ?? [];

  assert.equal(artifacts.length, 1);
  assert.match(artifacts[0], /1-docx-media[\\/]image1\.png$/u);
});

test("convert fails closed with remediation when DOCX contains unsupported embedded media", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-docx-emf-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "agency", "jeju");
  await mkdir(regionDir, { recursive: true });
  const docx = new JSZip();
  docx.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  docx.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  docx.file(
    "word/document.xml",
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>본문 가격 100만원</w:t></w:r></w:p></w:body></w:document>',
  );
  docx.file("word/media/image1.emf", Buffer.from("generated-emf-fixture"));
  await writeFile(
    path.join(regionDir, "embedded-emf.docx"),
    await docx.generateAsync({ type: "nodebuffer" }),
  );
  await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });

  const result = await convertManifest({ stateDir });

  assert.equal(result.units[0].stage, "error");
  assert.equal(result.units[0].conversion, undefined);
  assert.match(result.units[0].notices.join("\n"), /docx_media_format_unsupported/u);
  assert.match(result.units[0].notices.join("\n"), /PNG.*scan/u);
});

test("DOCX preflight rejects compression bombs before document extraction", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-docx-bomb-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "agency", "jeju");
  await mkdir(regionDir, { recursive: true });
  const docx = new JSZip();
  docx.file("[Content_Types].xml", "<Types />");
  docx.file("_rels/.rels", "<Relationships />");
  docx.file("word/document.xml", "<document />");
  docx.file("word/generated-bomb.xml", "A".repeat(1024 * 1024));
  await writeFile(
    path.join(regionDir, "generated-bomb.docx"),
    await docx.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } }),
  );
  await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });

  const result = await convertManifest({ stateDir });

  assert.equal(result.units[0].stage, "error");
  assert.match(result.units[0].notices.join("\n"), /docx_archive_compression_ratio_limit/u);
});

test("DOCX metadata limits enforce exact entry, total-size, and compression-ratio boundaries", () => {
  assert.doesNotThrow(() => validateDocxArchiveLimits(Array.from({ length: 2_048 }, (_, index) => ({
    name: `generated/${index}.xml`,
    compressedBytes: 0,
    uncompressedBytes: 0,
  }))));
  assert.throws(
    () => validateDocxArchiveLimits(Array.from({ length: 2_049 }, (_, index) => ({
      name: `generated/${index}.xml`,
      compressedBytes: 0,
      uncompressedBytes: 0,
    }))),
    /docx_archive_entry_count_limit/u,
  );
  assert.doesNotThrow(() => validateDocxArchiveLimits([{
    name: "word/document.xml",
    compressedBytes: 32 * 1024 * 1024,
    uncompressedBytes: 32 * 1024 * 1024,
  }]));
  assert.throws(
    () => validateDocxArchiveLimits([
      { name: "word/document.xml", compressedBytes: 16 * 1024 * 1024, uncompressedBytes: 16 * 1024 * 1024 },
      { name: "word/styles.xml", compressedBytes: 16 * 1024 * 1024 + 1, uncompressedBytes: 16 * 1024 * 1024 + 1 },
    ]),
    /docx_archive_total_size_limit/u,
  );
  assert.doesNotThrow(() => validateDocxArchiveLimits([{
    name: "word/document.xml",
    compressedBytes: 1_000,
    uncompressedBytes: 200_000,
  }]));
  assert.throws(
    () => validateDocxArchiveLimits([{
      name: "word/document.xml",
      compressedBytes: 1_000,
      uncompressedBytes: 200_001,
    }]),
    /docx_archive_compression_ratio_limit/u,
  );
});

test("DOCX entry count is rejected from the raw ZIP header before JSZip metadata allocation", async () => {
  const docx = new JSZip();
  docx.file("[Content_Types].xml", "<Types />");
  docx.file("_rels/.rels", "<Relationships />");
  docx.file("word/document.xml", "<document />");
  const archive = await docx.generateAsync({ type: "nodebuffer" });
  let eocdOffset = -1;
  for (let offset = archive.length - 22; offset >= 0; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  assert.ok(eocdOffset >= 0);
  archive.writeUInt16LE(2_049, eocdOffset + 8);
  archive.writeUInt16LE(2_049, eocdOffset + 10);

  assert.throws(() => validateDocxArchiveHeader(archive), /docx_archive_entry_count_limit/u);
});

test("convert rasterizes every PDF page even when text extraction is sparse", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-pdf-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));

  const regionDir = path.join(rootDir, "예식장", "강원");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(강원)_더미홀.pdf"), "%PDF dummy generated fixture");
  await scanSources({ rootDir, stateDir });

  const result = await convertManifest(
    { stateDir },
    {
      extractPdfText: async () => "짧은 더미 문서",
      rasterizePdf: async (_sourcePath, outputDirectory) => {
        const pagePath = path.join(outputDirectory, "page-1.png");
        await writeFile(pagePath, "generated-raster");
        return [pagePath];
      },
    },
  );
  const conversion = result.units[0].conversion;

  assert.ok(conversion);
  assert.equal(result.units[0].stage, "converted");
  assert.match(await readFile(conversion.text_artifacts[0], "utf8"), /짧은 더미 문서/u);
  assert.match(conversion.image_artifacts[0], /page-1\.png$/u);
});

test("convert retains page images for a text-rich hybrid PDF", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-pdf-hybrid-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));

  const regionDir = path.join(rootDir, "예식장", "전라");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(전라)_혼합형홀.pdf"), "%PDF generated hybrid fixture");
  await scanSources({ rootDir, stateDir });

  let rasterized = false;
  const result = await convertManifest(
    { stateDir },
    {
      extractPdfText: async () => "검색 가능한 본문 ".repeat(100),
      rasterizePdf: async (_sourcePath, outputDirectory) => {
        rasterized = true;
        const pagePath = path.join(outputDirectory, "page-1.png");
        await writeFile(pagePath, "generated hybrid raster");
        return [pagePath];
      },
    },
  );

  assert.equal(rasterized, true);
  assert.equal(result.units[0].stage, "converted");
  assert.equal(result.units[0].conversion?.image_artifacts.length, 1);
});

test("PDF text and raster metadata limits fail closed at page and output boundaries", () => {
  assert.doesNotThrow(() => validatePdfTextLimits({ pageCount: 200, textCharacters: 600_000 }));
  assert.throws(
    () => validatePdfTextLimits({ pageCount: 201, textCharacters: 1 }),
    /pdf_page_count_limit/u,
  );
  assert.throws(
    () => validatePdfTextLimits({ pageCount: 1, textCharacters: 600_001 }),
    /pdf_text_output_limit/u,
  );
  assert.doesNotThrow(() => validatePdfRasterLimits(Array.from({ length: 200 }, (_, index) => ({
    name: `page-${index + 1}.png`,
    bytes: 1,
  }))));
  assert.throws(
    () => validatePdfRasterLimits(Array.from({ length: 201 }, (_, index) => ({
      name: `page-${index + 1}.png`,
      bytes: 1,
    }))),
    /pdf_raster_page_count_limit/u,
  );
  assert.throws(
    () => validatePdfRasterLimits(Array.from({ length: 6 }, (_, index) => ({
      name: `page-${index + 1}.png`,
      bytes: 20 * 1024 * 1024,
    }))),
    /pdf_raster_total_output_limit/u,
  );
});

test("PDF rasterization publishes a checked temp directory atomically and removes failed temps", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-pdf-atomic-"));
  t.after(async () => rm(rootDir, { recursive: true, force: true }));
  const sourcePath = path.join(rootDir, "generated.pdf");
  const outputDirectory = path.join(rootDir, "published-pages");
  await writeFile(sourcePath, "%PDF generated fixture");

  const pages = await rasterizePdfSafely(sourcePath, outputDirectory, async ({ outputPrefix }) => {
    await writeFile(`${outputPrefix}-1.png`, "generated page");
    return { exitCode: 0, stderr: "", timedOut: false };
  });

  assert.deepEqual(pages, [path.join(outputDirectory, "page-1.png")]);
  assert.deepEqual((await readdir(rootDir)).filter((name) => name.includes(".tmp-")), []);

  let rerendered = false;
  const reused = await rasterizePdfSafely(sourcePath, outputDirectory, async () => {
    rerendered = true;
    return { exitCode: 0, stderr: "", timedOut: false };
  });
  assert.equal(rerendered, false);
  assert.deepEqual(reused, pages);

  const failedOutput = path.join(rootDir, "failed-pages");
  await assert.rejects(
    rasterizePdfSafely(sourcePath, failedOutput, async () => ({
      exitCode: null,
      stderr: "x".repeat(100_000),
      timedOut: true,
    })),
    /pdf_raster_process_timeout/u,
  );
  assert.deepEqual((await readdir(rootDir)).filter((name) => name.includes(".tmp-")), []);

  const stderrOutput = path.join(rootDir, "stderr-pages");
  const rejection = await rasterizePdfSafely(sourcePath, stderrOutput, async () => ({
    exitCode: 1,
    stderr: "x".repeat(100_000),
    timedOut: false,
  })).then(() => null, (error: unknown) => error);
  assert.ok(rejection instanceof Error);
  assert.ok(rejection.message.length < 20_000);
});

test("PDF rasterization uses a short state scratch path before publishing a deep artifact", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-pdf-long-path-"));
  t.after(async () => rm(rootDir, { recursive: true, force: true }));
  const sourcePath = path.join(rootDir, "generated.pdf");
  const convertedRoot = path.join(rootDir, ".converted");
  const outputDirectory = path.join(
    convertedRoot,
    "u".repeat(64),
    "f".repeat(64),
    "1-pdf-pages",
  );
  await writeFile(sourcePath, "%PDF generated fixture");
  let temporaryPrefix = "";

  const pages = await rasterizePdfSafely(sourcePath, outputDirectory, async ({ outputPrefix }) => {
    temporaryPrefix = outputPrefix;
    await writeFile(`${outputPrefix}-1.png`, "generated page");
    return { exitCode: 0, stderr: "", timedOut: false };
  });

  assert.ok(temporaryPrefix.includes(`${path.sep}.converted${path.sep}.pdf-raster-tmp${path.sep}`));
  assert.ok(temporaryPrefix.length < path.join(outputDirectory, "page").length);
  assert.deepEqual(pages, [path.join(outputDirectory, "page-1.png")]);
});

test("convert reports an actionable manual step when sparse PDF rasterization is unavailable", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-pdf-manual-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "예식장", "경기");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(경기)_더미홀.pdf"), "%PDF generated fixture");
  await scanSources({ rootDir, stateDir });

  const result = await convertManifest(
    { stateDir },
    {
      extractPdfText: async () => "텍스트 없음",
      rasterizePdf: async () => {
        throw new PdfRasterizerUnavailableError();
      },
    },
  );

  assert.equal(result.units[0].stage, "needs_manual_conversion");
  assert.match(result.units[0].notices.join("\n"), /Poppler.*PNG.*scan/u);
});

test("convert retries a previously manual PDF after the rasterizer becomes available", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-pdf-retry-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "hall", "gyeonggi");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "generated.pdf"), "%PDF generated fixture");
  await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  let rasterAttempts = 0;
  const first = await convertManifest({ stateDir }, {
    extractPdfText: async () => "short",
    rasterizePdf: async () => {
      rasterAttempts += 1;
      throw new PdfRasterizerUnavailableError();
    },
  });
  assert.equal(first.units[0].stage, "needs_manual_conversion");

  const second = await convertManifest({ stateDir }, {
    extractPdfText: async () => "short",
    rasterizePdf: async (_sourcePath, outputDirectory) => {
      rasterAttempts += 1;
      const page = path.join(outputDirectory, "page-1.png");
      await writeFile(page, "generated page");
      return [page];
    },
  });

  assert.equal(rasterAttempts, 2);
  assert.equal(second.units[0].stage, "converted");
  assert.equal(second.units[0].conversion?.image_artifacts.length, 1);
  assert.doesNotMatch(second.units[0].notices.join("\n"), /Poppler/u);
});

test("convert blocks the whole vendor unit when an HWP has no same-stem replacement PDF", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-hwp-mixed-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const vendorDir = path.join(rootDir, "agency", "jeolla", "generated-vendor");
  await mkdir(vendorDir, { recursive: true });
  await writeFile(path.join(vendorDir, "original.hwp"), "generated hwp fixture");
  await writeFile(path.join(vendorDir, "price.pdf"), "%PDF generated fixture");
  await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });

  const result = await convertManifest({ stateDir }, {
    extractPdfText: async () => "generated price disclosure ".repeat(30),
  });

  assert.equal(result.units[0].stage, "needs_manual_conversion");
  assert.ok(result.units[0].conversion);
  assert.match(result.units[0].notices.join("\n"), /HWP/u);
  const queue = await readFile(path.join(stateDir, ".converted", "needs-manual-conversion.json"), "utf8");
  assert.match(queue, /original\.hwp/u);
});

test("convert accepts a same-stem PDF replacement while retaining HWP provenance", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-hwp-replaced-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "agency", "jeolla");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "sample-replacement.hwp"), "generated hwp fixture");
  await writeFile(path.join(regionDir, "sample-replacement.pdf"), "%PDF generated replacement fixture");
  await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });

  const result = await convertManifest({ stateDir }, {
    extractPdfText: async () => "generated replacement disclosure ".repeat(30),
    rasterizePdf: async (_sourcePath, outputDirectory) => {
      const pagePath = path.join(outputDirectory, "page-1.png");
      await writeFile(pagePath, "generated replacement raster");
      return [pagePath];
    },
  });

  assert.equal(result.units.length, 1);
  assert.equal(result.units[0].stage, "converted");
  assert.deepEqual(result.units[0].source_files.map((source) => source.ext).sort(), ["hwp", "pdf"]);
  const queue = JSON.parse(await readFile(path.join(stateDir, ".converted", "needs-manual-conversion.json"), "utf8"));
  assert.equal(queue.units.length, 0);
});

test("convert rejects a source over 50MB before selecting a parser", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-source-limit-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "agency", "jeju");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "oversized.xlsx"), "small generated fixture");
  const manifest = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  manifest.units[0].source_files[0].bytes = 50 * 1024 * 1024 + 1;
  await writeJsonFile(path.join(stateDir, "manifest.json"), manifest);

  const result = await convertManifest({ stateDir });

  assert.equal(result.units[0].stage, "error");
  assert.match(result.units[0].notices.join("\n"), /50MB|source_size_limit/u);
  assert.doesNotMatch(result.units[0].notices.join("\n"), /oversized\.xlsx/u);
});

test("convert rejects XLSX files with an excessive embedded-media count", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-media-limit-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "agency", "jeju");
  await mkdir(regionDir, { recursive: true });
  const sourcePath = path.join(regionDir, "media-heavy.xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["generated"]]), "sheet");
  XLSX.writeFile(workbook, sourcePath);
  const zip = await JSZip.loadAsync(await readFile(sourcePath));
  for (let index = 0; index < 101; index += 1) {
    zip.file(`xl/media/generated-${index}.png`, "generated");
  }
  await writeFile(sourcePath, await zip.generateAsync({ type: "nodebuffer" }));
  await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });

  const result = await convertManifest({ stateDir });

  assert.equal(result.units[0].stage, "error");
  assert.match(result.units[0].notices.join("\n"), /media_count_limit/u);
});

test("XLSX archive limits cover non-media entries and total uncompressed bytes", () => {
  assert.throws(
    () => validateXlsxArchiveLimits([{ name: "xl/sharedStrings.xml", uncompressedBytes: 50 * 1024 * 1024 + 1 }]),
    /xlsx_archive_entry_size_limit/u,
  );
  assert.throws(
    () => validateXlsxArchiveLimits(Array.from({ length: 6 }, (_, index) => ({
      name: `xl/worksheets/sheet${index}.xml`,
      uncompressedBytes: 45 * 1024 * 1024,
    }))),
    /xlsx_archive_total_size_limit/u,
  );
  assert.throws(
    () => validateXlsxArchiveLimits(Array.from({ length: 10_001 }, (_, index) => ({
      name: `generated/${index}.xml`,
      uncompressedBytes: 1,
    }))),
    /xlsx_archive_entry_count_limit/u,
  );
  assert.doesNotThrow(() => validateXlsxArchiveLimits(Array.from({ length: 1_000 }, (_, index) => ({
    name: `xl/drawings/drawing${index + 1}.xml`,
    uncompressedBytes: 1,
  }))));
  assert.throws(
    () => validateXlsxArchiveLimits(Array.from({ length: 1_001 }, (_, index) => ({
      name: `xl/drawings/drawing${index + 1}.xml`,
      uncompressedBytes: 1,
    }))),
    /xlsx_drawing_part_count_limit/u,
  );
  assert.throws(
    () => validateXlsxArchiveLimits([{
      name: "xl/drawings/vmlDrawing1.vml",
      uncompressedBytes: 1,
    }]),
    /xlsx_drawing_part_format_unsupported/u,
  );
});

test("XLSX entry count is rejected from the raw ZIP header before JSZip metadata allocation", async () => {
  const xlsx = new JSZip();
  xlsx.file("[Content_Types].xml", "<Types />");
  xlsx.file("xl/workbook.xml", "<workbook />");
  xlsx.file("xl/worksheets/sheet1.xml", "<worksheet />");
  const archive = await xlsx.generateAsync({ type: "nodebuffer" });
  let eocdOffset = -1;
  for (let offset = archive.length - 22; offset >= 0; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  assert.ok(eocdOffset >= 0);
  archive.writeUInt16LE(10_001, eocdOffset + 8);
  archive.writeUInt16LE(10_001, eocdOffset + 10);

  assert.throws(() => validateXlsxArchiveHeader(archive), /xlsx_archive_entry_count_limit/u);
});

test("XLSX sheet range and serialized text limits stop sparse-range CPU and memory blowups", () => {
  const sparseWorkbook = XLSX.utils.book_new();
  const sparseSheet = XLSX.utils.aoa_to_sheet([["generated"]]);
  sparseSheet.XFD1048576 = { t: "s", v: "generated far cell" };
  sparseSheet["!ref"] = "A1:XFD1048576";
  XLSX.utils.book_append_sheet(sparseWorkbook, sparseSheet, "sparse");
  assert.throws(() => workbookToMarkdown(sparseWorkbook), /xlsx_sheet_range_limit/u);

  const textWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    textWorkbook,
    XLSX.utils.aoa_to_sheet([["x".repeat(300_001)]]),
    "large-text",
  );
  assert.throws(() => workbookToMarkdown(textWorkbook), /xlsx_serialized_text_limit/u);
});

test("XLSX serialization trims formatting-only ranges and compacts pathological merges", () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["sample heading"],
    [],
    [null, null, null, null, null, "sample price 100만원"],
  ]);
  sheet["!ref"] = "A1:XFD17";
  sheet["!merges"] = [XLSX.utils.decode_range("A1:XFD2")];
  XLSX.utils.book_append_sheet(workbook, sheet, "sample");

  const result = workbookToMarkdown(workbook);

  assert.equal(result.cellCount, 2);
  assert.match(result.markdown, /sample!A1: sample heading/u);
  assert.match(result.markdown, /병합 범위 A1:XFD2/u);
  assert.match(result.markdown, /sample!F3: sample price 100만원/u);
  assert.ok(result.markdown.length < 30_000);
});

test("XLSX serialization rejects an excessive workbook merge count", () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["generated"]]);
  sheet["!merges"] = Array.from({ length: 10_001 }, () => XLSX.utils.decode_range("A1:A1"));
  XLSX.utils.book_append_sheet(workbook, sheet, "generated");

  assert.throws(() => workbookToMarkdown(workbook), /xlsx_merge_count_limit/u);
});

test("convert skips an unchanged unit whose artifacts already exist", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-convert-cache-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "예식장", "부산");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(부산)_더미홀.pdf"), "%PDF generated fixture");
  await scanSources({ rootDir, stateDir });
  let extractionCount = 0;
  const dependencies = {
    extractPdfText: async () => {
      extractionCount += 1;
      return "충분한 더미 텍스트 ".repeat(30);
    },
    rasterizePdf: async (_sourcePath: string, outputDirectory: string) => {
      const pagePath = path.join(outputDirectory, "page-1.png");
      await writeFile(pagePath, "generated cache raster");
      return [pagePath];
    },
  };

  const first = await convertManifest({ stateDir }, dependencies);
  const second = await convertManifest({ stateDir }, dependencies);

  assert.equal(extractionCount, 1);
  assert.equal(second.units[0].conversion?.converted_at, first.units[0].conversion?.converted_at);
});

test("convert repairs a cached unit when an artifact's content is tampered", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-convert-cache-tamper-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "예식장", "부산");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(부산)_캐시무결성.pdf"), "%PDF generated fixture");
  await scanSources({ rootDir, stateDir });
  let extractionCount = 0;
  const expectedText = "원본에서 복구한 가격 정보 ".repeat(30).trim();
  const dependencies = {
    extractPdfText: async () => {
      extractionCount += 1;
      return expectedText;
    },
    rasterizePdf: async (_sourcePath: string, outputDirectory: string) => {
      const pagePath = path.join(outputDirectory, "page-1.png");
      await writeFile(pagePath, "generated cache raster");
      return [pagePath];
    },
  };

  const first = await convertManifest({ stateDir }, dependencies);
  const firstConversion = first.units[0].conversion;
  assert.ok(firstConversion);
  await writeFile(firstConversion.text_artifacts[0], "tampered artifact");

  const repaired = await convertManifest({ stateDir }, dependencies);
  const repairedConversion = repaired.units[0].conversion;
  assert.ok(repairedConversion);
  assert.equal(extractionCount, 2);
  assert.equal(await readFile(repairedConversion.text_artifacts[0], "utf8"), expectedText);
  assert.equal(repairedConversion.artifact_fingerprint, firstConversion.artifact_fingerprint);
});

test("convert repairs a cached unit when an artifact is deleted", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-convert-cache-deleted-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "예식장", "부산");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(부산)_캐시삭제복구.pdf"), "%PDF generated fixture");
  await scanSources({ rootDir, stateDir });
  let extractionCount = 0;
  const dependencies = {
    extractPdfText: async () => {
      extractionCount += 1;
      return "삭제된 산출물을 원본에서 복구 ".repeat(30);
    },
    rasterizePdf: async (_sourcePath: string, outputDirectory: string) => {
      const pagePath = path.join(outputDirectory, "page-1.png");
      await writeFile(pagePath, "recreated raster bytes");
      return [pagePath];
    },
  };

  const first = await convertManifest({ stateDir }, dependencies);
  const firstConversion = first.units[0].conversion;
  assert.ok(firstConversion);
  await rm(firstConversion.image_artifacts[0]);

  const repaired = await convertManifest({ stateDir }, dependencies);
  const repairedConversion = repaired.units[0].conversion;
  assert.ok(repairedConversion);
  assert.equal(extractionCount, 2);
  assert.equal(await readFile(repairedConversion.image_artifacts[0], "utf8"), "recreated raster bytes");
  assert.equal(repairedConversion.artifact_fingerprint, firstConversion.artifact_fingerprint);
});
