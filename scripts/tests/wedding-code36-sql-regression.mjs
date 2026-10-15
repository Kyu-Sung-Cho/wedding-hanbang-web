import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, isAbsolute, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

// In-memory SQL execution only: this runner never reads .env or opens a network connection.
const root = resolve(import.meta.dirname, '../..');
const arg = (name, fallback) => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const migrationFile = resolve(root, arg('migration', 'supabase/migrations/20261015070000_wedding_code36_private_pairing.sql'));
const reportFile = arg('report', null);
const fixtureFile = arg('catalog-fixture', null);
const pairingOnly = process.argv.includes('--pairing-only');
const modulePath = process.env.WC36_PGLITE_MODULE ?? '@electric-sql/pglite';
const { PGlite } = await import(isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
const migration = readFileSync(migrationFile, 'utf8');
const bank = JSON.parse(readFileSync(resolve(root, 'docs/wedding-code/results36-2026-10-15/bank.json'), 'utf8'));
const report = { scope: 'isolated in-memory PGlite actual SQL; no production connection', productionConnections: 0,
  migrationFile, migrationSha256: createHash('sha256').update(migration).digest('hex'),
  assertions: 0, groups: [], failures: [], limitations: ['One PGlite session cannot prove multi-session PostgreSQL blocking, races, lock timeouts or throughput.'] };
const db = new PGlite();
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
await db.exec(migration);
report.postgresVersion = (await db.query('SELECT version() AS version')).rows[0].version;
const eq = (actual, expected, label) => { report.assertions++; assert.deepEqual(actual, expected, label); };
const ok = (actual, label) => { report.assertions++; assert.ok(actual, label); };
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const rpc = async (name, args) => (await query(`SELECT public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) AS value`, args))[0].value;
const submission = (value = 3) => ({ questionnaire_version: bank.version,
  questionnaire_fingerprint: '982e2623c147bd7bbeefd2f7e1a6fb7ec27cbbd28e60bb62a0c002c148735f16',
  answers: Object.fromEntries(bank.items.map(item => [item.id, value])), missing_reasons: {},
  allow_couple_comparison: true, share_alias: true, share_item_ids: bank.items.filter(x => x.criterion).map(x=>x.id) });
async function create(value = 3, hash = createHash('sha256').update(randomUUID()).digest('hex')) {
  const submissionId = randomUUID();
  const input = submission(value);
  const saved = await rpc('wc36_submit', [submissionId, hash, JSON.stringify(input)]);
  return { id: saved.response_id, hash, submissionId, input, saved };
}
const pair = (person, token = null) => rpc('wc36_pair', [person.id, person.hash, token]);
const read = person => rpc('wc36_read_report', [person.id, person.hash]);
const status = token => rpc('wc36_invite_status', [token]);
const remove = person => rpc('wc36_delete', [person.id, person.hash]);
async function members(person) {
  return Number((await query('SELECT count(*) AS n FROM public.wedding_code36_pairs WHERE owner_response_id=$1 OR partner_response_id=$1',[person.id]))[0].n);
}
async function expire(person) {
  await query("UPDATE public.wedding_code36_responses SET created_at=now()-interval '8 days', expires_at=now()-interval '1 day' WHERE id=$1",[person.id]);
}
async function group(name, run) {
  await db.exec('TRUNCATE public.wedding_code36_responses CASCADE;');
  try { await run(); report.groups.push({name,status:'pass'}); }
  catch (error) { report.groups.push({name,status:'fail'}); report.failures.push({name,error:error.message}); }
}

await group('fresh individual, waiting invite and private report', async () => {
  const a = await create(); eq(a.saved.pairing_status,'unpaired');
  const invite = await pair(a); eq(invite.pairing_status,'waiting');
  eq((await read(a)).status,'waiting'); eq((await status(invite.invite_token)).status,'waiting');
  eq(await members(a),1);
});
await group('two existing waiting invites can join without losing either private answer', async () => {
  const a=await create(1),b=await create(5); const ia=await pair(a),ib=await pair(b);
  const joined=await pair(b,ia.invite_token); eq(joined.pairing_status,'paired'); eq(joined.invite_token,ia.invite_token);
  eq((await status(ib.invite_token)).status,'not_found');
  eq((await read(a)).partner_submission.answers,b.input.answers); eq((await read(b)).partner_submission.answers,a.input.answers);
  eq(await members(a),1); eq(await members(b),1);
  eq(await pair(b,ib.invite_token),joined,'retry of old invitation recovers established pair');
  eq(await pair(a,null),joined,'original owner sees same established pair');
});
await group('unknown target preserves the old empty invite', async () => {
  const b=await create(); const old=await pair(b);
  eq(await pair(b,randomUUID()),{error:'invite_not_found'}); eq(await pair(b),old);
  eq((await status(old.invite_token)).status,'waiting'); eq(await members(b),1);
});
await group('full target preserves the old empty invite', async () => {
  const a=await create(),b=await create(),c=await create(); const ia=await pair(a),ib=await pair(b);
  await pair(c,ia.invite_token); eq(await pair(b,ia.invite_token),{pairing_status:'full',invite_token:null});
  eq(await pair(b),ib); eq((await read(a)).status,'ready'); eq(await members(b),1);
});
await group('same owner secret cannot join a second personal result, empty invite survives', async () => {
  const a=await create(),b=await create(4,a.hash); const ia=await pair(a),ib=await pair(b);
  eq(await pair(b,ia.invite_token),{error:'self_pair'}); eq(await pair(b),ib); eq(await pair(a),ia);
});
await group('wrong owner key never changes a pair', async () => {
  const a=await create(),b=await create(); const ia=await pair(a),ib=await pair(b);
  eq(await rpc('wc36_pair',[b.id,'f'.repeat(64),ia.invite_token]),{error:'unauthorized'});
  eq(await pair(a),ia); eq(await pair(b),ib);
});
await group('established pair is immutable across other, unknown and self invite attempts', async () => {
  const a=await create(),b=await create(),c=await create(); const ia=await pair(a); await pair(b,ia.invite_token); const ic=await pair(c);
  for (const token of [ic.invite_token,randomUUID(),ia.invite_token,null]) {
    eq(await pair(a,token),{pairing_status:'paired',invite_token:ia.invite_token});
    eq(await pair(b,token),{pairing_status:'paired',invite_token:ia.invite_token});
  }
  eq(await members(a),1); eq(await members(b),1); eq((await status(ic.invite_token)).status,'waiting');
});
await group('retry submit can join from an existing empty invite and keeps saved answers', async () => {
  const a=await create(),b=await create(2); const ia=await pair(a),ib=await pair(b);
  const retry=await rpc('wc36_submit',[b.submissionId,b.hash,JSON.stringify(submission(5)),ia.invite_token]);
  eq(retry.response_id,b.id); eq(retry.recovered,true); eq(retry.pairing_status,'paired');
  eq(retry.submission.answers,b.input.answers); eq((await status(ib.invite_token)).status,'not_found');
});
await group('SQL failure rolls back empty invite removal and attempted join atomically', async () => {
  const a=await create(),b=await create(); const ia=await pair(a),ib=await pair(b);
  await db.exec("CREATE FUNCTION public.wc36_test_reject_pair() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test_injected_update_failure'; END $$; CREATE TRIGGER wc36_test_reject_pair BEFORE UPDATE ON public.wedding_code36_pairs FOR EACH ROW EXECUTE FUNCTION public.wc36_test_reject_pair();");
  try { let rejected=false; try { await pair(b,ia.invite_token); } catch { rejected=true; } ok(rejected); }
  finally { await db.exec('DROP TRIGGER wc36_test_reject_pair ON public.wedding_code36_pairs; DROP FUNCTION public.wc36_test_reject_pair();'); }
  eq(await pair(a),ia); eq(await pair(b),ib); eq(await members(a),1); eq(await members(b),1);
});
await group('many interleaved sequential pair orders preserve one pair membership', async () => {
  for (let i=0;i<30;i++) {
    const a=await create(i%5+1),b=await create((i+1)%5+1),c=await create();
    const ia=await pair(a),ib=await pair(b); const first=i%2 ? a:b, target=i%2 ? ib:ia;
    const established=await pair(first,target.invite_token); eq(established.pairing_status,'paired');
    eq((await pair(c,target.invite_token)).pairing_status,'full');
    eq(await members(a),1); eq(await members(b),1); eq(await members(c),0);
    eq((await read(a)).status,'ready'); eq((await read(b)).status,'ready');
  }
});

if (!pairingOnly) {
  await group('server controls exact seven day lifetime and sharing cannot extend it', async () => {
    const a=await create(); ok(Number.isFinite(Date.parse(a.saved.expires_at)));
    const row=(await query("SELECT extract(epoch from(expires_at-created_at))::integer AS seconds FROM public.wedding_code36_responses WHERE id=$1",[a.id]))[0];
    eq(row.seconds,7*24*3600);
    const updated=await rpc('wc36_update_sharing',[a.id,a.hash,JSON.stringify({allow_couple_comparison:false,share_alias:false,share_item_ids:[]})]);
    eq(updated.expires_at,a.saved.expires_at); eq(updated.submission.allow_couple_comparison,false);
  });
  await group('delete immediately removes own payload and pair but preserves partner payload', async () => {
    const a=await create(2),b=await create(4); const ia=await pair(a); await pair(b,ia.invite_token);
    eq(await remove(a),{deleted:true}); eq(await remove(a),{deleted:true});
    eq((await read(a)).error,'deleted'); eq((await read(b)).status,'unpaired');
    eq((await status(ia.invite_token)).status,'not_found');
    const own=(await query('SELECT submission,deleted_at,expires_at FROM public.wedding_code36_responses WHERE id=$1',[a.id]))[0];
    eq(own.submission,null); ok(own.deleted_at); eq(new Date(own.expires_at).toISOString(),new Date(a.saved.expires_at).toISOString());
    eq((await query('SELECT submission FROM public.wedding_code36_responses WHERE id=$1',[b.id]))[0].submission.answers,b.input.answers);
    eq(await rpc('wc36_delete',[b.id,'f'.repeat(64)]),{error:'unauthorized'});
  });
  await group('deleting the partner also disconnects without erasing the inviting owner', async () => {
    const a=await create(1),b=await create(5); const ia=await pair(a); await pair(b,ia.invite_token);
    eq(await remove(b),{deleted:true}); eq((await read(a)).status,'unpaired');
    eq((await query('SELECT submission FROM public.wedding_code36_responses WHERE id=$1',[a.id]))[0].submission.answers,a.input.answers);
    eq((await status(ia.invite_token)).status,'not_found');
  });
  await group('deleted tombstone blocks delayed submit, pairing, report and sharing retries', async () => {
    const a=await create(); await remove(a);
    eq(await rpc('wc36_submit',[a.submissionId,a.hash,JSON.stringify(submission(5))]),{error:'deleted'});
    eq(await pair(a),{error:'deleted'}); eq(await read(a),{error:'deleted'});
    eq(await rpc('wc36_update_sharing',[a.id,a.hash,JSON.stringify({allow_couple_comparison:true,share_alias:true,share_item_ids:[]})]),{error:'deleted'});
    eq((await query('SELECT submission FROM public.wedding_code36_responses WHERE id=$1',[a.id]))[0].submission,null);
    eq(await rpc('wc36_submit',[a.submissionId,'f'.repeat(64),JSON.stringify(submission(4))]),{error:'unauthorized'});
  });
  await group('expiry cuts all access before purge and does not silently renew a result', async () => {
    const a=await create(),b=await create(); const ia=await pair(a); await pair(b,ia.invite_token); await expire(a);
    eq(await pair(a),{error:'expired'}); eq(await read(a),{error:'expired'}); eq(await read(b),{error:'expired'});
    eq((await status(ia.invite_token)).status,'not_found');
    eq(await rpc('wc36_submit',[a.submissionId,a.hash,JSON.stringify(submission(4))]),{error:'expired'});
    eq(await rpc('wc36_update_sharing',[a.id,a.hash,JSON.stringify({allow_couple_comparison:true,share_alias:true,share_item_ids:[]})]),{error:'expired'});
    eq(await remove(a),{error:'expired'});
  });
  await group('expired target never destroys an unrelated valid waiting invite', async () => {
    const a=await create(),b=await create(); const ia=await pair(a),ib=await pair(b); await expire(a);
    eq(await pair(b,ia.invite_token),{error:'expired'}); eq(await pair(b),ib);
  });
  await group('expired invite does not lose a newly saved personal result or poison retries', async () => {
    const a=await create(); const ia=await pair(a); await expire(a);
    const submissionId=randomUUID(),hash='c'.repeat(64);
    const saved=await rpc('wc36_submit',[submissionId,hash,JSON.stringify(submission(4)),ia.invite_token]);
    ok(saved.response_id); eq(saved.error,undefined); eq(saved.pairing_status,'unpaired'); eq(saved.pairing_error,'invite_expired');
    const retry=await rpc('wc36_submit',[submissionId,hash,JSON.stringify(submission(5)),ia.invite_token]);
    eq(retry.response_id,saved.response_id); eq(retry.recovered,true); eq(retry.submission.answers,saved.submission.answers);
  });
  await group('purge removes expired results and tombstones, preserves all live private results', async () => {
    const a=await create(),b=await create(),c=await create(); const ia=await pair(a); await pair(b,ia.invite_token);
    await remove(c); await expire(b); await expire(c);
    eq(await rpc('wc36_purge_expired',[]),{deleted_count:2}); eq(await rpc('wc36_purge_expired',[]),{deleted_count:0});
    eq((await read(a)).status,'unpaired'); eq(Number((await query('SELECT count(*) AS n FROM public.wedding_code36_responses'))[0].n),1);
    eq((await query('SELECT submission FROM public.wedding_code36_responses WHERE id=$1',[a.id]))[0].submission.answers,a.input.answers);
  });
  await group('all seven RPCs deny public, anonymous and authenticated execution', async () => {
    const rows=await query("SELECT p.proname,has_function_privilege('anon',p.oid,'execute') AS anon,has_function_privilege('authenticated',p.oid,'execute') AS authenticated,has_function_privilege('service_role',p.oid,'execute') AS service,EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) x WHERE x.grantee=0 AND x.privilege_type='EXECUTE') AS public_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('wc36_submit','wc36_pair','wc36_read_report','wc36_invite_status','wc36_update_sharing','wc36_delete','wc36_purge_expired')");
    eq(rows.length,7); for (const row of rows) { eq(row.anon,false,row.proname); eq(row.authenticated,false,row.proname); eq(row.public_execute,false,row.proname); eq(row.service,true,row.proname); }
    const tables=await query("SELECT c.relrowsecurity AS rls,has_table_privilege('anon',c.oid,'select,insert,update,delete') AS anon,has_table_privilege('authenticated',c.oid,'select,insert,update,delete') AS authenticated,has_table_privilege('service_role',c.oid,'select,insert,update,delete') AS service FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('wedding_code36_responses','wedding_code36_pairs')");
    eq(tables.length,2); for (const table of tables) { eq(table.rls,true); eq(table.anon,false); eq(table.authenticated,false); eq(table.service,false); }
  });
  await group('missing required questionnaire metadata fails the table check', async () => {
    let rejected=false; try { await query('INSERT INTO public.wedding_code36_responses(submission_id,access_hash,submission) VALUES($1,$2,$3)',[randomUUID(),'a'.repeat(64),'{}']); } catch { rejected=true; }
    ok(rejected);
  });
}

report.status=report.failures.length ? 'fail' : 'pass';
report.completedAt=new Date().toISOString();
if (fixtureFile && !report.failures.length) {
  const { targetCatalogSql } = await import('../wedding-code36-release-catalog.mjs');
  const catalog=(await query(`SELECT ${targetCatalogSql()} AS catalog`))[0].catalog;
  const path=resolve(root,fixtureFile); mkdirSync(dirname(path),{recursive:true});
  writeFileSync(path,JSON.stringify({format:'wedding-code36-catalog-fixture-v1',generatedWith:{runtime:'PGlite',postgres:report.postgresVersion,productionEquivalent:false},migrationSha256:report.migrationSha256,catalog},null,2)+'\n');
}
if (reportFile) { const path=resolve(root,reportFile); mkdirSync(dirname(path),{recursive:true}); writeFileSync(path,JSON.stringify(report,null,2)+'\n'); }
console.log(JSON.stringify({status:report.status,groups:report.groups.length,assertions:report.assertions,failures:report.failures,migrationSha256:report.migrationSha256,productionConnections:0},null,2));
await db.close();
process.exitCode=report.failures.length ? 1 : 0;
