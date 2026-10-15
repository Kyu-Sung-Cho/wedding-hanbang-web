import { readFileSync, writeFileSync, mkdirSync, chmodSync, realpathSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';

// Explicitly invoked smoke test. No admin credentials, .env files, direct DB writes,
// forwarded-IP headers or rate-limit bypasses are used. Only normal public APIs.
const root=resolve(import.meta.dirname,'..');
const option=(name,fallback)=>process.argv.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const base=new URL(option('base','https://hanbang.ai'));
if (base.pathname!=='/' || base.search || base.hash || base.username || base.password ||
  !(base.protocol==='https:' || (base.protocol==='http:' && ['127.0.0.1','localhost'].includes(base.hostname)))) throw new Error('invalid_base');
const privateRoot=resolve(homedir(),'.codex/tmp/wc36-prod');
const runTag=new Date().toISOString().replace(/[^0-9]/g,'').slice(0,17)+'-'+randomBytes(4).toString('hex');
const privateDir=resolve(privateRoot,runTag);
const reportPath=resolve(root,option('report','docs/wedding-code/app36-production-2026-10-15/live-api-qa.json'));
const cleanupInput=option('cleanup-receipt',null);
const dryRun=process.argv.includes('--dry-run');
const bank=JSON.parse(readFileSync(resolve(root,'docs/wedding-code/results36-2026-10-15/bank.json'),'utf8'));
const fingerprint='982e2623c147bd7bbeefd2f7e1a6fb7ec27cbbd28e60bb62a0c002c148735f16';
const ids=bank.items.map(x=>x.id), coreIds=bank.criteria.flatMap(x=>x.item_ids);
const knownIds=new Set(ids), coreSet=new Set(coreIds);
const report={scope:'public API synthetic smoke; no browser automation or human validity claim',base:base.origin,
  targetKind:['127.0.0.1','localhost'].includes(base.hostname)?'local':'remote',
  startedAt:new Date().toISOString(),mode:cleanupInput?'cleanup_only':dryRun?'dry_run':'live',
  tests:[],failures:[],requestCounts:{},createdSyntheticResponses:0,cleanup:[],
  rawAnswersRecorded:false,privateCredentialsRecorded:false,spoofedHeaders:false,rateLimitBypass:false,
  limitations:['Browser rendering is tested separately.','Seven-day expiry is checked from server-issued timestamps; this live run does not advance the production clock.','Deletion removes payload and links immediately; minimal retry tombstones remain until the original expiry.']};
let receipt={format:'wedding-code36-private-live-qa-v1',base:base.origin,startedAt:report.startedAt,records:[]};
let receiptPath=null;
let assertions=0;
class QaFailure extends Error { constructor(code){super(code);this.code=code;} }
const ensure=(condition,code)=>{assertions++;if(!condition)throw new QaFailure(code);};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b,code)=>ensure(JSON.stringify(canonical(a))===JSON.stringify(canonical(b)),code);
function saveReceipt(){if(receiptPath)writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});}
function initReceipt(){
  mkdirSync(privateDir,{recursive:true,mode:0o700});
  const actual=realpathSync(privateDir),delta=relative(realpathSync(privateRoot),actual);
  ensure(delta && !isAbsolute(delta) && !delta.startsWith('..'),'private_receipt_path');
  receiptPath=resolve(privateDir,'credentials.json');
  writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
}
function saveReport(){
  report.assertions=assertions;report.completedAt=new Date().toISOString();
  report.status=report.failures.length||report.cleanup.some(x=>x.status!=='deleted')?'fail':dryRun?'not_run':'pass';
  mkdirSync(dirname(reportPath),{recursive:true});writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
}
async function check(name,fn){
  try {await fn();report.tests.push({name,status:'pass'});console.log(`PASS ${name}`);}
  catch(error){const code=error instanceof QaFailure?error.code:'request_failed';report.tests.push({name,status:'fail',code});report.failures.push({name,code});throw new QaFailure(code);}
}
async function request(operation,method,path,body,token,onPayload){
  const headers={};if(body!==undefined)headers['Content-Type']='application/json';
  // Exercise the site's same-origin JSON flow; Origin is never an owner credential
  // or an exception to the production CSRF gate. The gate remains unchanged.
  if(!['GET','HEAD','OPTIONS'].includes(method.toUpperCase()))headers.Origin=base.origin;
  if(token)headers['x-wedding-code-access-token']=token;
  let response,payload;
  try {response=await fetch(new URL(path,base),{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30_000)});payload=await response.json();}
  catch {throw new QaFailure('http_transport_or_json');}
  if(onPayload)onPayload(response.status,payload);
  const key=`${operation}:${response.status}`;report.requestCounts[key]=(report.requestCounts[key]??0)+1;
  ensure(response.status!==429,'normal_rate_limit_reached');
  ensure(!(response.status===403&&payload?.error==='untrusted_mutation_origin'),'untrusted_mutation_origin');
  const cache=response.headers.get('cache-control')?.toLowerCase()??'';
  ensure(cache.includes('private')&&cache.includes('no-store'),'private_no_store');
  ensure((response.headers.get('vary')??'').toLowerCase().includes('x-wedding-code-access-token'),'private_vary');
  return {status:response.status,body:payload,date:response.headers.get('date')};
}
const credentials=person=>({response_id:person.id,access_token:person.accessToken});
const pair=(person,token=null)=>request('pair','POST','/api/wedding-code/v36/pair',{...credentials(person),...(token?{invite_token:token}:{})});
const invite=token=>request('invite','GET',`/api/wedding-code/v36/invite?token=${encodeURIComponent(token)}`);
const read=person=>request('report','GET',`/api/wedding-code/v36/couple-report?response_id=${encodeURIComponent(person.id)}`,undefined,person.accessToken);
const share=(person,settings)=>request('sharing','PATCH','/api/wedding-code/v36/response',{...credentials(person),...settings});
const deletion=person=>request('delete','DELETE','/api/wedding-code/v36/response',credentials(person));
const settings=(alias=true,allow=true,shared=coreIds)=>({allow_couple_comparison:allow,share_alias:alias,share_item_ids:shared});
function makeSubmission(values){
  return {questionnaire_version:bank.version,questionnaire_fingerprint:fingerprint,
    answers:Object.fromEntries(ids.map(id=>[id,typeof values==='number'?values:values[id]??null])),missing_reasons:{},...settings()};
}
async function submit(label,input,accessToken=randomUUID()){
  const person={label,submissionId:randomUUID(),accessToken,id:null,expiresAt:null,input,deleted:false};
  receipt.records.push(person);saveReceipt();
  const result=await request('submit','POST','/api/wedding-code/v36/response',{
    ...input,submission_id:person.submissionId,access_token:accessToken,consent:true,expires_at:'2100-01-01T00:00:00.000Z'},undefined,(status,body)=>{
    // Preserve cleanup capability even if a later privacy/header assertion fails.
    if(status===200&&typeof body?.id==='string'&&/^[0-9a-f-]{36}$/i.test(body.id)){
      person.id=body.id;person.expiresAt=body.expiresAt??null;saveReceipt();
    }
  });
  ensure(result.status===200 && result.body.success===true,'submit_success');
  ensure(typeof result.body.id==='string' && /^[0-9a-f-]{36}$/i.test(result.body.id),'submit_result_id');
  person.id=result.body.id;person.expiresAt=result.body.expiresAt;saveReceipt();
  report.createdSyntheticResponses++;
  same(result.body.submission,input,'canonical_submission_preserved');
  ensure(result.body.pairingStatus==='unpaired','initially_unpaired');
  const lifetime=Date.parse(person.expiresAt)-Date.parse(result.date??new Date().toISOString());
  ensure(Number.isFinite(lifetime)&&Math.abs(lifetime-7*24*3600_000)<5*60_000,'server_seven_day_expiry');
  return person;
}
function containsPrivateRawKeys(value){
  if(!value||typeof value!=='object')return false;
  return Object.entries(value).some(([key,child])=>['answers','submission','own_submission','partner_submission','access_token','access_hash','missing_reasons'].includes(key)||containsPrivateRawKeys(child));
}
function verifyReport(payload,a,b,shared=coreIds,names=true){
  ensure(payload.status==='ready'&&payload.viewer==='a','comparison_ready');
  const value=payload.report;ensure(value&&typeof value.summary==='string'&&value.summary.length>0,'comparison_summary');
  ensure(!containsPrivateRawKeys(value),'no_raw_private_payload');
  ensure(value.body.compatibility_score===null&&value.body.joint_decision_confirmed===false,'no_compatibility_or_joint_decision');
  same([...value.body.shared_item_ids].sort(),[...shared].sort(),'mutual_shared_ids');
  ensure(names?!!value.names:value.names===null,'name_sharing_permission');
  if(names)ensure(value.display_order[0]==='names','names_first');
  const evidence=value.body.core_cards.flatMap(card=>card.evidence);
  same(evidence.map(item=>item.item_id).sort(),shared.filter(id=>coreSet.has(id)).sort(),'complete_evidence_scope');
  for(const item of evidence){
    ensure(knownIds.has(item.item_id),'known_evidence_id');
    const va=a.input.answers[item.item_id],vb=b.input.answers[item.item_id];
    ensure(item.a===va&&item.b===vb,'actual_evidence_values');
    ensure(item.gap===(va===null||vb===null?null:Math.abs(va-vb)),'actual_gap');
    ensure(item.discussion_candidate===(va!==null&&vb!==null&&Math.abs(va-vb)>=2),'discussion_threshold');
  }
  same(value.body.single_note_cards.map(item=>item.id).sort(),shared.filter(id=>!coreSet.has(id)).sort(),'single_notes_permission');
  return value;
}
async function cleanup(){
  for(const person of receipt.records){
    if(!person.id){report.cleanup.push({label:person.label,status:'unresolved_attempt_without_result_id'});continue;}
    try {
      const result=await deletion(person);
      const deleted=result.status===200&&result.body.deleted===true;
      person.deleted=deleted;report.cleanup.push({label:person.label,status:deleted?'deleted':'failed',httpStatus:result.status});saveReceipt();
    } catch {report.cleanup.push({label:person.label,status:'request_failed'});}
  }
}

try {
  ensure(ids.length===36 && coreIds.length===27,'canonical_bank_shape');
  if(dryRun){
    ensure(!cleanupInput,'dry_run_cleanup_conflict');
    report.plannedSyntheticResponses=7;report.plannedChecks=['five_uniform_submissions','named_and_missing','waiting_owner_join','both_directions','third_full_self_unknown','private_invite_boundary','scope_and_name_withdrawal','comparison_withdrawal','delete_and_submit_replay','finally_delete_only_cleanup'];
  } else if(cleanupInput){
    const path=resolve(cleanupInput),delta=relative(realpathSync(privateRoot),realpathSync(path));
    ensure(delta&&!isAbsolute(delta)&&!delta.startsWith('..'),'cleanup_receipt_path');
    receipt=JSON.parse(readFileSync(path,'utf8'));
    ensure(receipt.format==='wedding-code36-private-live-qa-v1'&&receipt.base===base.origin&&Array.isArray(receipt.records),'cleanup_receipt_contract');
    // Preserve the original receipt; cleanup writes a fresh private receipt.
    initReceipt();
  } else {
    initReceipt();
    const people=[];
    await check('all five uniform submissions preserve all 36 actual answers and server expiry',async()=>{
      for(let value=1;value<=5;value++)people.push(await submit(`uniform_${value}`,makeSubmission(value)));
    });
    const [one,two,three,four,five]=people;
    const namedAnswers=Object.fromEntries(ids.map(id=>[id,id.startsWith('B')||id.startsWith('P')?5:2]));
    const missingAnswers=Object.fromEntries(ids.map(id=>[id,id==='B1'||id==='N1'?null:3]));
    let named,missing;
    await check('supported adjective animal and missing response submissions',async()=>{
      named=await submit('supported_budget_planning',makeSubmission(namedAnswers),five.accessToken);
      missing=await submit('partial_missing',makeSubmission(missingAnswers));
    });
    let tokenOne,tokenTwo,tokenThree,tokenFive,tokenNamed;
    await check('existing waiting owner joins partner invitation atomically',async()=>{
      const a=await pair(one),b=await pair(two);ensure(a.status===200&&b.status===200,'create_two_invites');
      tokenOne=a.body.coupleToken;tokenTwo=b.body.coupleToken;
      const joined=await pair(two,tokenOne);ensure(joined.status===200&&joined.body.pairingStatus==='paired','waiting_owner_join');
      ensure(joined.body.coupleToken===tokenOne,'target_token_returned');
      const retired=await invite(tokenTwo);ensure(retired.status===200&&retired.body.status==='not_found','old_empty_invite_retired');
    });
    await check('first couple report is ready with actual evidence in both directions',async()=>{
      for(const [a,b]of[[one,two],[two,one]]){const r=await read(a);ensure(r.status===200,'report_http');const view=verifyReport(r.body,a,b);ensure(view.names.a.name==='아직 미정인 수달'&&view.names.b.name==='아직 미정인 수달','uniform_fallback_name');}
    });
    await check('second uniform couple connects and compares in both directions',async()=>{
      const a=await pair(three);ensure(a.status===200,'second_invite');tokenThree=a.body.coupleToken;
      const joined=await pair(four,tokenThree);ensure(joined.status===200&&joined.body.coupleToken===tokenThree,'second_join');
      for(const [a,b]of[[three,four],[four,three]]){const r=await read(a);ensure(r.status===200,'report_http');verifyReport(r.body,a,b);}
    });
    await check('third participant full invitation and unknown invitation preserve own waiting invite',async()=>{
      let r=await pair(five,tokenOne);ensure(r.status===409&&r.body.pairingStatus==='full','third_full');
      r=await pair(five);ensure(r.status===200&&r.body.pairingStatus==='waiting','fifth_own_invite');tokenFive=r.body.coupleToken;
      r=await pair(five,randomUUID());ensure(r.status===404,'unknown_invite');
      r=await pair(five);ensure(r.status===200&&r.body.coupleToken===tokenFive,'unknown_preserves_own_invite');
    });
    await check('separate result with same owner key cannot self pair',async()=>{
      const r=await pair(named,tokenFive);ensure(r.status===409&&r.body.pairingStatus==='self','same_owner_self_pair');
      const own=await invite(tokenFive);ensure(own.status===200&&own.body.status==='waiting','self_pair_keeps_invite');
    });
    await check('invite alone and incorrect owner credentials cannot read private comparison',async()=>{
      let r=await invite(tokenOne);ensure(r.status===200&&r.body.status==='full','invite_status_only');same(Object.keys(r.body),['status'],'invite_no_private_fields');
      r=await request('report','GET',`/api/wedding-code/v36/couple-report?response_id=${encodeURIComponent(one.id)}`);ensure(r.status===403,'missing_owner_key');
      r=await request('report','GET',`/api/wedding-code/v36/couple-report?response_id=${encodeURIComponent(one.id)}`,undefined,tokenOne);ensure(r.status===403,'invite_is_not_owner_key');
      r=await request('report','GET',`/api/wedding-code/v36/couple-report?response_id=${encodeURIComponent(one.id)}`,undefined,missing.accessToken);ensure(r.status===403,'other_person_key');
      r=await request('report','GET',`/api/wedding-code/v36/couple-report?ct=${encodeURIComponent(tokenOne)}`);ensure(r.status===403,'token_only_report');
    });
    await check('named and missing couple preserves adjective animal name and missing evidence',async()=>{
      const own=await pair(named);ensure(own.status===200,'named_invite');tokenNamed=own.body.coupleToken;
      const joined=await pair(missing,tokenNamed);ensure(joined.status===200&&joined.body.pairingStatus==='paired','missing_join');
      for(const [a,b]of[[named,missing],[missing,named]]){
        const r=await read(a);ensure(r.status===200,'named_report_http');const v=verifyReport(r.body,a,b);
        ensure(v.names[a===named?'a':'b'].name==='단단한 비버','supported_name_first');
        const budget=v.body.core_cards.find(x=>x.criterion==='B');ensure(budget&&budget[a===missing?'a_mean':'b_mean']===null,'missing_not_imputed');
      }
    });
    await check('name withdrawal leaves evidence unchanged and seven day expiry unchanged',async()=>{
      const before=await read(named);const changed=await share(named,settings(false));ensure(changed.status===200&&changed.body.success,'withdraw_name');
      ensure(changed.body.expiresAt===named.expiresAt,'share_does_not_extend_expiry');
      const after=await read(named);ensure(after.status===200,'withdraw_name_report');const v=verifyReport(after.body,named,missing,coreIds,false);
      same(v.body,before.body.report.body,'names_never_unlock_answers');
    });
    await check('shared item intersection excludes unshared criteria and all private notes',async()=>{
      const changed=await share(named,settings(false,true,['B1','B2']));ensure(changed.status===200,'narrow_scope');
      for(const [a,b]of[[named,missing],[missing,named]]){
        const r=await read(a);ensure(r.status===200,'scope_report');const v=verifyReport(r.body,a,b,['B1','B2'],false);
        ensure(v.body.core_cards.length===1&&v.body.core_cards[0].status==='partial_shared_scope','partial_scope_not_aggregate');
      }
    });
    await check('comparison withdrawal removes names and shared evidence in both directions',async()=>{
      const changed=await share(named,settings(true,false));ensure(changed.status===200,'withdraw_comparison');
      for(const p of[named,missing]){const r=await read(p);ensure(r.status===200&&r.body.status==='ready','withdraw_report');const v=r.body.report;ensure(v.names===null,'withdraw_all_names');ensure(v.body.status==='no_comparison_consent','withdraw_consent_state');same(v.body.core_cards,[],'withdraw_all_core');same(v.body.single_note_cards,[],'withdraw_all_notes');same(v.body.shared_item_ids,[],'withdraw_all_scope');}
      const restore=await share(named,settings());ensure(restore.status===200,'restore_explicit_consent');const r=await read(named);verifyReport(r.body,named,missing);
    });
    await check('submission replay cannot change answers or extend expiry',async()=>{
      const replay=await request('submit','POST','/api/wedding-code/v36/response',{...makeSubmission(5),submission_id:one.submissionId,access_token:one.accessToken,consent:true});
      ensure(replay.status===200&&replay.body.recovered===true&&replay.body.id===one.id,'immutable_retry');same(replay.body.submission.answers,one.input.answers,'immutable_original_answers');ensure(replay.body.expiresAt===one.expiresAt,'retry_no_renewal');
    });
    await check('delete disconnects partner and delayed submit replay stays deleted',async()=>{
      let r=await deletion(one);ensure(r.status===200&&r.body.deleted===true,'delete_success');one.deleted=true;saveReceipt();
      r=await read(one);ensure(r.status===410&&r.body.resultStatus==='deleted','deleted_owner_cannot_read');
      r=await read(two);ensure(r.status===200&&r.body.status==='unpaired','partner_own_result_preserved');
      r=await invite(tokenOne);ensure(r.status===200&&r.body.status==='not_found','deleted_invite_closed');
      r=await request('submit','POST','/api/wedding-code/v36/response',{...one.input,submission_id:one.submissionId,access_token:one.accessToken,consent:true});ensure(r.status===410&&r.body.resultStatus==='deleted','deleted_replay_rejected');
      r=await deletion(one);ensure(r.status===200&&r.body.deleted===true,'delete_retry_idempotent');
    });
  }
} catch(error){
  if(!report.failures.length)report.failures.push({name:'setup_or_execution',code:error instanceof QaFailure?error.code:'unexpected_failure'});
} finally {
  if(!dryRun && receiptPath){await cleanup();receipt.completedAt=new Date().toISOString();saveReceipt();try{chmodSync(receiptPath,0o400);}catch{report.privateReceiptReadOnly=false;}}
  report.privateReceiptCreated=Boolean(receiptPath);saveReport();
  console.log(JSON.stringify({status:report.status,tests:report.tests.length,assertions,createdSyntheticResponses:report.createdSyntheticResponses,deletedResponses:report.cleanup.filter(x=>x.status==='deleted').length,failures:report.failures,privateReceiptCreated:report.privateReceiptCreated},null,2));
}
process.exitCode=report.status==='fail'?1:0;
