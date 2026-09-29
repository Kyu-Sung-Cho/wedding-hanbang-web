import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { loadProviderParticipationReleasePlan } from './lib/provider-participation-release-contract.mjs';
import { localQaConfiguration, runLocalSdkQa } from './provider-local-supabase-sdk-qa.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);
const acknowledgement = '--allow-disposable-local-stack';

export function stackConfiguration(id, ports) {
  if (!/^provider-qa-[a-f0-9]{32}$/.test(id) || ports.length !== 5 || new Set(ports).size !== 5
    || ports.some(port => !Number.isInteger(port) || port < 1024 || port > 65535)) throw new Error('LOCAL_STACK_CONFIG_INVALID');
  return `project_id = "${id}"
[api]
enabled = true
port = ${ports[0]}
schemas = ["public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000
[db]
port = ${ports[1]}
shadow_port = ${ports[2]}
major_version = 17
[db.migrations]
enabled = false
[db.seed]
enabled = false
[db.pooler]
enabled = false
[studio]
enabled = false
[inbucket]
enabled = false
port = ${ports[3]}
[realtime]
enabled = false
[storage]
enabled = true
file_size_limit = "50MiB"
[auth]
enabled = true
site_url = "http://127.0.0.1:${ports[4]}"
enable_signup = true
[auth.email]
enable_signup = true
enable_confirmations = false
[auth.rate_limit]
token_refresh = 1000
sign_in_sign_ups = 1000
[analytics]
enabled = false
[edge_runtime]
enabled = false
`;
}

export function localDockerEnvironment(env, platform = process.platform) {
  // Supabase must use this machine's engine, never a configured remote context.
  const host = platform === 'win32' ? 'npipe:////./pipe/docker_engine' : 'unix:///var/run/docker.sock';
  if (env.DOCKER_HOST && env.DOCKER_HOST !== host) throw new Error('LOCAL_DOCKER_ENGINE_REQUIRED');
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => !/^(?:SUPABASE_|PROVIDER_QA_|DOCKER_|PG)/i.test(key)));
  return { ...clean, DOCKER_HOST: host, DOCKER_CONTEXT: '', SUPABASE_TELEMETRY_DISABLED: '1' };
}

async function freePorts() {
  const servers = [];
  try {
    for (let i = 0; i < 5; i++) {
      const server = createServer(); servers.push(server);
      await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
    }
    return servers.map(server => server.address().port);
  } finally { await Promise.all(servers.map(server => new Promise(accept => server.close(accept)))); }
}

export async function runDisposableProviderStack(argv, env = process.env, progress = () => {}) {
  if (argv.length !== 1 || argv[0] !== acknowledgement) throw new Error('DISPOSABLE_LOCAL_STACK_ACK_REQUIRED');
  const plan = loadProviderParticipationReleasePlan(root);
  const childEnv = localDockerEnvironment(env);
  const id = `provider-qa-${randomUUID().replaceAll('-', '')}`;
  // Refuse before creating files if Docker is unavailable. Captured CLI output
  // may contain local JWTs and passwords, so it is never forwarded to the log.
  await execute('docker', ['info', '--format', '{{.ServerVersion}}'], { env: childEnv, timeout: 15000, windowsHide: true });
  const parent = await realpath(tmpdir());
  const directory = await mkdtemp(join(parent, 'hanbang-provider-qa-'));
  const cli = join(root, 'node_modules/supabase/dist/supabase.js');
  const run = (args, timeout = 60_000) => execute(process.execPath, [cli, ...args, '--workdir', directory, '--agent', 'no'], {
    cwd: directory, env: childEnv, timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
  });
  let started = false, stopped = false, stage = 'prepare', result;
  try {
    await mkdir(join(directory, 'supabase'));
    await writeFile(join(directory, 'supabase/config.toml'), stackConfiguration(id, await freePorts()), { flag: 'wx' });
    stage = 'start-actual-local-services'; progress(stage); started = true;
    await run(['start', '--exclude', 'analytics,studio,meta,realtime,inbucket,edge-runtime,imgproxy,vector'], 12 * 60_000);
    const status = JSON.parse((await run(['status', '-o', 'json'])).stdout);
    const config = localQaConfiguration(['--allow-empty-local-synthetic-writes'], {
      PROVIDER_QA_SUPABASE_URL: status.API_URL,
      PROVIDER_QA_DATABASE_URL: status.DB_URL,
      PROVIDER_QA_ANON_KEY: status.ANON_KEY,
      PROVIDER_QA_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    });
    stage = 'provision-only-empty-owned-local-stack'; progress(stage);
    const { Client } = await import('pg');
    const db = new Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000, query_timeout: 30000 });
    try {
      await db.connect();
      const identity = (await db.query(`SELECT (SELECT system_identifier::text FROM pg_control_system()) system,
        current_setting('server_version_num')::integer version,
        (SELECT count(*)::integer FROM auth.users) users,
        (SELECT count(*)::integer FROM pg_tables WHERE schemaname='public') tables,
        (SELECT count(*)::integer FROM storage.objects) objects`)).rows[0];
      if (identity.system === plan.contract.systemIdentifier || identity.version < 170000 || identity.version >= 180000
        || identity.users !== 0 || identity.tables !== 0 || identity.objects !== 0) throw new Error('EMPTY_LOCAL_STACK_REQUIRED');
      for (const file of [
        'scripts/tests/fixtures/provider-local-supabase-base.sql',
        'supabase/migrations/20260716113000_account_deletion_storage_saga.sql',
        'supabase/platform-operations/storage/profile-avatar-service-only.sql',
        'supabase/migrations/20260913082314_private_profile_avatars_delivery.sql',
        plan.contract.platformPolicy.file,
        ...plan.contract.migrations.map(pin => `supabase/migrations/${pin.file}`),
      ]) await db.query(await readFile(join(root, file), 'utf8'));
      await db.query("NOTIFY pgrst, 'reload schema'");
    } finally { await db.end(); }
    // The schema-cache reload is asynchronous. Read the public RPC until the
    // running PostgREST instance sees it, with a bounded wait and no mutation.
    stage = 'wait-for-postgrest-schema'; progress(stage);
    const { createClient } = await import('@supabase/supabase-js');
    const { localOnlyFetch } = await import('./provider-local-supabase-sdk-qa.mjs');
    const anonymous = createClient(config.apiUrl, config.anonKey, { auth: { persistSession: false }, global: { fetch: localOnlyFetch(config.apiUrl) } });
    let available = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const response = await anonymous.rpc('provider_public_catalog', { p_provider_id: null, p_limit: 30 });
      if (!response.error && Array.isArray(response.data) && response.data.length === 0) { available = true; break; }
      await new Promise(accept => setTimeout(accept, 1000));
    }
    if (!available) throw new Error('LOCAL_POSTGREST_NOT_READY');
    stage = 'sdk-integration';
    result = await runLocalSdkQa(config, progress);
  } catch (error) {
    if (error instanceof Error && /^LOCAL_QA_FAILED:/.test(error.message)) throw error;
    throw new Error(`LOCAL_STACK_FAILED:${stage}`);
  } finally {
    if (started) {
      progress('stop-only-this-run-local-stack');
      try { await run(['stop', '--project-id', id, '--no-backup'], 120_000); stopped = true; }
      catch { throw new Error('LOCAL_STACK_CLEANUP_UNCONFIRMED'); }
    }
    if (!started || stopped) {
      const actual = await realpath(directory);
      const fromParent = relative(parent, actual);
      if (actual !== directory || dirname(actual) !== parent || !fromParent.startsWith('hanbang-provider-qa-')
        || fromParent.includes(sep)) throw new Error('LOCAL_STACK_CLEANUP_PATH_INVALID');
      await rm(actual, { recursive: true });
    }
  }
  return { ...result, disposableStackStopped: stopped, syntheticPublicDependencies: true,
    restoredProductionBaseline: false, releaseAuthorized: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await runDisposableProviderStack(process.argv.slice(2), process.env, stage => console.log(`provider-stack: ${stage}`)))); }
  catch (error) {
    console.error(error instanceof Error && /^(LOCAL_(?:STACK|QA)_|DISPOSABLE_LOCAL_)/.test(error.message)
      ? error.message : 'LOCAL_STACK_UNAVAILABLE_OR_REFUSED');
    process.exitCode = 1;
  }
}
