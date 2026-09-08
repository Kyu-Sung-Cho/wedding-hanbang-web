// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MediationCard from '../MediationCard';

const auth=vi.hoisted(()=>({value:{isInitialized:true,isDemo:false,user:{id:'11111111-1111-4111-8111-111111111111'},profile:{id:'11111111-1111-4111-8111-111111111111',couple_id:'33333333-3333-4333-8333-333333333333'},couple:{bride_id:'11111111-1111-4111-8111-111111111111',groom_id:'22222222-2222-4222-8222-222222222222'}},listeners:new Set<()=>void>()}));
vi.mock('@/stores/authStore',async()=>{
  const {useSyncExternalStore}=await import('react');
  const subscribe=(listener:()=>void)=>{auth.listeners.add(listener);return()=>{auth.listeners.delete(listener);};};
  return {useAuthStore:Object.assign((selector:(s:typeof auth.value)=>unknown)=>useSyncExternalStore(subscribe,()=>selector(auth.value),()=>selector(auth.value)),{getState:()=>auth.value,subscribe})};
});
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const owner='11111111-1111-4111-8111-111111111111',partner='22222222-2222-4222-8222-222222222222';
const MESSAGE_ID='1474c6f2-29c6-4c77-8d91-d3347eef4c3f';
const DRAFT={empathy:'요청자가 답답함을 느꼈다고 전했어요.',translation:'요청자가 예산 기준을 먼저 정하고 싶다고 전했어요.',data:'상대방의 예산 상한은 아직 확인되지 않았어요.',resolution:'예산 상한선을 같이 확인해 봐요',origin:'user_requested' as const,evidenceScope:'requester_summary_only' as const,schemaVersion:2 as const};
const BLOCK={...DRAFT,proposalVersion:'123e4567-e89b-42d3-a456-426614174000',rosterFingerprint:'0123456789abcdef0123456789abcdef'};
const row=(choice:'ok'|'conditional'|'difficult'='ok',patch:Record<string,unknown>={})=>({userId:owner,choice,condition:choice==='conditional'?'방문 후 확인':null,revision:1,updatedAt:'2026-09-07T00:00:00Z',...patch});
const snapshot=(mine:ReturnType<typeof row>|null=null,theirs:ReturnType<typeof row>|null=null,patch:Record<string,unknown>={})=>({actorId:owner,proposalVersion:BLOCK.proposalVersion,rosterFingerprint:BLOCK.rosterFingerprint,accepted:mine?.choice==='ok',acceptedCount:[mine,theirs].filter(r=>r?.choice==='ok').length,requiredCount:2,completed:false,partnerLinked:true,myResponse:mine,myResponseRevision:mine?.revision??0,responses:[mine,theirs].filter(Boolean),...patch});
const response=(body:unknown,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body}) as Response;
const flush=async()=>{await act(async()=>{await new Promise(done=>setTimeout(done,0));});};

describe('actual mediation response controls',()=>{
 let container:HTMLDivElement;let root:Root;
 beforeEach(()=>{auth.value={...auth.value,user:{id:owner},profile:{id:owner,couple_id:'33333333-3333-4333-8333-333333333333'}};container=document.createElement('div');document.body.append(container);root=createRoot(container);});
 afterEach(async()=>{await act(async()=>root.unmount());document.body.replaceChildren();vi.unstubAllGlobals();});
 const render=async(block:typeof DRAFT=BLOCK)=>{await act(async()=>root.render(createElement(MediationCard,{block,messageId:MESSAGE_ID})));await flush();};
 const button=(name:string)=>{const found=Array.from(container.querySelectorAll('button')).find(b=>b.textContent===name);expect(found,`button ${name}`).toBeDefined();return found!;};
 const click=async(name:string)=>{await act(async()=>button(name).click());await flush();};
 const input=async(label:string,value:string)=>{const node=container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement|HTMLTextAreaElement;expect(node).not.toBeNull();await act(async()=>{const prototype=node.tagName==='INPUT'?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));});};
 it('keeps AI message provenance and exact revision wiring',()=>{
  const source=readFileSync(resolve(process.cwd(),'src/components/app/chat/ChatBubble.tsx'),'utf8');const start=source.indexOf('if (sender_role === "ai")');const end=source.indexOf('// 사용자 메시지',start);expect(start).toBeGreaterThanOrEqual(0);expect(end).toBeGreaterThan(start);const branch=source.slice(start,end);
  expect(branch).toContain('normalizeMediationBlock(message.metadata?.mediation)');expect(branch).not.toContain('as MediationBlock');expect(branch).toContain('key={`${message.id}:${mediationBlock.proposalVersion ?? "draft"}:${mediationBlock.rosterFingerprint ?? "unknown-roster"}`}');expect(branch).toMatch(/<MediationCard[\s\S]*messageId=\{message.id\}/);
 });
 it('shows unconfirmed requester provenance and legacy content without opening the network',async()=>{const fetch=vi.fn();vi.stubGlobal('fetch',fetch);await render(DRAFT);expect(container.textContent).toContain('상대방의 생각은 아직 확인되지 않았어요');expect(container.textContent).not.toContain('두 분의 대화');expect(fetch).not.toHaveBeenCalled();await render({resolution:'이전 초안'} as typeof DRAFT);expect(container.textContent).toContain('확인 출처가 없는 이전 조율 초안');expect(fetch).not.toHaveBeenCalled();});
 it('requires reviewed condition then sends exact owner and revision without claiming shared completion',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(response(snapshot())).mockResolvedValueOnce(response(snapshot(row('conditional'))));vi.stubGlobal('fetch',fetch);await render();await click('조건부 가능');expect(button('내 응답 저장').disabled).toBe(true);await input('확인할 조건','방문 후 확인');await click('내 응답 저장');
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({messageId:MESSAGE_ID,expectedProposalVersion:BLOCK.proposalVersion,expectedRosterFingerprint:BLOCK.rosterFingerprint,expectedOwnerId:owner,expectedResponseRevision:0,choice:'conditional',condition:'방문 후 확인'});expect(container.textContent).toContain('내 응답 · 조건부 가능');expect(container.textContent).not.toContain('공동 결정으로 저장했어요');
 });
 it('allows difficult, condition editing and explicit ok transition only with a new revision',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(response(snapshot(row('conditional')))).mockResolvedValueOnce(response(snapshot(row('difficult',{condition:'지금은 어려워요',revision:2})))).mockResolvedValueOnce(response(snapshot(row('ok',{revision:3}))));vi.stubGlobal('fetch',fetch);await render();await click('어려움');await input('어려운 점','지금은 어려워요');await click('내 응답 저장');expect(JSON.parse(fetch.mock.calls[1][1].body).expectedResponseRevision).toBe(1);expect(container.textContent).not.toContain('공동 결정으로 저장했어요');await click('괜찮음');await click('내 응답 저장');expect(JSON.parse(fetch.mock.calls[2][1].body)).toMatchObject({choice:'ok',condition:null,expectedResponseRevision:2});
 });
 it('revokes own response using current revision and does not expose cancellation after joint completion',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(response(snapshot(row()))).mockResolvedValueOnce(response(snapshot(null,null,{myResponseRevision:2}))).mockResolvedValueOnce(response(snapshot(row('ok',{revision:3}),row('ok',{userId:partner}),{completed:true})));vi.stubGlobal('fetch',fetch);await render();await click('내 응답 취소');expect(JSON.parse(fetch.mock.calls[1][1].body).expectedResponseRevision).toBe(1);expect(container.textContent).not.toContain('내 응답 · 괜찮음');await click('확인 상태 새로고침');expect(container.textContent).toContain('두 분이 각각 확인해 공동 결정으로 저장했어요');expect(container.textContent).not.toContain('내 응답 취소');
 });
 it('refreshes canonical conflict state instead of applying the attempted response',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(response(snapshot())).mockResolvedValueOnce(response({},409)).mockResolvedValueOnce(response(snapshot(row('difficult'))));vi.stubGlobal('fetch',fetch);await render();await click('괜찮음');await click('내 응답 저장');expect(fetch).toHaveBeenCalledTimes(3);expect(container.textContent).toContain('내 응답 · 어려움');expect(container.querySelector('[role="alert"]')?.textContent).toContain('다시 확인');
 });
 it('distinguishes malformed state and solo accounts from an actionable empty response',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(response({})).mockResolvedValueOnce(response(snapshot(null,null,{partnerLinked:false})));vi.stubGlobal('fetch',fetch);await render();expect(container.querySelector('[role="alert"]')?.textContent).toContain('불러오지 못');expect(container.textContent).not.toContain('내 응답 저장');await click('확인 상태 새로고침');expect(container.textContent).toContain('파트너가 연결된 뒤');expect(container.textContent).not.toContain('내 응답 저장');
 });
 it('drops a late response after owner A-B-A without displaying the old condition',async()=>{
  let resolveReply!:(value:Response)=>void;const pending=new Promise<Response>(done=>{resolveReply=done;});const fetch=vi.fn().mockReturnValueOnce(pending).mockResolvedValue(response(snapshot()));vi.stubGlobal('fetch',fetch);await render();await act(async()=>{auth.value={...auth.value,user:{id:partner},profile:{...auth.value.profile,id:partner}};for(const l of auth.listeners)l();auth.value={...auth.value,user:{id:owner},profile:{...auth.value.profile,id:owner}};for(const l of auth.listeners)l();});resolveReply(response(snapshot(row('conditional',{condition:'오래된 개인 응답'}))));await flush();expect(container.textContent).not.toContain('오래된 개인 응답');
 });
 it('reviews a separate shared task and navigates to the actual board only after exact receipt',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(response(snapshot(row('conditional')))).mockResolvedValueOnce(response({action:{id:'action-1',title:'계약 조건 확인',description:'방문 후 확인',status:'open',source:'manual',href:'/chat'}},201));vi.stubGlobal('fetch',fetch);await render();await click('내가 확인할 내용 정리');expect(fetch).toHaveBeenCalledTimes(1);await input('확인할 할 일 제목','계약 조건 확인');await click('확인하고 공유 할 일 저장');expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({expectedOwnerId:owner,expectedCoupleId:'33333333-3333-4333-8333-333333333333',title:'계약 조건 확인',description:'방문 후 확인',source:'manual'});expect(container.querySelector('a[href="/wedding/chat/board?view=tasks"]')).not.toBeNull();expect(container.textContent).toContain('공유 할 일에 저장했어요');
 });
 it('unknown task outcome shows the board link and prohibits repeated save',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(response(snapshot())).mockRejectedValueOnce(new Error('dropped')).mockResolvedValue(response(snapshot()));vi.stubGlobal('fetch',fetch);await render();await click('내가 확인할 내용 정리');await input('확인할 할 일 제목','한번만 확인');await click('확인하고 공유 할 일 저장');expect(container.textContent).toContain('공유 할 일에서 먼저 확인');expect(container.querySelector('a[href="/wedding/chat/board?view=tasks"]')).not.toBeNull();expect(container.textContent).not.toContain('확인하고 공유 할 일 저장');await click('확인 상태 새로고침');expect(container.textContent).not.toContain('확인하고 공유 할 일 저장');expect(fetch.mock.calls.filter(call=>call[1].method==='POST')).toHaveLength(1);
 });
 it('cancellation conflict reloads a completed decision and leaves no revoke button',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(response(snapshot(row()))).mockResolvedValueOnce(response({},409)).mockResolvedValueOnce(response(snapshot(row(),row('ok',{userId:partner}),{completed:true})));vi.stubGlobal('fetch',fetch);await render();await click('내 응답 취소');expect(fetch).toHaveBeenCalledTimes(3);expect(fetch.mock.calls[1][1].method).toBe('DELETE');expect(container.textContent).toContain('두 분이 각각 확인해 공동 결정으로 저장했어요');expect(container.textContent).not.toContain('내 응답 취소');expect(container.querySelector('[role="alert"]')).not.toBeNull();
 });

});