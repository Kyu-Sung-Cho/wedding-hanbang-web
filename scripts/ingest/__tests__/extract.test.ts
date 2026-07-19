import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";

import { convertManifest } from "../convert.js";
import {
  acquireExtractionLock,
  buildOpenAIResponseRequest,
  computeRetryDelayMilliseconds,
  ExtractionProviderResponseError,
  extractManifest,
  mergeExtractionChunks,
  parseOpenAIExtractionResponse,
  planExtraction,
  resolveExtractionModel,
  selectExtractionUnits,
  validateImageRequestPayloadLimits,
  type ExtractionProvider,
} from "../extract.js";
import { scanSources } from "../scan.js";
import type { DisclosureExtraction } from "../schemas.js";
import { DisclosureExtractionSchema, ExtractionBatchCheckpointSchema } from "../schemas.js";
import type { IngestManifest, ManifestUnit, SourceExtension } from "../types.js";

function selectionUnit(
  id: string,
  ext: SourceExtension,
  kind: "agency" | "hall",
  options: { textCharacters?: number; images?: number } = {},
): ManifestUnit {
  return {
    unit_id: id.repeat(64),
    display_name: `${id}.${ext}`,
    parsed: {
      region_code: "seoul_gangnam",
      raw_name: id,
      normalized_name: id,
      corporate_name: null,
      kind_hint: kind,
    },
    source_files: [{
      path: `${kind}/${id}.${ext}`,
      absolute_path: `C:/${kind}/${id}.${ext}`,
      ext,
      sha256: id.repeat(64),
      bytes: 100,
    }],
    source_fingerprint: id.repeat(64),
    stage: "converted",
    notices: [],
    conversion: {
      source_fingerprint: id.repeat(64),
      text_artifacts: options.textCharacters === 0 ? [] : [`C:/${id}.txt`],
      image_artifacts: Array.from({ length: options.images ?? 0 }, (_, index) => `C:/${id}-${index}.png`),
      text_characters: options.textCharacters ?? 1_000,
      cell_count: 1,
      artifact_fingerprint: id.repeat(64),
      converted_at: new Date(0).toISOString(),
    },
  };
}

function dummyExtraction(businessName: string): DisclosureExtraction {
  return {
    doc_kind: "agency_disclosure",
    business_name: businessName,
    region_hint: "제주",
    agency_packages: [
      {
        package_name: "더미 기본 패키지",
        category_scope: ["studio", "dress", "makeup"],
        price_min_krw: 2_900_000,
        price_max_krw: 2_900_000,
        vat_note: null,
        price_note: null,
        options: [],
        source_quote: "더미 기본 패키지 290만원",
        confidence: 0.95,
        needs_review: false,
      },
    ],
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
    extraction_notes: "더미 테스트 결과",
  };
}

test("fixed --units selection preserves the requested order and rejects unknown ids", () => {
  const units = [
    selectionUnit("a", "xlsx", "agency"),
    selectionUnit("b", "pdf", "hall"),
    selectionUnit("c", "docx", "agency"),
  ];
  const manifest = { units } as IngestManifest;

  assert.deepEqual(
    selectExtractionUnits(manifest, { unitIds: ["c".repeat(64), "a".repeat(64)] })
      .map((unit) => unit.unit_id),
    ["c".repeat(64), "a".repeat(64)],
  );
  assert.throws(
    () => selectExtractionUnits(manifest, { unitIds: ["d".repeat(64)] }),
    /unknown_unit_id/u,
  );
});

test("automatic pilot selection is deterministic and stratifies formats instead of taking manifest order", () => {
  const units = [
    selectionUnit("a", "xlsx", "agency"),
    selectionUnit("b", "xlsx", "agency"),
    selectionUnit("c", "xlsx", "agency"),
    selectionUnit("d", "xlsx", "hall"),
    selectionUnit("e", "pdf", "agency", { textCharacters: 2_000 }),
    selectionUnit("f", "docx", "agency"),
    selectionUnit("1", "png", "agency", { textCharacters: 0, images: 1 }),
  ];
  const selected = selectExtractionUnits({ units } as IngestManifest, { sampleSize: 5 });

  assert.deepEqual(
    selected.map((unit) => `${unit.source_files[0].ext}:${unit.parsed.kind_hint}`),
    ["png:agency", "docx:agency", "pdf:agency", "xlsx:hall", "xlsx:agency"],
  );
  assert.deepEqual(
    selectExtractionUnits({ units } as IngestManifest, { sampleSize: 5 }).map((unit) => unit.unit_id),
    selected.map((unit) => unit.unit_id),
  );
});

test("extraction plan estimates selected work without requiring an API key or paid-call enable flag", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-plan-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "(제주)_계획테스트.docx"));
  const scanned = await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });

  const plan = await planExtraction({ stateDir, unitIds: [scanned.units[0].unit_id] }, {});

  assert.equal(plan.provider, "openai_responses_api");
  assert.equal(plan.configured_model_env, null);
  assert.equal(plan.resolved_model, "gpt-5.6-luna");
  assert.match(plan.luna_semantics, /literal.*not an alias/iu);
  assert.equal(plan.units.length, 1);
  assert.ok(plan.estimated_input_tokens > 0);
  assert.ok(plan.estimated_cost_usd > 0);
  assert.ok(plan.maximum_cost_usd >= plan.estimated_cost_usd);
});

async function writeDummyDocx(filePath: string): Promise<void> {
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
  await writeFile(filePath, await docx.generateAsync({ type: "nodebuffer" }));
}

test("extract uses lower-cost Luna by default and reuses a successful content-addressed cache", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-extract-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "(제주)_더미플래너.docx"));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });

  const requests: Array<{ model: string; text: string }> = [];
  const provider: ExtractionProvider = {
    extract: async (request) => {
      requests.push({ model: request.model, text: request.text });
      return { data: dummyExtraction("더미플래너"), inputTokens: 100, outputTokens: 50 };
    },
  };

  const first = await extractManifest({ stateDir }, { provider, env: {} });
  const second = await extractManifest({ stateDir }, { provider, env: {} });

  assert.equal(resolveExtractionModel({}), "gpt-5.6-luna");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, "gpt-5.6-luna");
  assert.match(requests[0].text, /더미 기본 패키지 290만원/u);
  assert.equal(first.units[0].stage, "extracted");
  assert.equal(second.units[0].extraction?.cache_hit, true);
  assert.match(second.units[0].extraction?.artifact_path ?? "", /\.cache[\\/]extract[\\/][a-f0-9]{64}\.json$/u);
});

test("extract accepts a bounded multi-file unit that needs more than ten text chunks", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-large-unit-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "예식장", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(제주)_샘플대형홀.pdf"), "%PDF generated fixture");
  await scanSources({ rootDir, stateDir });
  const longText = "샘플 공시 100만원\n".repeat(30_000);
  await convertManifest({ stateDir }, { extractPdfText: async () => longText });
  let requests = 0;

  const result = await extractManifest(
    { stateDir },
    {
      env: {},
      provider: {
        extract: async () => {
          requests += 1;
          return { data: dummyExtraction("샘플대형홀"), inputTokens: 10, outputTokens: 5 };
        },
      },
    },
  );

  assert.ok(requests > 10 && requests <= 20);
  assert.equal(result.units[0].stage, "extracted");
});

test("extract rejects every model outside the Luna/Terra allowlist", () => {
  assert.throws(
    () => resolveExtractionModel({ EXTRACTION_MODEL: "gpt-4o" }),
    /gpt-5\.6-luna.*gpt-5\.6-terra/u,
  );
});

test("OpenAI extraction request uses Responses structured output and never stores the response", async (t) => {
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-openai-request-"));
  t.after(async () => rm(fixtureDir, { recursive: true, force: true }));
  const imagePath = path.join(fixtureDir, "dummy.png");
  await writeFile(imagePath, "generated-image-fixture");

  const request = await buildOpenAIResponseRequest({
    unitId: "a".repeat(64),
    model: "gpt-5.6-terra",
    canonicalName: "샘플홀",
    regionCode: "seoul_etc",
    kindHint: "hall",
    text: "더미 원문",
    imagePaths: [imagePath],
    imageSourceRefs: [{
      artifactId: "b".repeat(64),
      sources: [{ sourceFileId: "c".repeat(64), sourcePath: "예식장/서울/샘플홀.png" }],
    }],
  });

  assert.equal(request.store, false);
  assert.equal(request.model, "gpt-5.6-terra");
  assert.equal(request.max_output_tokens, 8_000);
  assert.equal(request.temperature, 0);
  assert.equal(request.text?.format?.type, "json_schema");
  assert.equal(request.tools, undefined);
  assert.match(JSON.stringify(request.input), /data:image\/png;base64/u);
  assert.match(JSON.stringify(request.input), /샘플홀/u);
  assert.match(JSON.stringify(request.input), /hall/u);
  assert.match(JSON.stringify(request.input), /source_file_id: c{64}/u);
  assert.match(JSON.stringify(request.input), /예식장\/서울\/샘플홀\.png/u);
});

test("multi-batch retries reuse successful schema-validated checkpoints instead of paying twice", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-batch-checkpoint-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "예식장", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(제주)_체크포인트홀.pdf"), "%PDF generated fixture");
  await scanSources({ rootDir, stateDir });
  await convertManifest(
    { stateDir },
    { extractPdfText: async () => "체크포인트홀 100만원\n".repeat(4_000) },
  );

  const callTexts: string[] = [];
  let shouldFailSecondBatch = true;
  const provider: ExtractionProvider = {
    extract: async (request) => {
      callTexts.push(request.text);
      if (shouldFailSecondBatch && callTexts.length === 2) {
        shouldFailSecondBatch = false;
        throw new Error("generated second-batch failure");
      }
      return { data: dummyExtraction("체크포인트홀"), inputTokens: 11, outputTokens: 7 };
    },
  };

  const failed = await extractManifest({ stateDir }, { provider, env: {} });
  assert.equal(failed.units[0].stage, "error");
  const checkpointDirectory = path.join(stateDir, ".cache", "extract-batches");
  const checkpointNames = await import("node:fs/promises").then(({ readdir }) => readdir(checkpointDirectory));
  assert.equal(checkpointNames.length, 1);
  const checkpoint = JSON.parse(await readFile(path.join(checkpointDirectory, checkpointNames[0]), "utf8"));
  assert.equal(ExtractionBatchCheckpointSchema.safeParse(checkpoint).success, true);
  assert.equal(checkpoint.canonical_identity.canonical_name, "체크포인트홀");
  assert.match(checkpoint.prompt_hash, /^[a-f0-9]{64}$/u);
  assert.match(checkpoint.request_hash, /^[a-f0-9]{64}$/u);

  const completed = await extractManifest({ stateDir }, { provider, env: {} });
  assert.equal(completed.units[0].stage, "extracted");
  assert.equal(callTexts.length, 3);
  assert.equal(callTexts.filter((value) => value === callTexts[0]).length, 1);
  assert.equal(completed.units[0].extraction?.input_tokens, 22);
  assert.equal(completed.units[0].extraction?.output_tokens, 14);
});

test("an invalid batch checkpoint fails closed before another provider charge", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-invalid-checkpoint-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "예식장", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(제주)_깨진체크포인트홀.pdf"), "%PDF generated fixture");
  await scanSources({ rootDir, stateDir });
  await convertManifest(
    { stateDir },
    { extractPdfText: async () => "깨진체크포인트홀 100만원\n".repeat(4_000) },
  );

  let calls = 0;
  const provider: ExtractionProvider = {
    extract: async () => {
      calls += 1;
      if (calls === 2) throw new Error("generated second-batch failure");
      return { data: dummyExtraction("깨진체크포인트홀"), inputTokens: 1, outputTokens: 1 };
    },
  };
  await extractManifest({ stateDir }, { provider, env: {} });
  const checkpointDirectory = path.join(stateDir, ".cache", "extract-batches");
  const checkpointName = await import("node:fs/promises").then(async ({ readdir }) => (await readdir(checkpointDirectory))[0]);
  const checkpointPath = path.join(checkpointDirectory, checkpointName);
  const tamperedCheckpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
  tamperedCheckpoint.data.business_name = "schema-valid tampering";
  assert.equal(ExtractionBatchCheckpointSchema.safeParse(tamperedCheckpoint).success, true);
  await writeFile(checkpointPath, `${JSON.stringify(tamperedCheckpoint)}\n`, "utf8");

  const retried = await extractManifest({ stateDir }, { provider, env: {} });
  assert.equal(calls, 2);
  assert.equal(retried.units[0].stage, "error");
  assert.match(retried.units[0].notices.join("\n"), /batch_checkpoint_invalid/u);
});

test("invalid structured output keeps billable usage and request id in the attempt ledger", async (t) => {
  let rawResponseError: unknown;
  try {
    parseOpenAIExtractionResponse({
      output_text: "{\"not\":\"the extraction schema\"}",
      usage: { input_tokens: 123, output_tokens: 45 },
    }, "req_generated_invalid");
  } catch (error) {
    rawResponseError = error;
  }
  assert.equal(rawResponseError instanceof ExtractionProviderResponseError, true);
  assert.equal((rawResponseError as ExtractionProviderResponseError).inputTokens, 123);
  assert.equal((rawResponseError as ExtractionProviderResponseError).outputTokens, 45);
  assert.equal((rawResponseError as ExtractionProviderResponseError).requestId, "req_generated_invalid");

  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-invalid-usage-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "(제주)_사용량더미.docx"));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  let calls = 0;
  const provider: ExtractionProvider = {
    extract: async () => {
      calls += 1;
      if (calls === 1) {
        throw new ExtractionProviderResponseError(
          "OpenAI 구조화 출력 검증에 실패했습니다: generated invalid",
          { inputTokens: 123, outputTokens: 45, requestId: "req_generated_invalid" },
        );
      }
      return { data: dummyExtraction("사용량더미"), inputTokens: 10, outputTokens: 5 };
    },
  };

  const result = await extractManifest({ stateDir }, { provider, env: {} });
  assert.equal(result.units[0].stage, "extracted");
  assert.equal(result.units[0].extraction?.input_tokens, 133);
  assert.equal(result.units[0].extraction?.output_tokens, 50);
  const entries = (await readFile(path.join(stateDir, ".cache", "ai-ledger.ndjson"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(entries[0].success, false);
  assert.equal(entries[0].request_id, "req_generated_invalid");
  assert.equal(entries[0].input_tokens, 123);
  assert.equal(entries[0].output_tokens, 45);
  assert.ok(entries[0].estimated_cost_usd > 0);
});

test("text and image evidence expose stable source-file labels to the model request", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-source-labels-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const vendorDir = path.join(rootDir, "결혼준비대행서비스", "제주", "(제주)_샘플라벨웨딩");
  await mkdir(vendorDir, { recursive: true });
  await writeDummyDocx(path.join(vendorDir, "가격표.docx"));
  await writeDummyDocx(path.join(vendorDir, "옵션표.docx"));
  await writeFile(path.join(vendorDir, "사진.png"), "generated-image-fixture");
  const scanned = await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  const captured: Parameters<ExtractionProvider["extract"]>[0][] = [];

  await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async (request) => {
        captured.push(request);
        return { data: dummyExtraction("샘플라벨웨딩"), inputTokens: 1, outputTokens: 1 };
      },
    },
  });

  assert.equal(captured.length, 1);
  for (const source of scanned.units[0].source_files.filter((item) => item.ext === "docx")) {
    assert.match(captured[0].text, new RegExp(source.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  }
  assert.equal((captured[0].text.match(/source_file_id: [a-f0-9]{64}/gu) ?? []).length, 2);
  assert.equal(captured[0].imageSourceRefs.length, 1);
  assert.equal(captured[0].imageSourceRefs[0].sources[0].sourcePath.endsWith("사진.png"), true);
  assert.match(captured[0].imageSourceRefs[0].sources[0].sourceFileId, /^[a-f0-9]{64}$/u);
});

test("extract rejects a raw source replaced by a same-content symlink outside the raw root", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-extract-realpath-"));
  const outsideDir = `${rootDir}-outside`;
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(outsideDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const vendorDir = path.join(rootDir, "결혼준비대행서비스", "제주", "(제주)_링크더미");
  const outsideVendorDir = path.join(outsideDir, "outside-vendor");
  await mkdir(vendorDir, { recursive: true });
  await mkdir(outsideVendorDir, { recursive: true });
  const sourcePath = path.join(vendorDir, "가격표.docx");
  const outsidePath = path.join(outsideVendorDir, "가격표.docx");
  await writeDummyDocx(sourcePath);
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });
  await writeFile(outsidePath, await readFile(sourcePath));
  await rm(vendorDir, { recursive: true, force: true });
  try {
    await symlink(
      outsideVendorDir,
      vendorDir,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && ["EPERM", "EACCES", "ENOTSUP"].includes(String(error.code))) {
      t.skip(`symlink unavailable: ${String(error.code)}`);
      return;
    }
    throw error;
  }
  let calls = 0;
  const result = await extractManifest({ stateDir }, {
    env: {},
    provider: {
      extract: async () => {
        calls += 1;
        return { data: dummyExtraction("링크더미"), inputTokens: 1, outputTokens: 1 };
      },
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.units[0].stage, "error");
  assert.match(result.units[0].notices.join("\n"), /provenance|realpath|raw root|경로/iu);
});

test("OpenAI image requests enforce independent raw-byte and base64 payload totals", () => {
  assert.doesNotThrow(() => validateImageRequestPayloadLimits(
    30 * 1024 * 1024,
    40 * 1024 * 1024,
  ));
  assert.throws(
    () => validateImageRequestPayloadLimits(40 * 1024 * 1024 + 1, 1),
    /image_request_raw_bytes_limit/u,
  );
  assert.throws(
    () => validateImageRequestPayloadLimits(40 * 1024 * 1024, 50 * 1024 * 1024 + 1),
    /image_request_base64_payload_limit/u,
  );
});

test("extract lock permits one process and diagnoses a dead local owner without charging", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-extract-lock-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));

  const attempts = await Promise.allSettled(
    Array.from({ length: 8 }, () => acquireExtractionLock(stateDir)),
  );
  const acquired = attempts.filter(
    (attempt): attempt is PromiseFulfilledResult<() => Promise<void>> => attempt.status === "fulfilled",
  );
  const blocked = attempts.filter(
    (attempt): attempt is PromiseRejectedResult => attempt.status === "rejected",
  );
  assert.equal(acquired.length, 1);
  assert.equal(blocked.length, 7);
  for (const attempt of blocked) assert.match(String(attempt.reason), /extract_lock_active/u);
  await acquired[0].value();

  const lockDirectory = path.join(stateDir, ".cache", "locks");
  await mkdir(lockDirectory, { recursive: true });
  await writeFile(path.join(lockDirectory, "extract.lock"), JSON.stringify({
    schema_version: 1,
    lock_id: "00000000-0000-4000-8000-000000000001",
    pid: 2_147_483_647,
    hostname: os.hostname(),
    started_at: "2000-01-01T00:00:00.000Z",
    state_dir: path.resolve(stateDir),
  }));

  await assert.rejects(
    acquireExtractionLock(stateDir),
    /extract_lock_stale_local_pid/u,
  );
});

test("retry delay honors bounded Retry-After seconds and HTTP dates", () => {
  const secondsError = Object.assign(new Error("generated rate limit"), {
    status: 429,
    headers: new Headers({ "Retry-After": "2" }),
  });
  const dateError = Object.assign(new Error("generated unavailable"), {
    status: 503,
    headers: { "retry-after": new Date(5_000).toUTCString() },
  });
  const excessiveError = Object.assign(new Error("generated rate limit"), {
    status: 429,
    headers: { "Retry-After": "9999" },
  });

  assert.equal(computeRetryDelayMilliseconds(secondsError, 0, 0), 2_000);
  assert.equal(computeRetryDelayMilliseconds(dateError, 1, 0), 5_000);
  assert.equal(computeRetryDelayMilliseconds(excessiveError, 2, 0), 60_000);
  assert.equal(computeRetryDelayMilliseconds(new Error("generated"), 1, 0), 500);
});

test("extract retries only a bounded number of times for 429 responses", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-extract-retry-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "(제주)_재시도더미.docx"));
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });

  let attempts = 0;
  const delays: number[] = [];
  const provider: ExtractionProvider = {
    extract: async () => {
      attempts += 1;
      if (attempts < 4) {
        const error = new Error("generated rate limit");
        Object.defineProperty(error, "status", { value: 429 });
        throw error;
      }
      return { data: dummyExtraction("재시도더미"), inputTokens: 20, outputTokens: 10 };
    },
  };

  const result = await extractManifest(
    { stateDir },
    { provider, env: {}, sleep: async (milliseconds) => { delays.push(milliseconds); } },
  );

  assert.equal(result.units[0].stage, "extracted");
  assert.equal(attempts, 4);
  assert.deepEqual(delays, [250, 500, 1_000]);
  assert.equal(result.units[0].extraction?.attempts, 4);
  const ledgerLines = (await readFile(path.join(stateDir, ".cache", "ai-ledger.ndjson"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(ledgerLines.length, 4);
  assert.deepEqual(
    ledgerLines.map((entry) => entry.error_category),
    ["rate_limit", "rate_limit", "rate_limit", null],
  );
  assert.equal(ledgerLines[3].success, true);
  assert.equal(ledgerLines[3].input_tokens, 20);
  assert.ok(ledgerLines[3].estimated_cost_usd > 0);
  assert.doesNotMatch(JSON.stringify(ledgerLines), /더미 원문|generated rate limit|OPENAI_API_KEY/u);
});

test("invalid structured output receives exactly one repair retry while a second invalid response fails", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-extract-repair-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "agency", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "repair.docx"));
  await writeDummyDocx(path.join(regionDir, "fail.docx"));
  await writeDummyDocx(path.join(regionDir, "other-4xx.docx"));
  const scanned = await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  await convertManifest({ stateDir });
  const repairId = scanned.units.find((unit) => unit.display_name === "repair.docx")?.unit_id;
  const other4xxId = scanned.units.find((unit) => unit.display_name === "other-4xx.docx")?.unit_id;
  assert.ok(repairId);
  assert.ok(other4xxId);
  const attempts = new Map<string, number>();
  const delays: number[] = [];
  const provider: ExtractionProvider = {
    extract: async (request) => {
      const count = (attempts.get(request.unitId) ?? 0) + 1;
      attempts.set(request.unitId, count);
      if (request.unitId === other4xxId) {
        const error = new Error("generated bad request");
        Object.defineProperty(error, "status", { value: 400 });
        throw error;
      }
      if (request.unitId === repairId && count === 2) {
        return { data: dummyExtraction("repaired"), inputTokens: 10, outputTokens: 5 };
      }
      throw new Error("구조화 출력 검증 실패");
    },
  };

  const result = await extractManifest(
    { stateDir },
    { provider, env: {}, sleep: async (milliseconds) => { delays.push(milliseconds); } },
  );

  assert.equal(attempts.get(repairId), 2);
  const failedUnit = result.units.find((unit) => unit.unit_id !== repairId && unit.unit_id !== other4xxId);
  assert.equal(attempts.get(failedUnit?.unit_id ?? ""), 2);
  assert.equal(attempts.get(other4xxId), 1);
  assert.equal(result.units.find((unit) => unit.unit_id === repairId)?.stage, "extracted");
  assert.equal(failedUnit?.stage, "error");
  assert.equal(result.units.find((unit) => unit.unit_id === other4xxId)?.stage, "error");
  assert.deepEqual(delays, []);
  const ledger = (await readFile(path.join(stateDir, ".cache", "ai-ledger.ndjson"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(ledger.length, 5);
  assert.equal(ledger.filter((entry) => entry.error_category === "invalid_response").length, 3);
});

test("each extract invocation receives a new audit run id so retrying the CLI never hides a later success", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-extract-run-id-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "agency", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeDummyDocx(path.join(regionDir, "generated.docx"));
  await scanSources({ rootDir, stateDir, agencyDir: "agency", hallDir: "hall" });
  await convertManifest({ stateDir });

  const failedProvider: ExtractionProvider = { extract: async () => { throw new Error("generated failure"); } };
  const failed = await extractManifest({ stateDir }, { provider: failedProvider, env: {} });
  assert.equal(failed.units[0].stage, "error");
  const successfulProvider: ExtractionProvider = {
    extract: async () => ({ data: dummyExtraction("generated"), inputTokens: 10, outputTokens: 5 }),
  };
  const successful = await extractManifest({ stateDir }, { provider: successfulProvider, env: {} });
  assert.equal(successful.units[0].stage, "extracted");

  const entries = (await readFile(path.join(stateDir, ".cache", "ai-ledger.ndjson"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(entries.length, 2);
  assert.notEqual(entries[0].run_id, entries[1].run_id);
  assert.notEqual(entries[0].ledger_id, entries[1].ledger_id);
  assert.deepEqual(entries.map((entry) => entry.success), [false, true]);
});

test("chunk merge never chooses one of conflicting non-null numeric values silently", () => {
  const first = dummyExtraction("충돌더미");
  first.hall.venue_fee_krw = 1_000_000;
  first.hall.venue_fee_source_quote = "대관료 100만원";
  const second = structuredClone(first);
  second.doc_kind = "hall_disclosure";
  second.agency_packages[0].price_min_krw = 3_100_000;
  second.agency_packages[0].price_max_krw = 3_100_000;
  second.agency_packages[0].source_quote = "더미 기본 패키지 310만원";
  second.hall.venue_fee_krw = 1_200_000;
  second.hall.venue_fee_source_quote = "대관료 120만원";

  const merged = mergeExtractionChunks([first, second]);

  assert.equal(merged.doc_kind, "mixed");
  assert.equal(merged.hall.venue_fee_krw, null);
  assert.equal(merged.hall.venue_fee_source_quote, null);
  assert.equal(merged.hall.needs_review, true);
  assert.equal(merged.agency_packages.every((item) => item.needs_review), true);
  assert.match(merged.extraction_notes, /자동 선택하지 않고 needs_review/u);
});

test("chunk merge fails closed when canonical business or region identity conflicts", () => {
  const first = dummyExtraction("샘플제주웨딩");
  first.partner_vendors = [{
    vendor_name: "샘플제주스튜디오",
    old_names: [],
    category: "studio",
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    base_spec: "20p 앨범",
    price_note: null,
    options: [],
    source_quote: "샘플제주스튜디오 100만원",
    confidence: 0.95,
    needs_review: false,
  }];
  first.hall.items = [{
    name: "대관료",
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    raw_text: "대관료 100만원",
    source_quote: "대관료 100만원",
    confidence: 0.95,
    needs_review: false,
  }];

  const second = structuredClone(first);
  second.business_name = "샘플부산웨딩";
  second.region_hint = "부산";
  second.agency_packages[0].package_name = "샘플 부산 기본 패키지";
  second.partner_vendors[0].vendor_name = "샘플부산스튜디오";
  second.hall.items[0].name = "식대";

  const merged = mergeExtractionChunks([first, second]);

  assert.equal(merged.business_name, null);
  assert.equal(merged.region_hint, null);
  assert.equal(merged.agency_packages.every((item) => item.needs_review), true);
  assert.equal(merged.partner_vendors.every((item) => item.needs_review), true);
  assert.equal(merged.hall.items.every((item) => item.needs_review), true);
  assert.equal(merged.hall.needs_review, true);
  assert.match(merged.extraction_notes, /business_name/u);
  assert.match(merged.extraction_notes, /region_hint/u);
});

test("chunk merge flags every agency package variant when one identity has different structure", () => {
  const first = dummyExtraction("구조충돌플래너");
  const second = structuredClone(first);
  second.agency_packages[0].options = [{
    name: "앨범 추가",
    price_min_krw: 100_000,
    price_max_krw: 100_000,
    unit: "1권",
    condition: null,
    raw_text: "앨범 1권 추가 10만원",
    source_quote: "앨범 1권 추가 10만원",
  }];
  second.agency_packages[0].source_quote = "기본 패키지 290만원, 앨범 추가 가능";

  const merged = mergeExtractionChunks([first, second]);

  assert.equal(merged.agency_packages.length, 2);
  assert.equal(merged.agency_packages.every((item) => item.needs_review), true);
  assert.equal(merged.agency_packages.every((item) => item.confidence <= 0.5), true);
  assert.match(merged.extraction_notes, /구조/u);
});

test("chunk merge flags every partner vendor variant when one identity has different structure", () => {
  const first = dummyExtraction("구조충돌플래너");
  first.agency_packages = [];
  first.partner_vendors = [{
    vendor_name: "샘플동일스튜디오",
    old_names: [],
    category: "studio",
    price_min_krw: 1_200_000,
    price_max_krw: 1_200_000,
    base_spec: "20p 앨범",
    price_note: null,
    options: [],
    source_quote: "샘플동일스튜디오 20p 120만원",
    confidence: 0.95,
    needs_review: false,
  }];
  const second = structuredClone(first);
  second.partner_vendors[0].base_spec = "30p 앨범";
  second.partner_vendors[0].source_quote = "샘플동일스튜디오 30p 120만원";

  const merged = mergeExtractionChunks([first, second]);

  assert.equal(merged.partner_vendors.length, 2);
  assert.equal(merged.partner_vendors.every((item) => item.needs_review), true);
  assert.equal(merged.partner_vendors.every((item) => item.confidence <= 0.5), true);
  assert.match(merged.extraction_notes, /구조/u);
});

test("chunk merge flags every hall item variant when one identity has different structure", () => {
  const first = dummyExtraction("구조충돌홀");
  first.doc_kind = "hall_disclosure";
  first.agency_packages = [];
  first.hall.items = [{
    name: "대관료",
    price_min_krw: 1_000_000,
    price_max_krw: 1_000_000,
    raw_text: "대관료(기본) 100만원",
    source_quote: "대관료(기본) 100만원",
    confidence: 0.95,
    needs_review: false,
  }];
  first.hall.needs_review = false;
  first.hall.confidence = 0.95;
  const second = structuredClone(first);
  second.hall.items[0].raw_text = "대관료(주말) 100만원";
  second.hall.items[0].source_quote = "대관료(주말) 100만원";

  const merged = mergeExtractionChunks([first, second]);

  assert.equal(merged.hall.items.length, 2);
  assert.equal(merged.hall.items.every((item) => item.needs_review), true);
  assert.equal(merged.hall.items.every((item) => item.confidence <= 0.5), true);
  assert.equal(merged.hall.needs_review, true);
  assert.match(merged.extraction_notes, /구조/u);
});

test("chunk merge keeps venue and meal evidence attached to their own values", () => {
  const venueChunk = dummyExtraction("근거분리홀");
  venueChunk.doc_kind = "hall_disclosure";
  venueChunk.agency_packages = [];
  venueChunk.hall.venue_fee_krw = 3_000_000;
  venueChunk.hall.venue_fee_source_quote = "대관료 300만원";

  const mealChunk = dummyExtraction("근거분리홀");
  mealChunk.doc_kind = "hall_disclosure";
  mealChunk.agency_packages = [];
  mealChunk.hall.meal_price_min_krw = 75_000;
  mealChunk.hall.meal_price_max_krw = 90_000;
  mealChunk.hall.meal_price_source_quote = "식대 1인 7.5만~9만원";

  const merged = mergeExtractionChunks([venueChunk, mealChunk]);

  assert.equal(merged.hall.venue_fee_source_quote, "대관료 300만원");
  assert.equal(merged.hall.meal_price_source_quote, "식대 1인 7.5만~9만원");
});

test("structured output schema caps source text lengths", () => {
  const oversized = dummyExtraction("길이더미");
  oversized.agency_packages[0].source_quote = "가".repeat(1_001);
  assert.equal(DisclosureExtractionSchema.safeParse(oversized).success, false);
});
