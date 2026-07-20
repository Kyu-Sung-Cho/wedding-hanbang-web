import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import * as XLSX from "xlsx";

import { convertManifest } from "../convert.js";
import { extractManifestForTests as extractManifest, type ExtractionProvider } from "../extract.js";
import { sha256Text, writeJsonFile } from "../io.js";
import { loadValidated } from "../load.js";
import { sourceFileId } from "../provenance.js";
import { scanSources } from "../scan.js";
import type { DisclosureExtraction } from "../schemas.js";
import { validateManifest } from "../validate.js";

async function writeGeneratedDocx(filePath: string): Promise<void> {
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
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>기본 패키지 | 스튜디오 드레스 메이크업 | 100만원</w:t></w:r></w:p></w:body></w:document>',
  );
  await writeFile(filePath, await docx.generateAsync({ type: "nodebuffer" }));
}

async function rasterizeGeneratedPdf(
  _sourcePath: string,
  outputDirectory: string,
): Promise<string[]> {
  const pagePath = path.join(outputDirectory, "page-1.png");
  await writeFile(pagePath, "generated PDF page raster");
  return [pagePath];
}

function generatedExtraction(name: string): DisclosureExtraction {
  return {
    doc_kind: "agency_disclosure",
    business_name: name,
    region_hint: "제주",
    agency_packages: [{
      package_name: "기본 패키지",
      category_scope: ["studio", "dress", "makeup"],
      price_min_krw: 1_000_000,
      price_max_krw: 1_000_000,
      vat_note: null,
      price_note: null,
      options: [],
      source_quote: "기본 패키지 | 스튜디오 드레스 메이크업 | 100만원",
      confidence: 0.95,
      needs_review: false,
    }],
    partner_vendors: [],
    hall: {
      venue_fee_krw: null,
      meal_price_min_krw: null,
      meal_price_max_krw: null,
      venue_fee_source_quote: null,
      meal_price_source_quote: null,
      items: [],
      confidence: 0,
      needs_review: true,
    },
    extraction_notes: "generated fixture",
  };
}

test("all five supported formats flow safely while the unconverted HWP remains blocked", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-pipeline-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "agency", "제주");
  await mkdir(regionDir, { recursive: true });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([[
      "기본 패키지 | 스튜디오 드레스 메이크업 | 100만원",
    ]]),
    "price",
  );
  XLSX.writeFile(workbook, path.join(regionDir, "alpha.xlsx"));
  await writeGeneratedDocx(path.join(regionDir, "bravo.docx"));
  await writeFile(path.join(regionDir, "charlie.pdf"), "%PDF generated fixture");
  await writeFile(
    path.join(regionDir, "delta.png"),
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64"),
  );
  await writeFile(path.join(regionDir, "echo.hwp"), "generated HWP fixture");

  const scanned = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  const scannedNames = new Map(scanned.units.map((unit) => [unit.unit_id, unit.parsed.raw_name]));
  assert.equal(scanned.units.length, 5);
  const converted = await convertManifest({ stateDir }, {
    extractPdfText: async () =>
      "기본 패키지 | 스튜디오 드레스 메이크업 | 100만원 ".repeat(30),
    rasterizePdf: rasterizeGeneratedPdf,
  });
  assert.equal(converted.units.filter((unit) => unit.stage === "converted").length, 4);
  assert.equal(converted.units.filter((unit) => unit.stage === "needs_manual_conversion").length, 1);

  const provider: ExtractionProvider = {
    extract: async (request) => {
      const data = generatedExtraction(scannedNames.get(request.unitId) ?? request.canonicalName);
      if (
        !request.text.trim()
        && request.imagePaths.some((imagePath) => /pdf-pages/iu.test(imagePath))
      ) {
        // The generated raster contains no additional disclosure content. It
        // still travels through the image request, but must not duplicate the
        // price already grounded in the PDF text layer.
        data.agency_packages = [];
        return {
          data,
          inputTokens: 10,
          outputTokens: 5,
          requestId: `generated-${request.unitId.slice(0, 8)}-pdf-image`,
        };
      }
      if (request.text.includes("price!A1: 기본 패키지")) {
        data.agency_packages[0].source_quote =
          "price!A1: 기본 패키지 | 스튜디오 드레스 메이크업 | 100만원";
      } else {
        const locatedFragment = /^(line:\d+:\s*.*?)기본 패키지 \| 스튜디오 드레스 메이크업 \| 100만원/mu
          .exec(request.text);
        if (locatedFragment) {
          data.agency_packages[0].source_quote =
            `${locatedFragment[1]}기본 패키지 | 스튜디오 드레스 메이크업 | 100만원`;
        }
      }
      if (request.imagePaths.length > 0 && !request.text.trim()) {
        data.agency_packages[0].needs_review = true;
      }
      return {
        data,
        inputTokens: 10,
        outputTokens: 5,
        requestId: `generated-${request.unitId.slice(0, 8)}`,
      };
    },
  };
  await extractManifest({ stateDir }, { provider, env: {} });
  const validated = await validateManifest({ stateDir });
  const validationArtifact = validated.units[0].validation?.artifact_path
    ? JSON.parse(await readFile(validated.units[0].validation.artifact_path, "utf8"))
    : null;
  assert.equal(
    validated.units[0].stage,
    "validated",
    JSON.stringify(validationArtifact?.issues ?? validated.units[0].notices),
  );
  const dry = await loadValidated({ stateDir, snapshot: "2026Q3" });

  assert.equal(dry.plan.units.length, 4, JSON.stringify(dry.plan.skipped_units));
  assert.equal(dry.plan.agency_packages.length, 4);
  assert.equal(dry.plan.raw_objects.length, 4);
  assert.equal(dry.plan.preview_objects.length, 3);
  assert.equal(dry.plan.skipped_units.length, 1);
  assert.match(dry.plan.skipped_units[0].reason, /manual|conversion/iu);
  assert.equal(dry.plan.agency_packages.every((row) => row.package_name === "기본 패키지" && row.source_quote.includes("100만원")), true);
  assert.equal(dry.plan.agency_packages.every((row) => row.source_object_keys.length === 1), true);
  const rawKeys = new Set(dry.plan.raw_objects.map((raw) => raw.storage_path));
  assert.equal(dry.plan.agency_packages.every((row) => rawKeys.has(row.source_object_keys[0])), true);
  assert.equal(dry.plan.agency_packages.filter((row) => row.source_file.endsWith(".png"))[0].source_preview_keys.length, 0);
  assert.equal(dry.plan.agency_packages.filter((row) => !row.source_file.endsWith(".png")).every((row) => row.source_preview_keys.length === 1), true);
  assert.deepEqual(
    dry.plan.agency_packages.map((row) => path.posix.extname(row.source_file)).sort(),
    [".docx", ".pdf", ".png", ".xlsx"],
  );
  const queue = JSON.parse(await readFile(path.join(stateDir, ".converted", "needs-manual-conversion.json"), "utf8"));
  assert.equal(queue.units.length, 1);
  assert.match(queue.units[0].source_file, /echo\.hwp/u);
});

test("a same-stem HWP replacement preserves both audit paths and both storage object keys", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-multi-provenance-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "agency", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "sample-replacement.hwp"), "generated HWP fixture");
  await writeFile(path.join(regionDir, "sample-replacement.pdf"), "%PDF generated replacement fixture");
  const scanned = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  await convertManifest({ stateDir }, {
    extractPdfText: async () =>
      "기본 패키지 | 스튜디오 드레스 메이크업 | 100만원 ".repeat(30),
    rasterizePdf: rasterizeGeneratedPdf,
  });
  const provider: ExtractionProvider = {
    extract: async () => {
      const data = generatedExtraction("sample-replacement");
      const replacement = scanned.units[0].source_files.find((source) => source.ext === "pdf");
      assert.ok(replacement);
      data.agency_packages[0].source_file_ids = [sourceFileId(replacement)];
      data.agency_packages[0].source_quote =
        "line:1: 기본 패키지 | 스튜디오 드레스 메이크업 | 100만원";
      return { data, inputTokens: 10, outputTokens: 5 };
    },
  };
  await extractManifest({ stateDir }, { provider, env: {} });
  await validateManifest({ stateDir });
  const dry = await loadValidated({ stateDir, snapshot: "2026Q3" });

  assert.equal(dry.plan.units.length, 1);
  assert.equal(dry.plan.raw_objects.length, 2);
  assert.equal(dry.plan.preview_objects.length, 1);
  assert.equal(dry.plan.agency_packages[0].source_object_keys.length, 1);
  assert.equal(dry.plan.agency_packages[0].source_preview_keys.length, 1);
  assert.equal(dry.plan.agency_packages[0].source_file, "agency/제주/sample-replacement.pdf");
  const replacement = dry.manifest.units[0].source_files.find((source) => source.ext === "pdf");
  assert.ok(replacement);
  assert.deepEqual(dry.plan.agency_packages[0].source_object_keys, [`${replacement.sha256}.pdf`]);
  assert.equal(dry.plan.preview_objects[0].source_label, "sample-replacement.pdf");
  assert.equal(dry.plan.preview_objects[0].source_object_key.endsWith(".pdf"), true);
  assert.deepEqual(dry.plan.agency_packages[0].source_preview_keys, [dry.plan.preview_objects[0].storage_path]);
});

test("an existing reverse-ordered manifest keeps conversion prefixes bound to the right raw files", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-existing-order-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const vendorDir = path.join(rootDir, "agency", "제주", "reverse-order-vendor");
  await mkdir(vendorDir, { recursive: true });
  await writeFile(path.join(vendorDir, "a-first.pdf"), "%PDF generated a fixture");
  await writeFile(path.join(vendorDir, "z-last.pdf"), "%PDF generated z fixture");

  const scanned = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  const unit = scanned.units[0];
  unit.source_files.reverse();
  unit.source_fingerprint = sha256Text(
    unit.source_files.map((source) => `${source.path}\0${source.sha256}`).join("\n"),
  );
  await writeJsonFile(path.join(stateDir, "manifest.json"), scanned);

  await convertManifest({ stateDir }, {
    extractPdfText: async (sourcePath) =>
      `${path.basename(sourcePath)} 패키지 | 스튜디오 드레스 메이크업 | 100만원 `.repeat(30),
    rasterizePdf: rasterizeGeneratedPdf,
  });
  const provider: ExtractionProvider = {
    extract: async (request) => {
      const data = generatedExtraction("reverse-order-vendor");
      if (!request.text.trim() && request.imagePaths.length > 0) {
        data.agency_packages = [];
        return { data, inputTokens: 10, outputTokens: 5 };
      }
      const requestSourceIds = [...request.text.matchAll(/^source_file_id:\s*([a-f0-9]{64})\s*$/gmu)]
        .map((match) => match[1]);
      assert.equal(requestSourceIds.length, 1);
      const requestSource = unit.source_files.find((source) =>
        sourceFileId(source) === requestSourceIds[0]
      );
      assert.ok(requestSource);
      const packageName = `${path.posix.basename(requestSource.path)} 패키지`;
      data.agency_packages[0].package_name = packageName;
      data.agency_packages[0].source_file_ids = requestSourceIds;
      const locatedFragment = new RegExp(
        `^(line:\\d+:\\s*.*?)${packageName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")} \\| 스튜디오 드레스 메이크업 \\| 100만원`,
        "mu",
      ).exec(request.text);
      assert.ok(locatedFragment);
      data.agency_packages[0].source_quote =
        `${locatedFragment[1]}${packageName} | 스튜디오 드레스 메이크업 | 100만원`;
      return { data, inputTokens: 10, outputTokens: 5 };
    },
  };
  await extractManifest({ stateDir }, { provider, env: {} });
  const validated = await validateManifest({ stateDir });
  const validationArtifact = validated.units[0].validation?.artifact_path
    ? JSON.parse(await readFile(validated.units[0].validation.artifact_path, "utf8"))
    : null;
  assert.equal(
    validated.units[0].stage,
    "validated",
    JSON.stringify(validationArtifact?.issues ?? validated.units[0].notices),
  );
  const dry = await loadValidated({ stateDir, snapshot: "2026Q3" });

  assert.deepEqual(
    dry.manifest.units[0].source_files.map((source) => path.posix.basename(source.path)),
    ["z-last.pdf", "a-first.pdf"],
  );
  assert.equal(dry.plan.agency_packages.length, 2);
  const packageRowsBySource = new Map(
    dry.plan.agency_packages.map((row) => [path.posix.basename(row.source_file), row]),
  );
  assert.deepEqual([...packageRowsBySource.keys()].sort(), ["a-first.pdf", "z-last.pdf"]);
  for (const [sourceName, row] of packageRowsBySource) {
    assert.equal(row.package_name, `${sourceName} 패키지`);
    const source = dry.manifest.units[0].source_files.find((candidate) =>
      path.posix.basename(candidate.path) === sourceName
    );
    assert.ok(source);
    assert.deepEqual(row.source_object_keys, [`${source.sha256}.pdf`]);
  }
  assert.deepEqual(
    dry.plan.preview_objects.map((preview) => preview.source_label),
    ["z-last.pdf", "a-first.pdf"],
  );
  const previewTexts = await Promise.all(
    dry.plan.preview_objects.map((preview) => readFile(preview.absolute_path, "utf8")),
  );
  assert.match(previewTexts[0], /^z-last\.pdf/u);
  assert.match(previewTexts[1], /^a-first\.pdf/u);
  assert.deepEqual(
    dry.plan.preview_objects.map((preview) => preview.source_object_key),
    dry.plan.raw_objects.map((raw) => raw.storage_path),
  );
});
