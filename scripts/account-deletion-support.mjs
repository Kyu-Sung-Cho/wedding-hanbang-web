import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { tsImport } from 'tsx/esm/api';
import { verifySupabaseServiceDestinationFromEnv } from './lib/supabase-service-destination.mjs';
import { openDeletionSupportStore } from './lib/account-deletion-support-store.mjs';

const PROJECT = 'slrtobkksjmxgzatjyqb';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (ok, code) => { if (!ok) throw new Error(code); };
let store;
try {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) {
    process.stdout.write('Private support-case operator: prepare | enqueue | inspect | process\n'
      + 'Use --mode=<mode> --case-id=<UUID> --expected-commit=<40hex>. prepare reads the actual reviewed request and identity proof as bounded JSON on private stdin.\n'
      + 'enqueue/process also require --confirm=<mode>:<case-id>:<latest-record-sha256> and ACCOUNT_DELETION_STATE_SECRET (or legacy CRON_SECRET) in memory for the read-only runtime-state endpoint.\n'
      + 'Secrets are environment/private stdin only. Cases are DPAPI protected on this Windows account. No mail, global intake/cron enablement or automatic retries.\n');
  } else {
    const options = {};
    for (const arg of args) {
      const match = /^--(mode|case-id|expected-commit|confirm)=(.+)$/.exec(arg);
      need(match && !Object.hasOwn(options, match[1]), 'SUPPORT_CASE_ARGUMENT_INVALID');
      options[match[1]] = match[2];
    }
    need(['prepare', 'enqueue', 'inspect', 'process'].includes(options.mode)
      && /^[a-f0-9]{40}$/.test(options['expected-commit'] ?? ''), 'SUPPORT_CASE_ARGUMENT_INVALID');
    const git = args => execFileSync('git', ['--no-replace-objects', '-C', ROOT, ...args], {
      encoding: 'utf8', windowsHide: true, timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
    }).trim();
    const assertSource = () => {
      need(git(['rev-parse', 'HEAD']) === options['expected-commit']
        && git(['remote', 'get-url', 'origin']) === 'https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git'
        && git(['status', '--porcelain', '--untracked-files=all']) === '', 'SUPPORT_CASE_SOURCE_NOT_CLEAN_EXACT_COMMIT');
    };
    assertSource();
    const mutation = ['enqueue', 'process'].includes(options.mode);
    const destination = verifySupabaseServiceDestinationFromEnv({ access: mutation ? 'operator-write' : 'read' });
    need(destination.projectRef === PROJECT, 'SUPPORT_CASE_PROJECT_MISMATCH');
    const { prepareDeletionSupportCase, validateDeletionSupportCase, advanceDeletionSupportCase, validateSupportRuntimeState } = await tsImport(
      '../apps/web/src/lib/accountDeletion/supportCase.ts', import.meta.url);
    store = openDeletionSupportStore(options['case-id'], { initialize: options.mode === 'prepare' });
    if (options.mode === 'prepare') {
      const chunks = []; let size = 0;
      for await (const chunk of process.stdin) {
        size += chunk.length; need(size <= 96 * 1024, 'SUPPORT_CASE_PRIVATE_INPUT_TOO_LARGE'); chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks); let input;
      try { input = JSON.parse(bytes.toString('utf8')); } finally { bytes.fill(0); chunks.forEach(b => b.fill(0)); }
      need(input && Object.keys(input).sort().join(',') === 'confirmation,operator,proof,requestText', 'SUPPORT_CASE_PRIVATE_INPUT_INVALID');
      const value = prepareDeletionSupportCase({ ...input, caseId: options['case-id'], projectRef: PROJECT,
        secret: process.env.SUPABASE_SERVICE_ROLE_KEY });
      await store.persist(value);
      process.stdout.write(JSON.stringify({ state: value.state, caseId: value.caseId, recordSha256: sha(JSON.stringify(value)), remoteWritesPerformed: false }) + '\n');
    } else {
      const value = store.latest;
      validateDeletionSupportCase(value, PROJECT);
      const stateSecret = typeof process.env.ACCOUNT_DELETION_STATE_SECRET === 'string' && process.env.ACCOUNT_DELETION_STATE_SECRET.trim().length > 0
        ? process.env.ACCOUNT_DELETION_STATE_SECRET : process.env.CRON_SECRET;
      if (mutation) {
        need(options.confirm === `${options.mode}:${value.caseId}:${sha(JSON.stringify(value))}`, 'SUPPORT_CASE_EXACT_RECORD_CONFIRMATION_REQUIRED');
        need(typeof stateSecret === 'string' && stateSecret.trim().length > 0, 'SUPPORT_CASE_RUNTIME_CREDENTIAL_REQUIRED');
      }
      const rawFetch = globalThis.fetch;
      const fetchBound = async (resource, init = {}) => {
        const url = new URL(typeof resource === 'string' || resource instanceof URL ? resource : resource.url);
        need(url.origin === destination.url || url.origin === 'https://hanbang.ai', 'SUPPORT_CASE_NETWORK_DESTINATION_BLOCKED');
        return rawFetch(resource, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000) });
      };
      const checkLive = async () => {
        const health = await fetchBound('https://hanbang.ai/api/health');
        const healthBody = await health.json();
        need(health.ok && healthBody.ok === true && healthBody.database === 'up'
          && healthBody.commit === options['expected-commit'].slice(0, 12), 'SUPPORT_CASE_LIVE_SOURCE_MISMATCH');
      };
      const beforeMutation = async () => {
        assertSource();
        await checkLive();
        // 기존 cron GET/HEAD는 worker를 실행할 수 있다. 고유 CPU-only 경로만 사용한다.
        const observed = await fetchBound('https://hanbang.ai/api/ops/account-deletion-state', {
          headers: { Authorization: `Bearer ${stateSecret}` },
        });
        need(observed.status === 200 && observed.headers.get('cache-control')?.includes('no-store'), 'SUPPORT_CASE_RUNTIME_STATE_UNAVAILABLE');
        const raw = await observed.text();
        need(Buffer.byteLength(raw) <= 4096, 'SUPPORT_CASE_RUNTIME_STATE_INVALID');
        const state = JSON.parse(raw);
        // 1초 이내 시계 차이만 한 번 기다린 뒤 실제 시각으로 기존 검증을 수행한다.
        const aheadMs = typeof state?.observedAt === 'string' ? Date.parse(state.observedAt) - Date.now() : NaN;
        if (aheadMs > 0 && aheadMs <= 1_000) await new Promise(resolve => setTimeout(resolve, aheadMs));
        validateSupportRuntimeState(state, options['expected-commit']); assertSource();
        validateSupportRuntimeState(state, options['expected-commit']);
      };
      await checkLive();
      const admin = createClient(destination.url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetchBound },
      });
      const worker = await tsImport('../apps/web/src/lib/accountDeletion/communityStorageSaga.ts', import.meta.url);
      const fields = 'id,user_id,status,claim_token,storage_verified_at,auth_deleted_at,completed_at';
      const project = row => ({ id: row.id, userId: row.user_id, status: row.status, claimToken: row.claim_token,
        storageVerifiedAt: row.storage_verified_at, authDeletedAt: row.auth_deleted_at, completedAt: row.completed_at });
      const read = async query => {
        const result = await query;
        need(!result.error && Array.isArray(result.data), 'SUPPORT_CASE_REMOTE_READ_UNAVAILABLE');
        return result.data;
      };
      const result = await advanceDeletionSupportCase(value, options.mode, {
        persist: async next => { assertSource(); await store.persist(next); },
        enqueue: async subject => { await beforeMutation(); await worker.requestAccountDeletion(admin, subject, 'privacy', Date.now(), { processImmediately: false }); },
        findActiveJobs: async subject => (await read(admin.from('account_deletion_jobs').select(fields).eq('user_id', subject).neq('status', 'completed').limit(2))).map(project),
        readJob: async id => {
          const rows = await read(admin.from('account_deletion_jobs').select(fields).eq('id', id).limit(2));
          need(rows.length <= 1, 'SUPPORT_CASE_REMOTE_READ_UNAVAILABLE'); return rows.length === 1 ? project(rows[0]) : null;
        },
        process: async id => { await beforeMutation(); return worker.processAccountDeletionJob(admin, id); },
        verifyAccountAbsence: async subject => {
          const result = await admin.auth.admin.getUserById(subject);
          return !result.data?.user && (result.error?.status === 404 || result.error?.code === 'user_not_found')
            && (await read(admin.from('profiles').select('id').eq('id', subject).limit(1))).length === 0;
        },
      });
      process.stdout.write(JSON.stringify({ state: result.state, caseId: result.caseId,
        recordSha256: sha(JSON.stringify(result)), generalCustomerDataRemovalVerified: false, emailsSent: 0 }) + '\n');
    }
  }
} catch (error) {
  const code = /^SUPPORT_CASE_[A-Z_]+$/.test(error?.code ?? error?.message ?? '') ? (error.code ?? error.message) : 'SUPPORT_CASE_OPERATION_UNVERIFIED';
  process.stderr.write(JSON.stringify({ code, retryAutomatically: false, inspectExistingCaseBeforeRetry: true }) + '\n');
  process.exitCode = 2;
} finally { store?.close(); }
