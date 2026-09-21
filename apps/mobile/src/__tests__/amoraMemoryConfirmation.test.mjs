import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { URL } from 'node:url';
import { setImmediate, setTimeout } from 'node:timers';
import * as fence from '../lib/ownerCoupleSessionFence.mjs';
const require = createRequire(new URL('../../package.json', import.meta.url));
const ts = require('typescript');
function load(url, dependencies = {}) {
  const output = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('module','exports','require',output)(module,module.exports,key => { assert.ok(Object.hasOwn(dependencies,key),key); return dependencies[key]; });
  return module.exports;
}
const shared = load(new URL('../../../../packages/shared/src/contracts/privacyConfirmationTarget.ts', import.meta.url));
const display = load(new URL('../lib/amoraMemoryDisplay.ts', import.meta.url));
const A = '10000000-0000-4000-8000-000000000001', B = '10000000-0000-4000-8000-000000000002';
const C1 = '20000000-0000-4000-8000-000000000001', C2 = '20000000-0000-4000-8000-000000000002';
const nodes = value => !value ? [] : Array.isArray(value) ? value.flatMap(nodes) : typeof value === 'object' ? [value,...nodes(value.props?.children)] : [];
const text = value => value == null ? '' : Array.isArray(value) ? value.map(text).join('') : typeof value === 'object' ? text(value.props?.children) : String(value);
function harness({wrongTarget=false}={}) {
  const values = [], effects = [], pending = [], cleanups = [];
  let index = 0, owner = A, couple = C1, authChanged, epoch = 7;
  const requests = [], alerts = [], reads = [];
  const memo = (fn,deps) => { const slot=index++; const old=values[slot]; if (!old || deps.some((v,i)=>v!==old.deps[i])) values[slot]={value:fn(),deps}; return values[slot].value; };
  const react = {
    useState(initial) { const slot=index++; if (!(slot in values)) values[slot]=typeof initial==='function'?initial():initial; return [values[slot],value=>{values[slot]=typeof value==='function'?value(values[slot]):value;}]; },
    useRef(initial) { const slot=index++; return values[slot]??={current:initial}; },
    useMemo:memo, useCallback:(fn,deps)=>memo(()=>fn,deps),
    useEffect(effect,deps) { const slot=index++; if (!effects[slot] || deps.some((v,i)=>v!==effects[slot][i])) { effects[slot]=deps; pending.push(()=>{cleanups[slot]?.(); cleanups[slot]=effect();}); } },
  };
  const token = new Proxy({}, { get:()=>token });
  const jsx = (type,props)=>({type,props});
  const native = Object.fromEntries(['Modal','Pressable','ScrollView','Switch','View'].map(x=>[x,x]));
  const screen = load(new URL('../../app/settings/amora-memory.tsx', import.meta.url), {
    react, 'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'}, '@hanbang/shared':shared,
    'react-native':{...native,StyleSheet:{create:value=>value},Alert:{alert:(title,message,buttons)=>alerts.push({title,message,buttons})}},
    '@/components/ui/AppText':{TextInput:'TextInput'},'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'expo-router':{router:{back(){}}},
    'lucide-react-native':{},'@hanbang/design-tokens':{colors:token,radius:token,spacing:token},
    '@/lib/amoraMemoryDisplay':display,'@/lib/ownerCoupleSessionFence.mjs':fence,
    '@/components/ui/AppUI':Object.fromEntries(['AppHeader','AppText','EmptyState','LoadingState','PrimaryButton','StatusPill','Surface'].map(x=>[x,x])),
    '@/lib/supabase':{supabase:{auth:{getSession:async()=>({data:{session:{user:{id:owner}}}}),onAuthStateChange:callback=>{authChanged=callback;return{data:{subscription:{unsubscribe(){}}}};}},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{couple_id:couple}})})})})}},
    '@/lib/api':{apiJsonForExpectedUser:async(expectedOwner,url,options)=>{
      if(options?.method==='PATCH'){requests.push({expectedOwner,body:JSON.parse(options.body)});epoch++;return{success:true};}
      reads.push(expectedOwner);
      return{runtimeEnabled:true,confirmationTarget:{ownerId:wrongTarget?B:owner,coupleId:couple,privacyEpoch:epoch},settings:[{visibility:'shared',enabled:false,consentedByMe:false,pendingPurge:{total:0}}],memories:[],profiles:[]};
    }},
  }).default;
  return {
    requests,alerts,reads,
    render(){index=0;return screen();},
    async settle(){for(const effect of pending.splice(0))effect();await new Promise(resolve=>setTimeout(resolve,10));for(let n=0;n<12;n++)await new Promise(setImmediate);},
    switchOwner(){owner=B;couple=C2;authChanged('SIGNED_IN',{user:{id:owner}});},
    unmount(){for(const cleanup of cleanups)cleanup?.();},
  };
}
test('a memory clear confirmation from account A cannot authorize a clear for account B', async()=>{
  const h=harness();h.render();await h.settle();
  const clear=nodes(h.render()).find(node=>node.type==='Pressable'&&text(node)==='기억 초기화');assert.ok(clear);
  clear.props.onPress();const confirmation=h.alerts.at(-1).buttons.find(button=>button.style==='destructive');
  h.switchOwner();await h.settle();h.render();await h.settle();
  assert.ok(h.reads.includes(B),'the replacement account has finished loading before the old Alert is pressed');
  confirmation.onPress();await h.settle();
  assert.deepEqual(h.requests,[]);
  h.unmount();
});
test('a memory response with a different confirmation owner is not displayed as current settings',async()=>{
  const h=harness({wrongTarget:true});h.render();await h.settle();
  assert.ok(text(h.render()).includes('다시'));
  assert.equal(nodes(h.render()).some(node=>node.type==='Pressable'&&text(node)==='기억 초기화'),false);
  h.unmount();
});
test('confirmed clears carry their read target and refresh it for the next legitimate clear',async()=>{
  const h=harness();h.render();await h.settle();
  for(const epoch of [7,8]){
    nodes(h.render()).find(node=>node.type==='Pressable'&&text(node)==='기억 초기화').props.onPress();
    h.alerts.at(-1).buttons.find(button=>button.style==='destructive').onPress();await h.settle();
    assert.deepEqual(h.requests.at(-1),{expectedOwner:A,body:{action:'clear_scope',visibility:'shared',confirmationTarget:{ownerId:A,coupleId:C1,privacyEpoch:epoch}}});
  }
  h.unmount();
});
