import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
const migration = readFileSync(new URL('../../supabase/migrations/20260928135517_provider_participation_self_publishing.sql', import.meta.url), 'utf8');
const storageFence = readFileSync(new URL('../../supabase/platform-operations/storage/20260928135517_provider_portfolio_service_fence.sql', import.meta.url), 'utf8');
const OWNER='11111111-1111-4111-8111-111111111111', OTHER='22222222-2222-4222-8222-222222222222';
const ADMIN='33333333-3333-4333-8333-333333333333', UNVERIFIED='44444444-4444-4444-8444-444444444444';
const application=()=>({kind:'team',name:'Synthetic photography team',categories:['photography'],regions:['서울'],
  contact_name:'Synthetic owner',application_note:'Synthetic submission; not a real provider.',
  consents:{privacy:true,price_transparency:true,extra_charges:true,standard_terms:true,version:'2026-09-28'}});
const offering=()=>({name:'Synthetic two-hour shoot',category:'photography',description:'Synthetic test',base_price_krw:300000,
  price_unit:'2시간',includes:['원본'],extra_charges:'출장비 별도',conditions:'일정 확인 필요'});

async function fixture({fence=true,apply=true}={}) {
  const db=await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,banned_until timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,is_admin boolean NOT NULL DEFAULT false);
    CREATE TABLE public.account_deletion_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,status text);
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text,UNIQUE(bucket_id,name));
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA auth,storage,public TO anon,authenticated,service_role;
    GRANT ALL ON storage.objects TO anon,authenticated,service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
    INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
      ('${OWNER}','owner@example.invalid',now()),('${OTHER}','other@example.invalid',now()),
      ('${ADMIN}','admin@example.invalid',now()),('${UNVERIFIED}','unverified@example.invalid',NULL);
    INSERT INTO public.profiles(id,is_admin) SELECT id,id='${ADMIN}'::uuid FROM auth.users;
    UPDATE auth.users SET raw_app_meta_data='{"signup_consent":{"schemaVersion":1,"source":"hanbang_auth_server","record":{"terms_agreed":true,"privacy_agreed":true,"age_over_14_confirmed":true,"marketing_agreed":false,"consent_policy_version":"2026-08-03","consent_agreed_at":"2026-08-03T01:00:00.000Z"}}}'::jsonb;
  `);
  if(fence) await db.exec(storageFence);
  if(apply) await db.exec(migration);
  return db;
}
async function persona(db,role='authenticated',id=OWNER) {
  await db.exec('RESET ROLE');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);
  await db.exec(`SET ROLE ${role}`);
}
async function rpc(db,name,args=[],types=[]) {
  const placeholders=args.map((_,i)=>`$${i+1}${types[i]?`::${types[i]}`:''}`).join(',');
  return (await db.query(`select public.${name}(${placeholders}) as result`,args)).rows[0].result;
}
async function create(db,{approve=false,publish=false}={}) {
  await persona(db);
  const result=await rpc(db,'provider_submit_application',[application(),randomUUID()],['jsonb','uuid']);
  if(approve) {
    await persona(db,'authenticated',ADMIN);
    await rpc(db,'provider_review_application',[result.application_id,1,'approve','Synthetic eligibility checked']);
    await persona(db);
  }
  if(publish) await rpc(db,'provider_set_publication',[result.provider_id,2,'published']);
  return result;
}
async function catalog(db,id=null) {return rpc(db,'provider_public_catalog',[id,30],['uuid','int']);}
async function search(db,{category=null,region=null,query=null,after=null,limit=30,recommendation=false,budget=null}={}) {
  return rpc(db,'provider_search_catalog',[category,region,query,after,limit,recommendation,budget],['text','text','text','uuid','int','boolean','bigint']);
}
async function seedLargeCatalog(db) {
  await db.exec('RESET ROLE');
  await db.exec(`
    INSERT INTO public.provider_profiles(id,owner_id,kind,name,categories,regions,contact_name,contact_email,approval_status,publication_status)
    SELECT ('aaaaaaaa-aaaa-4aaa-8aaa-'||lpad(n::text,12,'0'))::uuid,'${OWNER}','individual','Synthetic '||n,
      ARRAY['photography','floral'],ARRAY['서울 강남'],'Synthetic owner','owner@example.invalid','approved','published'
    FROM generate_series(1,137) n;
    INSERT INTO public.provider_applications(id,provider_id,owner_id,kind,name,categories,regions,contact_name,contact_email,request_id,submission_payload,consents,status)
    SELECT ('bbbbbbbb-bbbb-4bbb-8bbb-'||lpad(n::text,12,'0'))::uuid,p.id,p.owner_id,p.kind,p.name,p.categories,p.regions,
      p.contact_name,p.contact_email,gen_random_uuid(),'{}','{}',CASE WHEN n>100 THEN 'pending' ELSE 'approved' END
    FROM generate_series(1,137) n JOIN public.provider_profiles p ON p.id=('aaaaaaaa-aaaa-4aaa-8aaa-'||lpad(n::text,12,'0'))::uuid;
    INSERT INTO public.provider_offerings(provider_id,name,category,base_price_krw,price_unit,extra_charges,conditions,review_status,recommendation_status,reviewed_at)
    SELECT id,'Synthetic photography','photography',300000,'2시간','출장 별도','날짜 협의','approved','eligible',now()
    FROM public.provider_profiles;
    INSERT INTO public.business_inquiries(owner_id,request_id,submission_payload,kind,subject,message,contact_name,contact_email)
    SELECT '${OWNER}',gen_random_uuid(),'{}','other','Synthetic inquiry '||n,'Synthetic only','Synthetic owner','owner@example.invalid'
    FROM generate_series(1,137) n;
  `);
}

test('global catalog filters before paging, survives updates, and never mixes eligibility across offerings',async()=>{
  const db=await fixture();
  try {
    await seedLargeCatalog(db);await persona(db,'anon',null);
    const ids=[];let after=null;
    do {const page=await search(db,{category:'photography',region:'강남',after});ids.push(...page.providers.map(p=>p.id));after=page.next_cursor;}while(after);
    assert.equal(ids.length,137);assert.equal(new Set(ids).size,137);
    const first=await search(db,{query:'Synthetic 137'});assert.equal(first.providers.length,1);assert.equal(first.providers[0].name,'Synthetic 137');
    assert.equal((await search(db,{query:'%'})).providers.length,0);
    await db.exec('RESET ROLE');
    const decoy=ids.at(-1);
    await db.query('update public.provider_offerings set base_price_krw=900000 where provider_id=$1',[decoy]);
    await db.query(`insert into public.provider_offerings(provider_id,name,category,base_price_krw,price_unit,extra_charges,conditions,review_status,recommendation_status,reviewed_at)
      values($1,'Cheap flowers','floral',1000,'회','별도 없음','일정 협의','approved','eligible',now())`,[decoy]);
    await db.query("update public.provider_profiles set updated_at=now()+interval '1 day' where id=$1",[ids[0]]);
    await persona(db,'anon',null);
    const next=await search(db,{after:ids[29]});assert.equal(next.providers[0].id,ids[30]);
    const eligible=[];after=null;
    do {const page=await search(db,{category:'photography',region:'서울강남',budget:400000,recommendation:true,after,limit:5});
      for(const profile of page.providers){eligible.push(profile.id);assert.ok(profile.offerings.every(o=>o.category==='photography'&&o.base_price_krw<=400000&&o.is_active));}after=page.next_cursor;
    }while(after);
    assert.equal(eligible.length,136);assert.equal(eligible.includes(decoy),false);
    assert.deepEqual((await search(db,{region:'서울',recommendation:true})).providers,[]);
    assert.deepEqual((await search(db,{category:'photography',budget:0,recommendation:true})).providers,[]);
    await assert.rejects(search(db,{limit:101}),/PROVIDER_INVALID_INPUT/);
    await assert.rejects(search(db,{category:'unknown'}),/PROVIDER_INVALID_INPUT/);
  }finally{await db.close();}
});
test('admin queues reach older matching applications with their profiles and owner records are never silently truncated',async()=>{
  const db=await fixture();
  try {
    await seedLargeCatalog(db);await persona(db);
    const owned=await rpc(db,'provider_get_workspace');assert.equal(owned.offerings.length,137);assert.equal(owned.business_inquiries.length,137);
    await assert.rejects(rpc(db,'provider_admin_queue',['applications','pending',null,30]),/PROVIDER_FORBIDDEN/);
    await persona(db,'authenticated',OTHER);const outsider=await rpc(db,'provider_get_workspace');assert.equal(outsider.offerings.length,0);assert.equal(outsider.business_inquiries.length,0);
    await persona(db,'authenticated',ADMIN);
    const page=await rpc(db,'provider_admin_queue',['applications','pending',null,30]);
    assert.equal(page.applications.length,30);assert.equal(page.profiles.length,30);assert.ok(page.applications.every(a=>a.status==='pending'&&page.profiles.some(p=>p.id===a.provider_id)));
    assert.deepEqual(page.offerings,[]);assert.deepEqual(page.business_inquiries,[]);
    const last=await rpc(db,'provider_admin_queue',['applications','pending',page.next_cursor,30]);assert.equal(last.applications.length,7);assert.equal(last.next_cursor,null);
    assert.equal(new Set([...page.applications,...last.applications].map(a=>a.id)).size,37);
    await assert.rejects(rpc(db,'provider_admin_queue',['applications','responded',null,30]),/PROVIDER_INVALID_INPUT/);
    await persona(db,'anon',null);await assert.rejects(rpc(db,'provider_admin_queue',['applications',null,null,30]),/permission denied/);
  }finally{await db.close();}
});
test('withdrawal retains history, immediately removes services, and cannot bypass a fresh review',async()=>{
  const db=await fixture();
  try {
    const item=await create(db,{approve:true,publish:true});
    let service=await rpc(db,'provider_save_offering',[item.provider_id,null,null,offering()],['uuid','uuid','int','jsonb']);
    await persona(db,'authenticated',ADMIN);service=await rpc(db,'provider_review_offering',[service.id,1,'approve','eligible','Verified']);
    await persona(db,'authenticated',OTHER);await assert.rejects(rpc(db,'provider_withdraw_offering',[item.provider_id,service.id,2]),/PROVIDER_NOT_FOUND/);
    await persona(db);await assert.rejects(rpc(db,'provider_withdraw_offering',[item.provider_id,service.id,1]),/PROVIDER_VERSION_CONFLICT/);
    service=await rpc(db,'provider_withdraw_offering',[item.provider_id,service.id,2]);assert.equal(service.is_active,false);assert.equal(service.recommendation_status,'blocked');assert.equal(service.reviewed_at,null);
    assert.equal((await catalog(db)).length,1);assert.deepEqual((await catalog(db))[0].offerings,[]);assert.deepEqual((await search(db,{recommendation:true})).providers,[]);
    await persona(db,'authenticated',ADMIN);await assert.rejects(rpc(db,'provider_review_offering',[service.id,3,'approve','eligible','No shortcut']),/PROVIDER_INVALID_STATE/);
    const withdrawn=await rpc(db,'provider_admin_queue',['offerings','withdrawn',null,30]);assert.equal(withdrawn.offerings[0].id,service.id);
    assert.deepEqual((await rpc(db,'provider_admin_queue',['offerings','pending',null,30])).offerings,[]);
    await persona(db);service=await rpc(db,'provider_save_offering',[item.provider_id,service.id,3,offering()],['uuid','uuid','int','jsonb']);
    assert.equal(service.is_active,true);assert.equal(service.review_status,'pending');assert.equal(service.recommendation_status,'needs_review');assert.deepEqual((await catalog(db))[0].offerings,[]);
    await persona(db,'authenticated',ADMIN);await rpc(db,'provider_suspend_profile',[item.provider_id,3,'Synthetic suspension']);
    await persona(db);service=(await rpc(db,'provider_get_workspace')).offerings[0];
    assert.equal((await rpc(db,'provider_withdraw_offering',[item.provider_id,service.id,service.version])).is_active,false);
    assert.equal((await rpc(db,'provider_get_workspace')).offerings.length,1);
  }finally{await db.close();}
});

test('migration requires the separate restrictive storage fence',async()=>{
  const db=await fixture({fence:false,apply:false});
  try {await assert.rejects(db.exec(migration),/PROVIDER_STORAGE_FENCE_REQUIRED/);}
  finally {await db.close();}
});
test('direct RPC rejects user-editable consent and malformed server evidence',async()=>{
  const db=await fixture();
  try {
    const item=await create(db,{approve:true});
    await db.exec('RESET ROLE');
    const original=(await db.query('select raw_app_meta_data from auth.users where id=$1',[OWNER])).rows[0].raw_app_meta_data;
    await db.query('update auth.users set raw_user_meta_data=raw_app_meta_data,raw_app_meta_data=null where id=$1',[OWNER]);
    await persona(db);
    await assert.rejects(rpc(db,'provider_get_workspace'),/PROVIDER_CONSENT_REQUIRED/);
    await assert.rejects(rpc(db,'provider_submit_application',[application(),randomUUID()],['jsonb','uuid']),/PROVIDER_CONSENT_REQUIRED/);
    await persona(db,'service_role',null);
    await assert.rejects(rpc(db,'provider_register_media_upload',[item.provider_id,OWNER,'image/webp',200]),/PROVIDER_CONSENT_REQUIRED/);
    for(const value of [null,'2026-02-30T01:00:00.000Z','2026-08-03T01:00:00Z']) {
      await db.exec('RESET ROLE');
      const malformed=structuredClone(original);malformed.signup_consent.record.consent_agreed_at=value;
      await db.query('update auth.users set raw_app_meta_data=$2 where id=$1',[OWNER,malformed]);
      await persona(db);
      await assert.rejects(rpc(db,'provider_get_workspace'),/PROVIDER_CONSENT_REQUIRED/);
    }
    await db.exec('RESET ROLE');await db.query('update auth.users set raw_app_meta_data=$2 where id=$1',[OWNER,original]);
    await persona(db);assert.equal((await rpc(db,'provider_get_workspace')).profiles.length,1);
  }finally{await db.close();}
});
test('verified submission is idempotent and grants neither publication nor recommendation',async()=>{
  const db=await fixture();
  try {
    await persona(db,'authenticated',UNVERIFIED);
    await assert.rejects(rpc(db,'provider_submit_application',[application(),randomUUID()],['jsonb','uuid']),/PROVIDER_EMAIL_REQUIRED/);
    await persona(db);
    const key=randomUUID(), first=await rpc(db,'provider_submit_application',[application(),key],['jsonb','uuid']);
    assert.deepEqual(await rpc(db,'provider_submit_application',[application(),key],['jsonb','uuid']),first);
    await assert.rejects(rpc(db,'provider_submit_application',[{...application(),name:'Changed'},key],['jsonb','uuid']),/PROVIDER_IDEMPOTENCY_CONFLICT/);
    const workspace=await rpc(db,'provider_get_workspace');
    assert.equal(workspace.profiles.length,1);assert.equal(workspace.applications[0].kind,'team');
    assert.equal(workspace.applications[0].contact_email,'owner@example.invalid');assert.deepEqual(await catalog(db),[]);
    await assert.rejects(rpc(db,'provider_set_publication',[first.provider_id,1,'published']),/PROVIDER_NOT_APPROVED/);
    await assert.rejects(rpc(db,'provider_update_profile',[first.provider_id,1,{introduction:'Text',website:'',instagram:''}],['uuid','int','jsonb']),/PROVIDER_NOT_APPROVED/);
    await assert.rejects(rpc(db,'provider_submit_application',[{...application(),approval_status:'approved'},randomUUID()],['jsonb','uuid']),/PROVIDER_INVALID_INPUT/);
  }finally{await db.close();}
});
test('direct writes, actor spoofing, outsider reads, and private helper calls fail',async()=>{
  const db=await fixture();
  try {
    const item=await create(db);
    await assert.rejects(db.query("update public.provider_profiles set approval_status='approved' where id=$1",[item.provider_id]),/permission denied/);
    await assert.rejects(db.query("insert into public.provider_audit_events(event_type) values('spoof')"),/permission denied/);
    await assert.rejects(rpc(db,'provider_register_media_upload',[item.provider_id,OWNER,'image/webp',20]),/permission denied/);
    await assert.rejects(db.query('select provider_private.require_admin()'),/permission denied/);
    await persona(db,'authenticated',OTHER);
    assert.deepEqual((await db.query('select * from public.provider_profiles')).rows,[]);
    assert.deepEqual((await rpc(db,'provider_get_workspace')).profiles,[]);
    await assert.rejects(rpc(db,'provider_review_application',[item.application_id,1,'approve','Not admin']),/PROVIDER_FORBIDDEN/);
    await assert.rejects(rpc(db,'provider_set_publication',[item.provider_id,1,'published']),/PROVIDER_NOT_FOUND/);
    await persona(db,'anon',null);
    await assert.rejects(rpc(db,'provider_get_workspace'),/permission denied/);
    await assert.rejects(db.query('select * from public.provider_applications'),/permission denied/);
    assert.deepEqual(await catalog(db),[]);
  }finally{await db.close();}
});
test('application and offering accept the full API text boundaries',async()=>{
  const db=await fixture();
  try {
    await persona(db);
    const item=await rpc(db,'provider_submit_application',[{...application(),name:'N'.repeat(120)},randomUUID()],['jsonb','uuid']);
    await assert.rejects(rpc(db,'provider_submit_application',[{...application(),name:'N'.repeat(121)},randomUUID()],['jsonb','uuid']),/PROVIDER_INVALID_INPUT/);
    await persona(db,'authenticated',ADMIN);await rpc(db,'provider_review_application',[item.application_id,1,'approve','']);
    await persona(db);
    const saved=await rpc(db,'provider_save_offering',[item.provider_id,null,null,{...offering(),includes:['I'.repeat(200)]}],['uuid','uuid','int','jsonb']);
    assert.equal(saved.includes[0].length,200);
    await assert.rejects(rpc(db,'provider_save_offering',[item.provider_id,null,null,{...offering(),includes:['I'.repeat(201)]}],['uuid','uuid','int','jsonb']),/PROVIDER_INVALID_INPUT/);
  }finally{await db.close();}
});
test('approval grants immediate editing but only explicit publication exposes the safe catalog',async()=>{
  const db=await fixture();
  try {
    const item=await create(db,{approve:true});assert.deepEqual(await catalog(db),[]);
    const updated=await rpc(db,'provider_update_profile',[item.provider_id,2,{introduction:'A new introduction',website:'https://example.invalid',instagram:''}],['uuid','int','jsonb']);
    assert.equal(updated.version,3);
    await assert.rejects(rpc(db,'provider_update_profile',[item.provider_id,2,{introduction:'Stale',website:'',instagram:''}],['uuid','int','jsonb']),/PROVIDER_VERSION_CONFLICT/);
    await rpc(db,'provider_set_publication',[item.provider_id,3,'published']);await persona(db,'anon',null);
    const list=await catalog(db);assert.equal(list.length,1);assert.equal(list[0].introduction,'A new introduction');
    for(const key of ['owner_id','contact_email','contact_name','review_reason','application_note','consents','approval_status'])assert.equal(key in list[0],false,key);
    assert.deepEqual(list[0].offerings,[]);await persona(db);
    await rpc(db,'provider_update_profile',[item.provider_id,4,{introduction:'Immediately changed',website:'',instagram:''}],['uuid','int','jsonb']);
    assert.equal((await catalog(db))[0].introduction,'Immediately changed');
  }finally{await db.close();}
});
test('resubmission versions and live administrator revocation are enforced',async()=>{
  const db=await fixture();
  try {
    const item=await create(db);await persona(db,'authenticated',ADMIN);
    await rpc(db,'provider_review_application',[item.application_id,1,'request_changes','Clarify responsibility']);await persona(db);
    const resubmitted=await rpc(db,'provider_resubmit_application',[item.application_id,2,{...application(),name:'Revised name'}],['uuid','int','jsonb']);
    assert.equal(resubmitted.version,3);assert.equal(resubmitted.name,'Revised name');await persona(db,'authenticated',ADMIN);
    await assert.rejects(rpc(db,'provider_review_application',[item.application_id,1,'approve','Stale']),/PROVIDER_VERSION_CONFLICT/);
    await db.exec('RESET ROLE');await db.query('update public.profiles set is_admin=false where id=$1',[ADMIN]);await persona(db,'authenticated',ADMIN);
    await assert.rejects(rpc(db,'provider_review_application',[item.application_id,3,'approve','Revoked']),/PROVIDER_FORBIDDEN/);
  }finally{await db.close();}
});
test('editing service terms revokes service eligibility while the approved profile remains public',async()=>{
  const db=await fixture();
  try {
    const item=await create(db,{approve:true,publish:true});
    let service=await rpc(db,'provider_save_offering',[item.provider_id,null,null,offering()],['uuid','uuid','int','jsonb']);
    assert.equal(service.recommendation_status,'unreviewed');assert.deepEqual((await catalog(db))[0].offerings,[]);
    await persona(db,'authenticated',ADMIN);
    service=await rpc(db,'provider_review_offering',[service.id,1,'approve','eligible','Terms and price checked']);
    assert.equal((await catalog(db))[0].offerings[0].recommendation_status,'eligible');await persona(db);
    service=await rpc(db,'provider_save_offering',[item.provider_id,service.id,2,{...offering(),base_price_krw:400000}],['uuid','uuid','int','jsonb']);
    assert.equal(service.review_status,'pending');assert.equal(service.recommendation_status,'needs_review');
    assert.equal((await catalog(db)).length,1);assert.deepEqual((await catalog(db))[0].offerings,[]);
  }finally{await db.close();}
});
test('media finalization checks stored bytes/current approval and abort cannot remove completed media',async()=>{
  const db=await fixture();
  try {
    const item=await create(db,{approve:true,publish:true});await persona(db,'service_role',null);
    const media=await rpc(db,'provider_register_media_upload',[item.provider_id,OWNER,'image/webp',200]);
    assert.ok(media.storage_path.startsWith(`${OWNER}/${item.provider_id}/`));await persona(db);
    assert.deepEqual((await rpc(db,'provider_get_workspace')).media,[]);
    await persona(db,'authenticated',ADMIN);assert.deepEqual((await rpc(db,'provider_admin_workspace')).media,[]);await persona(db);
    await assert.rejects(rpc(db,'provider_finalize_media',[media.id,'','',true]),/PROVIDER_MEDIA_NOT_UPLOADED/);
    await persona(db,'service_role',null);await db.query("insert into storage.objects(bucket_id,name) values('provider-portfolio',$1)",[media.storage_path]);await persona(db);
    assert.equal((await rpc(db,'provider_finalize_media',[media.id,'Synthetic photo','Two people',true])).status,'ready');
    assert.equal((await rpc(db,'provider_get_workspace')).media.length,1);
    const publicMedia=(await catalog(db))[0].media[0];assert.equal(publicMedia.provider_id,item.provider_id);assert.equal('storage_path' in publicMedia,false);
    await persona(db,'service_role',null);assert.deepEqual(await rpc(db,'provider_abort_media_upload',[media.id,OWNER]),{aborted:false,storage_path:null});
    await persona(db,'authenticated',OTHER);await assert.rejects(rpc(db,'provider_remove_media',[media.id]),/PROVIDER_NOT_FOUND/);
    await persona(db,'authenticated',ADMIN);await rpc(db,'provider_suspend_profile',[item.provider_id,3,'Suspended']);assert.deepEqual(await catalog(db),[]);
    await persona(db);await assert.rejects(rpc(db,'provider_finalize_media',[media.id,'New','',true]),/PROVIDER_NOT_APPROVED/);
    assert.equal((await rpc(db,'provider_remove_media',[media.id])).storage_path,media.storage_path);
    await persona(db,'authenticated',ADMIN);await rpc(db,'provider_restore_profile',[item.provider_id,4,'Rechecked']);assert.deepEqual(await catalog(db),[]);
  }finally{await db.close();}
});
test('twelve reservations include pending uploads; abort and expiration release slots without publication',async()=>{
  const db=await fixture();
  try {
    const item=await create(db,{approve:true});await persona(db,'service_role',null);const media=[];
    for(let i=0;i<12;i++)media.push(await rpc(db,'provider_register_media_upload',[item.provider_id,OWNER,'image/webp',200]));
    await assert.rejects(rpc(db,'provider_register_media_upload',[item.provider_id,OWNER,'image/webp',200]),/PROVIDER_MEDIA_LIMIT/);
    assert.equal((await rpc(db,'provider_abort_media_upload',[media[0].id,OWNER])).aborted,true);
    await rpc(db,'provider_register_media_upload',[item.provider_id,OWNER,'image/webp',200]);await db.exec('RESET ROLE');
    await db.query("update public.provider_media set created_at=now()-interval '31 minutes' where id=$1",[media[1].id]);await persona(db,'service_role',null);
    await rpc(db,'provider_register_media_upload',[item.provider_id,OWNER,'image/webp',200]);await persona(db);
    await assert.rejects(rpc(db,'provider_finalize_media',[media[1].id,'','',true]),/PROVIDER_INVALID_STATE/);
  }finally{await db.close();}
});
test('private storage fence denies clients even beside an unrelated permissive policy',async()=>{
  const db=await fixture();
  try {
    await db.exec('CREATE POLICY synthetic_broad_allow ON storage.objects FOR ALL TO anon,authenticated USING(true) WITH CHECK(true)');
    await db.query("insert into storage.objects(bucket_id,name) values('provider-portfolio','synthetic.webp')");
    for(const role of ['anon','authenticated']) {
      await persona(db,role,role==='authenticated'?OWNER:null);
      assert.deepEqual((await db.query("select * from storage.objects where bucket_id='provider-portfolio'")).rows,[]);
      await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('provider-portfolio','bad.webp')"),/row-level security/);
      assert.equal((await db.query("delete from storage.objects where bucket_id='provider-portfolio' returning id")).rows.length,0);
    }
  }finally{await db.close();}
});
test('private business replies are versioned and auth deletion removes owned data without legacy writes',async()=>{
  const db=await fixture();
  try {
    await create(db,{approve:true,publish:true});
    const input={kind:'collaboration',subject:'Synthetic inquiry',message:'Synthetic private message',contact_name:'Owner',privacy_consent:true};
    const b=await rpc(db,'provider_submit_business_inquiry',[input,randomUUID()],['jsonb','uuid']);await persona(db,'authenticated',OTHER);
    assert.deepEqual((await db.query('select * from public.business_inquiries')).rows,[]);await persona(db,'authenticated',ADMIN);
    assert.equal((await rpc(db,'provider_review_business_inquiry',[b.id,1,'responded','Reply in the portal'])).version,2);
    await assert.rejects(rpc(db,'provider_review_business_inquiry',[b.id,1,'closed','']),/PROVIDER_VERSION_CONFLICT/);
    await db.exec('RESET ROLE');await db.query('delete from auth.users where id=$1',[OWNER]);
    for(const table of ['provider_profiles','provider_applications','business_inquiries'])assert.equal((await db.query(`select count(*)::int n from public.${table}`)).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from public.provider_audit_events')).rows[0].n,0);
    assert.equal(/(?:INSERT INTO|UPDATE|ALTER TABLE) (?:public\.)?vendors\b/i.test(migration),false);
  }finally{await db.close();}
});
test('deletion intake hides public content and blocks late publication and upload finalization',async()=>{
  const db=await fixture();
  try {
    const item=await create(db,{approve:true,publish:true});await persona(db,'service_role',null);
    const media=await rpc(db,'provider_register_media_upload',[item.provider_id,OWNER,'image/webp',200]);
    await db.query("insert into storage.objects(bucket_id,name) values('provider-portfolio',$1)",[media.storage_path]);
    await db.exec('RESET ROLE');await db.query("insert into public.account_deletion_jobs(user_id,status) values($1,'pending')",[OWNER]);
    await persona(db);assert.deepEqual(await catalog(db),[]);
    await assert.rejects(rpc(db,'provider_get_workspace'),/PROVIDER_ACCOUNT_DELETION_PENDING/);
    await assert.rejects(rpc(db,'provider_finalize_media',[media.id,'','',true]),/PROVIDER_ACCOUNT_DELETION_PENDING/);
    await assert.rejects(rpc(db,'provider_set_publication',[item.provider_id,3,'published']),/PROVIDER_ACCOUNT_DELETION_PENDING/);
    await persona(db,'service_role',null);
    await assert.rejects(rpc(db,'provider_register_media_upload',[item.provider_id,OWNER,'image/webp',200]),/PROVIDER_ACCOUNT_DELETION_PENDING/);
    assert.equal((await rpc(db,'provider_abort_media_upload',[media.id,OWNER])).aborted,true);
  }finally{await db.close();}
});
