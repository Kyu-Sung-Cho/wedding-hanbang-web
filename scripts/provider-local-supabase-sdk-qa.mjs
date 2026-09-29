import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// This runner never loads .env files or accepts hosted destinations. It expects
// a pre-provisioned, empty, disposable LOCAL Supabase stack with the provider SQL.
export function localQaConfiguration(argv, env) {
  if (argv.length !== 1 || argv[0] !== '--allow-empty-local-synthetic-writes') {
    throw new Error('LOCAL_SYNTHETIC_WRITE_ACK_REQUIRED');
  }
  const api = new URL(env.PROVIDER_QA_SUPABASE_URL ?? '');
  const database = new URL(env.PROVIDER_QA_DATABASE_URL ?? '');
  if (api.protocol !== 'http:' || api.hostname !== '127.0.0.1' || !api.port
    || api.username || api.password || api.pathname !== '/' || api.search || api.hash) {
    throw new Error('LOCAL_LITERAL_API_REQUIRED');
  }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || database.hostname !== '127.0.0.1'
    || !database.port || database.search || database.hash || database.pathname !== '/postgres') {
    throw new Error('LOCAL_LITERAL_DATABASE_REQUIRED');
  }
  const anonKey = env.PROVIDER_QA_ANON_KEY, serviceKey = env.PROVIDER_QA_SERVICE_ROLE_KEY;
  if (!anonKey || !serviceKey || anonKey === serviceKey) throw new Error('SEPARATE_LOCAL_KEYS_REQUIRED');
  return { apiUrl: api.origin, databaseUrl: database.href, anonKey, serviceKey };
}

export function localOnlyFetch(origin, fetcher = globalThis.fetch) {
  return (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== origin || url.username || url.password) throw new Error('SDK_DESTINATION_MISMATCH');
    return fetcher(input, { ...init, redirect: 'error', signal: AbortSignal.any([
      AbortSignal.timeout(20_000), ...(init.signal ? [init.signal] : []),
    ]) });
  };
}

const consent = { signup_consent: { schemaVersion: 1, source: 'hanbang_auth_server', record: {
  terms_agreed: true, privacy_agreed: true, age_over_14_confirmed: true, marketing_agreed: false,
  consent_policy_version: '2026-09-28', consent_agreed_at: '2026-09-28T00:00:00.000Z',
} } };
const application = { kind: 'team', name: 'LOCAL SYNTHETIC photographer', categories: ['photography'], regions: ['서울'],
  contact_name: 'Synthetic owner', application_note: 'Disposable local QA, no real customer or provider.',
  consents: { privacy: true, price_transparency: true, extra_charges: true, standard_terms: true, version: '2026-09-28' } };
const succeeded = (result) => { assert.equal(result.error, null); return result.data; };
const denied = (result, reason) => { assert.ok(result.error, 'request unexpectedly succeeded'); if (reason) assert.ok(result.error.message.includes(reason)); };

export async function runLocalSdkQa(config, progress = () => {}) {
  localQaConfiguration(['--allow-empty-local-synthetic-writes'], {
    PROVIDER_QA_SUPABASE_URL: config.apiUrl, PROVIDER_QA_DATABASE_URL: config.databaseUrl,
    PROVIDER_QA_ANON_KEY: config.anonKey, PROVIDER_QA_SERVICE_ROLE_KEY: config.serviceKey,
  });
  const [{ createClient }, { Client }, { default: sharp }] = await Promise.all([
    import('@supabase/supabase-js'), import('pg'), import('sharp'),
  ]);
  const makeClient = (key, transport = localOnlyFetch(config.apiUrl)) => createClient(config.apiUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: transport },
  });
  const service = makeClient(config.serviceKey), anonymous = makeClient(config.anonKey);
  const db = new Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000, query_timeout: 10000 });
  const users = [], paths = [], checks = [];
  let stage = 'preflight', connected = false, cleanupSucceeded = false;
  const step = (name) => { stage = name; progress(name); };
  const checked = (name) => checks.push(name);
  const rpc = async (client, name, args = {}) => succeeded(await client.rpc(name, args));
  const catalog = async (id) => rpc(anonymous, 'provider_public_catalog', { p_provider_id: id, p_limit: 30 });
  let error;
  try {
    step('empty-local-database-and-services');
    await db.connect(); connected = true;
    assert.equal((await db.query('SELECT count(*)::int n FROM auth.users')).rows[0].n, 0, 'local Auth must be empty');
    const existing = succeeded(await service.auth.admin.listUsers({ page: 1, perPage: 1 }));
    assert.equal(existing.users.length, 0, 'local Auth API must be empty');
    for (const table of ['provider_profiles', 'provider_applications', 'provider_offerings', 'provider_media', 'business_inquiries', 'provider_audit_events']) {
      assert.equal((await db.query(`SELECT count(*)::int n FROM public.${table}`)).rows[0].n, 0);
    }
    assert.equal((await db.query("SELECT count(*)::int n FROM storage.objects WHERE bucket_id='provider-portfolio'")).rows[0].n, 0);
    const bucket = succeeded(await service.storage.getBucket('provider-portfolio'));
    assert.equal(bucket.public, false); assert.equal(Number(bucket.file_size_limit), 5 * 1024 * 1024);
    assert.ok(bucket.allowed_mime_types.includes('image/webp'));
    assert.deepEqual(await catalog(null), []);
    checked('empty_actual_auth_storage_and_provider_database');

    step('real-auth-users-and-sessions');
    for (const role of ['owner', 'outsider', 'administrator']) {
      const email = `provider-qa-${role}-${randomUUID()}@example.invalid`, password = randomBytes(32).toString('base64url');
      const created = succeeded(await service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: consent }));
      assert.ok(created.user?.id);
      const user = { id: created.user.id, email, client: makeClient(config.anonKey) };
      users.push(user);
      // Establish that Auth and SQL point at the same stack before SQL mutations.
      const record = (await db.query('SELECT id,email,email_confirmed_at FROM auth.users WHERE id=$1', [user.id])).rows[0];
      assert.equal(record?.email, email); assert.ok(record.email_confirmed_at);
      await db.query('INSERT INTO public.profiles(id,is_admin) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET is_admin=EXCLUDED.is_admin', [user.id, role === 'administrator']);
      succeeded(await user.client.auth.signInWithPassword({ email, password }));
      assert.equal(succeeded(await user.client.auth.getUser()).user.id, user.id);
    }
    const [owner, outsider, administrator] = users;
    checked('real_auth_admin_create_and_password_sessions');

    step('approval-and-ownership-boundaries');
    const submitted = await rpc(owner.client, 'provider_submit_application', { p_input: application, p_request_id: randomUUID() });
    const providerId = submitted.provider_id;
    const registerArgs = { p_provider_id: providerId, p_owner_id: owner.id, p_mime_type: 'image/webp', p_byte_size: 200 };
    denied(await service.rpc('provider_register_media_upload', registerArgs), 'PROVIDER_NOT_APPROVED');
    denied(await outsider.client.rpc('provider_review_application', { p_application_id: submitted.application_id, p_expected_version: 1, p_action: 'approve', p_reason: 'Not admin' }), 'PROVIDER_FORBIDDEN');
    denied(await owner.client.from('provider_profiles').update({ approval_status: 'approved' }).eq('id', providerId));
    assert.deepEqual((await rpc(outsider.client, 'provider_get_workspace')).profiles, []);
    await rpc(administrator.client, 'provider_review_application', { p_application_id: submitted.application_id, p_expected_version: 1, p_action: 'approve', p_reason: 'Synthetic local approval' });
    assert.deepEqual(await catalog(providerId), []);
    denied(await outsider.client.rpc('provider_set_publication', { p_provider_id: providerId, p_expected_version: 2, p_status: 'published' }), 'PROVIDER_NOT_FOUND');
    checked('actual_rpc_pending_approval_direct_write_and_idor');

    step('actual-webp-upload-and-private-storage-fence');
    const bytes = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#527d91' } }).webp().toBuffer();
    const media = await rpc(service, 'provider_register_media_upload', { ...registerArgs, p_byte_size: bytes.length });
    assert.equal(media.storage_path, `${owner.id}/${providerId}/${media.id}.webp`);
    paths.push(media.storage_path);
    const storage = (client) => client.storage.from('provider-portfolio');
    denied(await storage(owner.client).upload(media.storage_path, bytes, { contentType: 'image/webp', upsert: false }));
    succeeded(await storage(service).upload(media.storage_path, bytes, { contentType: 'image/webp', upsert: false }));
    assert.equal((await db.query("SELECT count(*)::int n FROM storage.objects WHERE bucket_id='provider-portfolio' AND name=$1", [media.storage_path])).rows[0].n, 1);
    const finalize = { p_media_id: media.id, p_caption: 'Synthetic pixels', p_alt_text: 'Synthetic blue rectangle', p_rights_confirmed: true };
    denied(await outsider.client.rpc('provider_finalize_media', finalize), 'PROVIDER_NOT_FOUND');
    await rpc(owner.client, 'provider_finalize_media', finalize);
    assert.equal((await rpc(owner.client, 'provider_get_workspace')).media.length, 1);
    for (const client of [anonymous, owner.client, outsider.client]) denied(await storage(client).download(media.storage_path));
    const downloaded = succeeded(await storage(service).download(media.storage_path));
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
    assert.deepEqual(await rpc(service, 'provider_abort_media_upload', { p_media_id: media.id, p_owner_id: owner.id }), { aborted: false, storage_path: null });
    checked('real_storage_bytes_exact_roundtrip_and_restrictive_client_fence');

    step('explicit-publication-withdrawal-and-current-admin-role');
    let profile = await rpc(owner.client, 'provider_set_publication', { p_provider_id: providerId, p_expected_version: 2, p_status: 'published' });
    let visible = await catalog(providerId);
    assert.equal(visible.length, 1); assert.equal(visible[0].media[0].id, media.id);
    for (const field of ['owner_id', 'contact_email', 'storage_path', 'contact_name']) assert.ok(!JSON.stringify(visible).includes(`"${field}"`));
    profile = await rpc(owner.client, 'provider_set_publication', { p_provider_id: providerId, p_expected_version: profile.version, p_status: 'paused' });
    assert.deepEqual(await catalog(providerId), []);
    profile = await rpc(owner.client, 'provider_set_publication', { p_provider_id: providerId, p_expected_version: profile.version, p_status: 'published' });
    await db.query('UPDATE public.profiles SET is_admin=false WHERE id=$1', [administrator.id]);
    const suspend = { p_provider_id: providerId, p_expected_version: profile.version, p_reason: 'Synthetic suspension' };
    denied(await administrator.client.rpc('provider_suspend_profile', suspend), 'PROVIDER_FORBIDDEN');
    await db.query('UPDATE public.profiles SET is_admin=true WHERE id=$1', [administrator.id]);
    profile = await rpc(administrator.client, 'provider_suspend_profile', suspend);
    assert.deepEqual(await catalog(providerId), []);
    denied(await service.rpc('provider_register_media_upload', registerArgs), 'PROVIDER_NOT_APPROVED');
    profile = await rpc(administrator.client, 'provider_restore_profile', { p_provider_id: providerId, p_expected_version: profile.version, p_reason: 'Synthetic restoration' });
    assert.equal(profile.publication_status, 'paused'); assert.deepEqual(await catalog(providerId), []);
    await rpc(owner.client, 'provider_set_publication', { p_provider_id: providerId, p_expected_version: profile.version, p_status: 'published' });
    checked('public_rpc_pause_suspend_restore_and_live_admin_revocation');

    step('media-withdrawal-actual-storage-delete-and-auth-cascade');
    denied(await outsider.client.rpc('provider_remove_media', { p_media_id: media.id }), 'PROVIDER_NOT_FOUND');
    await rpc(owner.client, 'provider_remove_media', { p_media_id: media.id });
    assert.deepEqual((await catalog(providerId))[0].media, []);
    const { require: tsxRequire } = await import('tsx/cjs/api');
    const { cleanupProviderMedia } = tsxRequire('../apps/web/src/lib/providers/mediaCleanup.ts', import.meta.url);
    assert.deepEqual(await cleanupProviderMedia(service), { claimed: 0, cleaned: 0, retired: 0, pending: 0 });
    // Advance only this synthetic row past the grace interval; this is not a
    // real-time 35-minute wait or an account-deletion worker rehearsal.
    await db.query("UPDATE public.provider_media SET created_at=now()-interval '36 minutes' WHERE id=$1", [media.id]);
    let failedDeletes = 0;
    const realTransport = localOnlyFetch(config.apiUrl);
    const transientFailure = makeClient(config.serviceKey, (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (url.origin === config.apiUrl && url.pathname === '/storage/v1/object/provider-portfolio' && method === 'DELETE') {
        failedDeletes++;
        return Promise.resolve(Response.json({ message: 'Synthetic transient storage failure' }, { status: 503 }));
      }
      return realTransport(input, init);
    });
    assert.deepEqual(await cleanupProviderMedia(transientFailure), { claimed: 1, cleaned: 0, retired: 0, pending: 1 });
    assert.ok(failedDeletes > 0);
    assert.equal((await db.query('SELECT cleanup_completed_at FROM public.provider_media WHERE id=$1', [media.id])).rows[0].cleanup_completed_at, null);
    assert.deepEqual(Buffer.from(await succeeded(await storage(service).download(media.storage_path)).arrayBuffer()), bytes);
    assert.deepEqual(await cleanupProviderMedia(service), { claimed: 0, cleaned: 0, retired: 0, pending: 0 });
    await db.query("UPDATE public.provider_media SET cleanup_claim_until=now()-interval '1 second' WHERE id=$1", [media.id]);
    assert.deepEqual(await cleanupProviderMedia(service), { claimed: 1, cleaned: 1, retired: 0, pending: 0 });
    assert.ok((await db.query('SELECT cleanup_completed_at FROM public.provider_media WHERE id=$1', [media.id])).rows[0].cleanup_completed_at);
    assert.deepEqual(await cleanupProviderMedia(service), { claimed: 0, cleaned: 0, retired: 0, pending: 0 });
    checked('actual_media_cleanup_worker_grace_lease_failure_retry_and_checkpoint');
    assert.equal((await db.query("SELECT count(*)::int n FROM storage.objects WHERE bucket_id='provider-portfolio' AND name=$1", [media.storage_path])).rows[0].n, 0);
    denied(await storage(service).download(media.storage_path));
    succeeded(await service.auth.admin.deleteUser(owner.id));
    assert.equal((await db.query('SELECT count(*)::int n FROM public.provider_profiles WHERE id=$1', [providerId])).rows[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.provider_media WHERE id=$1', [media.id])).rows[0].n, 0);
    assert.deepEqual(await catalog(providerId), []);
    denied(await owner.client.rpc('provider_get_workspace'));
    checked('real_storage_removal_auth_delete_cascade_and_old_session_denial');
  } catch (caught) {
    error = caught;
  } finally {
    const failureStage = stage;
    step('cleanup-only-this-run-synthetic-resources');
    let cleanupError;
    for (const path of paths) {
      try { succeeded(await service.storage.from('provider-portfolio').remove([path])); } catch { cleanupError = true; }
    }
    if (connected && paths.length) {
      try { assert.equal((await db.query("SELECT count(*)::int n FROM storage.objects WHERE bucket_id='provider-portfolio' AND name=ANY($1::text[])", [paths])).rows[0].n, 0); }
      catch { cleanupError = true; }
    }
    // Preserve the synthetic owners for a retry if their file deletion is not proven.
    for (const user of cleanupError ? [] : users) {
      try {
        const lookup = await service.auth.admin.getUserById(user.id);
        if (lookup.data?.user) succeeded(await service.auth.admin.deleteUser(user.id));
        else if (!lookup.error || lookup.error.status !== 404) throw new Error('AUTH_CLEANUP_UNCONFIRMED');
      } catch { cleanupError = true; }
    }
    if (connected) {
      try {
        if (users.length) assert.equal((await db.query('SELECT count(*)::int n FROM auth.users WHERE id=ANY($1::uuid[])', [users.map(user => user.id)])).rows[0].n, 0);
        if (paths.length) assert.equal((await db.query("SELECT count(*)::int n FROM storage.objects WHERE bucket_id='provider-portfolio' AND name=ANY($1::text[])", [paths])).rows[0].n, 0);
      } catch { cleanupError = true; }
      await db.end();
    }
    cleanupSucceeded = !cleanupError;
    if (error || cleanupError) {
      // Never print SDK/SQL errors, URLs, keys, passwords, JWTs, or response bodies.
      throw new Error(`LOCAL_QA_FAILED:${error ? failureStage : 'cleanup'};cleanup=${cleanupSucceeded ? 'confirmed' : 'unconfirmed'}`);
    }
  }
  return { environment: 'actual-local-supabase-auth-storage-postgres', passed: true, checks, cleanupSucceeded,
    remoteDestinationAllowed: false, nextHttpRoutesVerified: false, accountDeletionWorkerVerified: false,
    mediaCleanupWorkerVerified: true, realTimeGraceWaitVerified: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = localQaConfiguration(process.argv.slice(2), process.env);
    console.log(JSON.stringify(await runLocalSdkQa(config, stage => console.log(`local-provider-qa: ${stage}`))));
  } catch (error) {
    console.error(error instanceof Error && /^LOCAL_QA_FAILED:/.test(error.message) ? error.message : 'LOCAL_QA_REFUSED_OR_UNAVAILABLE: use the documented empty-local-only configuration');
    process.exitCode = 1;
  }
}
