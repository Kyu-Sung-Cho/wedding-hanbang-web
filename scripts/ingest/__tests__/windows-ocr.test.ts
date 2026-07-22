import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CONVERTER_VERSION, convertManifest } from "../convert.js";
import { saveManifest } from "../manifest.js";
import { scanSources } from "../scan.js";
import { deriveValidatedPayloadForUnit } from "../validate.js";
import {
  createWindowsOcrReviewArtifacts,
  WINDOWS_OCR_CONTRACT_HASH,
} from "../windows-ocr.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);

test("Windows OCR copies verified images to a short path and emits review-only page/line evidence", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanbang-ocr-contract-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const longDirectory = path.join(root, ...Array.from({ length: 8 }, (_, index) =>
    `long-vendor-disclosure-directory-${index}`
  ));
  await mkdir(longDirectory, { recursive: true });
  const sourcePath = path.join(longDirectory, "source-page.png");
  await writeFile(sourcePath, ONE_PIXEL_PNG);
  const expectedSha256 = createHash("sha256").update(ONE_PIXEL_PNG).digest("hex");
  let safePathSeen = "";

  const result = await createWindowsOcrReviewArtifacts({
    images: [{ imagePath: sourcePath, expectedSha256, page: 3 }],
    outputDirectory: path.join(root, "converted"),
  }, async (request) => {
    safePathSeen = request.safeImagePath;
    assert.ok(request.safeImagePath.length < sourcePath.length);
    assert.deepEqual(await readFile(request.safeImagePath), ONE_PIXEL_PNG);
    assert.equal(request.language, "ko-KR");
    return {
      schema_version: 1,
      engine_name: "Windows.Media.Ocr",
      engine_version: "10.0.26100.1",
      language: "ko-KR",
      lines: [
        { line: 1, text: "드레스 기본 400만원" },
        { line: 2, text: "피팅비 10만원" },
      ],
    };
  });

  assert.notEqual(safePathSeen, sourcePath);
  assert.deepEqual(await readFile(sourcePath), ONE_PIXEL_PNG);
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.review_only, true);
  assert.equal(result.authoritative, false);
  assert.equal(result.bulk_approval_eligible, false);
  const artifactText = await readFile(result.artifacts[0]!.artifact_path, "utf8");
  assert.match(artifactText, /^\[OCR_REVIEW_ONLY\]$/mu);
  assert.match(artifactText, /^authoritative: false$/mu);
  assert.match(artifactText, /^bulk_approval_eligible: false$/mu);
  assert.match(artifactText, /^engine_name: Windows\.Media\.Ocr$/mu);
  assert.match(artifactText, /^engine_hash: [a-f0-9]{64}$/mu);
  assert.match(artifactText, /^ocr:page:3:line:1: 드레스 기본 400만원$/mu);
  assert.match(artifactText, /^ocr:page:3:line:2: 피팅비 10만원$/mu);
});

test("Windows OCR rejects duplicate page locators before invoking the engine", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanbang-ocr-pages-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "page.png");
  await writeFile(sourcePath, ONE_PIXEL_PNG);
  const expectedSha256 = createHash("sha256").update(ONE_PIXEL_PNG).digest("hex");
  let calls = 0;

  await assert.rejects(
    createWindowsOcrReviewArtifacts({
      images: [
        { imagePath: sourcePath, expectedSha256, page: 1 },
        { imagePath: sourcePath, expectedSha256, page: 1 },
      ],
      outputDirectory: path.join(root, "converted"),
    }, async () => {
      calls += 1;
      throw new Error("must not run");
    }),
    /ocr_page_locator_duplicate/u,
  );
  assert.equal(calls, 0);
});

test("Windows OCR rejects a changed image before invoking the engine", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanbang-ocr-hash-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "page.png");
  await writeFile(sourcePath, ONE_PIXEL_PNG);
  let calls = 0;

  await assert.rejects(createWindowsOcrReviewArtifacts({
    images: [{ imagePath: sourcePath, expectedSha256: "0".repeat(64), page: 1 }],
    outputDirectory: path.join(root, "output"),
  }, async () => {
    calls += 1;
    throw new Error("must not run");
  }), /ocr_image_sha256_mismatch/u);
  assert.equal(calls, 0);
});

test("Windows OCR publishes no partial review artifacts when a later page fails", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanbang-ocr-atomic-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const firstPath = path.join(root, "first.png");
  const secondPath = path.join(root, "second.png");
  await Promise.all([
    writeFile(firstPath, ONE_PIXEL_PNG),
    writeFile(secondPath, ONE_PIXEL_PNG),
  ]);
  const expectedSha256 = createHash("sha256").update(ONE_PIXEL_PNG).digest("hex");
  const outputDirectory = path.join(root, "published-ocr");
  let calls = 0;

  await assert.rejects(createWindowsOcrReviewArtifacts({
    images: [
      { imagePath: firstPath, expectedSha256, page: 1 },
      { imagePath: secondPath, expectedSha256, page: 2 },
    ],
    outputDirectory,
  }, async () => {
    calls += 1;
    if (calls === 2) throw new Error("engine failed");
    return {
      schema_version: 1,
      engine_name: "Windows.Media.Ocr",
      engine_version: "test-engine-v1",
      language: "ko-KR",
      lines: [{ line: 1, text: "첫 페이지" }],
    };
  }), /engine failed/u);
  await assert.rejects(access(outputDirectory), /ENOENT/u);
});

test("convert opt-in binds OCR review evidence into the conversion fingerprint and manifest contract", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ocr-convert-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "agency", "강남");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "sample.png"), ONE_PIXEL_PNG);
  await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });

  const converted = await convertManifest({
    stateDir,
    windowsOcrReviewOnly: true,
  }, {
    windowsOcrRunner: async () => ({
      schema_version: 1,
      engine_name: "Windows.Media.Ocr",
      engine_version: "test-engine-v1",
      language: "ko-KR",
      lines: [{ line: 1, text: "패키지 100만원" }],
    }),
  });

  const conversion = converted.units[0]!.conversion;
  assert.ok(conversion);
  assert.equal(conversion.ocr_review?.review_only, true);
  assert.equal(conversion.ocr_review?.authoritative, false);
  assert.equal(conversion.ocr_review?.bulk_approval_eligible, false);
  assert.equal(conversion.ocr_review?.artifacts.length, 1);
  assert.ok(conversion.text_artifacts.includes(
    conversion.ocr_review?.artifacts[0]!.artifact_path ?? "missing",
  ));
  assert.match(await readFile(conversion.text_artifacts[0]!, "utf8"), /OCR_REVIEW_ONLY/u);
  assert.match(converted.units[0]!.notices.join("\n"), /ocr_review_only/u);
  const validation = await deriveValidatedPayloadForUnit(converted.units[0]!, {
    data: {
      doc_kind: "unknown",
      business_name: null,
      region_hint: null,
      agency_packages: [],
      partner_vendors: [],
      halls: [],
      sections: [],
      money_occurrences: [],
      hall: {
        venue_fee_krw: null,
        meal_price_min_krw: null,
        meal_price_max_krw: null,
        venue_fee_source_quote: null,
        meal_price_source_quote: null,
        venue_fee_source_file_ids: [],
        meal_price_source_file_ids: [],
        items: [],
        confidence: 0,
        needs_review: true,
      },
      extraction_notes: "OCR review fixture",
    },
  });
  assert.ok(validation.issues.some((issue) =>
    issue.code === "ocr_evidence_review_only"
    && issue.severity === "warning"
  ));

  const artifactBytes = await Promise.all([
    ...conversion.text_artifacts,
    ...conversion.image_artifacts,
  ].map((artifactPath) => readFile(artifactPath)));
  await writeFile(conversion.text_artifacts[0]!, `${await readFile(conversion.text_artifacts[0]!, "utf8")}tampered`);
  const repaired = await convertManifest({
    stateDir,
    windowsOcrReviewOnly: true,
  }, {
    windowsOcrRunner: async () => ({
      schema_version: 1,
      engine_name: "Windows.Media.Ocr",
      engine_version: "test-engine-v1",
      language: "ko-KR",
      lines: [{ line: 1, text: "패키지 100만원" }],
    }),
  });
  assert.deepEqual(
    await Promise.all([
      ...repaired.units[0]!.conversion!.text_artifacts,
      ...repaired.units[0]!.conversion!.image_artifacts,
    ].map((artifactPath) => readFile(artifactPath))),
    artifactBytes,
  );
  assert.ok(CONVERTER_VERSION.endsWith(WINDOWS_OCR_CONTRACT_HASH.slice(0, 12)));
  repaired.units[0]!.conversion!.ocr_review!.contract_hash = "0".repeat(64);
  await saveManifest(repaired);
  let contractRepairCalls = 0;
  const contractRepaired = await convertManifest({
    stateDir,
    windowsOcrReviewOnly: true,
  }, {
    windowsOcrRunner: async () => {
      contractRepairCalls += 1;
      return {
        schema_version: 1,
        engine_name: "Windows.Media.Ocr",
        engine_version: "test-engine-v1",
        language: "ko-KR",
        lines: [{ line: 1, text: "패키지 100만원" }],
      };
    },
  });
  assert.equal(contractRepairCalls, 1);
  assert.equal(
    contractRepaired.units[0]!.conversion!.ocr_review!.contract_hash,
    WINDOWS_OCR_CONTRACT_HASH,
  );
});

test("a failed OCR refresh preserves the last published conversion artifacts", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ocr-refresh-failure-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "hall", "chungcheong");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "sample.pdf"), "%PDF generated fixture");
  await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  const dependencies = {
    extractPdfText: async () => "published source evidence",
    rasterizePdf: async (_sourcePath: string, outputDirectory: string) => {
      const pagePath = path.join(outputDirectory, "page-1.png");
      await writeFile(pagePath, ONE_PIXEL_PNG);
      return [pagePath];
    },
  };

  const published = await convertManifest({ stateDir }, dependencies);
  const priorConversion = structuredClone(published.units[0]!.conversion);
  assert.ok(priorConversion);
  const priorPaths = [
    ...priorConversion.text_artifacts,
    ...priorConversion.image_artifacts,
  ];
  const priorBytes = await Promise.all(priorPaths.map((artifactPath) => readFile(artifactPath)));

  const failed = await convertManifest({
    stateDir,
    windowsOcrReviewOnly: true,
  }, {
    ...dependencies,
    windowsOcrRunner: async () => {
      throw new Error("fixture OCR failure");
    },
  });

  assert.equal(failed.units[0]!.stage, "error");
  assert.deepEqual(
    await Promise.all(priorPaths.map((artifactPath) => readFile(artifactPath))),
    priorBytes,
  );
  assert.deepEqual(failed.units[0]!.conversion, priorConversion);
});

test("Windows.Media.Ocr ko-KR helper smoke", {
  skip: process.platform !== "win32" || process.env.RUN_WINDOWS_OCR_SMOKE !== "1",
}, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanbang-ocr-smoke-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const sharp = (await import("sharp")).default;
  const image = await sharp({
    create: { width: 900, height: 180, channels: 3, background: "white" },
  }).composite([{
    input: Buffer.from(
      '<svg width="900" height="180"><text x="30" y="110" font-size="64" font-family="Malgun Gothic">드레스 400만원</text></svg>',
    ),
  }]).png().toBuffer();
  const sourcePath = path.join(root, "ocr-smoke.png");
  await writeFile(sourcePath, image);
  const expectedSha256 = createHash("sha256").update(image).digest("hex");

  const result = await createWindowsOcrReviewArtifacts({
    images: [{ imagePath: sourcePath, expectedSha256, page: 1 }],
    outputDirectory: path.join(root, "output"),
  });

  assert.equal(result.artifacts[0]?.engine_name, "Windows.Media.Ocr");
  assert.match(result.artifacts[0]?.engine_version ?? "", /^windows-/u);
});
