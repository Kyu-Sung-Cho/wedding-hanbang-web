import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { readAnchored } from './lib/current-baseline-release-contract.mjs';
import { BASE_COMMIT, loadPlan, MANIFEST, MIGRATION } from './wedding-code36-release.mjs';

export const WEDDING_CODE36_PREDECESSOR_SNAPSHOT = 'supabase/release-contracts/wedding-code36-predecessor-build-inputs-v1.json';
export const WEDDING_CODE36_BUILD_MARKERS = Object.freeze([MANIFEST, MIGRATION, WEDDING_CODE36_PREDECESSOR_SNAPSHOT,
  'apps/web/src/constants/weddingCode36.ts']);
export const WEDDING_CODE36_PREDECESSOR_SNAPSHOT_SHA256 = '3e4440945037b64bdfde1b83bc809b0dc08fb17bdf0f472422165e286873de0e';
const REVIEWED_SQL_SHA256 = '80fdb56216ef7f5350f0eff26fe75056e5fa9b5bf227951b923b61dcbbbbf56e';
const REVIEWED_CATALOG_SHA256 = '73e4115bb304f046f05333c2f6b26bd88a0c71f0d7f5b02e6cdafb3b454fa2be';
const VENDOR_MANIFEST = 'supabase/release-manifests/vendor-disclosure-v2-20260718.json';
const VENDOR_MANIFEST_SHA256 = '9fdf97e91ca6e53ac19394443d452061f635d1f05cfceff50483fa3d3cc5f3e7';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const requireValue = (ok, code) => { if (!ok) throw new Error(code); };
const same = (a, b, code) => requireValue(JSON.stringify(a) === JSON.stringify(b), code);

function predecessorInputs(repoRoot) {
  const raw = readAnchored(repoRoot, WEDDING_CODE36_PREDECESSOR_SNAPSHOT);
  requireValue(sha(raw) === WEDDING_CODE36_PREDECESSOR_SNAPSHOT_SHA256, 'WC36_BUILD_SNAPSHOT_HASH_MISMATCH');
  const snapshot = JSON.parse(raw.toString('utf8'));
  requireValue(snapshot.format === 'wedding-code36-predecessor-snapshot-v1' && snapshot.baseCommit === BASE_COMMIT
    && snapshot.migrationCount === 242 && Array.isArray(snapshot.files) && snapshot.files.length === 388,
  'WC36_BUILD_SNAPSHOT_INVALID');
  let previous = '';
  const migrations = [];
  for (const pin of snapshot.files) {
    requireValue(pin && Object.keys(pin).sort().join(',') === 'bytes,file,gitBlob,sha256'
      && typeof pin.file === 'string' && pin.file > previous
      && /^(?:scripts\/lib|supabase\/migrations|supabase\/release-contracts)\/[^\\:]+$/u.test(pin.file)
      && /^[a-f0-9]{40}$/u.test(pin.gitBlob ?? '') && /^[a-f0-9]{64}$/u.test(pin.sha256 ?? '')
      && Number.isSafeInteger(pin.bytes) && pin.bytes > 0, 'WC36_BUILD_PREDECESSOR_PIN_INVALID');
    const bytes = readAnchored(repoRoot, pin.file);
    requireValue(bytes.length === pin.bytes && sha(bytes) === pin.sha256, 'WC36_BUILD_PREDECESSOR_PIN_CHANGED');
    previous = pin.file;
    if (pin.file.startsWith('supabase/migrations/')) migrations.push(pin.file.slice('supabase/migrations/'.length));
  }
  requireValue(migrations.length === 242, 'WC36_BUILD_PREDECESSOR_MIGRATIONS_INVALID');
  return { snapshot, migrations };
}

function fixedVendorChain(repoRoot) {
  const visited = new Set();
  function read(file, expectedSha) {
    requireValue(typeof file === 'string' && /^supabase\/release-manifests\/[a-z0-9][a-z0-9-]*\.json$/u.test(file)
      && /^[a-f0-9]{64}$/u.test(expectedSha ?? '') && !visited.has(file) && visited.size < 16,
    'WC36_BUILD_VENDOR_CHAIN_INVALID');
    const raw = readAnchored(repoRoot, file);
    requireValue(sha(raw.toString('utf8').replace(/\r\n?/gu, '\n')) === expectedSha, 'WC36_BUILD_VENDOR_PIN_CHANGED');
    const manifest = JSON.parse(raw.toString('utf8'));
    requireValue(manifest.projectRef === 'slrtobkksjmxgzatjyqb', 'WC36_BUILD_VENDOR_PROJECT_INVALID');
    visited.add(file);
    if (manifest.predecessorManifest) read(manifest.predecessorManifest.file, manifest.predecessorManifest.sha256);
    return manifest;
  }
  const manifest = read(VENDOR_MANIFEST, VENDOR_MANIFEST_SHA256);
  requireValue(manifest.release === 'vendor-disclosure-v2-20260718' && manifest.status === 'deployment_blocked'
    && manifest.deploymentEvidence && Object.keys(manifest.deploymentEvidence).sort().join(',') === 'backup,finalizer,hostedRestore,hostedStaging,storage'
    && Object.values(manifest.deploymentEvidence).every(value => value === 'missing'), 'WC36_BUILD_VENDOR_STATE_INVALID');
  return { manifest, count: visited.size };
}

/** Static build admission only. No Git requirement, source provenance, DB or release authorization. */
export function validateWeddingCode36ProductionBuildContract(options) {
  requireValue(options && typeof options === 'object' && !Array.isArray(options)
    && Object.keys(options).join(',') === 'repoRoot' && typeof options.repoRoot === 'string' && isAbsolute(options.repoRoot),
  'WC36_BUILD_OPTIONS_INVALID');
  const { repoRoot } = options;
  const plan = loadPlan(repoRoot);
  requireValue(plan.sqlSha256 === REVIEWED_SQL_SHA256 && plan.fixtureSha256 === REVIEWED_CATALOG_SHA256,
    'WC36_BUILD_REVIEWED_ARTIFACT_CHANGED');
  const { snapshot, migrations } = predecessorInputs(repoRoot);
  const expected = [...migrations, MIGRATION.slice('supabase/migrations/'.length)].sort();
  const actual = readdirSync(`${repoRoot}/supabase/migrations`).filter(file => /\.sql$/iu.test(file)).sort();
  same(actual, expected, 'WC36_BUILD_MIGRATION_SET_DRIFT');
  const vendor = fixedVendorChain(repoRoot);
  // Recheck all trusted inputs after validation; filesystem mutation is never success.
  const repeated = loadPlan(repoRoot);
  requireValue(repeated.manifestSha256 === plan.manifestSha256, 'WC36_BUILD_ARTIFACT_CHANGED_DURING_VALIDATION');
  predecessorInputs(repoRoot);
  fixedVendorChain(repoRoot);
  return Object.freeze({ kind: 'wedding-code36-source-only-production-build-contract',
    scope: 'exact243-and-fixed-blocked-vendor-manifest-not-operational-authorization',
    migrationCount: actual.length, preservedPredecessorFiles: snapshot.files.length, baseCommit: BASE_COMMIT,
    sqlSha256: plan.sqlSha256, fixtureSha256: plan.fixtureSha256,
    predecessorSnapshotSha256: WEDDING_CODE36_PREDECESSOR_SNAPSHOT_SHA256,
    vendorManifestSha256: VENDOR_MANIFEST_SHA256, vendorManifestCount: vendor.count,
    controllerReady: false, deploymentBlocked: true, controllerManifest: null,
    releaseAuthorized: false, runtimeEvidenceVerified: false, sourceCiVerified: false,
    remoteWritesPerformed: false, productionApplyImplemented: true });
}
