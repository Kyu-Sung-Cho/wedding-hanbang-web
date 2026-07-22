import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  prepareStructuredEvidenceText,
  resolveArtifactSourceProvenance,
  sourceFileId,
} from "../provenance.js";
import type { ManifestUnit, SourceFile } from "../types.js";

function multiSourceOcrUnit(): {
  unit: ManifestUnit;
  first: SourceFile;
  second: SourceFile;
  ocrPath: string;
} {
  const unitId = "1".repeat(64);
  const sourceFingerprint = "2".repeat(64);
  const conversionRoot = path.resolve("state", ".converted", unitId, sourceFingerprint);
  const first: SourceFile = {
    path: "hall/seoul/terms.pdf",
    absolute_path: path.resolve("raw", "hall", "seoul", "terms.pdf"),
    ext: "pdf",
    sha256: "3".repeat(64),
    bytes: 1,
  };
  const second: SourceFile = {
    path: "hall/seoul/prices.pdf",
    absolute_path: path.resolve("raw", "hall", "seoul", "prices.pdf"),
    ext: "pdf",
    sha256: "4".repeat(64),
    bytes: 1,
  };
  const firstTextPath = path.join(conversionRoot, "1-pdf.txt");
  const secondTextPath = path.join(conversionRoot, "2-pdf.txt");
  const firstImagePath = path.join(conversionRoot, "1-pdf-pages", "page-1.png");
  const secondImagePath = path.join(conversionRoot, "2-pdf-pages", "page-1.png");
  const ocrPath = path.join(conversionRoot, "ocr-review", "001-ocr-review.txt");
  const unit: ManifestUnit = {
    unit_id: unitId,
    display_name: "sample",
    parsed: {
      region_code: "seoul",
      raw_name: "sample",
      normalized_name: "sample",
      corporate_name: null,
      kind_hint: "hall",
    },
    source_files: [first, second],
    source_fingerprint: sourceFingerprint,
    stage: "converted",
    notices: [],
    conversion: {
      converter_version: "fixture",
      source_fingerprint: sourceFingerprint,
      text_artifacts: [firstTextPath, secondTextPath, ocrPath],
      image_artifacts: [firstImagePath, secondImagePath],
      text_characters: 1,
      cell_count: 0,
      artifact_fingerprint: "5".repeat(64),
      converted_at: new Date(0).toISOString(),
      ocr_review: {
        contract_version: "fixture",
        contract_hash: "6".repeat(64),
        language: "ko-KR",
        review_only: true,
        authoritative: false,
        bulk_approval_eligible: false,
        artifacts: [{
          artifact_path: ocrPath,
          source_image_sha256: "7".repeat(64),
          page: 1,
          engine_name: "Windows.Media.Ocr",
          engine_version: "fixture",
          engine_hash: "8".repeat(64),
          line_count: 1,
        }],
      },
    },
  };
  return { unit, first, second, ocrPath };
}

test("shared OCR provenance accepts only one source proven by source-image sha256", () => {
  const { unit, second, ocrPath } = multiSourceOcrUnit();
  const resolution = resolveArtifactSourceProvenance(unit, ocrPath, {
    sourceImageSourcesBySha256: new Map([["7".repeat(64), [second]]]),
  });

  assert.equal(resolution.authoritative, true);
  assert.equal(resolution.ocr_review, true);
  assert.equal(resolution.kind, "ocr_source_image_sha256");
  assert.deepEqual(resolution.sources.map(sourceFileId), [sourceFileId(second)]);
});

test("shared OCR provenance stays quarantined when identical image evidence maps to two sources", () => {
  const { unit, first, second, ocrPath } = multiSourceOcrUnit();
  const resolution = resolveArtifactSourceProvenance(unit, ocrPath, {
    sourceImageSourcesBySha256: new Map([["7".repeat(64), [first, second]]]),
  });

  assert.equal(resolution.authoritative, false);
  assert.equal(resolution.ocr_review, true);
  assert.equal(resolution.kind, "ambiguous");
  assert.deepEqual(
    new Set(resolution.sources.map(sourceFileId)),
    new Set([sourceFileId(first), sourceFileId(second)]),
  );
});

test("structured evidence redacts only contact tokens and retains co-located prices", () => {
  const raw = "대관료 3,300,000원 / 문의 02-1234-5678";

  const prepared = prepareStructuredEvidenceText(raw);

  assert.equal(prepared.text, "대관료 3,300,000원 / 문의 [CONTACT_REDACTED]");
  assert.match(prepared.text, /3,300,000원/u);
  assert.doesNotMatch(prepared.text, /02-1234-5678/u);
  assert.equal(prepared.excluded_ocr_metadata_lines, 0);
  assert.equal(prepared.excluded_contact_lines, 1);
});

test("authoritative converter text retains money on metadata-looking lines", () => {
  const raw = "page: 1 대관료 3,300,000원";

  const prepared = prepareStructuredEvidenceText(raw);

  assert.equal(prepared.text, raw);
  assert.equal(prepared.excluded_ocr_metadata_lines, 0);
  assert.equal(prepared.excluded_contact_lines, 0);
});

test("OCR review metadata is blanked without shifting locators", () => {
  const raw = [
    "[OCR_REVIEW_ONLY]",
    "source_image_sha256: deadbeef",
    "ocr:page:1:line:1: 그레이스홀",
    "그래머시 코엑스 연회예약실 T 02 6002 2005",
    "ocr:page:1:line:2: 대관료 3,300,000원",
  ].join("\n");

  const prepared = prepareStructuredEvidenceText(raw, { ocrReviewArtifact: true });
  const lines = prepared.text.split("\n");
  assert.equal(lines.length, raw.split("\n").length);
  assert.equal(lines[0], "");
  assert.equal(lines[1], "");
  assert.equal(lines[2], "ocr:page:1:line:1: 그레이스홀");
  assert.equal(lines[3], "그래머시 코엑스 연회예약실 T [CONTACT_REDACTED]");
  assert.equal(lines[4], "ocr:page:1:line:2: 대관료 3,300,000원");
  assert.equal(prepared.excluded_ocr_metadata_lines, 2);
  assert.equal(prepared.excluded_contact_lines, 1);
});
