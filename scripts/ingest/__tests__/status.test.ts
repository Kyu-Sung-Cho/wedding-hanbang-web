import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { convertManifest } from "../convert.js";
import { loadManifest, saveManifest } from "../manifest.js";
import { scanSources } from "../scan.js";
import { formatIngestStatus, getIngestStatus } from "../status.js";

test("status reports manual work separately from completed stages", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-status-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([rm(rootDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "충청");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(충청)_수동더미.hwp"), "generated hwp fixture");
  await scanSources({ rootDir, stateDir });
  await convertManifest({ stateDir });

  const status = await getIngestStatus({ stateDir });

  assert.equal(status.total_units, 1);
  assert.equal(status.by_stage.needs_manual_conversion, 1);
  assert.equal(status.manual_source_files, 1);
  assert.equal(status.failed_units, 0);
  const table = formatIngestStatus(status);
  assert.match(table, /Stage\s+Count/u);
  assert.match(table, /needs_manual_conversion\s+1/u);
  assert.match(table, /Total units:\s+1/u);
  assert.match(table, /Estimated AI cost \(USD\):\s+0\.000000/u);
  assert.doesNotMatch(table, /\.hwp|수동웨딩/u);
});

test("status identifies failed units with content-safe codes only", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-status-error-"));
  const stateDir = `${rootDir}-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "결혼준비대행서비스", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "(제주)_샘플실패업체.docx"), "generated fixture");
  await scanSources({ rootDir, stateDir });
  const manifest = await loadManifest(stateDir);
  manifest.units[0].stage = "error";
  manifest.units[0].notices.push(
    "extract 실패: C:\\private\\실제업체명.xlsx OPENAI_API_KEY=secret generated failure",
  );
  await saveManifest(manifest);

  const status = await getIngestStatus({ stateDir });
  assert.deepEqual(status.failed_unit_details, [{
    unit_id: manifest.units[0].unit_id,
    error_codes: ["extract_failed"],
  }]);
  const table = formatIngestStatus(status);
  assert.match(table, new RegExp(manifest.units[0].unit_id, "u"));
  assert.match(table, /extract_failed/u);
  assert.doesNotMatch(table, /실제업체명|OPENAI_API_KEY|private/u);
});
