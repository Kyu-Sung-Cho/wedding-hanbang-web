import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { URL } from 'node:url';
import { setImmediate } from 'node:timers';
const { Response } = globalThis;
const require = createRequire(new URL('../../package.json',import.meta.url));
const ts=require('typescript');
function load(url,deps={}) { const code=ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText; const module={exports:{}};new Function('module','exports','require','__DEV__',code)(module,module.exports,key=>{assert.ok(Object.hasOwn(deps,key),key);return deps[key];},false);return module.exports; }
const contract=load(new URL('../../../../packages/shared/src/contracts/privacyConfirmationTarget.ts',import.meta.url));
const invites=load(new URL('../../../../packages/shared/src/contracts/coupleInviteCode.ts',import.meta.url));
const connection=load(new URL('../../../../packages/shared/src/utils/coupleConnection.ts',import.meta.url));
const settings=load(new URL('../lib/weddingSettings.ts',import.meta.url));
const care=load(new URL('../lib/careSettings.ts',import.meta.url));
const errorCopy=load(new URL('../lib/errorCopy.ts',import.meta.url));
const preference=load(new URL('../lib/preferenceRequest.ts',import.meta.url));
const A='10000000-0000-4000-8000-000000000001', B='10000000-0000-4000-8000-000000000002', C='20000000-0000-4000-8000-000000000001';
const target={ownerId:A,coupleId:C,privacyEpoch:7};
const nodes=value=>!value?[]:Array.isArray(value)?value.flatMap(nodes):typeof value==='object'?[value,...nodes(value.props?.children)]:[];
function harness(behavior={}) {
  let index=0,owner=A,authChange; const values=[],effects=[],pending=[],cleanups=[],alerts=[],writes=[],navigations=[],profileWrites=[],expectedCalls=[];
  const hooks={
    useState(initial){const slot=index++;if(!(slot in values))values[slot]=typeof initial==='function'?initial():initial;return[values[slot],next=>{values[slot]=typeof next==='function'?next(values[slot]):next;}];},
    useRef(initial){const slot=index++;return values[slot]??={current:initial};},
    useEffect(effect,deps){const slot=index++;if(!effects[slot]||deps.some((x,i)=>x!==effects[slot][i])){effects[slot]=deps;pending.push(()=>{cleanups[slot]?.();cleanups[slot]=effect();});}},
  };
  const fetchApi=async(url,options)=>{
    if(url==='/api/settings/wedding-profile')return Response.json({settings:{user_id:owner,couple_id:C,name:'합성',community_nickname:'합성',role:'bride',wedding_date:null,venue:null,total_budget:null,care_notifications_enabled:!!behavior.care,care_notifications_consented_at:behavior.care?'2026-09-20T00:00:00Z':null}});
    if(url==='/api/profile'){profileWrites.push(JSON.parse(options?.body??'{}'));return behavior.profileResponse?behavior.profileResponse():Response.json({profile:{id:owner,care_notifications_enabled:false}});}
    if(url==='/api/couple/code')return Response.json({inviteCode:'WH-ABCDEF',isFullyLinked:false,isMembershipSealed:false,inviteCodeExpiresAt:null,inviteCodeReissued:false});
    assert.equal(url,'/api/couple/reset');
    if(options?.method==='POST'){writes.push(JSON.parse(options.body));return Response.json({success:true});}
    return Response.json({confirmationTarget:target});
  };
  const expectedApi=async(expected,url,options)=>{expectedCalls.push({expected,url});if(expected!==owner)throw new Error('계정이 바뀌었어요');return fetchApi(url,options);};
  const token=new Proxy({},{get:()=>token});const jsx=(type,props)=>({type,props});
  const primitives=Object.fromEntries(['View','Pressable','ScrollView','ActivityIndicator','Modal'].map(x=>[x,x]));
  const supabase={auth:{getUser:async()=>({data:{user:{id:owner}}}),getSession:async()=>({data:{session:{user:{id:owner}}}}),onAuthStateChange:callback=>{authChange=callback;return{data:{subscription:{unsubscribe(){}}}};}},from:()=>({select:()=>({eq:()=>({neq:async()=>({data:[]}),maybeSingle:async()=>({data:{member_model_version:1}})})})})};
  const deps={
    react:hooks,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},'react-native':{...primitives,StyleSheet:{create:x=>x},Alert:{alert:(title,message,buttons)=>alerts.push({title,message,buttons})},Animated:{Value:class{},View:'View'},Platform:{OS:'ios'},Linking:{}},
    '@hanbang/shared/constants':{CONTACT:{email:'audit@example.invalid'}},'@hanbang/shared':{...contract,...invites,...connection,ACCOUNT_DELETION_FACTS:[]},'@hanbang/design-tokens':{colors:token},
    '@/components/ui/AppText':{Text:'Text',TextInput:'TextInput'},'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'expo-router':{router:{replace:value=>navigations.push(value)}},'lucide-react-native':{},'expo-clipboard':{},
    '@/lib/siteUrl.mjs':{buildMobileSiteUrl:()=>'',resolveMobileSiteOrigin:()=>''},'@/lib/supabase':{supabase},'@/lib/api':{apiFetch:fetchApi,apiFetchForExpectedUser:expectedApi,apiFetchForExpectedUserQuiet:expectedApi},'@/lib/weddingSettings':settings,'@/lib/careSettings':care,'@/lib/errorCopy':errorCopy,
    '@/lib/auth':{},'@/lib/accountDeletionIntake':{},'@/lib/communityPostCache':{clearCommunityCaches(){}},'@/lib/communityDecisionPending':{},'@/lib/preferenceRequest':preference,
    '@/components/ui/AppUI':Object.fromEntries(['ActionRow','AppHeader','LoadingState','PrimaryButton','Surface'].map(x=>[x,x])),
  };
  for(const name of ['DismissKeyboard','AppGuide','invite/InviteCodeCard','settings/TodayOnePreferenceControl','settings/CommunityReplyPushPreferenceControl'])deps[`@/components/${name}`]={default:name};
  const screen=load(new URL('../../app/settings/index.tsx',import.meta.url),deps).default;
  return {alerts,writes,navigations,profileWrites,expectedCalls,render(){index=0;return screen();},async settle(){for(const effect of pending.splice(0))effect();for(let n=0;n<12;n++)await new Promise(setImmediate);},unmount(){for(const cleanup of cleanups)cleanup?.();},switchOwner(next=B){owner=next;authChange?.('SIGNED_IN',{user:{id:next}});} };
}
test('an old reset Alert cannot mutate or navigate after its settings screen unmounts',async()=>{
  const h=harness();h.render();await h.settle();
  const button=nodes(h.render()).find(node=>node.props?.accessibilityLabel==='현재 커플 연결을 끊고 새 커플로 다시 시작');assert.ok(button);
  await button.props.onPress();await h.settle();
  const confirm=h.alerts.at(-1).buttons.find(x=>x.style==='destructive');h.unmount();
  await confirm.onPress();await h.settle();
  assert.deepEqual(h.writes,[]);assert.deepEqual(h.navigations,[]);
});
test('a current reset reads and submits the exact target once before onboarding',async()=>{
  const h=harness();h.render();await h.settle();
  const button=nodes(h.render()).find(node=>node.props?.accessibilityLabel==='현재 커플 연결을 끊고 새 커플로 다시 시작');
  await button.props.onPress();await h.settle();
  const confirm=h.alerts.at(-1).buttons.find(x=>x.style==='destructive');
  await confirm.onPress();await confirm.onPress();await h.settle();
  assert.deepEqual(h.writes,[{confirmText:'초기화합니다',confirmationTarget:target}]);
  assert.deepEqual(h.navigations,['/onboarding']);
});
test('an Alert from A cannot survive A → B → A even when the rendered owner looks unchanged',async()=>{
  const h=harness();h.render();await h.settle();
  await nodes(h.render()).find(node=>node.props?.accessibilityLabel==='현재 커플 연결을 끊고 새 커플로 다시 시작').props.onPress();
  const confirm=h.alerts.at(-1).buttons.find(x=>x.style==='destructive');
  h.switchOwner(B);h.switchOwner(A);await confirm.onPress();await h.settle();
  assert.deepEqual(h.writes,[]);assert.deepEqual(h.navigations,[]);
});
test('cancelled reset cannot be executed through its retained native confirmation callback',async()=>{
  const h=harness();h.render();await h.settle();
  await nodes(h.render()).find(node=>node.props?.accessibilityLabel==='현재 커플 연결을 끊고 새 커플로 다시 시작').props.onPress();
  const buttons=h.alerts.at(-1).buttons;
  buttons.find(x=>x.style==='cancel').onPress();await buttons.find(x=>x.style==='destructive').onPress();
  assert.deepEqual(h.writes,[]);
});

const careButton=h=>nodes(h.render()).find(node=>node.props?.title==='이전 이메일 수신 동의 해제');
test('a delayed initial auth event for the loaded owner retains the legacy opt-out',async()=>{
  const h=harness({care:true});h.render();await h.settle();assert.ok(careButton(h));
  h.switchOwner(A);await h.settle();assert.ok(careButton(h));
});
test('legacy care revoke pins the reviewed owner in transport and body, then validates the saved profile',async()=>{
  const h=harness({care:true});h.render();await h.settle();careButton(h).props.onPress();await h.settle();
  assert.deepEqual(h.profileWrites,[{care_notifications_enabled:false,expectedOwnerId:A}]);
  assert.deepEqual(h.expectedCalls.filter(call=>call.url==='/api/profile'),[{expected:A,url:'/api/profile'}]);
  assert.equal(careButton(h),undefined);assert.equal(h.alerts.at(-1).title,'해제 완료');
});
test('an old legacy-care callback cannot survive same-tick A to B to A',async()=>{
  const h=harness({care:true});h.render();await h.settle();const button=careButton(h);
  h.switchOwner(B);h.switchOwner(A);button.props.onPress();await h.settle();
  assert.deepEqual(h.profileWrites,[]);assert.deepEqual(h.alerts,[]);
});
test('a legacy-care callback cannot send after unmount',async()=>{
  const h=harness({care:true});h.render();await h.settle();const button=careButton(h);h.unmount();button.props.onPress();await h.settle();
  assert.deepEqual(h.profileWrites,[]);assert.deepEqual(h.alerts,[]);
});
test('late legacy-care success cannot change or alert the next account',async()=>{
  let finish;const h=harness({care:true,profileResponse:()=>new Promise(resolve=>{finish=resolve;})});h.render();await h.settle();
  careButton(h).props.onPress();await h.settle();h.switchOwner(B);finish(Response.json({profile:{id:A,care_notifications_enabled:false}}));await h.settle();
  assert.deepEqual(h.alerts,[]);
});
test('a malformed legacy-care receipt does not claim consent was revoked',async()=>{
  const h=harness({care:true,profileResponse:()=>Response.json({profile:{id:B,care_notifications_enabled:false},error:'RAW_PRIVATE_ERROR'})});h.render();await h.settle();
  careButton(h).props.onPress();await h.settle();assert.ok(careButton(h));
  assert.notEqual(h.alerts.at(-1).title,'해제 완료');assert.doesNotMatch(h.alerts.at(-1).message,/RAW_PRIVATE_ERROR/);
});
test('legacy-care double press sends one request before the first settles',async()=>{
  const completions=[];const h=harness({care:true,profileResponse:()=>new Promise(resolve=>{completions.push(resolve);})});h.render();await h.settle();
  const button=careButton(h);button.props.onPress();button.props.onPress();await h.settle();
  try {assert.equal(h.profileWrites.length,1);}
  finally {for(const finish of completions)finish(Response.json({profile:{id:A,care_notifications_enabled:false}}));await h.settle();}
});
test('legacy-care fetch and body have a bounded outcome-unknown path',async context=>{
  let expire;context.mock.method(globalThis,'setTimeout',(callback,delay)=>{assert.equal(delay,15000);expire=callback;return 1;});
  context.mock.method(globalThis,'clearTimeout',()=>undefined);
  const h=harness({care:true,profileResponse:()=>Promise.resolve({ok:true,json:()=>new Promise(()=>{})})});h.render();await h.settle();
  careButton(h).props.onPress();await h.settle();assert.equal(typeof expire,'function');expire();await h.settle();
  assert.ok(careButton(h));assert.equal(careButton(h).props.disabled,false);assert.match(h.alerts.at(-1).message,/결과를 확인하지 못/);
});
