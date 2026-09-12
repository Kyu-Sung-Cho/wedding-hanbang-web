import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";
import * as responsesContract from "@hanbang/shared/mediation-responses";
// 앱과 웹이 같은 판정을 쓰는지 확인하려면 테스트도 그 실물을 써야 한다.
import { isRequesterSummaryMediationProvenance } from "@hanbang/shared/mediation-provenance";

const chatPath = fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url));
const cardPath = fileURLToPath(new URL("../components/chat/AmoraMediationCard.tsx", import.meta.url));
const clientPath = fileURLToPath(new URL("../lib/amoraMediation.ts", import.meta.url));
const chatSource = readFileSync(chatPath, "utf8");
const cardSource = (existsSync(cardPath) ? readFileSync(cardPath, "utf8") : "") + readFileSync(new URL("../components/chat/AmoraMediationResponses.tsx", import.meta.url), "utf8");
const EXPECTED_REVISION = {
  expectedProposalVersion: "123e4567-e89b-42d3-a456-426614174000",
  expectedRosterFingerprint: "0123456789abcdef0123456789abcdef",
};

test("a persisted AI mediation message exposes its structured proposal in the native chat", () => {
  assert.equal(existsSync(cardPath), true, "native mediation card is missing");
  assert.match(chatSource, /mediation\?: unknown/);
  assert.match(chatSource, /normalizeMediationBlock\(item\.metadata\?\.mediation\)/);
  assert.match(chatSource, /<AmoraMediationCard[\s\S]*block=\{mediationBlock\}[\s\S]*messageId=\{item\.id\}/);
  assert.match(cardSource, /from "react-native"/);
  assert.doesNotMatch(cardSource, /WebView|Linking\.openURL/);
});

test("native realtime replaces an updated proposal and removes newly hidden messages", () => {
  assert.match(chatSource, /event:\s*"UPDATE"[\s\S]*table:\s*"chat_messages"/);
  assert.match(chatSource, /const updated = chatMessageFromRealtimeRow\(payload\.new\)/);
  assert.match(chatSource, /!canViewerSeeChatMessage\(updated, viewerRole\)[\s\S]*filter\(\(message\) => message\.id !== updatedId\)/);
  assert.match(chatSource, /map\(\(message\) => message\.id === updated\.id \? updated : message\)/);
  assert.match(chatSource, /key=\{`\$\{item\.id\}:\$\{mediationBlock\.proposalVersion \?\? "draft"\}:\$\{mediationBlock\.rosterFingerprint \?\? "unknown-roster"\}`\}/);
});

function loadAcceptanceClient(apiJson) {
  const clientSource = readFileSync(clientPath, "utf8");
  const sourceFile = ts.createSourceFile(
    clientPath,
    clientSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = sourceFile.statements
    .filter((statement) =>
      ts.isFunctionDeclaration(statement) || ts.isVariableStatement(statement)
    )
    .map((statement) => statement.getFullText(sourceFile).replace(/\bexport\s+/g, ""))
    .join("\n");
  const compiled = ts.transpileModule(declarations, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });
  return new Function(
    "apiJson",
    "isRequesterSummaryMediationProvenance",
    `${compiled.outputText}\nreturn {
      getMediationAcceptance,
      acceptMediationResolution: typeof acceptMediationResolution === "function"
        ? acceptMediationResolution
        : undefined,
      withdrawMediationAcceptance: typeof withdrawMediationAcceptance === "function"
        ? withdrawMediationAcceptance
        : undefined,
      canWithdrawMediationAcceptance: typeof canWithdrawMediationAcceptance === "function"
        ? canWithdrawMediationAcceptance
        : undefined,
      canAcceptMediationResolution: typeof canAcceptMediationResolution === "function"
        ? canAcceptMediationResolution
        : undefined,
      getExpectedMediationRevision: typeof getExpectedMediationRevision === "function"
        ? getExpectedMediationRevision
        : undefined,
      normalizeMediationBlock,
    };`,
  )(apiJson, isRequesterSummaryMediationProvenance);
}

test("opening a confirmable proposal loads the authenticated acceptance state", async () => {
  assert.equal(existsSync(clientPath), true, "mediation acceptance client is missing");
  const calls = [];
  const apiJson = async (path, options) => {
    calls.push({ path, options });
    return { accepted: false, acceptedCount: 0, requiredCount: 2, completed: false };
  };
  const { getMediationAcceptance } = loadAcceptanceClient(apiJson);
  const messageId = "1474c6f2-29c6-4c77-8d91-d3347eef4c3f";

  const state = await getMediationAcceptance(messageId, EXPECTED_REVISION);

  assert.deepEqual(state, {
    accepted: false,
    acceptedCount: 0,
    requiredCount: 2,
    completed: false,
  });
  assert.deepEqual(calls, [{
    path: `/api/amora/mediation/accept?messageId=${messageId}&expectedProposalVersion=${EXPECTED_REVISION.expectedProposalVersion}&expectedRosterFingerprint=${EXPECTED_REVISION.expectedRosterFingerprint}`,
    options: { cache: "no-store" },
  }]);
});

test("the mobile client preserves a solo account's partner-linked state", async () => {
  const { getMediationAcceptance } = loadAcceptanceClient(async () => ({
    accepted: false,
    acceptedCount: 0,
    requiredCount: 2,
    completed: false,
    partnerLinked: false,
  }));

  const state = await getMediationAcceptance(
    "1474c6f2-29c6-4c77-8d91-d3347eef4c3f",
    EXPECTED_REVISION,
  );

  assert.deepEqual(state, {
    accepted: false,
    acceptedCount: 0,
    requiredCount: 2,
    completed: false,
    partnerLinked: false,
  });
});

test("untrusted mediation metadata is normalized before it can reach native text", () => {
  const { normalizeMediationBlock } = loadAcceptanceClient(async () => ({}));

  assert.deepEqual(normalizeMediationBlock({
    empathy: "  속상했겠어요  ",
    translation: { unsafe: true },
    data: "확인할 자료가 아직 부족해요",
    proposalVersion: "not-a-uuid",
    rosterFingerprint: "not-a-fingerprint",
    ignored: "화면에 나오면 안 돼요",
  }), {
    empathy: "속상했겠어요",
    translation: undefined,
    data: "확인할 자료가 아직 부족해요",
    resolution: undefined,
    proposalVersion: undefined,
    rosterFingerprint: undefined,
    // 표식이 없으면 출처를 주장하지 않는다 — 화면은 "요청자가 전한" 문구를 쓰지 못한다.
    requesterSummaryOnly: false,
  });
  assert.equal(normalizeMediationBlock(null), null);
  assert.equal(normalizeMediationBlock([]), null);
  assert.equal(normalizeMediationBlock({ resolution: "가".repeat(501) }), null);
});

test("native normalization preserves the exact server proposal revision", () => {
  const { normalizeMediationBlock } = loadAcceptanceClient(async () => ({}));

  assert.deepEqual(normalizeMediationBlock({
    resolution: "  예산 상한선을 같이 확인해 봐요  ",
    proposalVersion: "123E4567-E89B-42D3-A456-426614174000",
    rosterFingerprint: "0123456789abcdef0123456789abcdef",
  }), {
    empathy: undefined,
    translation: undefined,
    data: undefined,
    resolution: "예산 상한선을 같이 확인해 봐요",
    proposalVersion: "123e4567-e89b-42d3-a456-426614174000",
    rosterFingerprint: "0123456789abcdef0123456789abcdef",
    requesterSummaryOnly: false,
  });
});

test("native confirmation fails closed without both exact revision fields", () => {
  const { getExpectedMediationRevision } = loadAcceptanceClient(async () => ({}));
  assert.equal(typeof getExpectedMediationRevision, "function");

  assert.equal(getExpectedMediationRevision({
    resolution: "내용은 계속 표시해요",
    proposalVersion: "123e4567-e89b-42d3-a456-426614174000",
  }), null);
  assert.deepEqual(getExpectedMediationRevision({
    resolution: "내용은 계속 표시해요",
    proposalVersion: "123e4567-e89b-42d3-a456-426614174000",
    rosterFingerprint: "0123456789abcdef0123456789abcdef",
  }), {
    expectedProposalVersion: "123e4567-e89b-42d3-a456-426614174000",
    expectedRosterFingerprint: "0123456789abcdef0123456789abcdef",
  });
});

test("accepting a proposal posts its message id and displayed exact revision", async () => {
  const calls = [];
  const apiJson = async (path, options) => {
    calls.push({ path, options });
    return { accepted: true, acceptedCount: 1, requiredCount: 2, completed: false };
  };
  const { acceptMediationResolution } = loadAcceptanceClient(apiJson);
  assert.equal(typeof acceptMediationResolution, "function");
  const messageId = "1474c6f2-29c6-4c77-8d91-d3347eef4c3f";

  const state = await acceptMediationResolution(messageId, EXPECTED_REVISION);

  assert.deepEqual(state, {
    accepted: true,
    acceptedCount: 1,
    requiredCount: 2,
    completed: false,
  });
  assert.deepEqual(calls, [{
    path: "/api/amora/mediation/accept",
    options: {
      method: "POST",
      body: JSON.stringify({ messageId, ...EXPECTED_REVISION }),
    },
  }]);
});

test("withdrawing my incomplete acceptance sends the displayed exact revision", async () => {
  const calls = [];
  const apiJson = async (path, options) => {
    calls.push({ path, options });
    return { accepted: false, acceptedCount: 0, requiredCount: 2, completed: false };
  };
  const { withdrawMediationAcceptance } = loadAcceptanceClient(apiJson);
  assert.equal(typeof withdrawMediationAcceptance, "function");
  const messageId = "1474c6f2-29c6-4c77-8d91-d3347eef4c3f";

  const state = await withdrawMediationAcceptance(messageId, EXPECTED_REVISION);

  assert.deepEqual(state, {
    accepted: false,
    acceptedCount: 0,
    requiredCount: 2,
    completed: false,
  });
  assert.deepEqual(calls, [{
    path: "/api/amora/mediation/accept",
    options: {
      method: "DELETE",
      body: JSON.stringify({ messageId, ...EXPECTED_REVISION }),
    },
  }]);
});

test("missing exact revision blocks acceptance requests before the network", async () => {
  const calls = [];
  const client = loadAcceptanceClient(async (...args) => {
    calls.push(args);
    return {};
  });
  const messageId = "1474c6f2-29c6-4c77-8d91-d3347eef4c3f";

  await assert.rejects(
    () => client.getMediationAcceptance(messageId),
    /표시된 선택안의 정확한 버전을 확인할 수 없습니다/,
  );
  await assert.rejects(
    () => client.acceptMediationResolution(messageId, {
      expectedProposalVersion: EXPECTED_REVISION.expectedProposalVersion,
    }),
    /표시된 선택안의 정확한 버전을 확인할 수 없습니다/,
  );
  assert.deepEqual(calls, []);
});

test("withdrawal is available only for my acceptance before joint completion", () => {
  const { canWithdrawMediationAcceptance } = loadAcceptanceClient(async () => ({}));
  assert.equal(typeof canWithdrawMediationAcceptance, "function");
  assert.equal(canWithdrawMediationAcceptance({
    accepted: true,
    acceptedCount: 1,
    requiredCount: 2,
    completed: false,
  }), true);
  assert.equal(canWithdrawMediationAcceptance({
    accepted: true,
    acceptedCount: 2,
    requiredCount: 2,
    completed: true,
  }), false);
  assert.equal(canWithdrawMediationAcceptance({
    accepted: false,
    acceptedCount: 1,
    requiredCount: 2,
    completed: false,
  }), false);
  assert.equal(canWithdrawMediationAcceptance(null), false);
});

test("a solo account cannot confirm a two-person mediation proposal", () => {
  const { canAcceptMediationResolution } = loadAcceptanceClient(async () => ({}));
  assert.equal(typeof canAcceptMediationResolution, "function");

  assert.equal(canAcceptMediationResolution({
    accepted: false,
    acceptedCount: 0,
    requiredCount: 2,
    completed: false,
    partnerLinked: false,
  }), false);
  assert.equal(canAcceptMediationResolution({
    accepted: false,
    acceptedCount: 0,
    requiredCount: 2,
    completed: false,
    partnerLinked: true,
  }), true);
});

test("a withdrawal response that still marks me accepted fails closed", async () => {
  const { withdrawMediationAcceptance } = loadAcceptanceClient(async () => ({
    accepted: true,
    acceptedCount: 1,
    requiredCount: 2,
    completed: false,
  }));

  await assert.rejects(
    () => withdrawMediationAcceptance(
      "1474c6f2-29c6-4c77-8d91-d3347eef4c3f",
      EXPECTED_REVISION,
    ),
    /확인 취소 응답이 올바르지 않습니다/,
  );
});

test("an inconsistent server response fails closed instead of showing a false joint agreement", async () => {
  const { getMediationAcceptance } = loadAcceptanceClient(async () => ({
    accepted: false,
    acceptedCount: 2,
    requiredCount: 2,
    completed: true,
  }));

  await assert.rejects(
    () => getMediationAcceptance(
      "1474c6f2-29c6-4c77-8d91-d3347eef4c3f",
      EXPECTED_REVISION,
    ),
    /동의 상태 응답이 올바르지 않습니다/,
  );
});

test("the native mediation card describes an AI draft rather than a settled agreement", () => {
  for (const copy of [
    "요청자 요약 기반 조율 초안",
    "요청자가 전한 감정",
    "요청자가 전한 상황",
    "상대방에게 확인할 점",
    "같이 검토할 선택안",
    "파트너가 연결된 뒤 두 분이 각각 확인할 수 있어요",
    "두 분 모두 ‘괜찮음’으로 확인해야 공동 결정으로 저장돼요",
  ]) {
    assert.equal(cardSource.includes(copy), true, `missing non-final copy: ${copy}`);
  }
  assert.doesNotMatch(cardSource, /제안 합의안|이 제안을 합의로 남길까요|공동 합의로 기록/);
});

test("the native card never claims Amora heard both partners", () => {
  // 카드에 담긴 말은 요청한 사람이 쓴 요약뿐이다. 상대의 메시지는 서버가 모델에
  // 보내지도 않는다. 그런데도 "두 분의 대화를 정리했다"고 쓰면, 그 카드를 읽는
  // 상대는 아모라가 양쪽 말을 듣고 저쪽 편을 들었다고 이해한다.
  // 웹 카드는 같은 금지선을 MediationCardContract.test.ts에 걸어 두었는데
  // 앱에는 없어서, 정작 주 제품인 앱만 잘못된 문구를 계속 내보내고 있었다.
  for (const forbidden of ["두 사람이 말한 내용", "두 분의 대화"]) {
    assert.equal(
      cardSource.includes(forbidden),
      false,
      `native mediation card must not claim it heard both partners: ${forbidden}`,
    );
  }

  // 출처 표식이 있을 때만 "요청자" 문구를 쓴다 — 모르면 아는 척하지 않는다.
  assert.match(cardSource, /requesterSummaryOnly/);
  assert.match(cardSource, /확인 출처가 없는 이전 조율 초안/);
});

test("the mediation block keeps the provenance marker the copy depends on", () => {
  const { normalizeMediationBlock } = loadAcceptanceClient(async () => ({}));

  const requesterSummary = normalizeMediationBlock({
    empathy: "감정",
    translation: "상황",
    data: "확인할 점",
    resolution: "선택안",
    origin: "user_requested",
    evidenceScope: "requester_summary_only",
    schemaVersion: 2,
  });
  assert.equal(requesterSummary.requesterSummaryOnly, true);

  // 표식이 하나라도 어긋나면 출처를 알 수 없는 것으로 본다.
  const legacy = normalizeMediationBlock({
    empathy: "감정",
    translation: "상황",
    origin: "user_requested",
    evidenceScope: "requester_summary_only",
    schemaVersion: 1,
  });
  assert.equal(legacy.requesterSummaryOnly, false);

  // 표식만 있고 본문이 없으면 카드가 되지 않는다.
  assert.equal(normalizeMediationBlock({
    origin: "user_requested",
    evidenceScope: "requester_summary_only",
    schemaVersion: 2,
  }), null);
});

const actor='11111111-1111-4111-8111-111111111111', partner='22222222-2222-4222-8222-222222222222', couple='33333333-3333-4333-8333-333333333333';
const mediationRevision={messageId:'44444444-4444-4444-8444-444444444444',...EXPECTED_REVISION};
const responseRow=(choice='ok',patch={})=>({userId:actor,choice,condition:choice==='conditional'?'조건 확인 뒤':null,revision:1,updatedAt:'2026-09-07T00:00:00Z',...patch});
const responseState=(mine=null,theirs=null,patch={})=>({actorId:actor,proposalVersion:EXPECTED_REVISION.expectedProposalVersion,rosterFingerprint:EXPECTED_REVISION.expectedRosterFingerprint,accepted:mine?.choice==='ok',acceptedCount:[mine,theirs].filter(r=>r?.choice==='ok').length,requiredCount:2,completed:false,partnerLinked:true,myResponse:mine,myResponseRevision:mine?.revision??0,responses:[mine,theirs].filter(Boolean),...patch});
const reply=(body,status=200)=>new globalThis.Response(JSON.stringify(body),{status});
const settle=()=>new Promise(done=>globalThis.setTimeout(done,0));
function responseHarness(replies){
 const calls=[],navigation=[],slots=[];let index=0,tree;
 const session=responsesContract.createMediationResponseSession({revision:mediationRevision,readScope:async()=>({ownerId:actor,coupleId:couple}),request:async(scope,path,options)=>{calls.push({scope,path,options});const next=replies.shift();if(next instanceof Error)throw next;return next;}});
 const jsx=(type,props)=>typeof type==='function'?type(props):({type,props});const token=new Proxy({},{get:()=>token});
 const modules={'@/components/ui/AppText':{Text:'Text',TextInput:'TextInput'},react:{useState(initial){const i=index++;slots[i]??={value:initial};return[slots[i].value,value=>{slots[i].value=value}];}},'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{ActivityIndicator:'ActivityIndicator',Pressable:'Pressable',Text:'Text',TextInput:'TextInput',View:'View',StyleSheet:{create:x=>x}},'expo-router':{router:{push:x=>navigation.push(x)}},'@hanbang/design-tokens':{colors:token},'@hanbang/shared/mediation-responses':responsesContract,'@/lib/useMediationResponses':{useMediationResponses:()=>({state:session.getState(),session})}};
 const code=ts.transpileModule(readFileSync(new URL('../components/chat/AmoraMediationResponses.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;const exports={};new Function('exports','require',code)(exports,name=>{assert.ok(modules[name],name);return modules[name];});
 const nodes=x=>!x?[]:Array.isArray(x)?x.flatMap(nodes):typeof x==='object'?[x,...nodes(x.props?.children)]:[];const text=x=>x==null?'':Array.isArray(x)?x.map(text).join(''):typeof x==='object'?text(x.props?.children):String(x);
 const render=()=>{index=0;tree=exports.default({revision:mediationRevision});};render();
 return {session,calls,navigation,render,text:()=>text(tree),nodes:()=>nodes(tree),button:label=>{const node=nodes(tree).find(n=>n.type==='Pressable'&&n.props.accessibilityLabel===label);assert.ok(node,label);return node;},field:label=>nodes(tree).find(n=>n.type==='TextInput'&&n.props.accessibilityLabel===label),press:async label=>{const node=nodes(tree).find(n=>n.type==='Pressable'&&n.props.accessibilityLabel===label);assert.ok(node,label);if(!node.props.disabled)node.props.onPress();await settle();render();}};
}
test('actual native choices require condition, use exact revision, and never make conditional response a decision',async()=>{
 const h=responseHarness([reply(responseState()),reply(responseState(responseRow('conditional'))),reply(responseState(responseRow('ok',{revision:2}))),reply(responseState(null,null,{myResponseRevision:3}))]);await h.session.load();h.render();await h.press('조건부 가능');assert.equal(h.button('내 응답 저장').props.disabled,true);h.field('확인할 조건').props.onChangeText('조건 확인 뒤');h.render();await h.press('내 응답 저장');assert.equal(h.calls.length,2,'reviewed native condition must reach one POST');assert.equal(JSON.parse(h.calls[1].options.body).expectedResponseRevision,0);assert.match(h.text(),/내 응답 · 조건부 가능/);assert.doesNotMatch(h.text(),/공동 결정으로 저장했어요/);
 await h.press('괜찮음');await h.press('내 응답 저장');assert.deepEqual(JSON.parse(h.calls[2].options.body),{...mediationRevision,expectedOwnerId:actor,expectedResponseRevision:1,choice:'ok',condition:null});await h.press('내 응답 취소');assert.equal(JSON.parse(h.calls[3].options.body).expectedResponseRevision,2);assert.equal(h.session.getState().snapshot.myResponse,null);
 assert.ok(h.button('내 응답 저장').props.style[0].minHeight>=48);
});
test('actual native failure and solo states disable writes, while refresh reads joint completion',async()=>{
 const h=responseHarness([reply({}),reply(responseState(null,null,{partnerLinked:false})),reply(responseState(responseRow(),responseRow('ok',{userId:partner}),{completed:true}))]);await h.session.load();h.render();assert.match(h.text(),/확인 상태를 불러오지 못/);assert.ok(h.nodes().some(n=>n.props.accessibilityRole==='alert'));assert.equal(h.nodes().some(n=>n.props.accessibilityLabel==='내 응답 저장'),false);await h.press('확인 상태 새로고침');assert.match(h.text(),/파트너가 연결된 뒤/);await h.press('확인 상태 새로고침');assert.match(h.text(),/두 분이 각각 확인해 공동 결정으로 저장했어요/);assert.equal(h.nodes().some(n=>n.props.accessibilityLabel==='내 응답 취소'),false);
});
test('actual native failed revoke retains receipt and offers refresh before explicit revision retry',async()=>{
 const h=responseHarness([reply(responseState(responseRow())),reply({},503),reply(responseState(responseRow())),reply(responseState(null,null,{myResponseRevision:2}))]);await h.session.load();h.render();await h.press('내 응답 취소');assert.equal(h.session.getState().snapshot.accepted,true);assert.match(h.text(),/응답 결과를 확인하지 못/);await h.press('확인 상태 새로고침');await h.press('내 응답 취소');assert.equal(h.session.getState().snapshot.accepted,false);assert.ok(h.button('확인 상태 새로고침').props.style[0].minHeight>=48);
});
test('actual native shared follow-up requires review and unknown write result only offers the real board',async()=>{
 const h=responseHarness([reply(responseState(responseRow('conditional'))),new Error('network dropped'),reply(responseState())]);await h.session.load();h.render();await h.press('내가 확인할 내용 정리');assert.equal(h.calls.length,1);assert.equal(h.field('확인할 할 일 제목').props.value,'');h.field('확인할 할 일 제목').props.onChangeText('방문 조건 확인');h.render();await h.press('확인하고 공유 할 일 저장');assert.match(h.text(),/저장 결과를 확인하기 전에는 다시 저장하지 않아요/);await h.press('확인 상태 새로고침');assert.equal(h.nodes().some(n=>n.props.accessibilityLabel==='확인하고 공유 할 일 저장'),false);await h.press('준비 보드에서 먼저 확인');assert.deepEqual(h.navigation,['/amora-preparation']);assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1);
});
test('actual native response hook rechecks current roster and invalidates a delayed response on auth events',async()=>{
 let currentActor=actor, currentCouple=couple, currentPartner=partner, authListener;
 let resolveWrite;const pending=new Promise(done=>{resolveWrite=done;});const effects=[],calls=[];
 const tokens={};
 const fakeSupabase={auth:{getUser:async()=>({data:{user:{id:currentActor}},error:null}),onAuthStateChange:callback=>{authListener=callback;return{data:{subscription:{unsubscribe(){}}}};}},from:table=>({select:()=>({eq:()=>({single:async()=>({data:table==='profiles'?{id:currentActor,couple_id:currentCouple}:{id:currentCouple,bride_id:currentActor,groom_id:currentPartner},error:null})})})}),channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel:async()=>{}};
 const modules={react:{useCallback:x=>x,useMemo:x=>x(),useRef:x=>({current:x}),useSyncExternalStore:(_sub,get)=>get(),useEffect:callback=>effects.push(callback)},'react-native':{AppState:{addEventListener:(_name,cb)=>{tokens.foreground=cb;return{remove(){}};}}},'expo-router':{useFocusEffect:()=>{}},'@hanbang/shared/mediation-responses':responsesContract,'./supabase':{supabase:fakeSupabase},'./api':{apiFetchForExpectedUser:async(expected,path,options)=>{calls.push({expected,path,options});return options.method==='POST'?pending:reply(responseState(null,null,{actorId:currentActor}));}}};
 const code=ts.transpileModule(readFileSync(new URL('../lib/useMediationResponses.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exports={};new Function('exports','require',code)(exports,name=>modules[name]);const {session}=exports.useMediationResponses(mediationRevision);const cleanups=effects.map(run=>run());await settle();assert.equal(session.getState().snapshot.actorId,actor);
 const saving=session.respond('ok',null);while(!calls.some(c=>c.options.method==='POST'))await Promise.resolve();currentActor=partner;authListener('SIGNED_IN');resolveWrite(reply(responseState(responseRow('conditional',{condition:'오래된 응답'}))));await saving;await settle();assert.notEqual(session.getState().snapshot?.actorId,actor);
 currentPartner='66666666-6666-4666-8666-666666666666';const before=calls.filter(c=>c.options.method==='POST').length;assert.equal(await session.respond('ok',null),false);assert.equal(calls.filter(c=>c.options.method==='POST').length,before);for(const cleanup of cleanups)cleanup?.();
});
