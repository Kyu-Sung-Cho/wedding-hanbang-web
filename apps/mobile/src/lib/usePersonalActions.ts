import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { apiFetchForExpectedUser } from './api';
import { supabase } from './supabase';
import { createPersonalActionsSession } from './personalActions.mjs';

export function usePersonalActions(initialOwner: string | null = null, loadOnMount = true) {
  const [session] = useState(() => createPersonalActionsSession(apiFetchForExpectedUser, initialOwner));
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const apply = (owner: string | null) => {
      session.setOwner(owner);
      if (owner && loadOnMount) void session.load();
    };
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, authSession) => {
      generation += 1;
      apply(authSession?.user.id ?? null);
    });
    const requestGeneration = generation;
    void supabase.auth.getUser().then(({ data, error }) => {
      if (active && generation === requestGeneration) apply(error ? null : data.user?.id ?? null);
    });
    return () => { active = false; subscription.subscription.unsubscribe(); session.dispose(); };
  }, [loadOnMount, session]);
  useEffect(() => {
    if (!loadOnMount) return;
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void session.load(); });
    return () => subscription.remove();
  }, [loadOnMount, session]);
  return { ...state, session };
}
