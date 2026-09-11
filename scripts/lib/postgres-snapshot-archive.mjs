import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { digest, digestJson, requireRelease } from './current-baseline-release-contract.mjs';

export const MAX_CUSTOM_ARCHIVE_BYTES = 24 * 1024 * 1024 - 4096;
export const MAX_ARCHIVE_ENVELOPE_BYTES = 32 * 1024 * 1024;
export const ARCHIVE_FORMAT = 'postgres-exported-snapshot-archive-v1';
const SNAPSHOT = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9]+$/;
const SHA = /^[a-f0-9]{64}$/;
const CODE = 'SNAPSHOT_ARCHIVE_PROCESS_FAILED';
const failure = () => Object.assign(new Error(CODE), { code: CODE });

export function assertArchiveTool(file, sha256) {
  requireRelease(isAbsolute(file) && SHA.test(sha256), 'SNAPSHOT_ARCHIVE_TOOL_INVALID');
  const stat = lstatSync(file);
  requireRelease(stat.isFile() && !stat.isSymbolicLink() && digest(readFileSync(file)) === sha256, 'SNAPSHOT_ARCHIVE_TOOL_CHANGED');
}

// PG 서비스 파일·기존 접속/인증 환경을 상속하지 않는다.
export function archiveProcessEnvironment(connection = {}) {
  const env = {};
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'PATH', 'TEMP', 'TMP'])
    if (process.env[key]) env[key] = process.env[key];
  for (const key of ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE', 'PGSSLROOTCERT'])
    if (typeof connection[key] === 'string') env[key] = connection[key];
  env.PGCONNECT_TIMEOUT = '10';
  env.PGOPTIONS = '-c default_transaction_read_only=on -c row_security=off';
  return env;
}

/** stdout은 상한 내 Buffer 또는 digest만 반환하며 stderr/원문 오류는 내보내지 않는다. */
export function runNativeArchiveProcess({ file, args, env, input, maximumBytes, digestOnly = false,
  timeoutMs = 120000, allowEarlyStdinClose = false, spawnImpl = spawn }) {
  requireRelease(Number.isSafeInteger(maximumBytes) && maximumBytes > 0 && maximumBytes <= 256 * 1024 * 1024,
    'SNAPSHOT_ARCHIVE_LIMIT_INVALID');
  requireRelease(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 180000
    && (input === undefined || Buffer.isBuffer(input)), 'SNAPSHOT_ARCHIVE_PROCESS_INPUT_INVALID');
  requireRelease(!allowEarlyStdinClose || (Array.isArray(args) && args.length === 1 && args[0] === '--list'
    && Buffer.isBuffer(input) && !digestOnly), 'SNAPSHOT_ARCHIVE_EARLY_CLOSE_FORBIDDEN');
  return new Promise((resolve, reject) => {
    const chunks = []; const hash = createHash('sha256');
    let bytes = 0; let bad = false; let settled = false; let child;
    const clear = () => { for (const chunk of chunks) chunk.fill(0); };
    const fail = () => {
      if (bad || settled) return; bad = true; clear();
      try { child?.kill(); } catch {}
      finish(-1);
    };
    const timer = setTimeout(fail, timeoutMs);
    const finish = exitCode => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (bad || exitCode !== 0) { clear(); reject(failure()); return; }
      const result = { bytes, sha256: hash.digest('hex'), exitCode: 0 };
      if (!digestOnly) result.buffer = Buffer.concat(chunks);
      clear(); resolve(result);
    };
    try { child = spawnImpl(file, args, { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { bad = true; finish(-1); return; }
    child.on('error', () => { bad = true; finish(-1); });
    child.on('close', finish);
    child.stdout.on('data', value => {
      if (bad || settled) { value.fill(0); return; }
      bytes += value.length;
      if (bytes > maximumBytes) { value.fill(0); fail(); return; }
      hash.update(value);
      if (!digestOnly) chunks.push(Buffer.from(value));
      value.fill(0);
    });
    // 정상 종료라도 경고가 있으면 자동 수집 성공으로 채택하지 않는다.
    child.stderr.on('data', value => { value.fill(0); fail(); });
    // --list는 TOC 이후 입력을 읽지 않을 수 있다. exit0·유효 TOC·전체 decode가 이어져야 채택된다.
    child.stdin.on('error', error => { if (!(allowEarlyStdinClose && ['EPIPE', 'EOF'].includes(error.code))) fail(); });
    try { child.stdin.end(input); } catch { fail(); }
  });
}

export function snapshotDumpArguments(snapshotId, readerRole) {
  requireRelease(SNAPSHOT.test(snapshotId), 'SNAPSHOT_ARCHIVE_ID_INVALID');
  requireRelease(['postgres', 'supabase_read_only_user'].includes(readerRole), 'SNAPSHOT_ARCHIVE_ROLE_INVALID');
  return ['--no-password', '--format=custom', '--snapshot=' + snapshotId, '--role=' + readerRole,
    '--lock-wait-timeout=8000', '--encoding=UTF8'];
}

function validateBinding(binding) {
  requireRelease(binding && /^[a-z0-9]{20}$/.test(binding.projectRef) && /^[0-9]{10,32}$/.test(binding.systemIdentifier)
    && /^[a-f0-9]{40}$/.test(binding.releaseCommit) && /^[a-f0-9-]{36}$/.test(binding.backupSetId)
    && SHA.test(binding.hotfixSha256) && SHA.test(binding.baselineSha256), 'SNAPSHOT_ARCHIVE_BINDING_INVALID');
}

export function inspectArchiveToc(toc, requiredSchemas) {
  requireRelease(Array.isArray(requiredSchemas) && requiredSchemas.length > 0
    && requiredSchemas.every(value => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value))
    && new Set(requiredSchemas).size === requiredSchemas.length, 'SNAPSHOT_ARCHIVE_SCOPE_INVALID');
  const lines = toc.toString('utf8').split(/\r?\n/).filter(line => /^\d+;\s+\d+\s+\d+\s+/.test(line));
  requireRelease(lines.length > 0, 'SNAPSHOT_ARCHIVE_TOC_EMPTY');
  // extension 소유 객체는 CREATE EXTENSION으로 재생된다. 전체 관계 동일성은 실제 복원 뒤 별도로 검사한다.
  const observed = requiredSchemas.filter(schema => lines.some(line =>
    new RegExp('^\\d+;\\s+\\d+\\s+\\d+\\s+(?:SCHEMA - |(?:TABLE|TABLE DATA|VIEW|MATERIALIZED VIEW|SEQUENCE|SEQUENCE SET|FUNCTION|ACL|COMMENT) )' + schema + '(?:\\s|$)').test(line)));
  requireRelease(observed.length === requiredSchemas.length, 'SNAPSHOT_ARCHIVE_SCHEMA_MISSING');
  requireRelease(lines.some(line => /\s(?:TABLE DATA|SEQUENCE SET)\s/.test(line)), 'SNAPSHOT_ARCHIVE_DATA_MISSING');
  return { entryCount: lines.length, requiredSchemas: [...requiredSchemas].sort(), sha256: digest(toc),
    scopeClaim: 'required schema presence only; all relation contents require actual restore comparison' };
}

/** 호출자는 살아 있는 첫 export transaction 안에서 완료될 때까지 기다린다. */
export async function capturePostgresSnapshotArchive({ snapshotId, binding, readerRole, connectionEnv,
  pgDump, pgDumpSha256, pgRestore, pgRestoreSha256, requiredSchemas, runProcess = runNativeArchiveProcess }) {
  validateBinding(binding);
  const args = snapshotDumpArguments(snapshotId, readerRole);
  assertArchiveTool(pgDump, pgDumpSha256); assertArchiveTool(pgRestore, pgRestoreSha256);
  let archive; let toc; let envelope;
  try {
    const dumped = await runProcess({ file: pgDump, args, env: archiveProcessEnvironment(connectionEnv),
      maximumBytes: MAX_CUSTOM_ARCHIVE_BYTES });
    archive = dumped.buffer;
    requireRelease(Buffer.isBuffer(archive) && archive.length >= 16 && archive.length <= MAX_CUSTOM_ARCHIVE_BYTES
      && archive.subarray(0, 5).toString('ascii') === 'PGDMP' && dumped.exitCode === 0
      && dumped.bytes === archive.length && dumped.sha256 === digest(archive), 'SNAPSHOT_ARCHIVE_INVALID');
    assertArchiveTool(pgRestore, pgRestoreSha256);
    const inspected = await runProcess({ file: pgRestore, args: ['--list'], env: archiveProcessEnvironment(),
      input: archive, maximumBytes: 8 * 1024 * 1024, allowEarlyStdinClose: true });
    toc = inspected.buffer;
    requireRelease(Buffer.isBuffer(toc) && inspected.exitCode === 0 && inspected.bytes === toc.length
      && inspected.sha256 === digest(toc), 'SNAPSHOT_ARCHIVE_TOC_INVALID');
    const coverage = inspectArchiveToc(toc, requiredSchemas);
    // --list만 통과하는 잘린 data block도 전체 SQL decode로 검사한다. 실행/디스크 저장은 하지 않는다.
    assertArchiveTool(pgRestore, pgRestoreSha256);
    const decoded = await runProcess({ file: pgRestore, args: ['--file=-'], env: archiveProcessEnvironment(),
      input: archive, maximumBytes: 256 * 1024 * 1024, digestOnly: true });
    requireRelease(decoded.exitCode === 0 && Number.isSafeInteger(decoded.bytes) && decoded.bytes > 0
      && SHA.test(decoded.sha256), 'SNAPSHOT_ARCHIVE_DECODE_FAILED');
    const commands = [[pgDumpSha256, args, dumped], [pgRestoreSha256, ['--list'], inspected],
      [pgRestoreSha256, ['--file=-'], decoded]].map(([toolSha256, commandArgs, result]) => ({
      commandSha256: digestJson({ toolSha256, args: commandArgs }), outputSha256: result.sha256, exitCode: 0 }));
    const summary = { format: ARCHIVE_FORMAT, ...binding, snapshotIdentitySha256: digest(snapshotId),
      archiveBytes: archive.length, archiveSha256: digest(archive), pgDumpSha256, pgRestoreSha256,
      toc: coverage, decodedSqlSha256: decoded.sha256, decodedSqlBytes: decoded.bytes, commands,
      archiveDecoded: true, databaseRestoreExecuted: false, clusterRolePasswordsCaptured: false };
    envelope = Buffer.from(JSON.stringify({ ...summary, archiveBase64: archive.toString('base64') }));
    requireRelease(envelope.length <= MAX_ARCHIVE_ENVELOPE_BYTES, 'SNAPSHOT_ARCHIVE_ENVELOPE_TOO_LARGE');
    return { bytes: envelope, summary };
  } catch {
    envelope?.fill(0);
    throw Object.assign(new Error('SNAPSHOT_ARCHIVE_CAPTURE_FAILED'), { code: 'SNAPSHOT_ARCHIVE_CAPTURE_FAILED' });
  } finally { archive?.fill(0); toc?.fill(0); }
}
