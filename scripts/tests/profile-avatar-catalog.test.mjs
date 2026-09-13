import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createProfileAvatarNativeDatabase,nativeProfileAvatarAvailable} from './fixtures/profile-avatar-native-database.mjs';
import {buildProfileAvatarObservationSql,buildProfileAvatarMutationSql,validateProfileAvatarCatalog,validateProfileAvatarObservation} from '../lib/profile-avatar-catalog.mjs';
const root=resolve(import.meta.dirname,'../..'),read=file=>readFileSync(join(root,file),'utf8');
const context={sql:read('supabase/migrations/20260913082314_private_profile_avatars_delivery.sql'),
 policySql:read('supabase/platform-operations/storage/profile-avatar-delivery-service-only.sql'),fixture:JSON.parse(read('supabase/release-contracts/profile-avatar-pg17-catalog-v1.json')),
 previousSql:read('supabase/migrations/20260716113000_account_deletion_storage_saga.sql'),predecessorSql:read('supabase/migrations/20260913075045_profile_wedding_roles.sql')};

test('PG17 applies policy before DDL atomically, rolls all of it back, preserves prior metadata/rows, and enforces private storage and replacement/deletion proofs',
 {skip:nativeProfileAvatarAvailable?false:'native PostgreSQL 17 unavailable; hosted authority and actual catalog not verified',timeout:120000},async()=>{
 const db=await createProfileAvatarNativeDatabase(root);
 try {
  const query=sql=>db.client.query(sql),one=async(sql,params)=>(await db.client.query(sql,params)).rows[0];
  const observe=async()=>(await query(buildProfileAvatarObservationSql())).find(r=>r.rows[0]?.observation).rows[0].observation;
  const before=await observe();
  validateProfileAvatarCatalog(before.catalog,context,false);
  assert.equal(before.systemIdentifier,db.system);
  assert.throws(()=>validateProfileAvatarObservation(before,{...context,now:new Date()}),{code:'PROFILE_AVATAR_OBSERVATION_INVALID'});
  // 합성 host identity만 대체하며 정책/DDL/catalog와 트랜잭션 실행은 제품 원문을 쓴다.
  const bundle=rehearsal=>buildProfileAvatarMutationSql({...context,before,rehearsal,deadline:new Date(Date.now()+120000).toISOString()})
    .replace("<>'7581440907192989109'","<>'"+db.system+"'");
  await query(bundle(true));
  const rolledBack=await observe();
  for(const key of ['catalog','preservedCatalogSha','preservedBucketsSha','ledgerSha'])assert.deepEqual(rolledBack[key],before[key]);
  await query(bundle(false));
  const after=await observe();validateProfileAvatarCatalog(after.catalog,context,true);
  for(const key of ['preservedCatalogSha','preservedBucketsSha'])assert.equal(after[key],before[key]);
  assert.equal(after.ledgerWithoutTargetSha,before.ledgerSha);assert.equal(after.ledgerCount,before.ledgerCount+1);
  assert.equal((await one("SELECT statements[1] AS sql FROM supabase_migrations.schema_migrations WHERE version='20260913082314'")).sql,context.sql);
  const user='11111111-1111-4111-8111-111111111111',rev='22222222-2222-4222-8222-222222222222',next='33333333-3333-4333-8333-333333333333';
  await db.client.query('INSERT INTO auth.users VALUES($1)',[user]);
  await db.client.query('SELECT register_profile_avatar_asset($1,$2)',[user,rev]);
  await db.client.query("SELECT save_profile_avatar($1,'photo',NULL,$2,NULL)",[user,rev]);
  await assert.rejects(db.client.query("SELECT save_profile_avatar($1,'initial',NULL,$2,NULL)",[user,next]),/PROFILE_AVATAR_CONFLICT/);
  await db.client.query("SELECT save_profile_avatar($1,'initial',NULL,$2,$3)",[user,next,rev]);
  assert.equal((await one('SELECT kind FROM profile_avatars')).kind,'initial');
  assert.equal((await one('SELECT count(*)::int AS n FROM profile_avatar_assets')).n,1);
  const job='44444444-4444-4444-8444-444444444444',claim='55555555-5555-4555-8555-555555555555';
  await db.client.query("INSERT INTO account_deletion_jobs(id,user_id,status,claim_token) VALUES($1,$2,'inventorying',$3)",[job,user,claim]);
  await assert.rejects(db.client.query('SELECT register_profile_avatar_asset($1,$2)',[user,next]),/PROFILE_AVATAR_DELETION_PENDING/);
  const asset=await one('SELECT object_path,upload_until::text FROM profile_avatar_assets');
  const manifest=[{bucket:'profile-avatars',path:asset.object_path,source:'profile_avatar',not_before:asset.upload_until}];
  await assert.rejects(db.client.query('SELECT replace_account_deletion_media_manifest($1,$2,$3::jsonb)',
    [job,claim,JSON.stringify([{...manifest[0],not_before:'2020-01-01T00:00:00Z'}])]),/PROFILE_AVATAR_DELETION_PROOF_INVALID/);
  await db.client.query('SELECT replace_account_deletion_media_manifest($1,$2,$3::jsonb)',[job,claim,JSON.stringify(manifest)]);
  assert.deepEqual((await query('SELECT bucket,source FROM account_deletion_media_manifest')).rows,[{bucket:'profile-avatars',source:'profile_avatar'}]);
  await query("GRANT SELECT,INSERT ON storage.objects TO authenticated; CREATE POLICY synthetic_broad ON storage.objects FOR ALL TO authenticated USING(true) WITH CHECK(true);");
  await query("INSERT INTO storage.objects VALUES(NULL,'profile-avatars','secret.webp'),(NULL,'other-bucket','ordinary.webp'); SET ROLE authenticated;");
  try {assert.deepEqual((await query('SELECT name FROM storage.objects')).rows,[{name:'ordinary.webp'}]);
    await assert.rejects(query("INSERT INTO storage.objects VALUES(NULL,'profile-avatars','forged.webp')"),/row-level security/);
  }finally{await query('RESET ROLE')}
  await db.client.query('DELETE FROM auth.users WHERE id=$1',[user]);
  assert.equal((await one('SELECT count(*)::int AS n FROM profile_avatars')).n,0);
  assert.equal((await one('SELECT count(*)::int AS n FROM profile_avatar_assets')).n,0);
  await query('GRANT SELECT ON profile_avatars TO authenticated');
  const drifted=await observe();assert.throws(()=>validateProfileAvatarCatalog(drifted.catalog,context,true));
 }finally{await db.close()}
});
