import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createCustomerDataNativeDatabase, nativeCustomerDataAvailable } from './fixtures/account-deletion-customer-data-native-database.mjs';
import { buildCustomerDataObservationSql, buildCustomerDataMutationSql, validateCustomerDataCatalog, validateCustomerDataObservation,
  CUSTOMER_DATA_SYSTEM } from '../lib/account-deletion-customer-data-catalog.mjs';
const root = resolve(import.meta.dirname, '../..'), read = file => readFileSync(join(root, file), 'utf8');
const context = { sql: read('supabase/migrations/20260913103407_account_deletion_customer_data_boundary.sql'),
  previousSql: read('supabase/migrations/20260716113000_account_deletion_storage_saga.sql'),
  previousClaimSql: read('supabase/migrations/20260716094000_couple_roster_epoch.sql'),
  predecessorSql: read('supabase/migrations/20260913082314_private_profile_avatars_delivery.sql'),
  fixture: JSON.parse(read('supabase/release-contracts/account-deletion-customer-data-pg17-catalog-v1.json')) };
const options = { skip: nativeCustomerDataAvailable ? false : 'native PostgreSQL 17 unavailable; actual DDL/rollback catalog not verified', timeout: 120000 };
const preserved = ['catalog', 'customerRows', 'preservedCatalogSha', 'jobsCount', 'privateScopesCount', 'retiredRequestsCount',
  'ledgerSha', 'ledgerWithoutTargetSha', 'ledgerCount', 'migration', 'predecessor'];

// Substitute only the owned synthetic host's system identifier. All DDL, lock,
// deadline, target/preserved catalog and customer-row checks execute unchanged.
const bundle = (db, before, rehearsal) => buildCustomerDataMutationSql({ ...context, before, rehearsal,
  deadline: new Date(Date.now() + 120000).toISOString() }).replace(`<> '${CUSTOMER_DATA_SYSTEM}'`, `<> '${db.system}'`)
  .replace(`<>\'${CUSTOMER_DATA_SYSTEM}\'`, `<>\'${db.system}\'`);
const observe = async db => (await db.client.query(buildCustomerDataObservationSql())).find(result => result.rows[0]?.observation).rows[0].observation;

test('PG17 generated transaction rehearses with exact rollback, then adds only reviewed catalog with all original rows preserved', options, async () => {
  const db = await createCustomerDataNativeDatabase(root);
  try {
    const before = await observe(db);
    validateCustomerDataCatalog(before.catalog, context, false);
    assert.throws(() => validateCustomerDataObservation(before, { ...context, now: new Date() }), { code: 'CUSTOMER_DATA_OBSERVATION_INVALID' });
    validateCustomerDataObservation({ ...before, systemIdentifier: CUSTOMER_DATA_SYSTEM }, { ...context, now: new Date() });
    const storageBefore = (await db.client.query('SELECT to_jsonb(o) AS value FROM storage.objects o ORDER BY id')).rows;
    await db.client.query(bundle(db, before, true));
    const rolledBack = await observe(db);
    for (const key of preserved) assert.deepEqual(rolledBack[key], before[key], key);
    await db.client.query(bundle(db, before, false));
    const after = await observe(db);
    validateCustomerDataObservation({ ...after, systemIdentifier: CUSTOMER_DATA_SYSTEM }, { ...context, now: new Date() });
    assert.deepEqual(after.customerRows, before.customerRows); assert.equal(after.preservedCatalogSha, before.preservedCatalogSha);
    assert.equal(after.ledgerCount, before.ledgerCount + 1); assert.equal(after.ledgerWithoutTargetSha, before.ledgerSha);
    assert.equal(after.jobsCount, 0); assert.equal(after.privateScopesCount, 0); assert.equal(after.retiredRequestsCount, 0);
    assert.equal(after.catalog.triggers.length, 13); assert.equal(after.catalog.functions.length, 6); assert.equal(after.catalog.relations.length, 2);
    assert.deepEqual((await db.client.query('SELECT to_jsonb(o) AS value FROM storage.objects o ORDER BY id')).rows, storageBefore);
    assert.equal((await db.client.query("SELECT statements[1] AS sql FROM supabase_migrations.schema_migrations WHERE version='20260913103407'")).rows[0].sql, context.sql);
    await assert.rejects(db.client.query(bundle(db, before, false)), /CUSTOMER_DATA_BASELINE_DRIFT/);
    await db.client.query('ROLLBACK');
    assert.equal((await observe(db)).ledgerCount, after.ledgerCount);
  } finally { await db.close(); }
});

test('PG17 rejects newly queued jobs, customer row drift, replaced-function drift and expired deadline before installing any schema', options, async () => {
  const db = await createCustomerDataNativeDatabase(root);
  try {
    const before = await observe(db);
    const attempt = async (change, expected) => {
      await db.client.query(change);
      const changed = await observe(db);
      await assert.rejects(db.client.query(bundle(db, before, false)), expected);
      await db.client.query('ROLLBACK');
      assert.deepEqual((await observe(db)).catalog, changed.catalog);
      assert.equal((await observe(db)).migration, null);
    };
    await attempt("INSERT INTO account_deletion_jobs(id,user_id,status) VALUES('90000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','pending')", /CUSTOMER_DATA_JOBS_MUST_BE_EMPTY/);
    await db.client.query('DELETE FROM account_deletion_jobs');
    await attempt("UPDATE chat_messages SET content='synthetic drift' WHERE content='shared sentinel'", /CUSTOMER_DATA_BASELINE_DRIFT/);
    await db.client.query("UPDATE chat_messages SET content='shared sentinel' WHERE content='synthetic drift'");
    await attempt('GRANT EXECUTE ON FUNCTION public.claim_amora_memory_job(integer,uuid) TO authenticated', /CUSTOMER_DATA_BASELINE_DRIFT/);
    await db.client.query('REVOKE EXECUTE ON FUNCTION public.claim_amora_memory_job(integer,uuid) FROM authenticated');
    const expired = bundle(db, before, false).replaceAll(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, '2020-01-01T00:00:00.000Z');
    await assert.rejects(db.client.query(expired), /CUSTOMER_DATA_DEADLINE_EXPIRED/); await db.client.query('ROLLBACK');
    assert.equal((await observe(db)).migration, null);
  } finally { await db.close(); }
});
