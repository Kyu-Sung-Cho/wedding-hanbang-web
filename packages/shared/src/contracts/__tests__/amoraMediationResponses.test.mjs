import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediationResponseSession, parseMediationResponseState } from '../amoraMediationResponses.mjs';
const owner = '11111111-1111-4111-8111-111111111111', partner = '22222222-2222-4222-8222-222222222222', couple = '33333333-3333-4333-8333-333333333333';
const scope = { ownerId: owner, coupleId: couple };
const revision = { messageId: '44444444-4444-4444-8444-444444444444', expectedProposalVersion: '55555555-5555-4555-8555-555555555555', expectedRosterFingerprint: '0123456789abcdef0123456789abcdef' };
const row = (choice='ok', changes={}) => ({ userId: owner, choice, condition: choice==='conditional' ? '상한 확인 뒤' : null, revision: 1, updatedAt: '2026-09-07T00:00:00Z', ...changes });
const state = (mine=null, theirs=null, changes={}) => ({ actorId: owner, proposalVersion: revision.expectedProposalVersion, rosterFingerprint: revision.expectedRosterFingerprint, accepted: mine?.choice==='ok', acceptedCount: [mine,theirs].filter(r=>r?.choice==='ok').length, requiredCount: 2, completed: false, partnerLinked: true, myResponse: mine, myResponseRevision: mine?.revision??0, responses: [mine,theirs].filter(Boolean), ...changes });
const response = (value, status=200) => new Response(JSON.stringify(value), {status});
const defer = () => { let resolve; const promise = new Promise(r=>{resolve=r}); return {promise,resolve}; };
function setup(replies) { const calls=[]; const session=createMediationResponseSession({ revision, readScope: async()=>scope, request: async(identity,path,options)=>{calls.push({identity,path,options});return replies.shift();} });return {session,calls}; }
test('condition and difficult never count as joint acceptance, and inconsistent owner/roster/rows fail closed', () => {
 assert.equal(parseMediationResponseState(state(row('conditional')), scope, revision)?.acceptedCount, 0);
 for (const invalid of [state(row('difficult'),null,{completed:true}), state(row(),row('ok')), state(null,null,{actorId:partner}), state(null,null,{rosterFingerprint:'f'.repeat(32)}), state(row('conditional',{condition:null})), state(row(),null,{myResponseRevision:0})]) assert.equal(parseMediationResponseState(invalid,scope,revision), null);
});
test('explicit response sends exact owner/proposal/roster/revision and accepts only exact saved choice', async()=>{
 const {session,calls}=setup([response(state()),response(state(row('conditional')))]);
 assert.equal(await session.load(),true); assert.equal(calls.length,1);
 assert.equal(await session.respond('conditional','상한 확인 뒤'),true);
 assert.deepEqual(JSON.parse(calls[1].options.body),{...revision,expectedOwnerId:owner,expectedResponseRevision:0,choice:'conditional',condition:'상한 확인 뒤'});
 assert.equal(session.getState().snapshot.completed,false);
});
test('conditional requires a reviewed nonempty condition; wrong saved choice cannot show success',async()=>{
 const {session,calls}=setup([response(state()),response(state(row()))]); await session.load();
 assert.equal(await session.respond('conditional','  '),false);assert.equal(calls.length,1);
 assert.equal(await session.respond('difficult',null),false);assert.match(session.getState().error,/확인하지 못/);
});
test('revocation carries the latest revision including a previous tombstone and does not erase a completed decision',async()=>{
 const {session,calls}=setup([response(state(null,null,{myResponseRevision:4})),response(state(row('ok',{revision:5}))),response(state(null,null,{myResponseRevision:6}))]);
 await session.load(); await session.respond('ok',null);assert.equal(JSON.parse(calls[1].options.body).expectedResponseRevision,4);
 assert.equal(await session.revoke(),true);assert.equal(JSON.parse(calls[2].options.body).expectedResponseRevision,5);assert.equal(session.getState().snapshot.myResponseRevision,6);
 const complete=setup([response(state(row(),row('ok',{userId:partner}),{completed:true}))]); await complete.session.load();assert.equal(await complete.session.revoke(),false);assert.equal(complete.calls.length,1);
});
test('conflict refreshes canonical state without treating the attempted choice as accepted',async()=>{
 const {session,calls}=setup([response(state()),response({error:'changed'},409),response(state(row('difficult')))]);await session.load();
 assert.equal(await session.respond('ok',null),false);assert.equal(calls.length,3);assert.equal(session.getState().snapshot.myResponse.choice,'difficult');assert.match(session.getState().error,/다시/);
});
test('owner A-B-A and late writes after invalidation never restore the previous account response',async()=>{
 const old=defer();const {session}=setup([response(state()),old.promise]);await session.load();const saving=session.respond('ok',null);await Promise.resolve();session.invalidate();old.resolve(response(state(row())));assert.equal(await saving,false);assert.equal(session.getState().snapshot,null);
});
test('fresh couple recheck blocks old proposal response before mutation and double click sends once',async()=>{
 let current=scope;let writes=0;const pending=defer(); const session=createMediationResponseSession({revision,readScope:async()=>current,request:async(_s,_p,o)=>o.method==='POST'?(writes++,pending.promise):response(state())});await session.load();current={...scope,coupleId:partner};assert.equal(await session.respond('ok',null),false);assert.equal(writes,0);
 const valid=setup([response(state()),pending.promise]);await valid.session.load();const first=valid.session.respond('ok',null);assert.equal(await valid.session.respond('ok',null),false);pending.resolve(response(state(row())));assert.equal(await first,true);assert.equal(valid.calls.length,2);
});
test('a shared follow-up is separate explicit reviewed creation with fixed scope and verified receipt',async()=>{
 const title='계약 해제 조건 확인';const description='내가 확인해서 함께 이야기하기';
 const {session,calls}=setup([response(state(row('conditional'))),response({action:{id:'action-1',title,description,status:'open',source:'manual',href:'/chat'}})]);await session.load();assert.equal(calls.length,1);
 assert.equal(await session.createTask(title,description),true);assert.deepEqual(JSON.parse(calls[1].options.body),{title,description,status:'open',source:'manual',href:'/chat',expectedOwnerId:owner,expectedCoupleId:couple,requestId:revision.expectedProposalVersion});
 const bad=setup([response(state()),response({action:{id:'other',title:'다른 제목',status:'open',source:'manual',href:'/chat'}})]);await bad.session.load();assert.equal(await bad.session.createTask(title,description),false);assert.equal(bad.session.getState().taskSaved,null);
});

test('an ok receipt cannot retain a condition or silently normalize unreviewed whitespace',()=>{
 assert.equal(parseMediationResponseState(state(row('ok',{condition:'단, 추가 확인'})),scope,revision),null);
 assert.equal(parseMediationResponseState(state(row('conditional',{condition:' 상한 확인 뒤 '})),scope,revision),null);
});
test('unknown shared task outcome blocks repeat creation even after a successful response reload',async()=>{
 let writes=0;const session=createMediationResponseSession({revision,readScope:async()=>scope,request:async(_s,_p,o)=>{if(o.method==='POST'){writes++;throw new Error('network dropped');}return response(state());}});await session.load();
 assert.equal(await session.createTask('계약 확인',''),false);assert.equal(session.getState().taskUnknown,true);await session.load();assert.equal(await session.createTask('계약 확인',''),false);assert.equal(writes,1);
});

test('same couple roster replacement during an in-flight response cannot publish the old receipt',async()=>{
 let current={...scope,rosterKey:owner+':'+partner};const pending=defer();let writes=0;
 const session=createMediationResponseSession({revision,readScope:async()=>current,request:async(_scope,_path,options)=>{if(options.method==='POST'){writes++;return pending.promise;}return response(state());}});await session.load();const saving=session.respond('ok',null);while(!writes)await Promise.resolve();current={...current,rosterKey:owner+':new-member'};pending.resolve(response(state(row())));assert.equal(await saving,false);assert.equal(session.getState().snapshot,null);
});

test('a hung read has a deadline, aborts transport, and permits a canonical reload without a late overwrite',{timeout:1000},async()=>{
 const pending=defer();let calls=0,signal;
 const session=createMediationResponseSession({revision,timeoutMs:15,readScope:async()=>scope,request:async(_s,_p,options)=>{calls++;signal??=options.signal;return calls===1?pending.promise:response(state(row('difficult')));}});
 assert.equal(await session.load(),false);assert.equal(session.getState().loading,false);assert.equal(signal?.aborted,true);
 assert.equal(await session.load(),true);pending.resolve(response(state(row())));await Promise.resolve();
 assert.equal(session.getState().snapshot.myResponse.choice,'difficult');
});

test('scope and response-body waits are bounded, and unknown mutation can reload canonical state',{timeout:1000},async()=>{
 const pending=defer();let scopeCalls=0;
 const noScope=createMediationResponseSession({revision,timeoutMs:15,readScope:()=>++scopeCalls===1?pending.promise:Promise.resolve(scope),request:async()=>response(state())});
 assert.equal(await noScope.load(),false);assert.equal(await noScope.load(),true);
 let posts=0;
 const session=createMediationResponseSession({revision,timeoutMs:15,readScope:async()=>scope,request:async(_s,_p,o)=>o.method==='POST'?(posts++,{ok:true,json:()=>pending.promise}):response(posts?state(row()):state())});
 await session.load();assert.equal(await session.respond('ok',null),false);assert.equal(session.getState().busy,false);
 assert.equal(await session.load(),true);assert.equal(session.getState().snapshot.myResponse.choice,'ok');
});

test('a committed follow-up with lost reply reuses its idempotency key after remount',async()=>{
 const saved=new Map();let loseReply=true;
 const request=async(_s,_p,o)=>{if(o.method==='GET')return response(state());const body=JSON.parse(o.body);const key=body.requestId??String(saved.size);const action=saved.get(key)??{id:`action-${saved.size}`,title:body.title,description:body.description,status:'open',source:'manual',href:'/chat'};saved.set(key,action);if(loseReply){loseReply=false;throw new Error('lost reply');}return response({action});};
 const make=()=>createMediationResponseSession({revision,readScope:async()=>scope,request});
 const first=make();await first.load();assert.equal(await first.createTask('계약 확인',''),false);
 const remounted=make();await remounted.load();assert.equal(await remounted.createTask('계약 확인',''),true);
 assert.equal(saved.size,1);assert.equal(remounted.getState().taskSaved,'action-0');
});
