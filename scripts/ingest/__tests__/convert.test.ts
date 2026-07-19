import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  workbookToMarkdown,
} from "../convert.js";
import { writeJsonFile } from "../io.js";
import { scanSources } from "../scan.js";

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

test("convert rasterizes a PDF when extracted text is shorter than 300 characters", async (t) => {
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
  };

  const first = await convertManifest({ stateDir }, dependencies);
  const second = await convertManifest({ stateDir }, dependencies);

  assert.equal(extractionCount, 1);
  assert.equal(second.units[0].conversion?.converted_at, first.units[0].conversion?.converted_at);
});
