import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { createMediationResponseSession, type MediationResponseRevision } from '@hanbang/shared/mediation-responses';
import { apiFetchForExpectedUser } from './api';
import { supabase } from './supabase';

export function useMediationResponses(revision: MediationResponseRevision) {
  const {messageId,expectedProposalVersion,expectedRosterFingerprint}=revision;
  const observedScope=useRef<{coupleId:string;rosterKey:string}|null>(null);
  const session=useMemo(()=>createMediationResponseSession({
    revision:{messageId,expectedProposalVersion,expectedRosterFingerprint},
    readScope:async()=>{
      const {data,error}=await supabase.auth.getUser();
      if(error||!data.user)return null;
      const {data:profile,error:profileError}=await supabase.from('profiles').select('id,couple_id').eq('id',data.user.id).single();
      if(profileError||profile?.id!==data.user.id||typeof profile.couple_id!=='string')return null;
      const {data:couple,error:coupleError}=await supabase.from('couples').select('id,bride_id,groom_id').eq('id',profile.couple_id).single();
      if(coupleError||couple?.id!==profile.couple_id||(couple.bride_id!==data.user.id&&couple.groom_id!==data.user.id))return null;
      const scope={ownerId:data.user.id,coupleId:profile.couple_id,rosterKey:[couple.bride_id,couple.groom_id].join(':')};
      observedScope.current=scope;
      return scope;
    },
    request:(identity,path,options)=>apiFetchForExpectedUser(identity.ownerId,path,options),
  }),[messageId,expectedProposalVersion,expectedRosterFingerprint]);
  const state=useSyncExternalStore(session.subscribe,session.getState,session.getState);
  useEffect(()=>{
    const {data:{subscription}}=supabase.auth.onAuthStateChange(event=>{
      if(event!=='INITIAL_SESSION'){session.invalidate();void session.load();}
    });
    const app=AppState.addEventListener('change',next=>{if(next==='active')void session.load();});
    void session.load();
    return()=>{subscription.unsubscribe();app.remove();session.invalidate();};
  },[session]);
  const actor=state.snapshot?.actorId;
  useEffect(()=>{
    if(!actor)return;
    const channel=supabase.channel(`mediation-response-${messageId}-${actor}`)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'profiles',filter:`id=eq.${actor}`},payload=>{if(payload.new.couple_id!==observedScope.current?.coupleId){session.invalidate();void session.load();}})
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'couples'},payload=>{if(payload.new.id===observedScope.current?.coupleId&&[payload.new.bride_id,payload.new.groom_id].join(':')!==observedScope.current?.rosterKey){session.invalidate();void session.load();}})
      .subscribe();
    return()=>{void supabase.removeChannel(channel);};
  },[messageId,session,actor]);
  useFocusEffect(useCallback(()=>{void session.load();},[session]));
  return {state,session};
}