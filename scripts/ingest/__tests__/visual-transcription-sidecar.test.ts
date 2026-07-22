import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalJsonSha256ExcludingField } from "../artifact-integrity.js";
import { CONVERTER_VERSION } from "../convert.js";
import { sha256File, sha256Text, writeJsonFile } from "../io.js";
import { loadValidated } from "../load.js";
import { extractManifestLocally } from "../local-extraction-runner.js";
import { currentLocalExtractionFingerprint } from "../local-extraction-contract.js";
import type { DisclosureExtraction } from "../schemas.js";
import type { IngestManifest } from "../types.js";
import { SCANNER_PARSER_VERSION } from "../scan.js";
import { scoreExtractionAgainstGroundTruth } from "../score.js";
import { getIngestStatus } from "../status.js";
import {
  validateManifest,
  verifyCurrentLocalValidatedArtifactForUnit,
} from "../validate.js";
import {
  approvedVisualTextBlockHash,
  compilePageToImageVisualGroundTruthOverlay,
  importHumanConfirmedVisualGroundTruth,
  loadVisualTranscriptionSidecar,
  mergeVisualTranscriptionSidecar,
  normalizeApprovedVisualText,
  visualTranscriptionEvidenceId,
  visualTranscriptionSidecarPath,
} from "../visual-transcription-sidecar.js";

async function syntheticFixture(t: test.TestContext) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanbang-visual-sidecar-"));
  t.after(async () => rm(temporaryRoot, { recursive: true, force: true }));
  const rootDir = path.join(temporaryRoot, "raw");
  const stateDir = path.join(temporaryRoot, ".state", "fixture");
  const rawPath = path.join(rootDir, "agency", "metro", "synthetic.pdf");
  const unitId = sha256Text("synthetic-visual-unit");
  const sourceFingerprint = sha256Text("synthetic-source-fingerprint");
  const conversionRoot = path.join(stateDir, ".converted", unitId, sourceFingerprint);
  const textPath = path.join(conversionRoot, "1-pdf.txt");
  const imagePath = path.join(conversionRoot, "1-pdf-pages", "page-1.png");
  await Promise.all([
    mkdir(path.dirname(rawPath), { recursive: true }),
    mkdir(path.dirname(textPath), { recursive: true }),
    mkdir(path.dirname(imagePath), { recursive: true }),
  ]);
  await writeFile(rawPath, "synthetic immutable pdf bytes", "utf8");
  await writeFile(textPath, "", "utf8");
  await writeFile(imagePath, "synthetic page raster", "utf8");
  const sourceDigest = await sha256File(rawPath);
  const imageDigest = await sha256File(imagePath);
  const artifactPaths = [textPath, imagePath].sort((left, right) => left.localeCompare(right, "en"));
  const artifactFingerprint = sha256Text((await Promise.all(artifactPaths.map(async (artifactPath) => {
    const digest = await sha256File(artifactPath);
    return `${path.resolve(artifactPath)}\0${digest.sha256}`;
  }))).join("\n"));
  const source = {
    path: "agency/metro/synthetic.pdf",
    absolute_path: rawPath,
    ext: "pdf" as const,
    sha256: sourceDigest.sha256,
    bytes: sourceDigest.bytes,
  };
  const manifest: IngestManifest = {
    schema_version: 1,
    scanner_parser_version: SCANNER_PARSER_VERSION,
    root_dir: rootDir,
    state_dir: stateDir,
    scanned_at: "2026-01-01T00:00:00.000Z",
    units: [{
      unit_id: unitId,
      display_name: "synthetic.pdf",
      parsed: {
        region_code: "metro",
        raw_name: "Synthetic Agency",
        normalized_name: "syntheticagency",
        corporate_name: null,
        kind_hint: "agency",
      },
      source_files: [source],
      source_fingerprint: sourceFingerprint,
      stage: "converted",
      notices: [],
      conversion: {
        converter_version: CONVERTER_VERSION,
        source_fingerprint: sourceFingerprint,
        text_artifacts: [textPath],
        image_artifacts: [imagePath],
        text_characters: 0,
        cell_count: 0,
        artifact_fingerprint: artifactFingerprint,
        converted_at: "2026-01-01T00:00:00.000Z",
      },
    }],
  };
  const sourceFileId = sha256Text(`${source.path}\0${source.sha256}`);
  const evidenceId = visualTranscriptionEvidenceId({
    source_file_id: sourceFileId,
    image_sha256: imageDigest.sha256,
    page: 1,
  });
  const sidecar = {
    schema_version: 1 as const,
    artifact_kind: "visual_transcription_sidecar" as const,
    content_sha256: "0".repeat(64),
    unit_id: unitId,
    source_fingerprint: sourceFingerprint,
    conversion_artifact_fingerprint: artifactFingerprint,
    source_files: [{ path: source.path, sha256: source.sha256, bytes: source.bytes }],
    reviewer: {
      kind: "codex_assisted_unconfirmed" as const,
      recorded_at: "2026-01-01T00:00:00.000Z",
    },
    review_status: "pending" as const,
    needs_review: true as const,
    bulk_approval_eligible: false as const,
    evidence: [{
      evidence_id: evidenceId,
      evidence_kind: "visual_transcription" as const,
      source_file_id: sourceFileId,
      source_sha256: source.sha256,
      source_bytes: source.bytes,
      image_artifact_index: 0,
      image_sha256: imageDigest.sha256,
      image_bytes: imageDigest.bytes,
      page: 1,
    }],
    record_evidence: [{
      record_path: "partner_vendors[0]",
      evidence_ids: [evidenceId],
      source_locators: ["image:1/package"],
    }, {
      record_path: "money_occurrences[0]",
      evidence_ids: [evidenceId],
      source_locators: ["image:1/package"],
    }],
    coverage_gaps: [],
    fragment: {
      doc_kind: "partner_price_list" as const,
      agency_packages: [],
      partner_vendors: [{
        vendor_name: "Synthetic Studio",
        old_names: [],
        category: "studio" as const,
        price_min_krw: 100_000,
        price_max_krw: 100_000,
        base_spec: "Synthetic base package",
        price_note: null,
        options: [],
        policies: [],
        source_quote: "Visual transcription: package 100000 KRW",
        source_file_ids: [sourceFileId],
        confidence: 0.95,
        needs_review: false,
      }],
      halls: [],
      sections: [],
      money_occurrences: [{
        amount_krw: 100_000,
        raw_text: "100000",
        source_quote: "Synthetic package 100000 KRW",
        source_file_ids: [sourceFileId],
        kind: "price" as const,
        needs_review: false,
      }],
    },
    created_at: "2026-01-01T00:00:00.000Z",
  };
  sidecar.content_sha256 = canonicalJsonSha256ExcludingField(sidecar, "content_sha256");
  const sidecarPath = visualTranscriptionSidecarPath(stateDir, manifest.units[0]!);
  await writeJsonFile(sidecarPath, sidecar);
  return { stateDir, manifest, rawPath, sidecarPath, sidecar, imageDigest };
}

function syntheticHumanTextApproval(
  fixture: Awaited<ReturnType<typeof syntheticFixture>>,
) {
  const evidence = fixture.sidecar.evidence[0]!;
  const approvedTextBlocks = [
    ["synthetic-identity", "Synthetic Studio"],
    ["synthetic-base-spec", "Synthetic base package"],
    ["synthetic-source-quote", "Visual transcription: package 100000 KRW"],
    ["synthetic-money-source", "Synthetic package 100000 KRW"],
  ].map(([id, content]) => {
    const block = {
      id: id!,
      source_locator: "image:1/package",
      normalized_content: normalizeApprovedVisualText(content!),
      evidence_id: evidence.evidence_id,
      source_sha256: evidence.source_sha256,
      block_sha256: "0".repeat(64),
    };
    block.block_sha256 = approvedVisualTextBlockHash(block);
    return block;
  });
  return {
    approved_text_blocks: approvedTextBlocks,
    record_field_bindings: [{
      field_path: "doc_kind",
      approved_text_block_id: "synthetic-source-quote",
      binding_kind: "enum_derivation",
    }, {
      field_path: "partner_vendors[0].vendor_name",
      approved_text_block_id: "synthetic-identity",
      binding_kind: "exact",
    }, {
      field_path: "partner_vendors[0].category",
      approved_text_block_id: "synthetic-identity",
      binding_kind: "enum_derivation",
    }, {
      field_path: "partner_vendors[0].base_spec",
      approved_text_block_id: "synthetic-base-spec",
      binding_kind: "exact",
    }, {
      field_path: "partner_vendors[0].source_quote",
      approved_text_block_id: "synthetic-source-quote",
      binding_kind: "exact",
    }, {
      field_path: "money_occurrences[0].raw_text",
      approved_text_block_id: "synthetic-money-source",
      binding_kind: "extractive",
    }, {
      field_path: "money_occurrences[0].source_quote",
      approved_text_block_id: "synthetic-money-source",
      binding_kind: "exact",
    }, {
      field_path: "money_occurrences[0].kind",
      approved_text_block_id: "synthetic-money-source",
      binding_kind: "enum_derivation",
    }],
  } as const;
}

function addSyntheticApprovedPolicyAndSection(
  human: Record<string, unknown>,
  fixture: Awaited<ReturnType<typeof syntheticFixture>>,
): void {
  const evidence = fixture.sidecar.evidence[0]!;
  const reviewer = human.reviewer as {
    approved_text_blocks: Array<Record<string, unknown>>;
    record_field_bindings: Array<Record<string, unknown>>;
  };
  const addBlock = (id: string, content: string): void => {
    const block = {
      id,
      source_locator: "image:1/package",
      normalized_content: normalizeApprovedVisualText(content),
      evidence_id: evidence.evidence_id,
      source_sha256: evidence.source_sha256,
      block_sha256: "0".repeat(64),
    };
    block.block_sha256 = approvedVisualTextBlockHash(block);
    reviewer.approved_text_blocks.push(block);
  };
  addBlock("synthetic-policy", "Cancellation allowed");
  addBlock("synthetic-section-title", "Refund terms");
  reviewer.record_field_bindings.push(
    {
      field_path: "partner_vendors[0].policies[0].policy_type",
      approved_text_block_id: "synthetic-policy",
      binding_kind: "enum_derivation",
    },
    {
      field_path: "partner_vendors[0].policies[0].raw_text",
      approved_text_block_id: "synthetic-policy",
      binding_kind: "exact",
    },
    {
      field_path: "partner_vendors[0].policies[0].source_quote",
      approved_text_block_id: "synthetic-policy",
      binding_kind: "exact",
    },
    {
      field_path: "sections[0].section_type",
      approved_text_block_id: "synthetic-section-title",
      binding_kind: "enum_derivation",
    },
    {
      field_path: "sections[0].title",
      approved_text_block_id: "synthetic-section-title",
      binding_kind: "exact",
    },
    {
      field_path: "sections[0].content_verbatim",
      approved_text_block_id: "synthetic-policy",
      binding_kind: "exact",
    },
    {
      field_path: "sections[0].summary",
      approved_text_block_id: "synthetic-policy",
      binding_kind: "exact",
    },
    {
      field_path: "sections[0].source_quote",
      approved_text_block_id: "synthetic-policy",
      binding_kind: "exact",
    },
  );
  const fragment = human.fragment as {
    partner_vendors: Array<{ policies: unknown[] }>;
    sections: unknown[];
  };
  fragment.partner_vendors[0]!.policies = [{
    policy_type: "refund",
    raw_text: "Cancellation allowed",
    source_quote: "Cancellation allowed",
    source_file_ids: [evidence.source_file_id],
  }];
  fragment.sections = [{
    section_type: "refund_policy",
    title: "Refund terms",
    content_verbatim: "Cancellation allowed",
    summary: "Cancellation allowed",
    source_quote: "Cancellation allowed",
    source_file_ids: [evidence.source_file_id],
    confidence: 0.89,
    needs_review: true,
  }];
  const recordEvidence = human.record_evidence as Array<{
    record_path: string;
    evidence_ids: string[];
    source_locators: string[];
  }>;
  recordEvidence.push({
    record_path: "partner_vendors[0].policies[0]",
    evidence_ids: [evidence.evidence_id],
    source_locators: ["image:1/package"],
  }, {
    record_path: "sections[0]",
    evidence_ids: [evidence.evidence_id],
    source_locators: ["image:1/package"],
  });
}

async function promoteSyntheticFixtureToHuman(
  fixture: Awaited<ReturnType<typeof syntheticFixture>>,
): Promise<Record<string, unknown>> {
  const overlayPath = path.join(fixture.stateDir, "ground-truth", "synthetic-overlay.json");
  await writeJsonFile(overlayPath, {
    schema_version: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    units: [{
      unit_id: fixture.manifest.units[0]!.unit_id,
      readable_occurrences: [{
        raw: "100000",
        krw: 100_000,
        line_context: "Synthetic package 100000 KRW",
        source_locator: "image:1/package",
      }],
      unreadable_cells: [],
      expectations: {
        doc_kinds: ["partner_price_list"],
        allowed_partner_categories: ["studio"],
        policies: false,
        pricing_basis: false,
        sections: false,
        halls_min: 0,
      },
    }],
  });
  const overlayDigest = await sha256File(overlayPath);
  const imported = await importHumanConfirmedVisualGroundTruth({
    stateDir: fixture.stateDir,
    overlayPath,
    expectedSourceGroundTruthSha256: overlayDigest.sha256,
    unitId: fixture.manifest.units[0]!.unit_id,
    approvalReference: "synthetic-user-approval",
  });
  const human = structuredClone(fixture.sidecar) as Record<string, unknown>;
  human.reviewer = {
    kind: "human_confirmed",
    recorded_at: "2026-01-01T00:00:00.000Z",
    confirmation: imported.confirmation,
    ...syntheticHumanTextApproval(fixture),
  };
  human.content_sha256 = canonicalJsonSha256ExcludingField(human, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, human);
  return human;
}

test("human confirmation rejects an invented vendor name even when money remains correct", async (t) => {
  const fixture = await syntheticFixture(t);
  const human = await promoteSyntheticFixtureToHuman(fixture);
  const fragment = human.fragment as {
    partner_vendors: Array<{ vendor_name: string }>;
  };
  fragment.partner_vendors[0]!.vendor_name = "Invented Studio";
  human.content_sha256 = canonicalJsonSha256ExcludingField(human, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, human);

  await assert.rejects(
    loadVisualTranscriptionSidecar({
      stateDir: fixture.stateDir,
      manifest: fixture.manifest,
      unitId: fixture.manifest.units[0]!.unit_id,
    }),
    /visual_transcription_human_text_field_not_approved:partner_vendors\[0\]\.vendor_name/u,
  );
});

test("human confirmation accepts NFKC and whitespace-equivalent approved text", async (t) => {
  const fixture = await syntheticFixture(t);
  const human = await promoteSyntheticFixtureToHuman(fixture);
  const fragment = human.fragment as {
    partner_vendors: Array<{ vendor_name: string }>;
  };
  fragment.partner_vendors[0]!.vendor_name = "Synthetic\u3000Studio";
  human.content_sha256 = canonicalJsonSha256ExcludingField(human, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, human);

  const loaded = await loadVisualTranscriptionSidecar({
    stateDir: fixture.stateDir,
    manifest: fixture.manifest,
    unitId: fixture.manifest.units[0]!.unit_id,
  });
  assert.equal(loaded?.reviewer.kind, "human_confirmed");
});

test("human confirmation rejects encoding corruption in an otherwise bound field", async (t) => {
  const fixture = await syntheticFixture(t);
  const human = await promoteSyntheticFixtureToHuman(fixture);
  const fragment = human.fragment as {
    partner_vendors: Array<{ base_spec: string }>;
  };
  fragment.partner_vendors[0]!.base_spec = "????";
  human.content_sha256 = canonicalJsonSha256ExcludingField(human, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, human);

  await assert.rejects(
    loadVisualTranscriptionSidecar({
      stateDir: fixture.stateDir,
      manifest: fixture.manifest,
      unitId: fixture.manifest.units[0]!.unit_id,
    }),
    /visual_transcription_human_text_encoding_corruption:partner_vendors\[0\]\.base_spec/u,
  );
});

test("human confirmation rejects an invented source quote with correct money", async (t) => {
  const fixture = await syntheticFixture(t);
  const human = await promoteSyntheticFixtureToHuman(fixture);
  const fragment = human.fragment as {
    partner_vendors: Array<{ source_quote: string }>;
  };
  fragment.partner_vendors[0]!.source_quote = "Invented but numerically correct package 100000 KRW";
  human.content_sha256 = canonicalJsonSha256ExcludingField(human, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, human);

  await assert.rejects(
    loadVisualTranscriptionSidecar({
      stateDir: fixture.stateDir,
      manifest: fixture.manifest,
      unitId: fixture.manifest.units[0]!.unit_id,
    }),
    /visual_transcription_human_text_field_not_approved:partner_vendors\[0\]\.source_quote/u,
  );
});

test("human confirmation rejects invented policy text with correct money", async (t) => {
  const fixture = await syntheticFixture(t);
  const human = await promoteSyntheticFixtureToHuman(fixture);
  addSyntheticApprovedPolicyAndSection(human, fixture);
  const fragment = human.fragment as {
    partner_vendors: Array<{ policies: Array<{ raw_text: string }> }>;
  };
  fragment.partner_vendors[0]!.policies[0]!.raw_text = "Invented cancellation policy";
  human.content_sha256 = canonicalJsonSha256ExcludingField(human, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, human);

  await assert.rejects(
    loadVisualTranscriptionSidecar({
      stateDir: fixture.stateDir,
      manifest: fixture.manifest,
      unitId: fixture.manifest.units[0]!.unit_id,
    }),
    /visual_transcription_human_text_field_not_approved:partner_vendors\[0\]\.policies\[0\]\.raw_text/u,
  );
});

test("human confirmation rejects invented section verbatim text with correct money", async (t) => {
  const fixture = await syntheticFixture(t);
  const human = await promoteSyntheticFixtureToHuman(fixture);
  addSyntheticApprovedPolicyAndSection(human, fixture);
  const fragment = human.fragment as {
    sections: Array<{ content_verbatim: string }>;
  };
  fragment.sections[0]!.content_verbatim = "Invented refund section";
  human.content_sha256 = canonicalJsonSha256ExcludingField(human, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, human);

  await assert.rejects(
    loadVisualTranscriptionSidecar({
      stateDir: fixture.stateDir,
      manifest: fixture.manifest,
      unitId: fixture.manifest.units[0]!.unit_id,
    }),
    /visual_transcription_human_text_field_not_approved:sections\[0\]\.content_verbatim/u,
  );
});

test("an approved human-confirmed sidecar loads and merges through the public path", async (t) => {
  const fixture = await syntheticFixture(t);
  await promoteSyntheticFixtureToHuman(fixture);
  const loaded = await loadVisualTranscriptionSidecar({
    stateDir: fixture.stateDir,
    manifest: fixture.manifest,
    unitId: fixture.manifest.units[0]!.unit_id,
  });
  assert.ok(loaded);
  const merged = mergeVisualTranscriptionSidecar(emptyExtraction(), loaded);
  assert.equal(merged.data.partner_vendors[0]?.vendor_name, "Synthetic Studio");
  assert.equal(merged.review_status, "pending");
  assert.equal(merged.publish_allowed, false);
});

function emptyExtraction(): DisclosureExtraction {
  return {
    doc_kind: "unknown",
    business_name: "Synthetic Agency",
    region_hint: "metro",
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
    extraction_notes: "",
  };
}

test("a fully bound unconfirmed visual sidecar loads and merges as pending review only", async (t) => {
  const fixture = await syntheticFixture(t);

  const loaded = await loadVisualTranscriptionSidecar({
    stateDir: fixture.stateDir,
    manifest: fixture.manifest,
    unitId: fixture.manifest.units[0]!.unit_id,
  });
  assert.ok(loaded);
  assert.deepEqual(loaded.validation_issue_codes, [
    "visual_transcription_requires_human_confirmation",
  ]);
  assert.equal(loaded.evidence[0]?.image_sha256, fixture.imageDigest.sha256);
  assert.equal(loaded.evidence[0]?.page, 1);
  assert.equal(loaded.evidence[0]?.evidence_kind, "visual_transcription");

  const merged = mergeVisualTranscriptionSidecar(emptyExtraction(), loaded);
  assert.equal(merged.review_status, "pending");
  assert.equal(merged.needs_review, true);
  assert.equal(merged.bulk_approval_eligible, false);
  assert.equal(merged.publish_allowed, false);
  assert.equal(merged.data.partner_vendors[0]?.vendor_name, "Synthetic Studio");
  assert.equal(merged.data.partner_vendors[0]?.needs_review, true);
  assert.ok((merged.data.partner_vendors[0]?.confidence ?? 1) <= 0.5);
});

test("sidecar content tampering is rejected", async (t) => {
  const fixture = await syntheticFixture(t);
  const raw = JSON.parse(await readFile(fixture.sidecarPath, "utf8")) as Record<string, unknown>;
  raw.created_at = "2026-01-02T00:00:00.000Z";
  await writeJsonFile(fixture.sidecarPath, raw);

  await assert.rejects(
    loadVisualTranscriptionSidecar({
      stateDir: fixture.stateDir,
      manifest: fixture.manifest,
      unitId: fixture.manifest.units[0]!.unit_id,
    }),
    /artifact content hash does not match/u,
  );
});

test("a self-consistent forged page-image SHA-256 is rejected against the conversion artifact", async (t) => {
  const fixture = await syntheticFixture(t);
  const forged = structuredClone(fixture.sidecar);
  const evidence = forged.evidence[0]!;
  evidence.image_sha256 = sha256Text("forged-page-image");
  evidence.evidence_id = visualTranscriptionEvidenceId(evidence);
  for (const binding of forged.record_evidence) {
    binding.evidence_ids = [evidence.evidence_id];
  }
  forged.content_sha256 = canonicalJsonSha256ExcludingField(forged, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, forged);

  await assert.rejects(
    loadVisualTranscriptionSidecar({
      stateDir: fixture.stateDir,
      manifest: fixture.manifest,
      unitId: fixture.manifest.units[0]!.unit_id,
    }),
    /visual_transcription_page_image_changed/u,
  );
});

test("a source file changed after the sidecar was recorded is rejected", async (t) => {
  const fixture = await syntheticFixture(t);
  await writeFile(fixture.rawPath, "changed source bytes", "utf8");

  await assert.rejects(
    loadVisualTranscriptionSidecar({
      stateDir: fixture.stateDir,
      manifest: fixture.manifest,
      unitId: fixture.manifest.units[0]!.unit_id,
    }),
    /visual_transcription_source_changed/u,
  );
});

test("OCR evidence cannot masquerade as a visual transcription", async (t) => {
  const fixture = await syntheticFixture(t);
  const masquerade = structuredClone(fixture.sidecar) as Record<string, unknown>;
  const evidence = (masquerade.evidence as Array<Record<string, unknown>>)[0]!;
  evidence.evidence_kind = "ocr";
  masquerade.content_sha256 = canonicalJsonSha256ExcludingField(masquerade, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, masquerade);

  await assert.rejects(
    loadVisualTranscriptionSidecar({
      stateDir: fixture.stateDir,
      manifest: fixture.manifest,
      unitId: fixture.manifest.units[0]!.unit_id,
    }),
    /visual_transcription_sidecar_schema_invalid/u,
  );
});

test("an unconfirmed sidecar cannot opt into bulk approval", async (t) => {
  const fixture = await syntheticFixture(t);
  const attempted = structuredClone(fixture.sidecar) as Record<string, unknown>;
  attempted.bulk_approval_eligible = true;
  attempted.content_sha256 = canonicalJsonSha256ExcludingField(attempted, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, attempted);

  await assert.rejects(
    loadVisualTranscriptionSidecar({
      stateDir: fixture.stateDir,
      manifest: fixture.manifest,
      unitId: fixture.manifest.units[0]!.unit_id,
    }),
    /visual_transcription_sidecar_schema_invalid/u,
  );
});

test("the deterministic sidecar path cannot be redirected by a symlink", async (t) => {
  const fixture = await syntheticFixture(t);
  const outsidePath = path.join(path.dirname(fixture.stateDir), "outside-sidecar.json");
  await writeFile(outsidePath, await readFile(fixture.sidecarPath));
  await rm(fixture.sidecarPath);
  try {
    await symlink(outsidePath, fixture.sidecarPath, "file");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    if (["EACCES", "ENOSYS", "EPERM", "UNKNOWN"].includes(code)) {
      t.skip(`symlink creation unavailable: ${code}`);
      return;
    }
    throw error;
  }

  await assert.rejects(
    loadVisualTranscriptionSidecar({
      stateDir: fixture.stateDir,
      manifest: fixture.manifest,
      unitId: fixture.manifest.units[0]!.unit_id,
    }),
    /artifact path must not contain a symbolic link/u,
  );
});

test("human confirmation is imported from a hash-bound exact overlay unit entry", async (t) => {
  const fixture = await syntheticFixture(t);
  const overlayPath = path.join(fixture.stateDir, "ground-truth", "synthetic-overlay.json");
  await writeJsonFile(overlayPath, {
    schema_version: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    units: [{
      unit_id: fixture.manifest.units[0]!.unit_id,
      readable_occurrences: [{
        raw: "100000",
        krw: 100_000,
        line_context: "Synthetic package 100000 KRW",
        source_locator: "image:1/package",
      }],
      unreadable_cells: [],
      expectations: {
        doc_kinds: ["partner_price_list"],
        allowed_partner_categories: ["studio"],
        policies: false,
        pricing_basis: false,
        sections: false,
        halls_min: 0,
      },
    }],
  });
  const overlayDigest = await sha256File(overlayPath);
  const imported = await importHumanConfirmedVisualGroundTruth({
    stateDir: fixture.stateDir,
    overlayPath,
    expectedSourceGroundTruthSha256: overlayDigest.sha256,
    unitId: fixture.manifest.units[0]!.unit_id,
    approvalReference: "synthetic-user-approval",
  });
  assert.equal(imported.entry.readable_occurrences[0]?.krw, 100_000);

  const human = structuredClone(fixture.sidecar) as Record<string, unknown>;
  human.reviewer = {
    kind: "human_confirmed",
    recorded_at: "2026-01-01T00:00:00.000Z",
    confirmation: imported.confirmation,
    ...syntheticHumanTextApproval(fixture),
  };
  human.content_sha256 = canonicalJsonSha256ExcludingField(human, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, human);

  const loaded = await loadVisualTranscriptionSidecar({
    stateDir: fixture.stateDir,
    manifest: fixture.manifest,
    unitId: fixture.manifest.units[0]!.unit_id,
  });
  assert.ok(loaded);
  assert.equal(loaded.reviewer.kind, "human_confirmed");
  assert.deepEqual(loaded.validation_issue_codes, [
    "visual_transcription_human_confirmed_pending_admin_review",
  ]);
  assert.equal(loaded.bulk_approval_eligible, false);
});

test("a ground-truth overlay outside the designated state directory is rejected", async (t) => {
  const fixture = await syntheticFixture(t);
  const outsidePath = path.join(path.dirname(fixture.stateDir), "outside-overlay.json");
  await writeJsonFile(outsidePath, {
    schema_version: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    units: [],
  });
  const digest = await sha256File(outsidePath);

  await assert.rejects(
    importHumanConfirmedVisualGroundTruth({
      stateDir: fixture.stateDir,
      overlayPath: outsidePath,
      expectedSourceGroundTruthSha256: digest.sha256,
      unitId: fixture.manifest.units[0]!.unit_id,
      approvalReference: "synthetic-user-approval",
    }),
    /visual_transcription_ground_truth_outside_state/u,
  );
});

test("human confirmation rejects a structured amount invented outside the overlay", async (t) => {
  const fixture = await syntheticFixture(t);
  const human = await promoteSyntheticFixtureToHuman(fixture);
  const fragment = human.fragment as {
    partner_vendors: Array<{ price_min_krw: number; price_max_krw: number }>;
  };
  fragment.partner_vendors[0]!.price_min_krw = 999_000;
  fragment.partner_vendors[0]!.price_max_krw = 999_000;
  human.content_sha256 = canonicalJsonSha256ExcludingField(human, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, human);

  await assert.rejects(
    loadVisualTranscriptionSidecar({
      stateDir: fixture.stateDir,
      manifest: fixture.manifest,
      unitId: fixture.manifest.units[0]!.unit_id,
    }),
    /visual_transcription_human_structured_amount_not_grounded/u,
  );
});

test("human confirmation rejects a forged money occurrence amount", async (t) => {
  const fixture = await syntheticFixture(t);
  const human = await promoteSyntheticFixtureToHuman(fixture);
  const fragment = human.fragment as {
    money_occurrences: Array<{ amount_krw: number }>;
  };
  fragment.money_occurrences[0]!.amount_krw = 999_000;
  human.content_sha256 = canonicalJsonSha256ExcludingField(human, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, human);

  await assert.rejects(
    loadVisualTranscriptionSidecar({
      stateDir: fixture.stateDir,
      manifest: fixture.manifest,
      unitId: fixture.manifest.units[0]!.unit_id,
    }),
    /visual_transcription_human_money_occurrence_mismatch/u,
  );
});

test("human confirmation rejects a readable overlay occurrence omitted from the fragment", async (t) => {
  const fixture = await syntheticFixture(t);
  const human = await promoteSyntheticFixtureToHuman(fixture);
  const fragment = human.fragment as { money_occurrences: unknown[] };
  fragment.money_occurrences = [];
  human.record_evidence = (human.record_evidence as Array<{ record_path: string }>)
    .filter((binding) => binding.record_path !== "money_occurrences[0]");
  human.content_sha256 = canonicalJsonSha256ExcludingField(human, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, human);

  await assert.rejects(
    loadVisualTranscriptionSidecar({
      stateDir: fixture.stateDir,
      manifest: fixture.manifest,
      unitId: fixture.manifest.units[0]!.unit_id,
    }),
    /visual_transcription_human_money_occurrence_mismatch/u,
  );
});

test("human confirmation rejects an extra duplicate occurrence", async (t) => {
  const fixture = await syntheticFixture(t);
  const human = await promoteSyntheticFixtureToHuman(fixture);
  const fragment = human.fragment as { money_occurrences: unknown[] };
  fragment.money_occurrences.push(structuredClone(fragment.money_occurrences[0]));
  const bindings = human.record_evidence as Array<{
    record_path: string;
    evidence_ids: string[];
    source_locators: string[];
  }>;
  const originalBinding = bindings.find((binding) => binding.record_path === "money_occurrences[0]")!;
  bindings.push({ ...structuredClone(originalBinding), record_path: "money_occurrences[1]" });
  human.content_sha256 = canonicalJsonSha256ExcludingField(human, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, human);

  await assert.rejects(
    loadVisualTranscriptionSidecar({
      stateDir: fixture.stateDir,
      manifest: fixture.manifest,
      unitId: fixture.manifest.units[0]!.unit_id,
    }),
    /visual_transcription_human_money_occurrence_mismatch/u,
  );
});

test("human confirmation rejects a structured amount attached to the wrong visual locator", async (t) => {
  const fixture = await syntheticFixture(t);
  const human = await promoteSyntheticFixtureToHuman(fixture);
  const binding = (human.record_evidence as Array<{
    record_path: string;
    source_locators: string[];
  }>).find((candidate) => candidate.record_path === "partner_vendors[0]")!;
  binding.source_locators = ["image:1/different-package"];
  human.content_sha256 = canonicalJsonSha256ExcludingField(human, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, human);

  await assert.rejects(
    loadVisualTranscriptionSidecar({
      stateDir: fixture.stateDir,
      manifest: fixture.manifest,
      unitId: fixture.manifest.units[0]!.unit_id,
    }),
    /visual_transcription_human_structured_amount_not_grounded/u,
  );
});

test("human confirmation rejects a fragment that misses overlay semantic expectations", async (t) => {
  const fixture = await syntheticFixture(t);
  const human = await promoteSyntheticFixtureToHuman(fixture);
  const overlayPath = path.join(fixture.stateDir, "ground-truth", "synthetic-overlay.json");
  const overlay = JSON.parse(await readFile(overlayPath, "utf8")) as {
    units: Array<{ expectations: { policies: boolean } }>;
  };
  overlay.units[0]!.expectations.policies = true;
  await writeJsonFile(overlayPath, overlay);
  const overlayDigest = await sha256File(overlayPath);
  const imported = await importHumanConfirmedVisualGroundTruth({
    stateDir: fixture.stateDir,
    overlayPath,
    expectedSourceGroundTruthSha256: overlayDigest.sha256,
    unitId: fixture.manifest.units[0]!.unit_id,
    approvalReference: "synthetic-user-approval",
  });
  const reviewer = human.reviewer as { confirmation: unknown };
  reviewer.confirmation = imported.confirmation;
  human.content_sha256 = canonicalJsonSha256ExcludingField(human, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, human);

  await assert.rejects(
    loadVisualTranscriptionSidecar({
      stateDir: fixture.stateDir,
      manifest: fixture.manifest,
      unitId: fixture.manifest.units[0]!.unit_id,
    }),
    /visual_transcription_human_expectation_miss:policies/u,
  );
});

test("human-confirmed agency disclosure may have zero partner vendors when an agency package is grounded", async (t) => {
  const fixture = await syntheticFixture(t);
  const human = await promoteSyntheticFixtureToHuman(fixture);
  const overlayPath = path.join(fixture.stateDir, "ground-truth", "synthetic-overlay.json");
  const overlay = JSON.parse(await readFile(overlayPath, "utf8")) as {
    units: Array<{ expectations: { doc_kinds: string[] } }>;
  };
  overlay.units[0]!.expectations.doc_kinds = ["agency_disclosure"];
  await writeJsonFile(overlayPath, overlay);
  const overlayDigest = await sha256File(overlayPath);
  const imported = await importHumanConfirmedVisualGroundTruth({
    stateDir: fixture.stateDir,
    overlayPath,
    expectedSourceGroundTruthSha256: overlayDigest.sha256,
    unitId: fixture.manifest.units[0]!.unit_id,
    approvalReference: "synthetic-user-approval",
  });
  (human.reviewer as { confirmation: unknown }).confirmation = imported.confirmation;
  const fragment = human.fragment as {
    doc_kind: string;
    agency_packages: unknown[];
    partner_vendors: Array<Record<string, unknown>>;
  };
  const partner = fragment.partner_vendors[0]!;
  fragment.doc_kind = "agency_disclosure";
  fragment.partner_vendors = [];
  fragment.agency_packages = [{
    package_name: "Synthetic agency package",
    category_scope: ["studio"],
    price_min_krw: partner.price_min_krw,
    price_max_krw: partner.price_max_krw,
    vat_note: null,
    price_note: null,
    options: [],
    source_quote: partner.source_quote,
    source_file_ids: partner.source_file_ids,
    confidence: partner.confidence,
    needs_review: true,
  }];
  const bindings = human.record_evidence as Array<{
    record_path: string;
    evidence_ids: string[];
    source_locators: string[];
  }>;
  const partnerBinding = bindings.find((binding) => (
    binding.record_path === "partner_vendors[0]"
  ))!;
  human.record_evidence = [
    ...bindings.filter((binding) => binding.record_path !== "partner_vendors[0]"),
    { ...partnerBinding, record_path: "agency_packages[0]" },
  ];
  const reviewer = human.reviewer as {
    approved_text_blocks: Array<{
      id: string;
      source_locator: string;
      normalized_content: string;
      evidence_id: string;
      source_sha256: string;
      block_sha256: string;
    }>;
    record_field_bindings: Array<{
      field_path: string;
      approved_text_block_id: string;
      binding_kind: string;
    }>;
  };
  reviewer.approved_text_blocks = reviewer.approved_text_blocks.filter((block) => (
    !["synthetic-identity", "synthetic-base-spec"].includes(block.id)
  ));
  const packageBlock = {
    id: "synthetic-agency-package",
    source_locator: "image:1/package",
    normalized_content: normalizeApprovedVisualText("Synthetic agency package"),
    evidence_id: fixture.sidecar.evidence[0]!.evidence_id,
    source_sha256: fixture.sidecar.evidence[0]!.source_sha256,
    block_sha256: "0".repeat(64),
  };
  packageBlock.block_sha256 = approvedVisualTextBlockHash(packageBlock);
  reviewer.approved_text_blocks.push(packageBlock);
  reviewer.record_field_bindings = [
    ...reviewer.record_field_bindings.filter((binding) => (
      !binding.field_path.startsWith("partner_vendors[0].")
    )),
    {
      field_path: "agency_packages[0].package_name",
      approved_text_block_id: packageBlock.id,
      binding_kind: "exact",
    },
    {
      field_path: "agency_packages[0].category_scope[0]",
      approved_text_block_id: packageBlock.id,
      binding_kind: "enum_derivation",
    },
    {
      field_path: "agency_packages[0].source_quote",
      approved_text_block_id: "synthetic-source-quote",
      binding_kind: "exact",
    },
  ];
  human.content_sha256 = canonicalJsonSha256ExcludingField(human, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, human);

  const loaded = await loadVisualTranscriptionSidecar({
    stateDir: fixture.stateDir,
    manifest: fixture.manifest,
    unitId: fixture.manifest.units[0]!.unit_id,
  });
  assert.equal(loaded?.fragment.partner_vendors.length, 0);
  assert.equal(loaded?.fragment.agency_packages.length, 1);
});

test("human-confirmed agency disclosure cannot use zero partners to bypass package expectations", async (t) => {
  const fixture = await syntheticFixture(t);
  const human = await promoteSyntheticFixtureToHuman(fixture);
  const overlayPath = path.join(fixture.stateDir, "ground-truth", "synthetic-overlay.json");
  const overlay = JSON.parse(await readFile(overlayPath, "utf8")) as {
    units: Array<{ expectations: { doc_kinds: string[] } }>;
  };
  overlay.units[0]!.expectations.doc_kinds = ["agency_disclosure"];
  await writeJsonFile(overlayPath, overlay);
  const overlayDigest = await sha256File(overlayPath);
  const imported = await importHumanConfirmedVisualGroundTruth({
    stateDir: fixture.stateDir,
    overlayPath,
    expectedSourceGroundTruthSha256: overlayDigest.sha256,
    unitId: fixture.manifest.units[0]!.unit_id,
    approvalReference: "synthetic-user-approval",
  });
  (human.reviewer as { confirmation: unknown }).confirmation = imported.confirmation;
  const fragment = human.fragment as {
    doc_kind: string;
    agency_packages: unknown[];
    partner_vendors: unknown[];
  };
  fragment.doc_kind = "agency_disclosure";
  fragment.partner_vendors = [];
  fragment.agency_packages = [];
  human.record_evidence = (human.record_evidence as Array<{ record_path: string }>)
    .filter((binding) => binding.record_path !== "partner_vendors[0]");
  human.content_sha256 = canonicalJsonSha256ExcludingField(human, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, human);

  await assert.rejects(
    loadVisualTranscriptionSidecar({
      stateDir: fixture.stateDir,
      manifest: fixture.manifest,
      unitId: fixture.manifest.units[0]!.unit_id,
    }),
    /visual_transcription_human_expectation_miss:agency_packages/u,
  );
});

test("human confirmation rejects coverage gaps that do not exactly match overlay unreadable cells", async (t) => {
  const fixture = await syntheticFixture(t);
  const human = await promoteSyntheticFixtureToHuman(fixture);
  const overlayPath = path.join(fixture.stateDir, "ground-truth", "synthetic-overlay.json");
  const overlay = JSON.parse(await readFile(overlayPath, "utf8")) as {
    units: Array<{ unreadable_cells: unknown[] }>;
  };
  overlay.units[0]!.unreadable_cells = [{
    source_locator: "image:1/unreadable-cell",
    visible_amounts_krw: [77_000],
    estimated_content: "Synthetic unreadable option",
    reason: "Synthetic unit marker is unreadable",
  }];
  await writeJsonFile(overlayPath, overlay);
  const overlayDigest = await sha256File(overlayPath);
  const imported = await importHumanConfirmedVisualGroundTruth({
    stateDir: fixture.stateDir,
    overlayPath,
    expectedSourceGroundTruthSha256: overlayDigest.sha256,
    unitId: fixture.manifest.units[0]!.unit_id,
    approvalReference: "synthetic-user-approval",
  });
  (human.reviewer as { confirmation: unknown }).confirmation = imported.confirmation;
  human.content_sha256 = canonicalJsonSha256ExcludingField(human, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, human);

  await assert.rejects(
    loadVisualTranscriptionSidecar({
      stateDir: fixture.stateDir,
      manifest: fixture.manifest,
      unitId: fixture.manifest.units[0]!.unit_id,
    }),
    /visual_transcription_human_coverage_gaps_mismatch/u,
  );
});

test("human confirmation rejects an extra money gap not linked to an approved occurrence", async (t) => {
  const fixture = await syntheticFixture(t);
  const human = await promoteSyntheticFixtureToHuman(fixture);
  human.coverage_gaps = [{
    evidence_id: fixture.sidecar.evidence[0]!.evidence_id,
    source_locator: "image:1/not-an-approved-occurrence",
    visible_amounts_krw: [999_000],
    estimated_content: "Unlinked synthetic amount",
    reason: "Must not create an ungrounded coverage exception",
  }];
  human.content_sha256 = canonicalJsonSha256ExcludingField(human, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, human);

  await assert.rejects(
    loadVisualTranscriptionSidecar({
      stateDir: fixture.stateDir,
      manifest: fixture.manifest,
      unitId: fixture.manifest.units[0]!.unit_id,
    }),
    /visual_transcription_human_coverage_gap_not_grounded/u,
  );
});

test("unconfirmed transcription never inherits the human overlay assertion", async (t) => {
  const fixture = await syntheticFixture(t);
  const unconfirmed = structuredClone(fixture.sidecar);
  unconfirmed.fragment.partner_vendors[0]!.price_min_krw = 999_000;
  unconfirmed.fragment.partner_vendors[0]!.price_max_krw = 999_000;
  unconfirmed.content_sha256 = canonicalJsonSha256ExcludingField(
    unconfirmed,
    "content_sha256",
  );
  await writeJsonFile(fixture.sidecarPath, unconfirmed);

  const loaded = await loadVisualTranscriptionSidecar({
    stateDir: fixture.stateDir,
    manifest: fixture.manifest,
    unitId: fixture.manifest.units[0]!.unit_id,
  });
  assert.ok(loaded);
  assert.equal(loaded.reviewer.kind, "codex_assisted_unconfirmed");
  assert.deepEqual(loaded.validation_issue_codes, [
    "visual_transcription_requires_human_confirmation",
  ]);
  const merged = mergeVisualTranscriptionSidecar(emptyExtraction(), loaded);
  assert.equal(merged.review_status, "pending");
  assert.equal(merged.bulk_approval_eligible, false);
  assert.equal(merged.publish_allowed, false);
});

test("local extraction, validation, replay, and load preserve a verified visual fragment", async (t) => {
  const fixture = await syntheticFixture(t);
  await writeJsonFile(path.join(fixture.stateDir, "manifest.json"), fixture.manifest);

  const extractionRun = await extractManifestLocally({
    stateDir: fixture.stateDir,
    unitIds: [fixture.manifest.units[0]!.unit_id],
  });
  assert.equal(extractionRun.failed_units, 0);
  assert.equal(
    extractionRun.manifest.units[0]?.local_extraction?.visual_transcription?.content_sha256,
    fixture.sidecar.content_sha256,
  );

  const validatedManifest = await validateManifest({ stateDir: fixture.stateDir });
  const unit = validatedManifest.units[0]!;
  assert.equal(unit.stage, "validated", JSON.stringify(unit.notices));
  const artifact = await verifyCurrentLocalValidatedArtifactForUnit(
    unit,
    validatedManifest,
    fixture.stateDir,
  );
  assert.equal(artifact.data.partner_vendors[0]?.vendor_name, "Synthetic Studio");
  assert.ok(artifact.issues.some((issue) => (
    issue.code === "visual_transcription_requires_human_confirmation"
  )));
  assert.equal(artifact.bulk_approval_eligible, false);

  const loaded = await loadValidated({
    stateDir: fixture.stateDir,
    snapshot: "2026Q3",
    apply: false,
  });
  assert.ok(loaded.plan.official_prices.some((row) => row.vendor_name === "Synthetic Studio"));
  assert.ok(loaded.plan.official_prices.every((row) => row.review_status === "pending"));
});

test("sidecar absence preserves the pre-sidecar local fingerprint and validation result", async (t) => {
  const fixture = await syntheticFixture(t);
  await rm(fixture.sidecarPath);
  await writeJsonFile(path.join(fixture.stateDir, "manifest.json"), fixture.manifest);

  const baseFingerprint = currentLocalExtractionFingerprint({
    scannerParserVersion: fixture.manifest.scanner_parser_version,
    converterVersion: fixture.manifest.units[0]!.conversion!.converter_version ?? "v1-legacy",
    rawName: fixture.manifest.units[0]!.parsed.raw_name,
    regionCode: fixture.manifest.units[0]!.parsed.region_code,
    kindHint: fixture.manifest.units[0]!.parsed.kind_hint,
    sourceFingerprint: fixture.manifest.units[0]!.source_fingerprint,
    artifactFingerprint: fixture.manifest.units[0]!.conversion!.artifact_fingerprint,
  });
  const extractionRun = await extractManifestLocally({
    stateDir: fixture.stateDir,
    unitIds: [fixture.manifest.units[0]!.unit_id],
  });
  const extracted = extractionRun.manifest.units[0]!;
  assert.equal(extracted.local_extraction?.fingerprint, baseFingerprint);
  assert.equal(extracted.local_extraction?.visual_transcription, undefined);

  const validated = await validateManifest({ stateDir: fixture.stateDir });
  const artifact = await verifyCurrentLocalValidatedArtifactForUnit(
    validated.units[0]!,
    validated,
    fixture.stateDir,
  );
  assert.equal(artifact.visual_transcription, undefined);
  assert.equal(artifact.data.partner_vendors.some((row) => (
    row.vendor_name === "Synthetic Studio"
  )), false);
  assert.equal(artifact.issues.some((issue) => (
    issue.code.startsWith("visual_transcription_")
  )), false);
});

test("sidecar deletion after extraction invalidates validation instead of falling back", async (t) => {
  const fixture = await syntheticFixture(t);
  await writeJsonFile(path.join(fixture.stateDir, "manifest.json"), fixture.manifest);
  await extractManifestLocally({
    stateDir: fixture.stateDir,
    unitIds: [fixture.manifest.units[0]!.unit_id],
  });
  await rm(fixture.sidecarPath);

  const validated = await validateManifest({ stateDir: fixture.stateDir });
  assert.equal(validated.units[0]?.stage, "error");
  assert.ok(validated.units[0]?.notices.some((notice) => (
    notice.includes("local_extraction_cache_manifest_identity_mismatch")
  )));
});

test("self-consistent sidecar tampering after validation invalidates replay and load", async (t) => {
  const fixture = await syntheticFixture(t);
  await writeJsonFile(path.join(fixture.stateDir, "manifest.json"), fixture.manifest);
  await extractManifestLocally({
    stateDir: fixture.stateDir,
    unitIds: [fixture.manifest.units[0]!.unit_id],
  });
  const validated = await validateManifest({ stateDir: fixture.stateDir });

  const tampered = JSON.parse(await readFile(fixture.sidecarPath, "utf8")) as Record<string, unknown>;
  const fragment = tampered.fragment as { partner_vendors: Array<{ vendor_name: string }> };
  fragment.partner_vendors[0]!.vendor_name = "Tampered Studio";
  tampered.content_sha256 = canonicalJsonSha256ExcludingField(tampered, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, tampered);

  await assert.rejects(
    verifyCurrentLocalValidatedArtifactForUnit(
      validated.units[0]!,
      validated,
      fixture.stateDir,
    ),
    /local_extraction_cache_manifest_identity_mismatch/u,
  );
  await assert.rejects(
    loadValidated({ stateDir: fixture.stateDir, snapshot: "2026Q3", apply: false }),
    /local validation artifact is not eligible for pending-only staging/u,
  );
});

test("human overlay drift after validation invalidates replay", async (t) => {
  const fixture = await syntheticFixture(t);
  await promoteSyntheticFixtureToHuman(fixture);
  await writeJsonFile(path.join(fixture.stateDir, "manifest.json"), fixture.manifest);
  await extractManifestLocally({
    stateDir: fixture.stateDir,
    unitIds: [fixture.manifest.units[0]!.unit_id],
  });
  const validated = await validateManifest({ stateDir: fixture.stateDir });
  const beforeDrift = await verifyCurrentLocalValidatedArtifactForUnit(
    validated.units[0]!,
    validated,
    fixture.stateDir,
  );
  assert.equal(beforeDrift.review_status, "pending");
  assert.equal(beforeDrift.needs_review, true);
  assert.equal(beforeDrift.bulk_approval_eligible, false);
  assert.ok(beforeDrift.issues.some((issue) => (
    issue.code === "visual_transcription_human_confirmed_pending_admin_review"
  )));
  const overlayPath = path.join(fixture.stateDir, "ground-truth", "synthetic-overlay.json");
  const overlay = JSON.parse(await readFile(overlayPath, "utf8")) as {
    units: Array<{ readable_occurrences: Array<{ line_context: string }> }>;
  };
  overlay.units[0]!.readable_occurrences[0]!.line_context = "drifted approval evidence";
  await writeJsonFile(overlayPath, overlay);

  await assert.rejects(
    verifyCurrentLocalValidatedArtifactForUnit(
      validated.units[0]!,
      validated,
      fixture.stateDir,
    ),
    /visual_transcription_ground_truth_sha256_mismatch/u,
  );
});

test("visual coverage gaps survive normal validated artifacts without lossy rewriting", async (t) => {
  const fixture = await syntheticFixture(t);
  const evidenceId = fixture.sidecar.evidence[0]!.evidence_id;
  const sidecar = structuredClone(fixture.sidecar) as Record<string, unknown>;
  sidecar.coverage_gaps = [{
    evidence_id: evidenceId,
    source_locator: "image:1/unreadable-option",
    visible_amounts_krw: [77_000, 88_000],
    estimated_content: "Synthetic unreadable option range",
    reason: "Synthetic raster hides the option label",
  }];
  sidecar.content_sha256 = canonicalJsonSha256ExcludingField(sidecar, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, sidecar);
  await writeJsonFile(path.join(fixture.stateDir, "manifest.json"), fixture.manifest);
  await extractManifestLocally({
    stateDir: fixture.stateDir,
    unitIds: [fixture.manifest.units[0]!.unit_id],
  });
  const validated = await validateManifest({ stateDir: fixture.stateDir });
  const artifact = await verifyCurrentLocalValidatedArtifactForUnit(
    validated.units[0]!,
    validated,
    fixture.stateDir,
  );
  const gap = artifact.coverage_gaps.find((candidate) => (
    candidate.source_locator === "image:1/unreadable-option"
  ));
  assert.deepEqual(gap?.visual_transcription, {
    evidence_id: evidenceId,
    visible_amounts_krw: [77_000, 88_000],
    estimated_content: "Synthetic unreadable option range",
    reason: "Synthetic raster hides the option label",
  });
});

test("status counts a sidecar-bound local extraction and validation as current", async (t) => {
  const fixture = await syntheticFixture(t);
  await writeJsonFile(path.join(fixture.stateDir, "manifest.json"), fixture.manifest);
  await extractManifestLocally({
    stateDir: fixture.stateDir,
    unitIds: [fixture.manifest.units[0]!.unit_id],
  });
  await validateManifest({ stateDir: fixture.stateDir });

  const status = await getIngestStatus({ stateDir: fixture.stateDir });
  assert.equal(status.current_local_extracted_units, 1);
  assert.equal(status.current_local_validated_units, 1);
});

test("strict local score consumes the same verified visual validated artifact as load", async (t) => {
  const fixture = await syntheticFixture(t);
  await writeJsonFile(path.join(fixture.stateDir, "manifest.json"), fixture.manifest);
  await extractManifestLocally({
    stateDir: fixture.stateDir,
    unitIds: [fixture.manifest.units[0]!.unit_id],
  });
  await validateManifest({ stateDir: fixture.stateDir });

  const groundTruthPath = path.join(fixture.stateDir, "ground-truth", "inventory.json");
  const overlayPath = path.join(fixture.stateDir, "ground-truth", "score-overlay.json");
  await writeJsonFile(groundTruthPath, {
    generated_at: "2026-01-01T00:00:00.000Z",
    units: [{
      unit_id: fixture.manifest.units[0]!.unit_id,
      display_name: "synthetic.pdf",
      source_paths: [fixture.manifest.units[0]!.source_files[0]!.path],
      candidate_count: 0,
      candidates: [],
    }],
  });
  await writeJsonFile(overlayPath, {
    schema_version: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    units: [{
      unit_id: fixture.manifest.units[0]!.unit_id,
      readable_occurrences: [{
        raw: "100000",
        krw: 100_000,
        line_context: "Synthetic package 100000 KRW",
        source_locator: "image:1/package",
      }],
      unreadable_cells: [],
      expectations: {
        doc_kinds: ["partner_price_list"],
        allowed_partner_categories: ["studio"],
        policies: false,
        pricing_basis: false,
        sections: false,
        halls_min: 0,
      },
    }],
  });
  const report = await scoreExtractionAgainstGroundTruth({
    stateDir: fixture.stateDir,
    unitIds: [fixture.manifest.units[0]!.unit_id],
    groundTruthPath,
    expectedGroundTruthSha256: (await sha256File(groundTruthPath)).sha256,
    expectedOccurrenceCount: 0,
    overlayPath,
    expectedOverlaySha256: (await sha256File(overlayPath)).sha256,
    candidateSource: "local",
    requireValidatedArtifacts: true,
  });
  const unitReport = (report.units as Array<Record<string, unknown>>)[0]!;
  assert.notEqual(unitReport.status, "blocked", JSON.stringify(unitReport));
  assert.equal(
    (unitReport.provenance as Record<string, unknown>).candidate_source,
    "active_local_validation",
  );
  assert.equal((report.verification as Record<string, unknown>).review_only, true);
  assert.equal((report.gate as Record<string, unknown>).eligible_for_25_unit_batch, false);
});

test("page-to-image overlay compilation changes only exact locator protocols", async (t) => {
  const fixture = await syntheticFixture(t);
  const sourcePath = path.join(fixture.stateDir, "ground-truth", "source-overlay.json");
  const outputPath = path.join(fixture.stateDir, "ground-truth", "derived-overlay.json");
  const originalOccurrence = {
    raw: "100000",
    krw: 100_000,
    line_context: "Synthetic package 100000 KRW",
    source_locator: "page:1/package",
  };
  await writeJsonFile(sourcePath, {
    schema_version: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    units: [{
      unit_id: fixture.manifest.units[0]!.unit_id,
      readable_occurrences: [
        originalOccurrence,
        { ...originalOccurrence, raw: "200000", krw: 200_000, source_locator: "image:2/existing" },
        { ...originalOccurrence, raw: "300000", krw: 300_000, source_locator: "Sheet1!A1" },
      ],
      unreadable_cells: [{
        source_locator: "page:3/unreadable",
        visible_amounts_krw: [77_000],
        estimated_content: "Synthetic unreadable option",
        reason: "Synthetic raster hides the option label",
      }],
      expectations: {
        doc_kinds: ["partner_price_list"],
        allowed_partner_categories: ["studio"],
        policies: false,
        pricing_basis: false,
        sections: false,
        halls_min: 0,
      },
    }],
  });
  const sourceDigest = await sha256File(sourcePath);

  const compiled = await compilePageToImageVisualGroundTruthOverlay({
    stateDir: fixture.stateDir,
    sourceOverlayPath: sourcePath,
    expectedSourceOverlaySha256: sourceDigest.sha256,
    outputPath,
  });
  assert.equal(compiled.artifact.source_overlay_sha256, sourceDigest.sha256);
  assert.deepEqual(compiled.artifact.locator_migration, {
    contract_version: "page-to-image-v1",
    transformed_locator_count: 2,
    transformed_unit_count: 1,
  });
  const unit = compiled.artifact.overlay.units[0]!;
  assert.deepEqual(unit.readable_occurrences[0], {
    ...originalOccurrence,
    source_locator: "image:1/package",
  });
  assert.equal(unit.readable_occurrences[1]?.source_locator, "image:2/existing");
  assert.equal(unit.readable_occurrences[2]?.source_locator, "Sheet1!A1");
  assert.equal(unit.unreadable_cells[0]?.source_locator, "image:3/unreadable");
  assert.equal(
    compiled.artifact.content_sha256,
    canonicalJsonSha256ExcludingField(compiled.artifact, "content_sha256"),
  );
});

test("derived overlay import binds source SHA, derived content SHA, counts, and unit entry", async (t) => {
  const fixture = await syntheticFixture(t);
  const sourcePath = path.join(fixture.stateDir, "ground-truth", "source-page-overlay.json");
  const outputPath = path.join(fixture.stateDir, "ground-truth", "derived-image-overlay.json");
  await writeJsonFile(sourcePath, {
    schema_version: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    units: [{
      unit_id: fixture.manifest.units[0]!.unit_id,
      readable_occurrences: [{
        raw: "100000",
        krw: 100_000,
        line_context: "Synthetic package 100000 KRW",
        source_locator: "page:1/package",
      }],
      unreadable_cells: [],
      expectations: {
        doc_kinds: ["partner_price_list"],
        allowed_partner_categories: ["studio"],
        policies: false,
        pricing_basis: false,
        sections: false,
        halls_min: 0,
      },
    }],
  });
  const sourceDigest = await sha256File(sourcePath);
  const compiled = await compilePageToImageVisualGroundTruthOverlay({
    stateDir: fixture.stateDir,
    sourceOverlayPath: sourcePath,
    expectedSourceOverlaySha256: sourceDigest.sha256,
    outputPath,
  });
  const imported = await importHumanConfirmedVisualGroundTruth({
    stateDir: fixture.stateDir,
    overlayPath: outputPath,
    expectedSourceGroundTruthSha256: sourceDigest.sha256,
    expectedDerivedOverlayContentSha256: compiled.artifact.content_sha256,
    unitId: fixture.manifest.units[0]!.unit_id,
    approvalReference: "synthetic-user-approval",
  });
  assert.deepEqual(imported.confirmation.locator_migration, {
    contract_version: "page-to-image-v1",
    derived_overlay_content_sha256: compiled.artifact.content_sha256,
    transformed_locator_count: 1,
    transformed_unit_count: 1,
  });

  const human = structuredClone(fixture.sidecar) as Record<string, unknown>;
  human.reviewer = {
    kind: "human_confirmed",
    recorded_at: "2026-01-01T00:00:00.000Z",
    confirmation: imported.confirmation,
    ...syntheticHumanTextApproval(fixture),
  };
  human.content_sha256 = canonicalJsonSha256ExcludingField(human, "content_sha256");
  await writeJsonFile(fixture.sidecarPath, human);
  assert.equal((await loadVisualTranscriptionSidecar({
    stateDir: fixture.stateDir,
    manifest: fixture.manifest,
    unitId: fixture.manifest.units[0]!.unit_id,
  }))?.reviewer.kind, "human_confirmed");

  const source = JSON.parse(await readFile(sourcePath, "utf8")) as {
    units: Array<{ readable_occurrences: Array<{ line_context: string }> }>;
  };
  source.units[0]!.readable_occurrences[0]!.line_context = "drifted source approval";
  await writeJsonFile(sourcePath, source);
  await assert.rejects(
    loadVisualTranscriptionSidecar({
      stateDir: fixture.stateDir,
      manifest: fixture.manifest,
      unitId: fixture.manifest.units[0]!.unit_id,
    }),
    /visual_transcription_ground_truth_sha256_mismatch/u,
  );
});

test("derived overlay import rejects self-consistent non-mechanical field tampering", async (t) => {
  const fixture = await syntheticFixture(t);
  const sourcePath = path.join(fixture.stateDir, "ground-truth", "source-page-overlay.json");
  const outputPath = path.join(fixture.stateDir, "ground-truth", "derived-image-overlay.json");
  await writeJsonFile(sourcePath, {
    schema_version: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    units: [{
      unit_id: fixture.manifest.units[0]!.unit_id,
      readable_occurrences: [{
        raw: "100000",
        krw: 100_000,
        line_context: "Synthetic package 100000 KRW",
        source_locator: "page:1/package",
      }],
      unreadable_cells: [],
      expectations: {
        doc_kinds: ["partner_price_list"],
        policies: false,
        pricing_basis: false,
        sections: false,
        halls_min: 0,
      },
    }],
  });
  const sourceDigest = await sha256File(sourcePath);
  await compilePageToImageVisualGroundTruthOverlay({
    stateDir: fixture.stateDir,
    sourceOverlayPath: sourcePath,
    expectedSourceOverlaySha256: sourceDigest.sha256,
    outputPath,
  });
  const forged = JSON.parse(await readFile(outputPath, "utf8")) as Record<string, unknown>;
  const overlay = forged.overlay as {
    units: Array<{ readable_occurrences: Array<{ raw: string }> }>;
  };
  overlay.units[0]!.readable_occurrences[0]!.raw = "forged raw amount";
  forged.content_sha256 = canonicalJsonSha256ExcludingField(forged, "content_sha256");
  await writeJsonFile(outputPath, forged);

  await assert.rejects(
    importHumanConfirmedVisualGroundTruth({
      stateDir: fixture.stateDir,
      overlayPath: outputPath,
      expectedSourceGroundTruthSha256: sourceDigest.sha256,
      expectedDerivedOverlayContentSha256: String(forged.content_sha256),
      unitId: fixture.manifest.units[0]!.unit_id,
      approvalReference: "synthetic-user-approval",
    }),
    /visual_transcription_derived_overlay_mechanical_mismatch/u,
  );
});

test("page-to-image compiler rejects ambiguous page locator spellings", async (t) => {
  const fixture = await syntheticFixture(t);
  const sourcePath = path.join(fixture.stateDir, "ground-truth", "ambiguous-page-overlay.json");
  const outputPath = path.join(fixture.stateDir, "ground-truth", "derived-overlay.json");
  await writeJsonFile(sourcePath, {
    schema_version: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    units: [{
      unit_id: fixture.manifest.units[0]!.unit_id,
      readable_occurrences: [{
        raw: "100000",
        krw: 100_000,
        line_context: "Synthetic package 100000 KRW",
        source_locator: "page:01/package",
      }],
      unreadable_cells: [],
      expectations: {
        doc_kinds: ["partner_price_list"],
        policies: false,
        pricing_basis: false,
        sections: false,
        halls_min: 0,
      },
    }],
  });
  const sourceDigest = await sha256File(sourcePath);
  await assert.rejects(
    compilePageToImageVisualGroundTruthOverlay({
      stateDir: fixture.stateDir,
      sourceOverlayPath: sourcePath,
      expectedSourceOverlaySha256: sourceDigest.sha256,
      outputPath,
    }),
    /visual_transcription_locator_migration_invalid/u,
  );
});
