import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createProfileRoleNativeDatabase, nativeProfileRoleAvailable } from './fixtures/profile-role-native-database.mjs';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const storageFence = read('supabase/platform-operations/storage/20260928135517_provider_portfolio_service_fence.sql');
const baseDeletion = read('supabase/migrations/20260716113000_account_deletion_storage_saga.sql');
const migrations = [
  '20260928135517_provider_participation_self_publishing.sql',
  '20260928140701_provider_portfolio_account_deletion.sql',
  '20260928142123_provider_media_cleanup.sql',
].map(name => ({ name, sql: read(`supabase/migrations/${name}`) }));
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';
const LEGACY = '44444444-4444-4444-8444-444444444444';
const evidence = { signup_consent: { schemaVersion: 1, source: 'hanbang_auth_server', record: {
  terms_agreed: true, privacy_agreed: true, age_over_14_confirmed: true, marketing_agreed: false,
  consent_policy_version: '2026-09-28', consent_agreed_at: '2026-09-28T00:00:00.000Z',
} } };
const application = { kind: 'individual', name: 'Synthetic photographer', categories: ['photography'], regions: ['서울'],
  contact_name: 'Synthetic applicant', application_note: 'No customer or production data.',
  consents: { privacy: true, price_transparency: true, extra_charges: true, standard_terms: true, version: '2026-09-28' } };
const offering = { name: 'Synthetic service', category: 'photography', description: 'Synthetic description', base_price_krw: 300000,
  price_unit: '2시간', includes: ['원본'], extra_charges: '출장 별도', conditions: '실제 일정과 담당자 확인 필요' };

async function persona(db, role = 'authenticated', id = OWNER) {
  assert.ok(['authenticated', 'anon', 'service_role'].includes(role));
  await db.query('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id ?? '']);
  await db.query(`SET ROLE ${role}`);
}
async function rpc(db, name, args = [], types = []) {
  assert.match(name, /^[a-z_]+$/);
  for (const type of types) assert.ok(['uuid', 'jsonb', 'integer', 'text', 'boolean'].includes(type));
  const placeholders = args.map((_, index) => `$${index + 1}${types[index] ? `::${types[index]}` : ''}`).join(',');
  return (await db.query(`SELECT public.${name}(${placeholders}) AS result`, args)).rows[0].result;
}
const catalog = db => rpc(db, 'provider_public_catalog', [null, 30], ['uuid', 'integer']);

async function seedSyntheticPrerequisites(db) {
  await db.query(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,banned_until timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,is_admin boolean NOT NULL DEFAULT false);
    CREATE TABLE public.vendors(id uuid PRIMARY KEY,owner_id uuid REFERENCES auth.users(id),name text);
    CREATE TABLE public.account_deletions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,email text,reason text,deleted_at timestamptz DEFAULT now());
    CREATE TABLE public.community_upload_sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,staging_path text,final_bucket text,final_path text,expires_at timestamptz);
    CREATE TABLE public.profile_avatar_assets(user_id uuid,object_path text,upload_until timestamptz);
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text,UNIQUE(bucket_id,name));
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA auth,storage,public TO anon,authenticated,service_role;
    GRANT ALL ON storage.objects TO anon,authenticated,service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
    INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
      ('${OWNER}','owner@example.invalid',now()),('${OTHER}','other@example.invalid',now()),('${ADMIN}','admin@example.invalid',now());
    INSERT INTO public.profiles(id,is_admin) SELECT id,id='${ADMIN}'::uuid FROM auth.users;
    INSERT INTO public.vendors VALUES('${LEGACY}',NULL,'Unrelated legacy sentinel');
    INSERT INTO storage.buckets VALUES('unrelated','unrelated',false,1000,ARRAY['image/webp']);
    INSERT INTO storage.objects(bucket_id,name) VALUES('unrelated','sentinel.webp');
  `);
  await db.query('UPDATE auth.users SET raw_app_meta_data=$1::jsonb', [evidence]);
  // Actual pre-existing deletion schema/function definitions, not a substitute RPC stub.
  await db.query(baseDeletion);
}

// The rehearsal preserves every migration body and removes only its single outer
// transaction wrapper. A caller-owned transaction can then prove all-or-nothing
// behavior. This does not claim an existing production release controller does so.
function transactionBody(sql) {
  assert.equal((sql.match(/^BEGIN;\s*$/gm) ?? []).length, 1);
  assert.equal((sql.match(/^COMMIT;\s*$/gm) ?? []).length, 1);
  assert.match(sql, /COMMIT;\s*$/);
  return sql.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
}
async function baseline(db) {
  await db.query('RESET ROLE');
  return (await db.query(`SELECT jsonb_build_object(
    'legacy',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.vendors v),
    'buckets',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM storage.buckets b),
    'objects',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM storage.objects o),
    'manifestDefinition',pg_get_functiondef('public.replace_account_deletion_media_manifest(uuid,uuid,jsonb)'::regprocedure),
    'manifestConstraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname)
      FROM pg_constraint WHERE conrelid='public.account_deletion_media_manifest'::regclass),
    'providerSchema',to_regnamespace('provider_private'),
    'providerProfile',to_regclass('public.provider_profiles'),
    'fenceCount',(SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND policyname='provider_portfolio_service_only')
  ) AS snapshot`)).rows[0].snapshot;
}
async function assertAppliedPostconditions(db) {
  await db.query('RESET ROLE');
  const tables = (await db.query(`SELECT relname,relrowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND relkind='r' AND relname IN
      ('provider_profiles','provider_applications','provider_offerings','provider_media','business_inquiries','provider_audit_events') ORDER BY relname`)).rows;
  assert.equal(tables.length, 6);
  for (const table of tables) assert.deepEqual([table.relrowsecurity, table.owner], [true, 'postgres'], table.relname);
  assert.deepEqual((await db.query("SELECT public,file_size_limit::integer,allowed_mime_types FROM storage.buckets WHERE id='provider-portfolio'")).rows,
    [{ public: false, file_size_limit: 5242880, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] }]);
  assert.equal((await db.query("SELECT count(*)::integer n FROM information_schema.columns WHERE table_schema='public' AND table_name='provider_media' AND column_name IN ('cleanup_claim_token','cleanup_claim_until','cleanup_attempted_at','cleanup_completed_at')")).rows[0].n, 4);
  const privileges = (await db.query(`SELECT
    has_function_privilege('anon','public.provider_public_catalog(uuid,integer)','EXECUTE') AS catalog,
    has_function_privilege('anon','public.provider_get_workspace()','EXECUTE') AS anon_workspace,
    has_function_privilege('authenticated','public.provider_claim_media_cleanup(uuid,integer)','EXECUTE') AS member_cleanup,
    has_function_privilege('service_role','public.provider_claim_media_cleanup(uuid,integer)','EXECUTE') AS worker_cleanup,
    has_function_privilege('authenticated','public.replace_account_deletion_media_manifest(uuid,uuid,jsonb)','EXECUTE') AS member_manifest,
    has_function_privilege('service_role','public.replace_account_deletion_media_manifest(uuid,uuid,jsonb)','EXECUTE') AS worker_manifest`)).rows[0];
  assert.deepEqual(privileges, { catalog: true, anon_workspace: false, member_cleanup: false, worker_cleanup: true, member_manifest: false, worker_manifest: true });
  assert.equal((await db.query(`SELECT count(*)::integer n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
    LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE (n.nspname='provider_private' OR (n.nspname='public' AND p.proname LIKE 'provider_%'))
      AND a.grantee=0 AND a.privilege_type='EXECUTE'`)).rows[0].n, 0);
  assert.equal((await db.query("SELECT name FROM public.vendors WHERE id=$1", [LEGACY])).rows[0].name, 'Unrelated legacy sentinel');
}

test('native PG17: provider bundle rollback, RLS, self-publishing, cleanup, and deletion boundaries', {
  skip: nativeProfileRoleAvailable ? false : 'installed PG17 unavailable; native provider bundle NOT verified',
  timeout: 120000,
}, async t => {
  const owned = await createProfileRoleNativeDatabase(), db = owned.client;
  const receipt = { remoteCalls: 0, customerData: false, serverVersion: null, migrations: migrations.map(item => item.name),
    missingFenceRolledBack: false, completeBundleRolledBack: false, lateFailureRolledBack: false,
    bundleApplied: false, runtimeBoundariesVerified: false, nativeClusterClosed: false };
  try {
    const version = (await db.query("SELECT current_setting('server_version') version,current_setting('server_version_num')::integer number")).rows[0];
    assert.ok(version.number >= 170000 && version.number < 180000);
    receipt.serverVersion = version.version;
    await seedSyntheticPrerequisites(db);
    const before = await baseline(db);

    await t.test('missing Storage-owner fence aborts and leaves no partial provider schema', async () => {
      await assert.rejects(db.query(migrations[0].sql), /PROVIDER_STORAGE_FENCE_REQUIRED/);
      await db.query('ROLLBACK');
      assert.deepEqual(await baseline(db), before);
      receipt.missingFenceRolledBack = true;
    });

    const body = `${storageFence}\n${migrations.map(item => transactionBody(item.sql)).join('\n')}`;
    await t.test('all migration bodies and their postconditions pass inside a rolled-back rehearsal', async () => {
      await db.query(`BEGIN;\n${body}`);
      try {
        await assertAppliedPostconditions(db);
        await persona(db);
        const result = await rpc(db, 'provider_submit_application', [application, randomUUID()], ['jsonb', 'uuid']);
        assert.equal(result.status, 'pending');
        assert.equal((await rpc(db, 'provider_get_workspace')).profiles.length, 1);
      } finally { await db.query('ROLLBACK'); }
      assert.deepEqual(await baseline(db), before);
      receipt.completeBundleRolledBack = true;
    });

    await t.test('a failure after the final migration body rolls back the fence and every preceding change', async () => {
      await assert.rejects(db.query(`BEGIN;\n${body}\nSELECT 1 / 0;`), /division by zero/);
      await db.query('ROLLBACK');
      assert.deepEqual(await baseline(db), before);
      receipt.lateFailureRolledBack = true;
    });

    await t.test('the exact fence and migration files apply in order with restrictive catalog postconditions', async () => {
      await db.query(storageFence);
      for (const item of migrations) await db.query(item.sql);
      await assertAppliedPostconditions(db);
      receipt.bundleApplied = true;
    });

    let profileId;
    await t.test('approved ownership enables immediate introduction editing while publication and service eligibility stay separate', async () => {
      await persona(db);
      const key = randomUUID();
      const submitted = await rpc(db, 'provider_submit_application', [application, key], ['jsonb', 'uuid']);
      assert.deepEqual(await rpc(db, 'provider_submit_application', [application, key], ['jsonb', 'uuid']), submitted);
      profileId = submitted.provider_id;
      await assert.rejects(rpc(db, 'provider_update_profile', [profileId, 1, { introduction: 'Not yet', website: '', instagram: '' }], ['uuid', 'integer', 'jsonb']), /PROVIDER_NOT_APPROVED/);
      await assert.rejects(db.query("UPDATE public.provider_profiles SET approval_status='approved' WHERE id=$1", [profileId]), /permission denied/);
      await persona(db, 'authenticated', ADMIN);
      await rpc(db, 'provider_review_application', [submitted.application_id, 1, 'approve', 'Synthetic review']);
      await persona(db);
      assert.deepEqual(await catalog(db), []);
      const updated = await rpc(db, 'provider_update_profile', [profileId, 2, { introduction: 'Approved self-published text', website: 'https://example.invalid', instagram: '' }], ['uuid', 'integer', 'jsonb']);
      await assert.rejects(rpc(db, 'provider_set_publication', [profileId, 2, 'published']), /PROVIDER_VERSION_CONFLICT/);
      await rpc(db, 'provider_set_publication', [profileId, updated.version, 'published']);
      let service = await rpc(db, 'provider_save_offering', [profileId, null, null, offering], ['uuid', 'uuid', 'integer', 'jsonb']);
      assert.deepEqual((await catalog(db))[0].offerings, []);
      await persona(db, 'authenticated', ADMIN);
      service = await rpc(db, 'provider_review_offering', [service.id, 1, 'approve', 'eligible', 'Synthetic service review']);
      await persona(db, 'anon', null);
      const published = (await catalog(db))[0];
      assert.equal(published.offerings[0].recommendation_status, 'eligible');
      for (const field of ['owner_id', 'contact_name', 'contact_email', 'consents', 'application_note', 'review_reason']) assert.equal(field in published, false, field);
      await assert.rejects(rpc(db, 'provider_get_workspace'), /permission denied/);
      await persona(db, 'authenticated', OTHER);
      assert.deepEqual((await db.query('SELECT * FROM public.provider_profiles')).rows, []);
      await assert.rejects(rpc(db, 'provider_set_publication', [profileId, 4, 'paused']), /PROVIDER_NOT_FOUND/);
      await persona(db);
      service = await rpc(db, 'provider_save_offering', [profileId, service.id, service.version, { ...offering, base_price_krw: 400000 }], ['uuid', 'uuid', 'integer', 'jsonb']);
      assert.equal(service.review_status, 'pending'); assert.equal(service.recommendation_status, 'needs_review');
      assert.equal((await catalog(db)).length, 1); assert.deepEqual((await catalog(db))[0].offerings, []);
      await db.query('RESET ROLE');
      await db.query('UPDATE auth.users SET raw_user_meta_data=raw_app_meta_data,raw_app_meta_data=NULL WHERE id=$1', [OWNER]);
      await persona(db);
      await assert.rejects(rpc(db, 'provider_get_workspace'), /PROVIDER_CONSENT_REQUIRED/);
      await db.query('RESET ROLE'); await db.query('UPDATE auth.users SET raw_app_meta_data=$2 WHERE id=$1', [OWNER, evidence]);
    });

    await t.test('the private bucket remains inaccessible beside a broad permissive policy', async () => {
      await db.query('RESET ROLE');
      await db.query('CREATE POLICY synthetic_broad_allow ON storage.objects FOR ALL TO anon,authenticated USING(true) WITH CHECK(true)');
      await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('provider-portfolio','synthetic-sentinel.webp')");
      for (const role of ['anon', 'authenticated']) {
        await persona(db, role, role === 'anon' ? null : OWNER);
        assert.equal((await db.query("SELECT count(*)::integer n FROM storage.objects WHERE bucket_id='provider-portfolio'")).rows[0].n, 0);
        assert.equal((await db.query("SELECT count(*)::integer n FROM storage.objects WHERE bucket_id='unrelated'")).rows[0].n, 1);
        await assert.rejects(db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('provider-portfolio','denied.webp')"), /row-level security/);
        assert.equal((await db.query("DELETE FROM storage.objects WHERE bucket_id='provider-portfolio' RETURNING id")).rows.length, 0);
      }
    });

    const assets = [];
    await t.test('cleanup uses leases, protects ready and recent uploads, and rejects client execution', async () => {
      await persona(db, 'service_role', null);
      const ready = await rpc(db, 'provider_register_media_upload', [profileId, OWNER, 'image/webp', 200]);
      const stale = await rpc(db, 'provider_register_media_upload', [profileId, OWNER, 'image/webp', 200]);
      const recent = await rpc(db, 'provider_register_media_upload', [profileId, OWNER, 'image/webp', 200]);
      assets.push(ready, stale, recent);
      await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('provider-portfolio',$1)", [ready.storage_path]);
      await persona(db);
      await rpc(db, 'provider_finalize_media', [ready.id, 'Synthetic work', 'Synthetic consenting people', true]);
      await db.query('RESET ROLE');
      // PG stores microseconds, unlike JavaScript Date; keep this non-millisecond
      // instant to exercise the deletion manifest's conservative boundary below.
      await db.query("UPDATE public.provider_media SET created_at='2020-01-01T00:00:00.123456Z' WHERE id=ANY($1::uuid[])", [[ready.id, stale.id]]);
      await persona(db);
      await assert.rejects(rpc(db, 'provider_claim_media_cleanup', [randomUUID(), 20]), /permission denied/);
      await persona(db, 'service_role', null);
      const claim = randomUUID();
      const claimed = await rpc(db, 'provider_claim_media_cleanup', [claim, 20]);
      assert.deepEqual(claimed.map(item => item.id), [stale.id]);
      assert.deepEqual(await rpc(db, 'provider_claim_media_cleanup', [randomUUID(), 20]), []);
      assert.equal(await rpc(db, 'provider_checkpoint_media_cleanup', [stale.id, randomUUID(), stale.storage_path]), false);
      assert.equal(await rpc(db, 'provider_checkpoint_media_cleanup', [stale.id, claim, recent.storage_path]), false);
      assert.equal(await rpc(db, 'provider_checkpoint_media_cleanup', [stale.id, claim, stale.storage_path]), true);
      assert.equal(await rpc(db, 'provider_checkpoint_media_cleanup', [stale.id, claim, stale.storage_path]), false);
      await persona(db); await assert.rejects(rpc(db, 'provider_finalize_media', [stale.id, '', '', true]), /PROVIDER_INVALID_STATE/);
      assert.equal((await catalog(db))[0].media.length, 1);
    });

    await t.test('deletion manifests require every owned registration and account removal clears owned records', async () => {
      await persona(db);
      const inquiry = await rpc(db, 'provider_submit_business_inquiry', [{ kind: 'collaboration', subject: 'Synthetic inquiry', message: 'Private synthetic message', contact_name: 'Owner', privacy_consent: true }, randomUUID()], ['jsonb', 'uuid']);
      await persona(db, 'authenticated', ADMIN);
      await rpc(db, 'provider_review_business_inquiry', [inquiry.id, 1, 'responded', 'Synthetic reply']);
      await db.query('RESET ROLE');
      const jobId = randomUUID(), claim = randomUUID();
      await db.query("INSERT INTO public.account_deletion_jobs(id,user_id,reason,status,claim_token,claimed_at) VALUES($1,$2,'privacy','inventorying',$3,now())", [jobId, OWNER, claim]);
      await persona(db); assert.deepEqual(await catalog(db), []);
      await assert.rejects(rpc(db, 'provider_get_workspace'), /PROVIDER_ACCOUNT_DELETION_PENDING/);
      await persona(db, 'service_role', null);
      await assert.rejects(rpc(db, 'provider_register_media_upload', [profileId, OWNER, 'image/webp', 200]), /PROVIDER_ACCOUNT_DELETION_PENDING/);
      await assert.rejects(db.query('SELECT * FROM public.replace_account_deletion_media_manifest($1,$2,$3::jsonb)', [jobId, claim, '[]']), /PROVIDER_PORTFOLIO_DELETION_INVENTORY_INCOMPLETE/);
      await db.query('RESET ROLE');
      const records = (await db.query('SELECT id,storage_path,created_at::text FROM public.provider_media WHERE provider_id=$1', [profileId])).rows;
      const entries = records.map(record => ({ bucket: 'provider-portfolio', path: record.storage_path, source: 'provider_portfolio', not_before: new Date(Date.parse(record.created_at) + 35 * 60 * 1000 + 1000).toISOString() }));
      await persona(db, 'service_role', null);
      const truncated = records.map(record => ({ bucket: 'provider-portfolio', path: record.storage_path, source: 'provider_portfolio', not_before: new Date(Date.parse(record.created_at) + 35 * 60 * 1000).toISOString() }));
      await assert.rejects(db.query('SELECT * FROM public.replace_account_deletion_media_manifest($1,$2,$3::jsonb)', [jobId, claim, JSON.stringify(truncated)]), /PROVIDER_PORTFOLIO_DELETION_PROOF_INVALID/);
      const invalid = entries.map((entry, index) => index ? entry : { ...entry, path: entry.path.replace(OWNER, OTHER) });
      await assert.rejects(db.query('SELECT * FROM public.replace_account_deletion_media_manifest($1,$2,$3::jsonb)', [jobId, claim, JSON.stringify(invalid)]), /ACCOUNT_DELETION_MANIFEST_PATH_INVALID/);
      assert.equal((await db.query('SELECT count(*)::integer n FROM public.account_deletion_media_manifest WHERE job_id=$1', [jobId])).rows[0].n, 0);
      assert.deepEqual((await db.query('SELECT status,quarantine_count FROM public.replace_account_deletion_media_manifest($1,$2,$3::jsonb)', [jobId, claim, JSON.stringify(entries)])).rows, [{ status: 'inventory_ready', quarantine_count: 0 }]);
      await db.query("UPDATE public.account_deletion_jobs SET status='deleting',claim_token=$2,claimed_at=now() WHERE id=$1", [jobId, claim]);
      assert.equal(await rpc(db, 'prepare_account_deletion_auth_delete', [jobId, claim]), false, 'registered files must be checkpointed before worker Auth deletion');
      await db.query('RESET ROLE');
      // Independently inspect Auth FK cascade behavior. This superuser fixture
      // operation is not the worker path or a claim of external file deletion.
      await db.query('DELETE FROM auth.users WHERE id=$1', [OWNER]);
      for (const table of ['provider_profiles', 'provider_applications', 'provider_offerings', 'provider_media', 'business_inquiries', 'provider_audit_events']) {
        assert.equal((await db.query(`SELECT count(*)::integer n FROM public.${table}`)).rows[0].n, 0, table);
      }
      assert.equal((await db.query('SELECT name FROM public.vendors WHERE id=$1', [LEGACY])).rows[0].name, 'Unrelated legacy sentinel');
      // Storage bytes are external to Auth cascade. The durable manifest must still
      // contain their exact paths for the worker; this test does not fake SDK deletion.
      assert.equal((await db.query('SELECT count(*)::integer n FROM public.account_deletion_media_manifest WHERE job_id=$1', [jobId])).rows[0].n, assets.length);
      receipt.runtimeBoundariesVerified = true;
    });
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    await owned.close(); receipt.nativeClusterClosed = true;
    t.diagnostic(JSON.stringify(receipt));
  }
});
