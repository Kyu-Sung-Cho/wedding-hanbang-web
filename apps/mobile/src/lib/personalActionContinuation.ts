import { createPersonalActionContinuation, isPersonalActionId } from '@hanbang/shared/amora-personal-actions';
import { apiFetchForExpectedUser } from './api';
import { supabase } from './supabase';

const continuation = createPersonalActionContinuation({
  readScope: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    const { data: profile, error: profileError } = await supabase.from('profiles').select('id, couple_id').eq('id', data.user.id).single();
    if (profileError || profile?.id !== data.user.id || !isPersonalActionId(profile?.couple_id)) return null;
    return { ownerId: data.user.id, coupleId: profile.couple_id };
  },
  readAction: async (id, scope) => {
    const response = await apiFetchForExpectedUser(scope.ownerId, `/api/amora/personal-actions?conversationCoupleId=${encodeURIComponent(scope.coupleId)}&actionId=${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error('개인 할 일을 다시 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
    return response.json();
  },
});

let observing = false;
export const personalActionContinuation = {
  ...continuation,
  review(id: string) {
    if (!observing) {
      observing = true;
      supabase.auth.onAuthStateChange(event => {
        if (event !== 'INITIAL_SESSION') continuation.reset();
      });
    }
    return continuation.review(id);
  },
};
