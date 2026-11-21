// 아모라 맡은 일 배포 길의 운영 빌드 정적 계약(2026-11-20). 웨딩홀 문의 계약(정확히 244개)을 바꾸지 않고 그 위에 한 판을 더 쌓는다.
// 빌드가 통과하려면: 검토한 SQL·catalog hash 그대로, 기준 커밋의 기존 원문 396개 그대로, 마이그레이션은 정확히 245개,
// 묶여 있는 벤더 매니페스트 사슬 그대로, 웨딩홀 문의 길과 36문항 길의 고정 원문 그대로.
// Git 이력·DB·운영 인가는 요구하지도 주장하지도 않는다.
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { readAnchored } from './lib/current-baseline-release-contract.mjs';
import { BASE_COMMIT, loadPlan, loadPreviousLanePlans, MANIFEST, MIGRATION, PREDECESSOR_SNAPSHOT } from './amora-tasks-release.mjs';

// 이 중 하나라도 있으면 이 판으로만 검사한다. 증거가 빠지거나 손상돼도 예전 판(웨딩홀 문의)으로 내려가지 않는다.
// 마지막 것은 새 RPC 를 부르는 앱 코드다. 증거 파일을 다 지워도 앱 코드가 남아 있으면 이 판이 막는다.
export const AMORA_TASKS_BUILD_MARKERS = Object.freeze([MANIFEST, MIGRATION, PREDECESSOR_SNAPSHOT,
  'apps/web/src/lib/amoraTasks/taskStore.ts']);
export const AMORA_TASKS_PREDECESSOR_SNAPSHOT_SHA256 = '9f5bd496486131a1374cb1b4f2aed779662703b672840dcf4fda2d7d5bcc3046';
const REVIEWED_SQL_SHA256 = '2a9f2a00d3e196090f57f7803eed8678ec0adfbb4ec7a5848aceb03bfefda6c7';
const REVIEWED_CATALOG_SHA256 = 'c78964de912fbed7413634ab8db93f3d7e92b44b35c117a3b3588bc3a427dd6e';
const PREDECESSOR_FILES = 396;
const PREDECESSOR_MIGRATIONS = 244;
const VENDOR_MANIFEST = 'supabase/release-manifests/vendor-disclosure-v2-20260718.json';
const VENDOR_MANIFEST_SHA256 = '9fdf97e91ca6e53ac19394443d452061f635d1f05cfceff50483fa3d3cc5f3e7';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const requireValue = (ok, code) => { if (!ok) throw new Error(code); };
const same = (a, b, code) => requireValue(JSON.stringify(a) === JSON.stringify(b), code);

function predecessorInputs(repoRoot) {
  const raw = readAnchored(repoRoot, PREDECESSOR_SNAPSHOT);
  requireValue(sha(raw) === AMORA_TASKS_PREDECESSOR_SNAPSHOT_SHA256, 'ATK_BUILD_SNAPSHOT_HASH_MISMATCH');
  const snapshot = JSON.parse(raw.toString('utf8'));
  requireValue(snapshot.format === 'amora-tasks-predecessor-snapshot-v1' && snapshot.baseCommit === BASE_COMMIT
    && snapshot.migrationCount === PREDECESSOR_MIGRATIONS && Array.isArray(snapshot.files)
    && snapshot.files.length === PREDECESSOR_FILES, 'ATK_BUILD_SNAPSHOT_INVALID');
  let previous = '';
  const migrations = [];
  for (const pin of snapshot.files) {
    requireValue(pin && Object.keys(pin).sort().join(',') === 'bytes,file,gitBlob,sha256'
      && typeof pin.file === 'string' && pin.file > previous
      && /^(?:scripts\/lib|supabase\/migrations|supabase\/release-contracts)\/[^\\:]+$/u.test(pin.file)
      && /^[a-f0-9]{40}$/u.test(pin.gitBlob ?? '') && /^[a-f0-9]{64}$/u.test(pin.sha256 ?? '')
      && Number.isSafeInteger(pin.bytes) && pin.bytes > 0, 'ATK_BUILD_PREDECESSOR_PIN_INVALID');
    const bytes = readAnchored(repoRoot, pin.file);
    requireValue(bytes.length === pin.bytes && sha(bytes) === pin.sha256, 'ATK_BUILD_PREDECESSOR_PIN_CHANGED');
    previous = pin.file;
    if (pin.file.startsWith('supabase/migrations/') && pin.file.endsWith('.sql')) migrations.push(pin.file.slice('supabase/migrations/'.length));
  }
  requireValue(migrations.length === PREDECESSOR_MIGRATIONS, 'ATK_BUILD_PREDECESSOR_MIGRATIONS_INVALID');
  return { snapshot, migrations };
}

function fixedVendorChain(repoRoot) {
  const visited = new Set();
  function read(file, expectedSha) {
    requireValue(typeof file === 'string' && /^supabase\/release-manifests\/[a-z0-9][a-z0-9-]*\.json$/u.test(file)
      && /^[a-f0-9]{64}$/u.test(expectedSha ?? '') && !visited.has(file) && visited.size < 16,
    'ATK_BUILD_VENDOR_CHAIN_INVALID');
    const raw = readAnchored(repoRoot, file);
    requireValue(sha(raw.toString('utf8').replace(/\r\n?/gu, '\n')) === expectedSha, 'ATK_BUILD_VENDOR_PIN_CHANGED');
    const manifest = JSON.parse(raw.toString('utf8'));
    requireValue(manifest.projectRef === 'slrtobkksjmxgzatjyqb', 'ATK_BUILD_VENDOR_PROJECT_INVALID');
    visited.add(file);
    if (manifest.predecessorManifest) read(manifest.predecessorManifest.file, manifest.predecessorManifest.sha256);
    return manifest;
  }
  const manifest = read(VENDOR_MANIFEST, VENDOR_MANIFEST_SHA256);
  requireValue(manifest.release === 'vendor-disclosure-v2-20260718' && manifest.status === 'deployment_blocked'
    && manifest.deploymentEvidence && Object.keys(manifest.deploymentEvidence).sort().join(',') === 'backup,finalizer,hostedRestore,hostedStaging,storage'
    && Object.values(manifest.deploymentEvidence).every(value => value === 'missing'), 'ATK_BUILD_VENDOR_STATE_INVALID');
  return { manifest, count: visited.size };
}

// 웨딩홀 문의 길과 36문항 길의 실행기·catalog·준비·빌드 계약은 기준 스냅숏 밖에 있다. 각 길의 loadPlan 으로 지킨다.
function previousLanesIntact(repoRoot) {
  try { return loadPreviousLanePlans(repoRoot); } catch { throw new Error('ATK_BUILD_PREVIOUS_LANE_CHANGED'); }
}

/** Static build admission only. No Git requirement, source provenance, DB or release authorization. */
export function validateAmoraTasksProductionBuildContract(options) {
  requireValue(options && typeof options === 'object' && !Array.isArray(options)
    && Object.keys(options).join(',') === 'repoRoot' && typeof options.repoRoot === 'string' && isAbsolute(options.repoRoot),
  'ATK_BUILD_OPTIONS_INVALID');
  const { repoRoot } = options;
  const plan = loadPlan(repoRoot);
  requireValue(plan.sqlSha256 === REVIEWED_SQL_SHA256 && plan.fixtureSha256 === REVIEWED_CATALOG_SHA256,
    'ATK_BUILD_REVIEWED_ARTIFACT_CHANGED');
  const { snapshot, migrations } = predecessorInputs(repoRoot);
  const expected = [...migrations, MIGRATION.slice('supabase/migrations/'.length)].sort();
  const actual = readdirSync(`${repoRoot}/supabase/migrations`).filter(file => /\.sql$/iu.test(file)).sort();
  same(actual, expected, 'ATK_BUILD_MIGRATION_SET_DRIFT');
  const vendor = fixedVendorChain(repoRoot);
  const previous = previousLanesIntact(repoRoot);
  // Recheck all trusted inputs after validation; filesystem mutation is never success.
  const repeated = loadPlan(repoRoot);
  requireValue(repeated.manifestSha256 === plan.manifestSha256, 'ATK_BUILD_ARTIFACT_CHANGED_DURING_VALIDATION');
  predecessorInputs(repoRoot);
  fixedVendorChain(repoRoot);
  previousLanesIntact(repoRoot);
  return Object.freeze({ kind: 'amora-tasks-source-only-production-build-contract',
    scope: 'exact245-and-fixed-blocked-vendor-manifest-not-operational-authorization',
    migrationCount: actual.length, preservedPredecessorFiles: snapshot.files.length, baseCommit: BASE_COMMIT,
    sqlSha256: plan.sqlSha256, fixtureSha256: plan.fixtureSha256,
    predecessorSnapshotSha256: AMORA_TASKS_PREDECESSOR_SNAPSHOT_SHA256,
    previousLaneSqlSha256: previous.hallInquiry.sqlSha256, olderLaneSqlSha256: previous.weddingCode36.sqlSha256,
    vendorManifestSha256: VENDOR_MANIFEST_SHA256, vendorManifestCount: vendor.count,
    controllerReady: false, deploymentBlocked: true, controllerManifest: null,
    releaseAuthorized: false, runtimeEvidenceVerified: false, sourceCiVerified: false,
    remoteWritesPerformed: false, productionApplyImplemented: true });
}
