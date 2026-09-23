import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadAmoraDecisionPrivacyCandidate } from '../lib/amora-decision-privacy-candidate.mjs';
import { buildAmoraDecisionPrivacyInspectionSql, validateAmoraDecisionPrivacyInspection, classifyAmoraDecisionPrivacyLedger } from '../lib/amora-decision-privacy-inspection.mjs';
import { analyzeReadOnlySqlEnvelope } from '../lib/sql-read-only-envelope.mjs';
import { createAmoraPrivacyDecisionDatabase, nativeAmoraAvailable, publicCatalog } from './fixtures/amora-privacy-decision-native.mjs';

const root = resolve(import.meta.dirname, '../..');
const plan = loadAmoraDecisionPrivacyCandidate(root);
const native = { skip: nativeAmoraAvailable ? false : 'native PG17 unavailable; inspection SQL unverified', timeout: 60000 };
let db;
test.before(async () => {
  if (!nativeAmoraAvailable) return;
  db = await createAmoraPrivacyDecisionDatabase({ applyDecision: false, applyPrivacy: false });
  await db.client.query(`CREATE SCHEMA supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
    CREATE ROLE supabase_read_only_user NOLOGIN;
    GRANT USAGE ON SCHEMA supabase_migrations TO supabase_read_only_user;
    GRANT SELECT ON supabase_migrations.schema_migrations TO supabase_read_only_user;
    GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO supabase_read_only_user;`);
  await db.client.query('INSERT INTO supabase_migrations.schema_migrations VALUES($1,$2,$3)', ['20260920120000',
    'wedding_preparation_style', [readFileSync(resolve(root, 'supabase/migrations/20260920120000_wedding_preparation_style.sql'), 'utf8')]]);
});
test.after(async () => { if (db) { await db.client.query('RESET SESSION AUTHORIZATION'); await db.close(); } });
async function inspect() {
  await db.client.query('SET SESSION AUTHORIZATION supabase_read_only_user');
  try {
    const result = await db.client.query(buildAmoraDecisionPrivacyInspectionSql(plan));
    const rows = result.flatMap(statement => statement.rows ?? []);
    assert.equal(rows.length, 1);
    return rows[0].observation;
  } finally { await db.client.query('ROLLBACK'); await db.client.query('RESET SESSION AUTHORIZATION'); }
}

test('native inspection reads the baseline as the actual read-only session without modifying catalog or returning function source', native, async () => {
  const before = await publicCatalog(db.client);
  const value = await inspect();
  assert.deepEqual(analyzeReadOnlySqlEnvelope(buildAmoraDecisionPrivacyInspectionSql(plan)), { ok: true });
  assert.equal(value.currentUser, 'supabase_read_only_user'); assert.equal(value.sessionUser, 'supabase_read_only_user');
  assert.equal(value.readOnly, true); assert.equal(value.functions.length, 14);
  assert.equal(value.functions.filter(row => row.present).length, 8);
  assert.equal(value.functions.filter(row => !row.present).length, 6);
  assert.equal(value.ledger.length, 1);
  assert.equal(value.ledger[0].singleStatementSha256,
    plan.reviewedMigrations.find(pin => pin.file === '20260920120000_wedding_preparation_style.sql').sha256);
  assert.match(value.preservedCatalogSha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(value).includes('CREATE OR REPLACE FUNCTION'), false);
  assert.deepEqual(await publicCatalog(db.client), before);
  assert.throws(() => validateAmoraDecisionPrivacyInspection(value, { plan, startedAt: new Date(Date.now() - 10000), finishedAt: new Date() }),
    { code: 'AMORA_INSPECTION_IDENTITY_INVALID' });
});

test('native inspection observes exactly eight changed and six added functions while preserving unrelated catalogs and full ledger digest', native, async () => {
  const before = await inspect();
  await db.applySuccessors();
  for (const pin of plan.contract.migrations) await db.client.query(
    'INSERT INTO supabase_migrations.schema_migrations VALUES($1,$2,$3)',
    [pin.file.slice(0, 14), pin.file.slice(15, -4), [readFileSync(resolve(root, 'supabase/migrations', pin.file), 'utf8')]]);
  const after = await inspect();
  assert.deepEqual(after.functions.filter((row, index) => row.present && before.functions[index].present
    && row.catalogSha256 !== before.functions[index].catalogSha256).map(row => row.signature), plan.contract.scope.changedFunctions);
  assert.deepEqual(after.functions.filter((row, index) => row.present && !before.functions[index].present)
    .map(row => row.signature), plan.contract.scope.addedFunctions);
  assert.equal(after.preservedCatalogSha256, before.preservedCatalogSha256);
  assert.notEqual(after.ledgerSha256, before.ledgerSha256);
  assert.equal(classifyAmoraDecisionPrivacyLedger(after, plan), 'candidate-present-unreviewed');
  const independentlyHashed = (await db.client.query(`SELECT encode(sha256(convert_to(
    jsonb_agg(to_jsonb(m) ORDER BY version COLLATE "C")::text,'UTF8')),'hex') AS hash
    FROM supabase_migrations.schema_migrations m`)).rows[0].hash;
  assert.equal(after.ledgerSha256, independentlyHashed);
  // 로컬 cluster는 운영 identity가 아니다. 스키마 검증만을 위한 합성 복사이며 원본 identity는 위 테스트에서 거부된다.
  const synthetic = { ...after, systemIdentifier: plan.contract.systemIdentifier };
  const result = validateAmoraDecisionPrivacyInspection(synthetic, { plan,
    startedAt: new Date(Date.now() - 10000), finishedAt: new Date() });
  assert.equal(result.releaseAuthorized, false);
  assert.equal(result.status, 'observed-unreviewed');
});

test('native inspection exposes an unexpected executable grant, overload and unrelated RLS drift without invoking application functions', native, async () => {
  const signature = 'public.mutate_amora_memory_with_confirmation(uuid,uuid,bigint,text,text,boolean)';
  const before = await inspect();
  const original = before.functions.find(row => row.signature === signature);
  assert.equal(original.effectiveExecute.anon, false);
  await db.client.query(`GRANT EXECUTE ON FUNCTION ${signature} TO anon`);
  const granted = await inspect(), changed = granted.functions.find(row => row.signature === signature);
  assert.equal(changed.definitionSha256, original.definitionSha256);
  assert.notEqual(changed.catalogSha256, original.catalogSha256);
  assert.equal(changed.effectiveExecute.anon, true);
  assert.equal(granted.preservedCatalogSha256, before.preservedCatalogSha256);
  await db.client.query(`REVOKE EXECUTE ON FUNCTION ${signature} FROM anon;
    CREATE FUNCTION public.amora_shared_action_policy(text) RETURNS text LANGUAGE plpgsql AS
    $$ BEGIN RAISE EXCEPTION 'inspector must not execute application functions'; END $$;`);
  const overloaded = await inspect();
  assert.deepEqual(overloaded.overloads.map(row => row.signature), ['public.amora_shared_action_policy(text)']);
  assert.equal(overloaded.overloads[0].effectiveExecute.anon, true);
  assert.notEqual(overloaded.preservedCatalogSha256, before.preservedCatalogSha256);
  await db.client.query('DROP FUNCTION public.amora_shared_action_policy(text)');
  assert.equal((await inspect()).preservedCatalogSha256, before.preservedCatalogSha256);
  await db.client.query('ALTER TABLE public.amora_privacy_context_epochs DISABLE ROW LEVEL SECURITY');
  assert.notEqual((await inspect()).preservedCatalogSha256, before.preservedCatalogSha256);
  await db.client.query('ALTER TABLE public.amora_privacy_context_epochs ENABLE ROW LEVEL SECURITY');
  assert.equal((await inspect()).preservedCatalogSha256, before.preservedCatalogSha256);
});

test('native full ledger digest includes additional ledger columns not exposed in the redacted row summaries', native, async () => {
  const before = await inspect();
  await db.client.query("ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN migration_note text DEFAULT 'synthetic-note'");
  const after = await inspect();
  assert.deepEqual(after.ledger, before.ledger);
  assert.notEqual(after.ledgerSha256, before.ledgerSha256);
  assert.equal(JSON.stringify(after).includes('synthetic-note'), false);
  assert.equal(after.preservedCatalogSha256, before.preservedCatalogSha256);
});
