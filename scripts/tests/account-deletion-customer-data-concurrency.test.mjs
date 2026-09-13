import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createProfileRoleNativeDatabase, nativeProfileRoleAvailable } from './fixtures/profile-role-native-database.mjs';
import { createCustomerDataBoundaryFixture, A, B, C, J, T, key } from './fixtures/account-deletion-customer-data-database.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { Client } = createRequire(import.meta.url)('pg');
const digest = value => createHash('sha256').update(value).digest('hex');
const fixturePath = join(root, 'scripts/tests/fixtures/account-deletion-customer-data-database.mjs');
const fixture = readFileSync(fixturePath, 'utf8');
const inputs = new Map();
const sql = name => {
  if (!inputs.has(name)) inputs.set(name, readFileSync(join(root, 'supabase/migrations', name), 'utf8'));
  return inputs.get(name);
};
const migration = sql('20260913103407_account_deletion_customer_data_boundary.sql');
const insert = (actor, visibility, text) => ({
  text: 'INSERT INTO public.chat_messages(couple_id,sender_id,sender_type,role,content,visibility) VALUES($1,$2,$3,$4,$5,$6)',
  values: [C, actor, actor === A ? 'bride' : 'groom', 'user', text, visibility],
});
const receipt = { customerData: false, remoteCalls: 0, sourceSqlSha256: digest(migration),
  fixtureSha256: digest(fixture), normalConcurrentWrites: false, prepareWaitsForActiveWriter: false,
  lateWriterBlocked: false, partnerWritesPreserved: false, claimLockInversionAvoided: false,
  healthyMemoryQueue: false, actorPrivatePurged: false, nativeClusterClosed: false, completed: false };

async function waitForAdvisoryWait(observer, pid) {
  for (let i = 0; i < 100; i++) {
    const row = (await observer.query('SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
    if (row?.wait_event_type === 'Lock' && row.wait_event === 'advisory') return;
    await delay(20);
  }
  assert.fail('preparation must observably wait behind the active writer');
}
async function waitForRowWait(observer, pid) {
  for (let i = 0; i < 100; i++) {
    const row = (await observer.query('SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
    if (row?.wait_event_type === 'Lock' && ['transactionid', 'tuple'].includes(row.wait_event)) return;
    await delay(20);
  }
  assert.fail('preparation must observably wait behind the claim row');
}

test('NEW232 native PG17: ordinary concurrency, in-flight writer barrier and claim inversion', {
  skip: nativeProfileRoleAvailable ? false : 'installed PG17 unavailable; native concurrency NOT verified', timeout: 90000,
}, async t => {
  const owned = await createProfileRoleNativeDatabase();
  const clients = [];
  try {
    const adapter = { exec: text => owned.client.query(text), query: (text, values) => owned.client.query(text, values) };
    await createCustomerDataBoundaryFixture({ createDatabase: async () => adapter, readMigration: sql });
    const version = Number((await owned.client.query("SELECT current_setting('server_version_num') AS version")).rows[0].version);
    assert.ok(version >= 170000 && version < 180000, 'this fixture requires native PostgreSQL 17');
    const connect = async () => {
      const client = new Client({ ...owned.connection, connectionTimeoutMillis: 2000, statement_timeout: 12000, query_timeout: 15000 });
      await client.connect(); clients.push(client); return client;
    };
    const writer = await connect(), other = await connect(), prep = await connect();
    const prepPid = (await prep.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await owned.client.query('DELETE FROM account_deletion_jobs WHERE id=$1', [J]);

    // Keep the first real row-trigger transaction open while the second writes.
    // An exclusive actor writer lock would reject the second normal request.
    await writer.query('BEGIN'); await other.query('BEGIN');
    await writer.query(insert(A, 'bride_private', 'native concurrent private'));
    await other.query(insert(A, 'shared', 'native concurrent shared'));
    await writer.query('COMMIT'); await other.query('COMMIT');
    receipt.normalConcurrentWrites = true;
    await owned.client.query(`UPDATE amora_memory_jobs SET claimed_at=now()-interval '1 hour',attempt_count=5;
      INSERT INTO amora_memory_jobs(couple_id,user_id,visibility,status,created_at) VALUES
        ('${C}','${A}','shared','pending',now()-interval '2 hours'),
        ('${C}','${B}','shared','pending',now());`);

    await writer.query('BEGIN');
    await writer.query(insert(A, 'bride_private', 'native already in-flight'));
    await owned.client.query(`INSERT INTO account_deletion_jobs(id,user_id,status,claim_token,ready_after)
      VALUES($1,$2,'deleting',$3,now()-interval '1 hour')`, [J,A,T]);
    const healthy = (await owned.client.query('SELECT * FROM claim_amora_memory_job(300,NULL)')).rows;
    assert.equal(healthy.length, 1); assert.equal(healthy[0].user_id, B);
    assert.equal((await owned.client.query("SELECT status FROM amora_memory_jobs WHERE user_id=$1 AND visibility='bride_private'", [A])).rows[0].status, 'failed');
    receipt.healthyMemoryQueue = true;
    await prep.query('BEGIN');
    let preparation = prep.query('SELECT prepare_account_deletion_customer_data($1,$2) AS ok', [J,T]);
    // Attach rejection handling immediately while observing the other session.
    preparation.catch(() => {});
    await waitForAdvisoryWait(owned.client, prepPid);
    await writer.query('COMMIT');
    assert.equal((await preparation).rows[0].ok, true);
    receipt.prepareWaitsForActiveWriter = true;
    await assert.rejects(other.query(insert(A, 'bride_private', 'native forbidden late write')),
      error => error.code === '55P03' && error.message === 'ACCOUNT_DELETE_CUSTOMER_WRITE_BUSY');
    await other.query(insert(B, 'groom_private', 'native partner private'));
    await other.query(insert(B, 'shared', 'native partner shared'));
    receipt.lateWriterBlocked = true; receipt.partnerWritesPreserved = true;
    // Undo only this synthetic rehearsal so the exact claim can drive the
    // lock-order case below in the same one-time cluster and fixture.
    await prep.query('ROLLBACK');

    await writer.query('BEGIN');
    await writer.query('SELECT request_key FROM amora_chat_request_claims WHERE couple_id=$1 AND request_key=$2 FOR UPDATE', [C,key(A)]);
    await prep.query('BEGIN');
    preparation = prep.query('SELECT prepare_account_deletion_customer_data($1,$2) AS ok', [J,T]);
    preparation.catch(() => {});
    await waitForRowWait(owned.client, prepPid);
    await assert.rejects(writer.query(insert(A, 'bride_private', 'native stale finalizer')),
      error => error.code === '55P03' && error.message === 'ACCOUNT_DELETE_CUSTOMER_WRITE_BUSY');
    await writer.query('ROLLBACK');
    assert.equal((await preparation).rows[0].ok, true);
    await prep.query('COMMIT');
    receipt.claimLockInversionAvoided = true;
    assert.equal((await owned.client.query("SELECT count(*)::int AS n FROM chat_messages WHERE couple_id=$1 AND visibility='bride_private'", [C])).rows[0].n, 0);
    assert.equal((await owned.client.query("SELECT count(*)::int AS n FROM chat_messages WHERE content IN ('native partner private','native partner shared')")).rows[0].n, 2);
    receipt.actorPrivatePurged = true;
    for (const [name, text] of inputs) assert.equal(digest(readFileSync(join(root, 'supabase/migrations', name))), digest(text), 'SQL changed during the run');
    assert.equal(digest(readFileSync(fixturePath)), receipt.fixtureSha256, 'fixture changed during the run');
    receipt.completed = true;
  } finally {
    for (const client of clients) { await client.query('ROLLBACK').catch(() => {}); await client.end().catch(() => {}); }
    await owned.close(); receipt.nativeClusterClosed = true;
    receipt.inputSql = [...inputs].map(([name, text]) => ({ name, sha256: digest(text) }));
    t.diagnostic(JSON.stringify(receipt));
  }
});
