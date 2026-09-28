import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadRecoveryCaptureLineage, assertRecoveryCaptureLedger, buildRecoveryCaptureInventorySql } from '../lib/recovery-capture-lineage.mjs';
import { createWeddingCodePairSessionHistoricalRepository } from './fixtures/wedding-code-pair-session-historical-repository.mjs';
import { verifyLegacyJoinInventory } from '../lib/legacy-couple-join-acl-release.mjs';
import { validateLegacyFittingAclObservation } from '../lib/legacy-fitting-acl-release.mjs';
import { digest, digestJson } from '../lib/current-baseline-release-contract.mjs';
import { analyzeReadOnlySqlEnvelope } from '../lib/sql-read-only-envelope.mjs';

const root = resolve(import.meta.dirname, '../..');
const code = value => error => error?.code === value;
const expectedVersions = ['20260910160514', '20260911080244', '20260913043211', '20260913075045',
  '20260913082314', '20260913103407', '20260915101500', '20260915130000', '20260917090000',
  '20260918090000', '20260920120000', '20260923104336', '20260923132503', '20260928073546'];
const lineage = loadRecoveryCaptureLineage(root);

test('inventory SQL fixes render context inside READ ONLY before the original catalog body', () => {
  const original = readFileSync(join(root, 'supabase/release-checks/current-baseline-inventory-v1.sql'), 'utf8');
  const sql = buildRecoveryCaptureInventorySql(root);
  const boundary = 'BEGIN TRANSACTION READ ONLY;\n';
  const context = 'SET LOCAL search_path = pg_catalog, public;\n';
  assert.equal(digest(original), '25426ca5d3397de465e137ea3c4119ca2373277b18b8f5e610407deba1ad96f8');
  assert.equal(sql, boundary + context + original.slice(boundary.length));
  assert.ok(sql.indexOf(context) < sql.indexOf('WITH namespaces'));
  assert.ok(sql.indexOf(context) < sql.indexOf('SELECT'));
  assert.equal(sql.replace(context, ''), original, 'all original SQL bytes remain unchanged');
  assert.deepEqual(analyzeReadOnlySqlEnvelope(sql), { ok: true });
  assert.equal(sql.match(/SET LOCAL search_path/g).length, 1);
});

test('inventory builder rejects modified exact source bytes instead of normalizing or repinning them', t => {
  const f = fixture(t);
  const target = join(f.root, 'supabase/release-checks/current-baseline-inventory-v1.sql');
  const original = readFileSync(target);
  try {
    writeFileSync(target, Buffer.concat([original, Buffer.from('\n')]));
    assert.throws(() => buildRecoveryCaptureInventorySql(f.root), code('ARTIFACT_HASH_MISMATCH'));
  } finally { writeFileSync(target, original); }
  assert.equal(buildRecoveryCaptureInventorySql(f.root), buildRecoveryCaptureInventorySql(root));
});

function fixture(t) {
  const value = createWeddingCodePairSessionHistoricalRepository(root);
  t.after(value.cleanup);
  const latestFile = 'supabase/release-contracts/account-deletion-audit-nullability-v1.json';
  const latest = JSON.parse(readFileSync(join(root, latestFile), 'utf8'));
  const predecessor = JSON.parse(readFileSync(join(root, latest.predecessor.file), 'utf8'));
  const files = [latestFile, latest.predecessor.file, latest.predecessorLoader.file, latest.runtime.file,
    predecessor.runtime.file, predecessor.catalog.file, predecessor.catalogFixture.file,
    ...[latest, predecessor].flatMap(contract => contract.migrations.map(pin => `supabase/migrations/${pin.file}`)),
    lineage.historical.loader.file, lineage.current.loader.file,
    ...lineage.manualAclReleases.flatMap(release => [release.source.file, ...(release.contract ? [release.contract.file] : [])])];
  for (const file of files) {
    mkdirSync(dirname(join(value.root, file)), { recursive: true });
    copyFileSync(join(root, file), join(value.root, file));
  }
  return value;
}

test('fixed 215 ledger plus the exact 14 raw SQLs produces the reviewed 229-row expectation', () => {
  assert.equal(lineage.scope, 'expected-ledger-and-manual-acl-source-lineage-only');
  assert.equal(lineage.historical.ledgerCount, 215);
  assert.equal(lineage.current.reviewedMigrations.length, 240);
  assert.deepEqual(lineage.appendedMigrations.map(pin => pin.ledgerRow.version), expectedVersions);
  assert.equal(lineage.expectedLedger.length, 229);
  assert.equal(lineage.expectedLedgerSha256, '072d7cb5e765875122a194637901283fd97cfa7bc7a4c737d3d588ca92e5c2fa');
  assert.equal(lineage.historical.ledgerSha256, '112ed34186a9354b63a93ed90601dcc983dc1d9acb6e8b571b9a7122dd218209');
  assert.equal(lineage.expectedLedger.at(-1).statementsSha256, '9a590ba42231604858596d36ed748d1934e959ce2fbd76dd7e2eeb3992b17d61');
  for (const pin of lineage.appendedMigrations) {
    const raw = readFileSync(join(root, 'supabase/migrations', pin.file));
    assert.equal(digest(raw), pin.sha256);
    assert.equal(digest(JSON.stringify([raw.toString('utf8')])), pin.ledgerRow.statementsSha256);
    assert.notEqual(pin.sha256, pin.ledgerRow.statementsSha256, 'file hash must not stand in for ledger statement-array hash');
  }
  assert.equal(Object.hasOwn(lineage, 'fullRestoreVerified'), false);
  assert.equal(Object.hasOwn(lineage, 'sourceVerified'), false);
});

test('exact ledger comparison checks contents, ordering and shape rather than count', () => {
  const actual = structuredClone(lineage.expectedLedger);
  assert.deepEqual(assertRecoveryCaptureLedger(lineage, actual), { scope: 'ledger-content-equality-only',
    ledgerCount: 229, ledgerSha256: lineage.expectedLedgerSha256 });
  assert.deepEqual(actual, lineage.expectedLedger, 'caller data is not rewritten');
  const changedHash = structuredClone(actual); changedHash.at(-1).statementsSha256 = 'a'.repeat(64);
  const changedName = structuredClone(actual); changedName.at(-1).name += '_different';
  const duplicate = structuredClone(actual); duplicate[1] = duplicate[0];
  const reordered = structuredClone(actual); [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  const extraField = structuredClone(actual); extraField[0].unreviewed = true;
  for (const invalid of [null, {}, [], actual.slice(0, 215), actual.slice(1), [...actual, actual.at(-1)],
    changedHash, changedName, duplicate, reordered, extraField])
    assert.throws(() => assertRecoveryCaptureLedger(lineage, invalid), code('RECOVERY_LINEAGE_LEDGER_MISMATCH'));
});

test('loaded expectations are immutable and cloned or caller-authored expectations are not trusted', () => {
  assert.ok(Object.isFrozen(lineage)); assert.ok(Object.isFrozen(lineage.expectedLedger[0]));
  assert.throws(() => { lineage.expectedLedger[0].name = 'different'; }, TypeError);
  for (const invented of [null, {}, structuredClone(lineage), { expectedLedger: [] }])
    assert.throws(() => assertRecoveryCaptureLedger(invented, []), code('RECOVERY_LINEAGE_NOT_LOADED'));
});

test('manual ACL expectations retain existing after-phase validators and do not invent ledger rows', () => {
  const [joinAcl, fittingAcl] = lineage.manualAclReleases;
  assert.equal(joinAcl.release, 'legacy-couple-join-acl-20260913');
  assert.equal(fittingAcl.release, 'legacy-fitting-acl-20260928');
  assert.deepEqual(joinAcl.ledgerChanges, []); assert.deepEqual(fittingAcl.ledgerChanges, []);
  assert.doesNotThrow(() => verifyLegacyJoinInventory(joinAcl.expectedInventory, 'after'));
  assert.deepEqual(joinAcl.expectedInventory.find(row => row.identity === 'public.join_couple(text,text)'), {
    identity: 'public.join_couple(text,text)', owner: 'postgres', security_definer: true,
    definition_md5: 'ca02d81fd41ba72ce8ef0df36eb3c708', acl: '{postgres=X/postgres}',
    anon_execute: false, authenticated_execute: false, service_execute: false });
  const now = new Date('2026-09-28T12:00:00Z');
  assert.equal(validateLegacyFittingAclObservation({ format: 'legacy-fitting-acl-observation-v1',
    systemIdentifier: lineage.systemIdentifier, database: 'postgres', serverVersion: '17.6', readOnly: true,
    observedAt: now.toISOString(), inventory: fittingAcl.expectedInventory,
    preservation: { defaultAclSha256: 'a'.repeat(64), ledgerSha256: 'b'.repeat(64), ledgerCount: 229 } }, { now, phase: 'after' }), 'after');
  for (const release of lineage.manualAclReleases) assert.equal(digest(readFileSync(join(root, release.source.file))), release.source.sha256);
});

test('copied historical fixture reproduces the exact expectation without production evidence', t => {
  const f = fixture(t);
  const copy = loadRecoveryCaptureLineage(f.root);
  assert.equal(digestJson(copy), digestJson(lineage));
});

test('modified SQL, baseline, loader and manual ACL source bytes are rejected without repinning', t => {
  const f = fixture(t);
  const files = [`supabase/migrations/${lineage.appendedMigrations.at(-1).file}`,
    `supabase/migrations/${lineage.current.reviewedMigrations[0].file}`, lineage.historical.baseline.file,
    lineage.current.loader.file, lineage.historical.loader.file,
    ...lineage.manualAclReleases.flatMap(release => [release.source.file, ...(release.contract ? [release.contract.file] : [])])];
  for (const file of files) {
    const target = join(f.root, file), original = readFileSync(target);
    try {
      writeFileSync(target, Buffer.concat([original, Buffer.from('\n')]));
      assert.throws(() => loadRecoveryCaptureLineage(f.root), code('ARTIFACT_HASH_MISMATCH'), file);
    } finally { writeFileSync(target, original); }
  }
});

test('extra SQL or missing reviewed SQL cannot silently change expected ledger scope', t => {
  const f = fixture(t);
  for (const name of ['20260929000000_unreviewed.sql', '20200101000000_unreviewed.sql']) {
    const file = join(f.root, 'supabase/migrations', name);
    try {
      writeFileSync(file, 'SELECT 1;\n', { flag: 'wx' });
      assert.throws(() => loadRecoveryCaptureLineage(f.root), code('NEW_MIGRATION_NOT_REVIEWED'));
    } finally { rmSync(file); }
  }
  const file = join(f.root, 'supabase/migrations', lineage.appendedMigrations.at(-1).file), original = readFileSync(file);
  try {
    rmSync(file);
    assert.throws(() => loadRecoveryCaptureLineage(f.root), code('NEW_MIGRATION_NOT_REVIEWED'));
  } finally { writeFileSync(file, original); }
});
