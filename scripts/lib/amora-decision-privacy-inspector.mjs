import { closeSync, fsyncSync, lstatSync, openSync, realpathSync, writeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { CurrentBaselineBlocked, digest, readAnchored } from './current-baseline-release-contract.mjs';
import { loadAmoraDecisionPrivacyCandidate } from './amora-decision-privacy-candidate.mjs';

const PROJECT = 'slrtobkksjmxgzatjyqb';
class InspectionBlocked extends Error {
  constructor(code) { super(code); this.name = 'InspectionBlocked'; this.code = code; }
}
const fail = code => { throw new InspectionBlocked(code); };
const ensure = (condition, code) => { if (!condition) fail(code); };
const authority = Object.freeze({ productionApplyImplemented: false, runtimeEvidenceVerified: false,
  releaseAuthorized: false, remoteWritesPerformed: false });
const sourceFiles = ['scripts/amora-decision-privacy-inspect.mjs', 'scripts/lib/amora-decision-privacy-inspector.mjs',
  'scripts/lib/amora-decision-privacy-inspection.mjs', 'scripts/lib/amora-decision-privacy-candidate.mjs',
  'scripts/lib/current-baseline-release-contract.mjs'];

function assertSafeEnvironment(environment) {
  const forbidden = new Set(['SUPABASE_CLI_BINARY_OVERRIDE', 'NODE_OPTIONS', 'NODE_PATH',
    'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_EXTRA_CA_CERTS', 'GIT_EXEC_PATH',
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_CONFIG_COUNT', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_CEILING_DIRECTORIES']);
  ensure(!Object.entries(environment).some(([key, value]) => value !== undefined && value !== ''
    && (forbidden.has(key.toUpperCase()) || /^GIT_CONFIG(?:_|$)/.test(key.toUpperCase()))),
  'AMORA_INSPECTION_EXECUTION_ENVIRONMENT_UNSAFE');
}

function assertGitSource(repoRoot, expectedCommit, environment) {
  try {
    const gitBytes = argv => execFileSync('git', ['--no-replace-objects', '-c', 'core.fsmonitor=false',
      '-c', 'core.untrackedCache=false', '-C', repoRoot, ...argv], {
      timeout: 15_000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...environment, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
    });
    const git = argv => gitBytes(argv).toString('utf8').trim();
    ensure(git(['rev-parse', 'HEAD']) === expectedCommit
      && realpathSync(git(['rev-parse', '--show-toplevel'])).toLowerCase() === realpathSync(repoRoot).toLowerCase()
      && git(['remote', 'get-url', 'origin']) === 'https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git'
      && git(['status', '--porcelain', '--untracked-files=all']) === '',
    'AMORA_INSPECTION_SOURCE_NOT_CLEAN_EXACT_COMMIT');
    // status에 숨길 수 있는 index flag도 거절하고 실행 경계 원문을 commit blob과 대조한다.
    ensure(!git(['ls-files', '-v', '-z']).split('\0').some(line => /^(?:S|[a-z]) /.test(line)),
      'AMORA_INSPECTION_SOURCE_NOT_CLEAN_EXACT_COMMIT');
    for (const file of sourceFiles) ensure(digest(gitBytes(['show', `${expectedCommit}:${file}`])) === digest(readAnchored(repoRoot, file)),
      'AMORA_INSPECTION_SOURCE_NOT_CLEAN_EXACT_COMMIT');
  } catch { fail('AMORA_INSPECTION_SOURCE_NOT_CLEAN_EXACT_COMMIT'); }
}

export function parseAmoraDecisionPrivacyInspectionArgs(argv) {
  const values = {};
  for (const arg of argv) {
    if (arg === '--inspect' && !values.mode) { values.mode = 'inspect'; continue; }
    const match = /^--(expected-commit|project-ref|receipt-out)=(.+)$/.exec(arg);
    ensure(match && !Object.hasOwn(values, match[1]), 'AMORA_INSPECTION_ARGUMENT_INVALID');
    values[match[1]] = match[2];
  }
  ensure(values.mode === 'inspect' && /^[a-f0-9]{40}$/.test(values['expected-commit'] ?? '')
    && values['project-ref'] === PROJECT && isAbsolute(values['receipt-out'] ?? '')
    && !/[\r\n\0]/.test(values['receipt-out']), 'AMORA_INSPECTION_ARGUMENT_INVALID');
  return { mode: values.mode, expectedCommit: values['expected-commit'], projectRef: PROJECT,
    receiptOut: values['receipt-out'] };
}

export function appendAmoraDecisionPrivacyInspectionReceipt(fd, value, { write = writeSync, flush = fsyncSync } = {}) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  let offset = 0;
  while (offset < bytes.length) {
    const written = write(fd, bytes, offset, bytes.length - offset, null);
    ensure(Number.isSafeInteger(written) && written > 0 && written <= bytes.length - offset,
      'AMORA_INSPECTION_RECEIPT_WRITE_INCOMPLETE');
    offset += written;
  }
  flush(fd);
}

export function createAmoraDecisionPrivacyInspectionReceipt(repoRoot, file) {
  ensure(isAbsolute(file), 'AMORA_INSPECTION_RECEIPT_PATH_INVALID');
  const target = resolve(file), parent = dirname(target);
  try {
    let cursor = parse(parent).root;
    for (const part of parent.slice(cursor.length).split(/[\\/]/).filter(Boolean)) {
      cursor = join(cursor, part);
      const stat = lstatSync(cursor);
      ensure(stat.isDirectory() && !stat.isSymbolicLink(), 'AMORA_INSPECTION_RECEIPT_PATH_INVALID');
    }
    const actual = realpathSync(parent);
    const delta = relative(realpathSync(repoRoot), actual);
    ensure(actual.toLowerCase() === parent.toLowerCase()
      && delta && (delta === '..' || delta.startsWith(`..${sep}`) || isAbsolute(delta)),
    'AMORA_INSPECTION_RECEIPT_PATH_INVALID');
  } catch { fail('AMORA_INSPECTION_RECEIPT_PATH_INVALID'); }
  let fd;
  try { fd = openSync(target, 'wx', 0o600); } catch { fail('AMORA_INSPECTION_RECEIPT_UNAVAILABLE'); }
  return { append: value => appendAmoraDecisionPrivacyInspectionReceipt(fd, value), close: () => closeSync(fd) };
}

function sourceSnapshot(repoRoot) {
  const plan = loadAmoraDecisionPrivacyCandidate(repoRoot);
  const runtime = sourceFiles.map(file => ({ file, sha256: digest(readAnchored(repoRoot, file)) }));
  return { plan, runtime };
}

function safeCode(error) {
  return (error instanceof InspectionBlocked || error instanceof CurrentBaselineBlocked)
    && /^AMORA_INSPECTION_[A-Z_]+$/.test(error.code) ? error.code : 'AMORA_INSPECTION_UNCONFIRMED';
}

export function createAmoraDecisionPrivacyInspectionTransport({ plan, accessToken, fetchImpl = globalThis.fetch,
  timeoutMs = 45_000 } = {}) {
  ensure(plan?.contract?.projectRef === PROJECT && plan.contract.systemIdentifier === '7581440907192989109',
    'AMORA_INSPECTION_DESTINATION_INVALID');
  ensure(/^sbp_(?:oauth_)?[a-f0-9]{40}$/.test(accessToken ?? ''), 'AMORA_INSPECTION_CREDENTIAL_UNAVAILABLE');
  ensure(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 45_000,
    'AMORA_INSPECTION_TIMEOUT_INVALID');
  return { async inspect(...args) {
    ensure(args.length === 0, 'AMORA_INSPECTION_ARGUMENT_INVALID');
    const { buildAmoraDecisionPrivacyInspectionSql } = await import('./amora-decision-privacy-inspection.mjs');
    const query = buildAmoraDecisionPrivacyInspectionSql(plan);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let reader;
    const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort',
      () => reject(new Error('AMORA_INSPECTION_REMOTE_UNCONFIRMED')), { once: true }));
    try {
      const response = await Promise.race([fetchImpl(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
        method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, read_only: true }), signal: controller.signal,
      }), aborted]);
      ensure(response.ok && /^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? ''),
        'AMORA_INSPECTION_REMOTE_UNCONFIRMED');
      const maximum = 4 * 1024 * 1024;
      const length = response.headers.get('content-length');
      ensure(length === null || /^\d+$/.test(length) && Number(length) <= maximum,
        'AMORA_INSPECTION_RESPONSE_TOO_LARGE');
      reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await Promise.race([reader.read(), aborted]);
        if (done) break;
        ensure(value instanceof Uint8Array, 'AMORA_INSPECTION_REMOTE_UNCONFIRMED');
        total += value.byteLength;
        ensure(total <= maximum, 'AMORA_INSPECTION_RESPONSE_TOO_LARGE');
        chunks.push(Buffer.from(value));
      }
      const rows = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      ensure(Array.isArray(rows), 'AMORA_INSPECTION_RESPONSE_INVALID');
      return rows;
    } catch (error) {
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
      fail(error instanceof InspectionBlocked ? error.code : 'AMORA_INSPECTION_REMOTE_UNCONFIRMED');
    } finally {
      clearTimeout(timeout);
      try { reader?.releaseLock(); } catch { /* 중단 중인 reader는 GC에 맡기고 원문 오류는 내보내지 않는다. */ }
    }
  } };
}

// CLI는 주입 인자를 노출하지 않는다. 주입은 외부 경계의 오프라인 회귀 검사에만 사용한다.
export async function runAmoraDecisionPrivacyInspection({ repoRoot, argv, environment = process.env,
  assertSource = assertGitSource, receiptFactory = createAmoraDecisionPrivacyInspectionReceipt, transport,
  now = () => new Date() } = {}) {
  const options = parseAmoraDecisionPrivacyInspectionArgs(argv ?? []);
  assertSafeEnvironment(environment);
  assertSource(repoRoot, options.expectedCommit, environment);
  const snapshot = sourceSnapshot(repoRoot), { plan } = snapshot;
  const { buildAmoraDecisionPrivacyInspectionSql, validateAmoraDecisionPrivacyInspection } =
    await import('./amora-decision-privacy-inspection.mjs');
  const sql = buildAmoraDecisionPrivacyInspectionSql(plan);
  transport ??= createAmoraDecisionPrivacyInspectionTransport({ plan, accessToken: environment.SUPABASE_ACCESS_TOKEN });
  const receipt = receiptFactory(repoRoot, options.receiptOut);
  const binding = { format: 'amora-decision-privacy-inspection-receipt-v1', projectRef: PROJECT,
    release: plan.contract.release, releaseCommit: options.expectedCommit, contractSha256: plan.contractSha256,
    migrations: plan.contract.migrations, runtime: snapshot.runtime, querySha256: digest(sql), ...authority };
  const record = (status, extra = {}) => receipt.append({ ...binding, ...extra, status, recordedAt: now().toISOString() });
  try {
    record('started');
    const startedAt = now();
    ensure(transport && typeof transport.inspect === 'function', 'AMORA_INSPECTION_TRANSPORT_REQUIRED');
    const rows = await transport.inspect();
    const finishedAt = now();
    ensure(Array.isArray(rows) && rows.length === 1 && rows[0] && Object.keys(rows[0]).length === 1
      && Object.hasOwn(rows[0], 'observation'), 'AMORA_INSPECTION_RESPONSE_INVALID');
    const observation = validateAmoraDecisionPrivacyInspection(rows[0].observation, { plan, startedAt, finishedAt });
    assertSafeEnvironment(environment);
    assertSource(repoRoot, options.expectedCommit, environment);
    ensure(JSON.stringify(sourceSnapshot(repoRoot)) === JSON.stringify(snapshot), 'AMORA_INSPECTION_SOURCE_CHANGED');
    record('observed-unreviewed', { observation });
    return { status: 'observed-unreviewed', ledgerState: observation.ledgerState, ledgerCount: observation.ledgerCount, ...authority };
  } catch (error) {
    const code = safeCode(error);
    try { record('blocked', { code }); } catch { /* 처음 fsync한 기록을 보존한다. */ }
    fail(code);
  } finally { receipt.close(); }
}
