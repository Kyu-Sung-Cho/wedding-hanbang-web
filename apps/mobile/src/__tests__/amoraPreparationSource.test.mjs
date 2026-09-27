import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';
const source=readFileSync(new URL('../../app/webview.tsx',import.meta.url),'utf8');
const helperPath=new URL('../lib/amoraPreparationSource.ts',import.meta.url);
function compile(text){const module={exports:{}};const code=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('module','exports',code)(module,module.exports);return module.exports;}
const helper=existsSync(helperPath)?compile(readFileSync(helperPath,'utf8')):{};
const tree=ts.createSourceFile('webview.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let callback;const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='handleNavigation')callback=node.initializer.arguments[0].getText(tree);ts.forEachChild(node,visit);};visit(tree);
const declarations=tree.statements.filter(n=>(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(tree)==='WEB_TO_NATIVE'))||(ts.isFunctionDeclaration(n)&&n.name?.text==='nativeRouteForWebPath')).map(n=>n.getText(tree)).join('\n').replace('export function','function');
const code=ts.transpileModule(declarations+'\nconst navigate='+callback,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function runNavigation(url){const routes=[],alerts=[];const bindings={...helper,SITE_ORIGIN:'https://hanbang.ai',normalizeMobileSiteUrl:(value,origin)=>new URL(value).origin===origin?value:null,router:{dismissTo:value=>routes.push(value)},Alert:{alert:(...v)=>alerts.push(v)},setCurrentTitle:()=>{},titleFromUrl:()=>'',canOpenExternally:()=>false,Linking:{openURL:()=>Promise.resolve()}};const navigate=new Function('bindings',`with(bindings){${code};return navigate;}`)(bindings);return {allowed:navigate({url}),routes,alerts};}
test('actual WebView callback preserves exact guide source into native chat',()=>{assert.deepEqual(runNavigation('https://hanbang.ai/wedding/chat?amoraSource=g.gift-money.section-2').routes,['/chat?amoraSource=g.gift-money.section-2']);});
test('source parser rejects duplicate arrays, noncanonical IDs and unknown response properties',()=>{assert.equal(typeof helper.readPreparationSource,'function');for(const bad of [[],['g.gift-money'],['g.gift-money','g.other'],'g.gift-money.section-0','c.venue.bad-id','javascript:bad','g.gift-money.section-1.extra'])assert.equal(helper.readPreparationSource(bad),null);const raw={source:'g.gift-money.section-2',text:'안내를 읽고 질문해요.',sourceLabel:'축의금 · 먼저 확인할 것',sourceHref:'/manners/gift-money#section-2'};assert.deepEqual(helper.parsePreparationDraft(raw,raw.source),raw);for(const wrong of [{...raw,source:'g.gift-money'},{...raw,sourceHref:'https://evil.invalid'},{...raw,referenceText:'extra'},{...raw,text:'x'.repeat(4001)}])assert.equal(helper.parsePreparationDraft(wrong,raw.source),null);});
test('invalid source navigation fails visibly without generic chat fallback',()=>{assert.deepEqual(runNavigation('https://hanbang.ai/wedding/chat?amoraSource=g.gift-money&amoraSource=g.other').routes,[]);assert.equal(runNavigation('https://hanbang.ai/wedding/chat?amoraSource=g.gift-money&amoraSource=g.other').alerts.length,1);});


const chatSource = readFileSync(new URL('../../app/(tabs)/chat.tsx', import.meta.url), 'utf8');
const chatTree = ts.createSourceFile('chat.tsx', chatSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function chatFunction(name) {
  let found;
  const visit = node => {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name?.text === name) found = node.getText(chatTree);
    ts.forEachChild(node, visit);
  };
  visit(chatTree);
  assert.ok(found, `missing actual function ${name}`);
  return found;
}
function loadChatFunctions(names, bindings = {}) {
  const output = ts.transpileModule(names.map(chatFunction).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  // 진행 중인 「대화 화면 정리」가 없는 화면이 기본값이다(그 잠금은 chatViewClearScreen.test.mjs 가 잰다).
  // 대화 칸도 이미 정해진 화면이 기본값이다(2026-09-26 첫 칸 고르기 — 정하기 전 잠금은 amoraLaneChoice.test.mjs 가 잰다).
  return new Function('bindings', `with(bindings){${output};return {${names.join(',')}};}`)({ ...helper, viewClearInFlightRef: { current: null }, laneOpeningRef: { current: 'decided' }, ...bindings });
}
const ingestNames = ['AiMessageIngestError', 'isRecord', 'asToolExecutionResult', 'asChatMessageMetadata', 'normalizeChatVisibility', 'chatMessageFromRealtimeRow', 'parseAiMessageIngestResult', 'parseRetryAfterMs'];
const SOURCE = 'g.gift-money.section-2';
const preview = { source: SOURCE, text: '공개 안내를 읽고 확인할 것을 알려주세요.', sourceLabel: '축의금 · 먼저 확인할 것', sourceHref: '/manners/gift-money#section-2' };
const initialContext = () => ({ ownerId: 'actor-a', coupleId: 'couple-a', generation: 1, lane: 'shared_ai', ready: true, busy: false, input: '' });
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const flush = () => new Promise(resolve => globalThis.setImmediate(resolve));

for (const change of [
  { ownerId: 'actor-b' }, { coupleId: 'couple-b' }, { generation: 3 },
  { lane: 'private_ai' }, { lane: 'shared_partner' }, { input: '내가 쓰던 질문' }, { ready: false }, { busy: true },
]) test(`public preview late response is discarded after ${JSON.stringify(change)}`, async () => {
  const before = initialContext(); let current = { ...before }; const pending = deferred();
  const loading = helper.loadPreparationForContext(SOURCE, before, () => current, () => pending.promise);
  current = { ...current, ...change }; pending.resolve(preview);
  assert.equal(await loading, null);
});
test('public preview requires an empty shared lane before any read and returns exact current data', async () => {
  let reads = 0;
  for (const change of [{ input: 'existing' }, { lane: 'private_ai' }, { lane: 'shared_partner' }, { ownerId: null }, { coupleId: null }, { busy: true }]) {
    const before = { ...initialContext(), ...change };
    assert.equal(await helper.loadPreparationForContext(SOURCE, before, () => before, () => { reads++; return preview; }), null);
  }
  assert.equal(reads, 0);
  const before = initialContext();
  assert.deepEqual(await helper.loadPreparationForContext(SOURCE, before, () => before, () => preview), preview);
});

let actualEffect;
const visitEffect = node => {
  if (ts.isCallExpression(node) && node.expression.getText(chatTree) === 'useEffect' && node.arguments[0]?.getText(chatTree).includes('loadPreparationForContext')) actualEffect = node.arguments[0].getText(chatTree);
  ts.forEachChild(node, visitEffect);
};
visitEffect(chatTree);
assert.ok(actualEffect, 'actual source-consuming effect exists');
const effectCode = ts.transpileModule(`const effect = ${actualEffect}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function effectHarness(overrides = {}) {
  const pending = deferred(); const context = { ...initialContext(), ...overrides };
  let drafts = { shared_ai: context.input, private_ai: '개인 질문', shared_partner: '파트너 질문' };
  let card = null; let notice = null; let generation = 1; let reads = 0;
  const routes = []; const laneMoves = []; const inputRef = { current: drafts }; const contextRef = { current: context };
  const bindings = { ...helper, preparationParam: SOURCE, entryParam: undefined, initialLoaded: true, userId: 'actor-a', coupleId: 'couple-a', chatLoadError: null,
    consumedPreparationRef: { current: null }, preparationContextRef: contextRef, chatSessionGenerationRef: { current: { current: () => generation, isCurrent: value => value === generation } },
    mountedRef: { current: true }, sessionUserIdRef: { current: 'actor-a' }, sendingRef: { current: false }, inputByLaneRef: inputRef,
    amoraSiteOrigin: 'https://hanbang.ai', buildMobileSiteUrl: (path, origin) => origin + path,
    fetch: async (url, options) => { reads++; assert.equal(new URL(url).pathname, '/api/amora/preparation-source'); assert.equal(new URL(url).searchParams.get('source'), SOURCE); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.headers, undefined); return pending.promise; },
    router: { setParams: params => routes.push(params) },
    preparationLaneSwitchRef: { current: null },
    setActiveScope: scope => laneMoves.push(['scope', scope]), setTarget: target => laneMoves.push(['target', target]),
    setPreparationDraft: value => { card = value; }, setPreparationNotice: value => { notice = value; },
    setInputByLane: update => { drafts = update(drafts); }, updateAmoraChatLaneRecord: (values, lane, text) => ({ ...values, [lane]: text }),
  };
  const effect = new Function('bindings', `with(bindings){${effectCode};return effect;}`)(bindings);
  return { start: effect, resolve: value => pending.resolve({ ok: true, text: async () => JSON.stringify(value) }),
    state: () => ({ drafts, card, notice, reads, routes, laneMoves }), setContext: next => { contextRef.current = { ...contextRef.current, ...next }; },
    type: text => { drafts = { ...drafts, shared_ai: text }; inputRef.current = drafts; },
    invalidate: () => { generation += 2; }, bindings };
}
test('actual native effect only fills a verified source draft and never submits or changes other lanes', async () => {
  const h = effectHarness(); const cleanup = h.start(); h.resolve(preview); await flush();
  assert.equal(h.state().reads, 1); assert.equal(h.state().drafts.shared_ai, preview.text);
  assert.equal(h.state().drafts.private_ai, '개인 질문'); assert.equal(h.state().drafts.shared_partner, '파트너 질문');
  assert.equal(h.state().card.source, SOURCE); assert.equal(h.state().notice, null); assert.deepEqual(h.state().routes, [{ amoraSource: undefined }]); cleanup();
});
test('actual native effect preserves typing while the public source is loading', async () => {
  const h = effectHarness(); const cleanup = h.start(); h.type('내가 지금 쓰는 질문'); h.resolve(preview); await flush();
  assert.equal(h.state().drafts.shared_ai, '내가 지금 쓰는 질문'); assert.equal(h.state().card, null); assert.match(h.state().notice, /넣지 않았어요/); cleanup();
});
test('actual native effect blocks ignored-abort completion after owner ABA and disposal', async () => {
  for (const dispose of [false, true]) {
    const h = effectHarness(); const cleanup = h.start(); if (dispose) cleanup(); else h.invalidate();
    h.resolve(preview); await flush(); assert.equal(h.state().card, null); assert.equal(h.state().drafts.shared_ai, ''); assert.equal(h.state().notice, null); cleanup();
  }
});
test('actual native effect does not fetch or overwrite an existing shared draft, and says that is why', async () => {
  const h = effectHarness({ input: 'existing' }); const cleanup = h.start(); await flush();
  assert.equal(h.state().reads, 0); assert.equal(h.state().card, null); assert.equal(h.state().drafts.shared_ai, 'existing');
  assert.match(h.state().notice, /함께 대화에서 아모라에게 쓰던 질문이 있어서 안내 질문을 넣지 않았어요/); cleanup();
});
// 2026-09-15: 체크리스트 시트의 아모라 버튼·예절 안내 링크를 눌렀는데 마지막에 나만 (상담)이나 상대와의
// 대화에 있었으면 아무것도 채우지 않고 "함께 대화의 작성 중인 질문을…" 이라는 틀린 알림만 떴다.
for (const lane of ['private_ai', 'shared_partner', null]) {
  test(`actual native effect moves from ${lane} to the shared Amora lane and fills there without touching other drafts`, async () => {
    const h = effectHarness({ lane }); h.start(); await flush();
    // 첫 실행은 레인만 옮긴다 — 아직 읽지도 채우지도 않고, 주소의 안내 ID도 남겨 둔다.
    assert.deepEqual(h.state().laneMoves, [['scope', 'shared'], ['target', 'ai']]);
    assert.equal(h.state().reads, 0); assert.equal(h.state().notice, null); assert.deepEqual(h.state().routes, []);
    // 레인이 바뀌면 React 가 이 효과를 다시 돌린다.
    h.setContext({ lane: 'shared_ai' }); const cleanup = h.start(); h.resolve(preview); await flush();
    assert.equal(h.state().reads, 1); assert.equal(h.state().drafts.shared_ai, preview.text); assert.equal(h.state().card.source, SOURCE);
    assert.equal(h.state().drafts.private_ai, '개인 질문'); assert.equal(h.state().drafts.shared_partner, '파트너 질문');
    assert.equal(h.state().notice, null); assert.deepEqual(h.state().routes, [{ amoraSource: undefined }]); cleanup();
  });
}
test('actual native effect in another lane with a shared draft shows that draft instead of overwriting it', async () => {
  const h = effectHarness({ lane: 'private_ai', input: '함께 대화에 쓰던 질문' }); h.start(); await flush();
  assert.equal(h.state().reads, 0); assert.equal(h.state().card, null);
  assert.equal(h.state().drafts.shared_ai, '함께 대화에 쓰던 질문'); assert.equal(h.state().drafts.private_ai, '개인 질문');
  assert.deepEqual(h.state().laneMoves, [['scope', 'shared'], ['target', 'ai']]);
  assert.match(h.state().notice, /함께 대화에서 아모라에게 쓰던 질문이 있어서 안내 질문을 넣지 않았어요/);
  assert.deepEqual(h.state().routes, [{ amoraSource: undefined }]);
  // 레인이 바뀌어 다시 돌아도 읽거나 채우지 않는다.
  h.setContext({ lane: 'shared_ai' }); h.start(); await flush();
  assert.equal(h.state().reads, 0); assert.equal(h.state().drafts.shared_ai, '함께 대화에 쓰던 질문');
});
test('actual native effect does not switch lanes while a message is on its way, and says so', async () => {
  const h = effectHarness({ lane: 'private_ai', busy: true }); const cleanup = h.start(); await flush();
  assert.deepEqual(h.state().laneMoves, []); assert.equal(h.state().reads, 0); assert.equal(h.state().card, null);
  assert.equal(h.state().drafts.private_ai, '개인 질문'); assert.match(h.state().notice, /보내거나 답을 받는 중이라/); cleanup();
});
test('actual native effect tries the lane move once and fails visibly if the lane did not change', async () => {
  const h = effectHarness({ lane: 'private_ai' }); h.start(); await flush();
  const cleanup = h.start(); await flush();
  assert.equal(h.state().laneMoves.length, 2); assert.equal(h.state().reads, 0); assert.equal(h.state().card, null);
  assert.equal(h.state().drafts.private_ai, '개인 질문'); assert.match(h.state().notice, /넣지 않았어요/); cleanup();
});
test('actual native effect fails closed for a wrong-source public response', async () => {
  const h = effectHarness(); const cleanup = h.start(); h.resolve({ ...preview, source: 'g.gift-money' }); await flush();
  assert.equal(h.state().card, null); assert.equal(h.state().drafts.shared_ai, ''); assert.ok(h.state().notice); cleanup();
});

function ingestFixture() {
  const expected = { coupleId: '11111111-1111-4111-8111-111111111111', userId: '22222222-2222-4222-8222-222222222222', senderType: 'bride', text: preview.text, clientRequestId: '33333333-3333-4333-8333-333333333333', target: 'ai', providerAttachmentCount: 0, preparationSource: SOURCE };
  const message = { id: '44444444-4444-4444-8444-444444444444', couple_id: expected.coupleId, sender_id: expected.userId, role: 'user', sender_type: 'bride', content: expected.text, visibility: 'shared', created_at: '2026-09-08T00:00:00Z', metadata: { client_request_id: expected.clientRequestId, amora_ingest_contract_version: 1, ai_response_requested: true, provider_attachment_state: 'none', provider_attachment_count: 0, preparation_source: SOURCE } };
  const payload = { outcome: 'persisted', reused: false, effectiveVisibility: 'shared', safetyPrivacyRedirected: false, message };
  return { expected, message, payload };
}
test('actual ingest validates exact durable source and rejects substituted or missing source receipts', () => {
  const { parseAiMessageIngestResult: parse } = loadChatFunctions(ingestNames);
  const { expected, payload } = ingestFixture();
  assert.equal(parse(201, payload, expected).message.metadata.preparation_source, SOURCE);
  for (const wrong of [undefined, 'g.gift-money', ['g.gift-money'], 1]) {
    assert.throws(() => parse(201, { ...payload, message: { ...payload.message, metadata: { ...payload.message.metadata, preparation_source: wrong } } }, expected));
  }
});
test('actual ingest permits safety-private redirection only after the public source is removed', () => {
  const { parseAiMessageIngestResult: parse } = loadChatFunctions(ingestNames);
  const { expected, payload } = ingestFixture();
  const redirected = { ...payload, effectiveVisibility: 'bride_private', safetyPrivacyRedirected: true, safetyResolution: 'non_immediate_safety', message: { ...payload.message, visibility: 'bride_private', metadata: { ...payload.message.metadata, preparation_source: undefined } } };
  assert.equal(parse(201, redirected, expected).message.visibility, 'bride_private');
  assert.throws(() => parse(201, { ...redirected, message: { ...redirected.message, metadata: { ...redirected.message.metadata, preparation_source: SOURCE } } }, expected));
});
test('actual ingest POST sends only source ID and returns the same canonical source without reference text', async () => {
  const { expected, payload } = ingestFixture(); let body;
  const api = loadChatFunctions([...ingestNames, 'requestAiMessageIngest'], {
    supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-token', user: { id: expected.userId } } } }) } },
    API_BASE: 'https://synthetic.invalid', CHAT_INGEST_TIMEOUT_MS: 1000,
    fetch: async (_url, options) => { body = JSON.parse(options.body); return { status: 201, json: async () => payload, headers: { get: () => null } }; },
  });
  const result = await api.requestAiMessageIngest({ ...expected, requestedVisibility: 'shared', visibility: 'shared' }, () => true);
  assert.equal(body.preparationSource, SOURCE); assert.equal(body.referenceText, undefined); assert.equal(body.sourceLabel, undefined);
  assert.equal(result.message.metadata.preparation_source, SOURCE);
});
test('actual cold-start recovery preserves source and refuses private, malformed or different-owner recovery', () => {
  const { findColdStartAiRecovery: recover } = loadChatFunctions(['isRecord', 'findColdStartAiRecovery']);
  const { expected, message } = ingestFixture(); const context = { coupleId: expected.coupleId, userId: expected.userId, senderType: 'bride', visibility: 'shared' };
  assert.equal(recover([message], context).preparationSource, SOURCE);
  for (const bad of ['g.gift-money.section-0', '', ['g.gift-money'], null]) assert.equal(recover([{ ...message, metadata: { ...message.metadata, preparation_source: bad } }], context), null);
  assert.equal(recover([message], { ...context, userId: 'other' }), null);
  assert.equal(recover([{ ...message, visibility: 'bride_private' }], { ...context, visibility: 'bride_private' }), null);
});
test('actual durable retry cannot reuse a row whose source was removed or replaced', async () => {
  const { expected, message } = ingestFixture(); let row = message;
  const query = new Proxy({}, { get: (_target, key) => key === 'maybeSingle' ? async () => ({ data: row }) : () => query });
  const { findDurableUserMessage: find } = loadChatFunctions([...ingestNames, 'findDurableUserMessage'], { supabase: { from: () => query } });
  const draft = { ...expected, visibility: 'shared' };
  assert.equal((await find(draft, 'ai')).id, message.id);
  for (const bad of [undefined, 'g.gift-money']) {
    row = { ...message, metadata: { ...message.metadata, preparation_source: bad } };
    assert.equal(await find(draft, 'ai'), null);
  }
});


test('ambiguous native source plus entry preserves the existing entry path and never attaches a source', async () => {
  const h = effectHarness(); h.bindings.entryParam = 'lounge_fab'; const cleanup = h.start(); h.type('라운지 질문'); await flush();
  assert.equal(h.state().reads, 0); assert.equal(h.state().card, null); assert.equal(h.state().drafts.shared_ai, '라운지 질문'); cleanup();
});
test('actual canonical send and response retry keep shared source, but strip source after safety-private ingest', async () => {
  for (const redirected of [false, true]) {
    const { expected, message } = ingestFixture();
    const canonical = redirected ? { ...message, visibility: 'bride_private', metadata: { ...message.metadata, preparation_source: undefined } } : message;
    const requests = []; const failures = []; let stored = [];
    const draft = { ...expected, sourceLane: 'shared_ai', requestedVisibility: 'shared', visibility: 'shared', sessionGeneration: 1, senderName: '합성' };
    const bindings = {
      isCurrentChatSession: () => true, setStreaming: () => {}, setLaneFailure: (_lane, failure) => failures.push(failure),
      requestAiMessageIngest: async (_draft, guard) => { assert.equal(guard, bindings.isCurrentChatSession); return { outcome: 'persisted', message: canonical, safetyPrivacyRedirected: redirected }; },
      messages: [], isMessageInAiContext: () => true, setActiveScope: () => {}, setTarget: () => {},
      setMessages: update => { stored = update(stored); }, setInputByLane: update => update({ shared_ai: draft.text, private_ai: '', shared_partner: '' }),
      updateAmoraChatLaneRecord: (values, lane, text) => ({ ...values, [lane]: text }),
      streamAiRequest: async request => { requests.push(request); },
    };
    const { sendAiDraft } = loadChatFunctions(['AiMessageIngestError', 'aiLaneForVisibility', 'getAiMessageIngestFailureMessage', 'sendAiDraft'], bindings);
    await sendAiDraft(draft, false);
    assert.equal(requests.length, 1, JSON.stringify(failures));
    assert.equal(requests[0].body.preparationSource, redirected ? undefined : SOURCE);
    assert.equal(requests[0].body.visibility, redirected ? 'bride_private' : 'shared');
    const retryRequests = [];
    const { handleRetry } = loadChatFunctions(['handleRetry'], { activeSendFailure: { kind: 'ai_response', canRetry: true, request: requests[0] }, activeLane: requests[0].lane, streaming: false, sendingRef: { current: false }, isCurrentChatSession: () => true, streamAiRequest: async request => retryRequests.push(request) });
    await handleRetry();
    assert.deepEqual(retryRequests, requests, 'retry reuses the canonical request, not the pre-ingest draft');
  }
});


test('actual explicit send attaches source only to the same owner/couple/generation shared lane', async () => {
  for (const scenario of ['shared', 'private', 'partner', 'owner', 'couple', 'aba']) {
    const calls = []; const current = initialContext(); const context = { ...current };
    if (scenario === 'owner') context.ownerId = 'previous';
    if (scenario === 'couple') context.coupleId = 'previous';
    if (scenario === 'aba') context.generation = 0;
    const visibility = scenario === 'private' ? 'bride_private' : 'shared';
    const bindings = {
      input: preview.text, activeScope: scenario === 'private' ? 'private' : 'shared', userRole: 'bride',
      chatVisibilityForScope: () => visibility, streaming: false, sendingRef: { current: false }, initialLoaded: true, chatLoadError: null,
      coupleId: 'couple-a', userId: 'actor-a', userName: '합성', activeLane: scenario === 'private' ? 'private_ai' : scenario === 'partner' ? 'shared_partner' : 'shared_ai', target: scenario === 'partner' ? 'partner' : 'ai',
      planAmoraCrisisDelivery: () => ({ effectiveVisibility: visibility, disposition: 'allow' }),
      linkedPartnerIdRef: { current: 'partner' }, hasLinkedPartnerRef: { current: true },
      chatSessionGenerationRef: { current: { current: () => 1 } }, isCurrentChatSession: () => true,
      setLaneFailure: () => {}, setColdStartAiRecoveryByLane: () => {}, setFollowUpSuggestions: () => {}, Crypto: { randomUUID: () => 'synthetic-request' },
      preparationDraft: { ...preview, context }, preparationContextRef: { current },
      sendAiDraft: async draft => calls.push(draft), sendPartnerDraft: async draft => calls.push(draft),
    };
    const { handleSend } = loadChatFunctions(['aiLaneForVisibility', 'handleSend'], bindings);
    await handleSend(); assert.equal(calls.length, 1);
    assert.equal(calls[0].preparationSource, scenario === 'shared' ? SOURCE : undefined, scenario);
  }
});
test('actual cold-start button carries the stored source into immutable durable retry', async () => {
  const { expected, message } = ingestFixture();
  const { findColdStartAiRecovery } = loadChatFunctions(['isRecord', 'findColdStartAiRecovery']);
  const recovery = findColdStartAiRecovery([message], { coupleId: expected.coupleId, userId: expected.userId, senderType: 'bride', visibility: 'shared' });
  const calls = [];
  const { handleColdStartAiRecovery } = loadChatFunctions(['handleColdStartAiRecovery'], {
    activeColdStartAiRecovery: recovery, streaming: false, sendingRef: { current: false }, coupleId: expected.coupleId, userId: expected.userId, userRole: 'bride', userName: '합성',
    chatSessionGenerationRef: { current: { current: () => 1 } }, isCurrentChatSession: () => true,
    setColdStartAiRecoveryByLane: () => {}, setActiveScope: () => {}, setTarget: () => {}, sendAiDraft: async (...args) => calls.push(args),
  });
  await handleColdStartAiRecovery(); assert.equal(calls.length, 1);
  assert.equal(calls[0][0].preparationSource, SOURCE); assert.equal(calls[0][0].durableUserMessageId, message.id); assert.equal(calls[0][0].clientRequestId, expected.clientRequestId); assert.equal(calls[0][1], true);
});


for (const scenario of ['owner-switch', 'owner-ABA']) test(`actual ingest does not POST after pending session ${scenario}`, async () => {
  const { expected, payload } = ingestFixture(); const pending = deferred(); let posts = 0; let currentGeneration = 1;
  const api = loadChatFunctions([...ingestNames, 'requestAiMessageIngest'], {
    supabase: { auth: { getSession: () => pending.promise } }, API_BASE: 'https://synthetic.invalid', CHAT_INGEST_TIMEOUT_MS: 1000,
    fetch: async () => { posts++; return { status: 201, json: async () => payload, headers: { get: () => null } }; },
  });
  const request = api.requestAiMessageIngest({ ...expected, sessionGeneration: 1, requestedVisibility: 'shared', visibility: 'shared' }, value => value === currentGeneration);
  if (scenario === 'owner-ABA') currentGeneration = 3;
  pending.resolve({ data: { session: { access_token: 'synthetic-token', user: { id: scenario === 'owner-switch' ? 'other-actor' : expected.userId } } } });
  await assert.rejects(request, error => error.serverCode === 'AUTH_CONTEXT_CHANGED');
  assert.equal(posts, 0, 'wrong-owner or stale-generation draft must not reach the server');
});


test('actual partner sender passes its live generation guard to the same owner-checked ingest', async () => {
  const { expected, message } = ingestFixture(); const calls = []; const failures = [];
  const draft = { ...expected, target: 'partner', preparationSource: undefined, partnerRecipientId: 'partner', visibility: 'shared', sessionGeneration: 1 };
  const guard = () => true;
  const { sendPartnerDraft } = loadChatFunctions(['AiMessageIngestError', 'getAiMessageIngestFailureMessage', 'sendPartnerDraft'], {
    isCurrentChatSession: guard, hasLinkedPartnerRef: { current: true }, linkedPartnerIdRef: { current: 'partner' },
    setStreaming: () => {}, setLaneFailure: (_lane, value) => failures.push(value), verifyPartnerDraftRecipient: async () => 'linked',
    requestAiMessageIngest: async (received, callback) => { assert.equal(callback, guard); calls.push(received); return { outcome: 'persisted', message }; },
    setMessages: () => {}, setInputByLane: () => {},
  });
  await sendPartnerDraft(draft); assert.equal(calls.length, 1, JSON.stringify(failures)); assert.equal(calls[0], draft);
});
