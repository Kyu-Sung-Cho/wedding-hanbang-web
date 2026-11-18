// 웨딩홀 문의 배포 길의 운영 빌드 정적 계약(2026-11-18). 36문항 계약(정확히 243개)을 바꾸지 않고 그 위에 한 판을 더 쌓는다.
// 빌드가 통과하려면: 검토한 SQL·catalog hash 그대로, 기준 커밋의 기존 원문 392개 그대로, 마이그레이션은 정확히 244개,
// 묶여 있는 벤더 매니페스트 사슬 그대로, 36문항 길의 고정 원문 그대로. Git 이력·DB·운영 인가는 요구하지도 주장하지도 않는다.
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { readAnchored } from './lib/current-baseline-release-contract.mjs';
import { BASE_COMMIT, loadPlan, MANIFEST, MIGRATION, PREDECESSOR_SNAPSHOT } from './hall-inquiry-release.mjs';
import { loadPlan as loadWeddingCode36Plan } from './wedding-code36-release.mjs';

// 이 중 하나라도 있으면 이 판으로만 검사한다. 증거가 빠지거나 손상돼도 예전 판(36문항)으로 내려가지 않는다.
export const HALL_INQUIRY_BUILD_MARKERS = Object.freeze([MANIFEST, MIGRATION, PREDECESSOR_SNAPSHOT,
  'apps/web/src/lib/invitation/inquiryRpc.ts']);
export const HALL_INQUIRY_PREDECESSOR_SNAPSHOT_SHA256 = 'd8ec8cc9414e627f76374dc96f26cba30ca27d81915f5cb2d4ce6105bfc19030';
const REVIEWED_SQL_SHA256 = 'b04f62efa2a7bf73471511cdc21a110c39b3440e4d74b13c7f03b66ef2e1f0cd';
const REVIEWED_CATALOG_SHA256 = 'ab6e6c359a0a1053684e4304e8948c5ba434afacae9af3702e879a992f211191';
const PREDECESSOR_FILES = 392;
const PREDECESSOR_MIGRATIONS = 243;
const VENDOR_MANIFEST = 'supabase/release-manifests/vendor-disclosure-v2-20260718.json';
const VENDOR_MANIFEST_SHA256 = '9fdf97e91ca6e53ac19394443d452061f635d1f05cfceff50483fa3d3cc5f3e7';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const requireValue = (ok, code) => { if (!ok) throw new Error(code); };
const same = (a, b, code) => requireValue(JSON.stringify(a) === JSON.stringify(b), code);

function predecessorInputs(repoRoot) {
  const raw = readAnchored(repoRoot, PREDECESSOR_SNAPSHOT);
  requireValue(sha(raw) === HALL_INQUIRY_PREDECESSOR_SNAPSHOT_SHA256, 'HIQ_BUILD_SNAPSHOT_HASH_MISMATCH');
  const snapshot = JSON.parse(raw.toString('utf8'));
  requireValue(snapshot.format === 'hall-inquiry-predecessor-snapshot-v1' && snapshot.baseCommit === BASE_COMMIT
    && snapshot.migrationCount === PREDECESSOR_MIGRATIONS && Array.isArray(snapshot.files)
    && snapshot.files.length === PREDECESSOR_FILES, 'HIQ_BUILD_SNAPSHOT_INVALID');
  let previous = '';
  const migrations = [];
  for (const pin of snapshot.files) {
    requireValue(pin && Object.keys(pin).sort().join(',') === 'bytes,file,gitBlob,sha256'
      && typeof pin.file === 'string' && pin.file > previous
      && /^(?:scripts\/lib|supabase\/migrations|supabase\/release-contracts)\/[^\\:]+$/u.test(pin.file)
      && /^[a-f0-9]{40}$/u.test(pin.gitBlob ?? '') && /^[a-f0-9]{64}$/u.test(pin.sha256 ?? '')
      && Number.isSafeInteger(pin.bytes) && pin.bytes > 0, 'HIQ_BUILD_PREDECESSOR_PIN_INVALID');
    const bytes = readAnchored(repoRoot, pin.file);
    requireValue(bytes.length === pin.bytes && sha(bytes) === pin.sha256, 'HIQ_BUILD_PREDECESSOR_PIN_CHANGED');
    previous = pin.file;
    if (pin.file.startsWith('supabase/migrations/') && pin.file.endsWith('.sql')) migrations.push(pin.file.slice('supabase/migrations/'.length));
  }
  requireValue(migrations.length === PREDECESSOR_MIGRATIONS, 'HIQ_BUILD_PREDECESSOR_MIGRATIONS_INVALID');
  return { snapshot, migrations };
}

function fixedVendorChain(repoRoot) {
  const visited = new Set();
  function read(file, expectedSha) {
    requireValue(typeof file === 'string' && /^supabase\/release-manifests\/[a-z0-9][a-z0-9-]*\.json$/u.test(file)
      && /^[a-f0-9]{64}$/u.test(expectedSha ?? '') && !visited.has(file) && visited.size < 16,
    'HIQ_BUILD_VENDOR_CHAIN_INVALID');
    const raw = readAnchored(repoRoot, file);
    requireValue(sha(raw.toString('utf8').replace(/\r\n?/gu, '\n')) === expectedSha, 'HIQ_BUILD_VENDOR_PIN_CHANGED');
    const manifest = JSON.parse(raw.toString('utf8'));
    requireValue(manifest.projectRef === 'slrtobkksjmxgzatjyqb', 'HIQ_BUILD_VENDOR_PROJECT_INVALID');
    visited.add(file);
    if (manifest.predecessorManifest) read(manifest.predecessorManifest.file, manifest.predecessorManifest.sha256);
    return manifest;
  }
  const manifest = read(VENDOR_MANIFEST, VENDOR_MANIFEST_SHA256);
  requireValue(manifest.release === 'vendor-disclosure-v2-20260718' && manifest.status === 'deployment_blocked'
    && manifest.deploymentEvidence && Object.keys(manifest.deploymentEvidence).sort().join(',') === 'backup,finalizer,hostedRestore,hostedStaging,storage'
    && Object.values(manifest.deploymentEvidence).every(value => value === 'missing'), 'HIQ_BUILD_VENDOR_STATE_INVALID');
  return { manifest, count: visited.size };
}

function previousLaneIntact(repoRoot) {
  try { return loadWeddingCode36Plan(repoRoot); } catch { throw new Error('HIQ_BUILD_PREVIOUS_LANE_CHANGED'); }
}

/** Static build admission only. No Git requirement, source provenance, DB or release authorization. */
export function validateHallInquiryProductionBuildContract(options) {
  requireValue(options && typeof options === 'object' && !Array.isArray(options)
    && Object.keys(options).join(',') === 'repoRoot' && typeof options.repoRoot === 'string' && isAbsolute(options.repoRoot),
  'HIQ_BUILD_OPTIONS_INVALID');
  const { repoRoot } = options;
  const plan = loadPlan(repoRoot);
  requireValue(plan.sqlSha256 === REVIEWED_SQL_SHA256 && plan.fixtureSha256 === REVIEWED_CATALOG_SHA256,
    'HIQ_BUILD_REVIEWED_ARTIFACT_CHANGED');
  const { snapshot, migrations } = predecessorInputs(repoRoot);
  const expected = [...migrations, MIGRATION.slice('supabase/migrations/'.length)].sort();
  const actual = readdirSync(`${repoRoot}/supabase/migrations`).filter(file => /\.sql$/iu.test(file)).sort();
  same(actual, expected, 'HIQ_BUILD_MIGRATION_SET_DRIFT');
  const vendor = fixedVendorChain(repoRoot);
  const previous = previousLaneIntact(repoRoot);
  // Recheck all trusted inputs after validation; filesystem mutation is never success.
  const repeated = loadPlan(repoRoot);
  requireValue(repeated.manifestSha256 === plan.manifestSha256, 'HIQ_BUILD_ARTIFACT_CHANGED_DURING_VALIDATION');
  predecessorInputs(repoRoot);
  fixedVendorChain(repoRoot);
  previousLaneIntact(repoRoot);
  return Object.freeze({ kind: 'hall-inquiry-source-only-production-build-contract',
    scope: 'exact244-and-fixed-blocked-vendor-manifest-not-operational-authorization',
    migrationCount: actual.length, preservedPredecessorFiles: snapshot.files.length, baseCommit: BASE_COMMIT,
    sqlSha256: plan.sqlSha256, fixtureSha256: plan.fixtureSha256,
    predecessorSnapshotSha256: HALL_INQUIRY_PREDECESSOR_SNAPSHOT_SHA256, previousLaneSqlSha256: previous.sqlSha256,
    vendorManifestSha256: VENDOR_MANIFEST_SHA256, vendorManifestCount: vendor.count,
    controllerReady: false, deploymentBlocked: true, controllerManifest: null,
    releaseAuthorized: false, runtimeEvidenceVerified: false, sourceCiVerified: false,
    remoteWritesPerformed: false, productionApplyImplemented: true });
}
