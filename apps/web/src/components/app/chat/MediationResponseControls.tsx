"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import { useAuthStore } from '@/stores/authStore';
import { weddingPath } from '@/lib/weddingPaths';
import { createMediationResponseSession, mediationChoiceLabels, type MediationChoice, type MediationResponseRevision } from '@hanbang/shared/mediation-responses';

function identityKey() {
  const auth=useAuthStore.getState();
  return auth.isInitialized&&!auth.isDemo&&auth.user?.id===auth.profile?.id
    ? [auth.user?.id,auth.profile?.couple_id,auth.couple?.bride_id,auth.couple?.groom_id].join(':') : '';
}

export default function MediationResponseControls({ revision }: { revision: MediationResponseRevision }) {
  const identity=useAuthStore(identityKey);
  const {messageId,expectedProposalVersion,expectedRosterFingerprint}=revision;
  const session=useMemo(()=>createMediationResponseSession({
    revision:{messageId,expectedProposalVersion,expectedRosterFingerprint},
    readScope:async()=>{const auth=useAuthStore.getState();return identityKey()===identity&&auth.user?.id&&auth.profile?.couple_id ? {ownerId:auth.user.id,coupleId:auth.profile.couple_id}:null;},
    request:async(_scope,path,options)=>fetch(path,{...options,credentials:'same-origin',cache:'no-store'}),
  }),[identity,messageId,expectedProposalVersion,expectedRosterFingerprint]);
  const state=useSyncExternalStore(session.subscribe,session.getState,session.getState);
  useEffect(()=>{
    const stop=useAuthStore.subscribe(()=>{if(identityKey()!==identity)session.invalidate();});
    if(identity)void session.load();
    return()=>{stop();session.invalidate();};
  },[identity,session]);
  useEffect(()=>{const refresh=()=>{if(document.visibilityState==='visible')void session.load();};window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[session]);
  return <ResponseForm key={`${identity}:${messageId}:${expectedProposalVersion}:${expectedRosterFingerprint}`} state={state} session={session} connected={Boolean(identity)} />;
}

function ResponseForm({state,session,connected}:{state:ReturnType<ReturnType<typeof createMediationResponseSession>['getState']>;session:ReturnType<typeof createMediationResponseSession>;connected:boolean}) {
  const [choice,setChoice]=useState<MediationChoice|null>(null);
  const [condition,setCondition]=useState('');
  const [editing,setEditing]=useState(false);
  const [taskOpen,setTaskOpen]=useState(false);
  const [title,setTitle]=useState('');
  const [description,setDescription]=useState('');
  const snapshot=state.snapshot;
  const currentChoice=editing?choice:snapshot?.myResponse?.choice??null;
  const currentCondition=editing?condition:snapshot?.myResponse?.condition??'';
  const disabled=state.loading||state.busy;
  async function save(){if(currentChoice&&await session.respond(currentChoice,currentChoice==='ok'?null:currentCondition))setEditing(false);}
  return <div className="space-y-3 border-t border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)] px-4 py-3.5" aria-live="polite">
    <p className="text-sm font-semibold text-[var(--hb-text-strong)]">이 선택안에 대한 내 응답</p>
    <p className="text-xs leading-relaxed text-[var(--hb-text-muted)]">조건과 어려운 점도 서로 볼 수 있어요. 두 분 모두 ‘괜찮음’으로 확인해야 공동 결정으로 저장돼요.</p>
    {!connected&&<p className="text-sm">실제 계정으로 연결한 뒤 응답할 수 있어요.</p>}
    {state.loading&&<p className="text-sm">확인 상태를 불러오는 중이에요</p>}
    {state.error&&<p role="alert" className="text-sm text-red-700">{state.error}</p>}
    {state.taskUnknown&&<p className="text-sm">저장 결과를 확인하기 전에는 다시 저장하지 않아요. <Link href={weddingPath('/chat/board?view=tasks')} className="underline">공유 할 일에서 먼저 확인</Link></p>}
    {snapshot&&<>
      {snapshot.responses.map(item=><div key={item.userId} className="rounded-[6px] bg-[var(--hb-surface-hover)] p-3 text-sm text-[var(--hb-text-body)]"><p className="font-semibold">{item.userId===snapshot.actorId?'내 응답':'상대방 응답'} · {mediationChoiceLabels[item.choice]}</p>{item.condition&&<p className="mt-1 whitespace-pre-wrap break-words">{item.condition}</p>}</div>)}
      {snapshot.completed?<p className="text-sm font-semibold text-[var(--hb-success)]">두 분이 각각 확인해 공동 결정으로 저장했어요</p>:!snapshot.partnerLinked?<p className="text-sm">파트너가 연결된 뒤 두 분이 각각 확인할 수 있어요</p>:<>
        {snapshot.accepted&&<p className="text-sm">내가 확인했어요 · 상대방 확인을 기다리고 있어요</p>}
        <div role="group" aria-label="내 응답 선택" className="grid grid-cols-1 gap-2 sm:grid-cols-3">{(Object.keys(mediationChoiceLabels) as MediationChoice[]).map(value=><Button key={value} variant={currentChoice===value?'primary':'secondary'} aria-pressed={currentChoice===value} disabled={disabled} onClick={()=>{setChoice(value);setCondition(currentCondition);setEditing(true);}}>{mediationChoiceLabels[value]}</Button>)}</div>
        {(currentChoice==='conditional'||currentChoice==='difficult')&&<label className="block text-sm">{currentChoice==='conditional'?'확인할 조건 (필수)':'어려운 점 (선택)'}<textarea aria-label={currentChoice==='conditional'?'확인할 조건':'어려운 점'} value={currentCondition} disabled={disabled} maxLength={500} rows={3} onChange={event=>{setChoice(currentChoice);setCondition(event.target.value);setEditing(true);}} className="mt-2 w-full resize-y rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)] p-3 text-sm" /></label>}
        <Button fullWidth loading={state.busy} disabled={disabled||!currentChoice||(currentChoice==='conditional'&&!currentCondition.trim())} onClick={()=>void save()}>내 응답 저장</Button>
        {snapshot.myResponse&&<Button fullWidth variant="secondary" disabled={disabled} onClick={()=>void session.revoke().then(saved=>{if(saved){setEditing(false);setChoice(null);setCondition('');}})}>내 응답 취소</Button>}
        <p className="text-xs text-[var(--hb-text-muted)]">{snapshot.acceptedCount}/2명 괜찮음 · 조건부 가능과 어려움은 공동 확정이 아니에요.</p>
      </>}
      {state.taskUnknown?null:state.taskSaved?<p className="text-sm">공유 할 일에 저장했어요. <Link href={weddingPath('/chat/board?view=tasks')} className="underline">공유 할 일 보기</Link></p>:!taskOpen?<Button variant="secondary" fullWidth disabled={disabled} onClick={()=>{setTaskOpen(true);setDescription(snapshot.myResponse?.condition??'');}}>내가 확인할 내용 정리</Button>:<div className="space-y-3 rounded-[6px] border border-[var(--hb-hairline)] p-3">
        <p className="text-sm font-semibold">공유 할 일로 저장할 내용 확인</p><p className="text-xs leading-relaxed">파트너도 보는 준비 보드에 저장해요. 상대방에게 담당자를 지정하거나 선택안을 확정하지 않아요.</p>
        <label className="block text-sm">제목<input aria-label="확인할 할 일 제목" value={title} maxLength={120} disabled={disabled} onChange={e=>setTitle(e.target.value)} className="mt-1 min-h-11 w-full rounded-[6px] border border-[var(--hb-hairline)] p-2" /></label>
        <label className="block text-sm">내용<textarea aria-label="확인할 할 일 내용" value={description} maxLength={500} rows={3} disabled={disabled} onChange={e=>setDescription(e.target.value)} className="mt-1 w-full rounded-[6px] border border-[var(--hb-hairline)] p-2" /></label>
        <Button fullWidth disabled={disabled||!title.trim()} onClick={()=>void session.createTask(title,description)}>확인하고 공유 할 일 저장</Button><Button fullWidth variant="ghost" disabled={disabled} onClick={()=>setTaskOpen(false)}>취소</Button>
      </div>}
    </>}
    {connected&&<Button variant="ghost" fullWidth disabled={disabled} onClick={()=>void session.load()}>확인 상태 새로고침</Button>}
  </div>;
}
