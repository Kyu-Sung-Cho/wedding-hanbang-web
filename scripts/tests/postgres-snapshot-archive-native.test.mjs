import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import {
  archiveProcessEnvironment, capturePostgresSnapshotArchive, runNativeArchiveProcess,
} from '../lib/postgres-snapshot-archive.mjs';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const PREFIX = 'hanbang-synthetic-pg-snapshot-';
const MAX_OUTPUT = 8 * 1024 * 1024;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// 기존 DB/서비스를 찾지 않는다. 명시된 binary 디렉터리 또는 Windows의 기존 도구만 사용한다.
const configuredBin = process.env.HANBANG_SYNTHETIC_PG_BIN;
const nativeBin = configuredBin || (process.platform === 'win32' && process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'WeddingHanbangTools', 'postgresql-17.10', 'pgsql', 'bin') : null);
const executable = name => join(nativeBin, name + (process.platform === 'win32' ? '.exe' : ''));
const nativeMissing = !nativeBin || ['initdb', 'postgres', 'pg_ctl', 'pg_dump', 'pg_restore'].some(name => !existsSync(executable(name)));

function baseEnvironment() {
  const env = {};
  for (const name of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'PATH', 'TEMP', 'TMP']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return env;
}

async function freeLoopbackPort() {
  const listener = createServer();
  await new Promise((done, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', done); });
  const address = listener.address();
  assert.equal(typeof address, 'object');
  assert.ok(address && address.address === '127.0.0.1' && address.port > 1024);
  await new Promise((done, reject) => listener.close(error => error ? reject(error) : done()));
  return address.port;
}

function safeNative(file, args, env, timeoutMs = 30000) {
  // initdb/pg_ctl 전용. stderr는 캡처하고 실패 시 원문을 테스트 출력에 전달하지 않는다.
  try {
    return execFileSync(file, args, { env, windowsHide: true, timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_OUTPUT });
  } catch { throw new Error('SYNTHETIC_NATIVE_SETUP_FAILED'); }
}

function assertOwnDirectory(root, marker) {
  assert.equal(dirname(resolve(root)), realpathSync(tmpdir()));
  assert.ok(basename(root).startsWith(PREFIX));
  assert.equal(lstatSync(root).isSymbolicLink(), false);
  assert.equal(readFileSync(join(root, 'synthetic-owner'), 'utf8'), marker);
}

async function syntheticCluster() {
  assert.ok(nativeBin && isAbsolute(nativeBin));
  const env = baseEnvironment();
  const version = safeNative(executable('postgres'), ['--version'], env).toString('utf8');
  assert.match(version, /PostgreSQL\) 17\./, 'native suite requires PostgreSQL 17, not an arbitrary available server');
  const marker = randomUUID();
  const root = mkdtempSync(join(realpathSync(tmpdir()), PREFIX));
  writeFileSync(join(root, 'synthetic-owner'), marker, { flag: 'wx', mode: 0o600 });
  const data = join(root, 'data');
  const password = randomBytes(24).toString('hex');
  const passwordFile = join(root, 'synthetic-password');
  let server; let serverClosed; let stopped = false;
  const clients = new Set();
  const close = async () => {
    if (stopped) return;
    for (const client of clients) await client.end().catch(() => {});
    clients.clear();
    assertOwnDirectory(root, marker);
    if (server && server.exitCode === null && server.signalCode === null) {
      const pidFile = readFileSync(join(data, 'postmaster.pid'), 'utf8').split(/\r?\n/);
      assert.equal(Number(pidFile[0]), server.pid, 'shutdown is limited to the process this fixture spawned');
      assert.equal(resolve(pidFile[1]), resolve(data));
      safeNative(executable('pg_ctl'), ['-D', data, '-m', 'fast', '-w', '-t', '15', 'stop'], env, 20000);
      await serverClosed;
    }
    assert.ok(!existsSync(join(data, 'postmaster.pid')), 'own PostgreSQL must stop before temporary files are removed');
    assertOwnDirectory(root, marker);
    rmSync(root, { recursive: true, force: false });
    stopped = true;
  };
  try {
    writeFileSync(passwordFile, password + '\n', { flag: 'wx', mode: 0o600 });
    safeNative(executable('initdb'), ['-D', data, '--username=postgres', '--auth-host=scram-sha-256',
      '--auth-local=scram-sha-256', '--pwfile=' + passwordFile, '--encoding=UTF8', '--no-locale'], env);
    rmSync(passwordFile);
    const port = await freeLoopbackPort();
    server = spawn(executable('postgres'), ['-D', data, '-h', '127.0.0.1', '-p', String(port),
      '-c', 'unix_socket_directories=', '-c', 'ssl=off', '-c', 'max_connections=12'],
    { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', chunk => chunk.fill(0));
    server.stderr.on('data', chunk => chunk.fill(0));
    let spawnError = false;
    server.on('error', () => { spawnError = true; });
    serverClosed = new Promise(done => server.once('close', done));
    const clientFor = database => new Client({ host: '127.0.0.1', port, database, user: 'postgres', password,
      ssl: false, options: '', application_name: 'synthetic-snapshot-native', connectionTimeoutMillis: 500,
      statement_timeout: 15000, query_timeout: 20000 });
    let admin;
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(spawnError, false, 'own PostgreSQL process must start');
      assert.equal(server.exitCode, null, 'own PostgreSQL must not exit during startup');
      const probe = clientFor('postgres');
      try { await probe.connect(); admin = probe; break; }
      catch { await probe.end().catch(() => {}); await delay(100); }
    }
    assert.ok(admin, 'own PostgreSQL must accept loopback connections within the deadline');
    clients.add(admin);
    const identity = (await admin.query(`SELECT current_setting('data_directory') AS data,
      current_setting('listen_addresses') AS listen, host(inet_server_addr()) AS address,
      inet_server_port() AS port, (SELECT system_identifier::text FROM pg_control_system()) AS system`)).rows[0];
    assert.equal(resolve(identity.data), resolve(data));
    assert.equal(identity.listen, '127.0.0.1'); assert.equal(identity.address, '127.0.0.1'); assert.equal(identity.port, port);
    const pid = readFileSync(join(data, 'postmaster.pid'), 'utf8').split(/\r?\n/);
    assert.equal(Number(pid[0]), server.pid); assert.equal(Number(pid[3]), port);
    const connect = async database => {
      assert.ok(['postgres', 'synthetic_source', 'synthetic_restore', 'synthetic_broken'].includes(database));
      const client = clientFor(database); await client.connect(); clients.add(client); return client;
    };
    const connection = database => ({ PGHOST: '127.0.0.1', PGPORT: String(port), PGDATABASE: database,
      PGUSER: 'postgres', PGPASSWORD: password, PGSSLMODE: 'disable' });
    return { admin, connect, connection, close, system: identity.system, port };
  } catch (error) {
    await close();
    throw error;
  }
}

const fixtureSchema = `
CREATE ROLE supabase_read_only_user NOLOGIN;
GRANT pg_read_all_data, pg_monitor TO supabase_read_only_user;
CREATE ROLE synthetic_reader NOLOGIN;
CREATE SCHEMA fixture;
CREATE TYPE fixture.stage AS ENUM ('planned','done');
CREATE DOMAIN fixture.nonnegative AS numeric(18,2) CHECK (VALUE >= 0);
CREATE SEQUENCE fixture.counter START 89;
CREATE TABLE fixture.large_payload(id integer PRIMARY KEY, payload bytea NOT NULL);
CREATE TABLE public.snapshot_fixture (
 id bigint PRIMARY KEY, title text NOT NULL, precise numeric(30,10), amount fixture.nonnegative,
 stage fixture.stage, detail jsonb, binary_data bytea, instant timestamptz, nullable text,
 computed text GENERATED ALWAYS AS (title || '-generated') STORED
);
INSERT INTO public.snapshot_fixture(id,title,precise,amount,stage,detail,binary_data,instant,nullable)
VALUES(9007199254740993,'합성 snapshot 이전',12345678901234567890.1234567890,1501.25,'planned',
 '{"counter":9007199254740993,"note":"합성 자료"}',decode('00ff1020','hex'),'2026-09-11T01:02:03.456789Z',NULL);
SELECT setval('fixture.counter',88,true);
GRANT USAGE ON SCHEMA public,fixture TO synthetic_reader;
GRANT SELECT ON public.snapshot_fixture TO synthetic_reader;
GRANT USAGE,SELECT ON SEQUENCE fixture.counter TO synthetic_reader;
`;

const rowSql = `SELECT id::text,title,precise::text,amount::text,stage::text,detail::text,
 encode(binary_data,'hex') AS binary_data, to_char(instant AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US') AS instant,
 nullable,computed FROM public.snapshot_fixture ORDER BY id`;
const aclSql = `SELECT n.nspname,c.relname,pg_get_userbyid(c.relowner) AS owner,c.relacl::text
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE (n.nspname='public' AND c.relname='snapshot_fixture') OR (n.nspname='fixture' AND c.relname='counter')
 ORDER BY n.nspname,c.relname`;

test('native custom archive: isolated synthetic PostgreSQL snapshot/restore only, never full production restore',
  { skip: nativeMissing ? 'PostgreSQL native binaries absent; no local native restore performed (not a release PASS)' : false, timeout: 180000 }, async t => {
    const cluster = await syntheticCluster();
    let archive; let envelope;
    t.after(async () => { archive?.fill(0); envelope?.fill(0); await cluster.close(); });
    await cluster.admin.query('CREATE DATABASE synthetic_source TEMPLATE template0');
    await cluster.admin.query('CREATE DATABASE synthetic_restore TEMPLATE template0');
    await cluster.admin.query('CREATE DATABASE synthetic_broken TEMPLATE template0');
    const source = await cluster.connect('synthetic_source');
    await source.query(fixtureSchema);
    // 압축으로 작아지지 않는 합성 payload: --list의 이른 stdin 종료도 실제 큰 pipe로 검증한다.
    const largePayload = randomBytes(1024 * 1024);
    const largePayloadSha = sha(largePayload);
    try { await source.query('INSERT INTO fixture.large_payload VALUES(1,$1)', [largePayload]); }
    finally { largePayload.fill(0); }
    const writer = await cluster.connect('synthetic_source');
    const restore = await cluster.connect('synthetic_restore');
    const baselineRows = (await source.query(rowSql)).rows;
    const baselineAcl = (await source.query(aclSql)).rows;
    const baselineSequence = (await source.query('SELECT last_value::text,is_called FROM fixture.counter')).rows;
    await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshotId = (await source.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    assert.equal((await source.query("SELECT current_setting('transaction_read_only') AS readonly")).rows[0].readonly, 'on');
    await source.query('SAVEPOINT reject_source_write');
    await assert.rejects(source.query("UPDATE public.snapshot_fixture SET title='must not write'"), error => error.code === '25006');
    await source.query('ROLLBACK TO SAVEPOINT reject_source_write');
    await writer.query("UPDATE public.snapshot_fixture SET title='합성 snapshot 이후',precise=7 WHERE id=9007199254740993");
    assert.equal((await writer.query(rowSql)).rows[0].title, '합성 snapshot 이후');
    const settings = {
      snapshotId, readerRole: 'supabase_read_only_user', connectionEnv: cluster.connection('synthetic_source'),
      pgDump: executable('pg_dump'), pgDumpSha256: sha(readFileSync(executable('pg_dump'))),
      pgRestore: executable('pg_restore'), pgRestoreSha256: sha(readFileSync(executable('pg_restore'))),
      requiredSchemas: ['public','fixture'],
      runProcess: options => runNativeArchiveProcess({ ...options, spawnImpl(file, args, spawnOptions) {
        const child = spawn(file, args, spawnOptions);
        const phase = args.includes('--list') ? 'list' : args.includes('--file=-') ? 'decode' : 'dump';
        let stdinCode = null; let stderrBytes = 0;
        child.stdin.on('error', error => { stdinCode = error.code; });
        child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
        child.on('close', exitCode => t.diagnostic(JSON.stringify({ phase, exitCode, stdinCode, stderrBytes })));
        return child;
      } }),
      binding: { projectRef: 'syntheticlocalonly00', systemIdentifier: cluster.system,
        releaseCommit: '1'.repeat(40), backupSetId: randomUUID(), hotfixSha256: '2'.repeat(64), baselineSha256: '3'.repeat(64) },
    };

    await t.test('exported snapshot restores previous exact rows, native types, sequence and ACL to the empty DB', async () => {
      const result = await capturePostgresSnapshotArchive(settings);
      envelope = result.bytes;
      const decoded = JSON.parse(envelope.toString('utf8'));
      assert.equal(decoded.format, 'postgres-exported-snapshot-archive-v1');
      assert.equal(decoded.databaseRestoreExecuted, false);
      assert.equal(decoded.clusterRolePasswordsCaptured, false);
      assert.equal(decoded.snapshotIdentitySha256, sha(snapshotId));
      archive = Buffer.from(decoded.archiveBase64, 'base64');
      assert.ok(archive.length > 512 * 1024, 'native pipe test must use an actually large compressed archive');
      assert.equal(sha(archive), decoded.archiveSha256);
      assert.equal(archive.length, decoded.archiveBytes);
      const nativeRestore = await runNativeArchiveProcess({ file: executable('pg_restore'),
        args: ['--exit-on-error','--single-transaction','--no-password','--dbname=synthetic_restore'],
        env: { ...baseEnvironment(), ...cluster.connection('synthetic_restore'), PGOPTIONS: '' },
        input: archive, maximumBytes: MAX_OUTPUT, timeoutMs: 30000 });
      nativeRestore.buffer?.fill(0);
      assert.deepEqual((await restore.query(rowSql)).rows, baselineRows);
      const restoredPayload = (await restore.query('SELECT payload FROM fixture.large_payload WHERE id=1')).rows[0].payload;
      try { assert.equal(restoredPayload.length, 1024 * 1024); assert.equal(sha(restoredPayload), largePayloadSha); }
      finally { restoredPayload.fill(0); }
      assert.deepEqual((await restore.query(aclSql)).rows, baselineAcl);
      assert.deepEqual((await restore.query('SELECT last_value::text,is_called FROM fixture.counter')).rows, baselineSequence);
      assert.equal((await restore.query("SELECT nextval('fixture.counter')::text AS next")).rows[0].next, '89');
      const types = (await restore.query(`SELECT column_name,udt_schema,udt_name,domain_schema,domain_name,is_generated
        FROM information_schema.columns WHERE table_schema='public' AND table_name='snapshot_fixture' ORDER BY ordinal_position`)).rows;
      assert.deepEqual(types, (await writer.query(`SELECT column_name,udt_schema,udt_name,domain_schema,domain_name,is_generated
        FROM information_schema.columns WHERE table_schema='public' AND table_name='snapshot_fixture' ORDER BY ordinal_position`)).rows);
      await restore.query('SET ROLE synthetic_reader');
      assert.deepEqual((await restore.query(rowSql)).rows, baselineRows);
      await assert.rejects(restore.query("UPDATE public.snapshot_fixture SET title='forbidden'"), error => error.code === '42501');
      await restore.query('RESET ROLE');
      assert.deepEqual((await source.query(rowSql)).rows, baselineRows);
      assert.equal((await writer.query(rowSql)).rows[0].title, '합성 snapshot 이후', 'capture/restore must not overwrite the source');
      t.diagnostic('Synthetic loopback SCRAM cluster only; roles precreated in the same isolated cluster; no Supabase/Auth/Storage full restore claim. Sequence was held stable, not an MVCC point-in-time sequence assertion.');
    });

    await t.test('truncated data archive fails native full decode and atomic restore without partial destination rows', async () => {
      assert.ok(archive && archive.length > 100);
      const broken = Buffer.from(archive.subarray(0, archive.length - 32));
      try {
        await assert.rejects(runNativeArchiveProcess({ file: executable('pg_restore'), args: ['--file=-'],
          env: archiveProcessEnvironment(), input: broken, maximumBytes: MAX_OUTPUT, digestOnly: true }),
        error => error.code === 'SNAPSHOT_ARCHIVE_PROCESS_FAILED' && error.message === 'SNAPSHOT_ARCHIVE_PROCESS_FAILED');
        await assert.rejects(runNativeArchiveProcess({ file: executable('pg_restore'),
          args: ['--exit-on-error','--single-transaction','--no-password','--dbname=synthetic_broken'],
          env: { ...baseEnvironment(), ...cluster.connection('synthetic_broken'), PGOPTIONS: '' }, input: broken,
          maximumBytes: MAX_OUTPUT, timeoutMs: 30000 }), error => error.code === 'SNAPSHOT_ARCHIVE_PROCESS_FAILED');
        const brokenDb = await cluster.connect('synthetic_broken');
        assert.equal((await brokenDb.query("SELECT to_regclass('public.snapshot_fixture')::text AS target")).rows[0].target, null);
      } finally { broken.fill(0); }
    });

    await t.test('closed exported snapshot is rejected instead of silently taking a new current snapshot', async () => {
      await source.query('ROLLBACK');
      await assert.rejects(capturePostgresSnapshotArchive(settings), error => error.code === 'SNAPSHOT_ARCHIVE_CAPTURE_FAILED'
        && error.message === 'SNAPSHOT_ARCHIVE_CAPTURE_FAILED' && !Object.hasOwn(error, 'cause'));
      assert.equal((await writer.query(rowSql)).rows[0].title, '합성 snapshot 이후');
    });
  });

test('native archive environment excludes inherited PG/service/credential values and enforces read-only capture', async () => {
  const names = ['PGHOST','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGDATABASE','PGUSER','PGPASSWORD','PGOPTIONS','PGSSLCERT',
    'SUPABASE_SERVICE_ROLE_KEY','HBAM2_DATABASE_URL'];
  const previous = new Map(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = 'synthetic-inherited-must-not-reach-child';
    const env = archiveProcessEnvironment({ PGHOST: '127.0.0.1', PGPORT: '54321', PGDATABASE: 'synthetic',
      PGUSER: 'synthetic', PGPASSWORD: 'synthetic-explicit-only', PGSSLMODE: 'disable',
      PGSERVICE: 'must-not-copy', PGOPTIONS: '-c default_transaction_read_only=off' });
    const result = await runNativeArchiveProcess({ file: process.execPath,
      args: ['-e', "process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(?:PG|SUPABASE|HBAM2)/i.test(k)))))"],
      env, maximumBytes: 8192, timeoutMs: 10000 });
    try {
      const actual = JSON.parse(result.buffer.toString('utf8'));
      assert.deepEqual(actual, { PGHOST: '127.0.0.1', PGPORT: '54321', PGDATABASE: 'synthetic', PGUSER: 'synthetic',
        PGPASSWORD: 'synthetic-explicit-only', PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '10',
        PGOPTIONS: '-c default_transaction_read_only=on -c row_security=off' });
    } finally { result.buffer.fill(0); }
  } finally {
    for (const [name, value] of previous) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
