"use client";

import { useCallback, useEffect, type SetStateAction } from "react";
import {
  bindChatComposerSession, createEmptyComposerDrafts, updateChatComposerDrafts,
  useChatComposerStore, type ChatComposerDrafts,
} from "@/stores/chatComposerStore";

const EMPTY_DRAFTS = createEmptyComposerDrafts();

export function useChatComposerDrafts(identity: string) {
  const state = useChatComposerStore();
  const generation = state.generation + (state.identity !== null && state.identity !== identity ? 1 : 0);
  useEffect(() => {
    bindChatComposerSession(identity);
  }, [identity, state.generation]);
  // unmount는 폐기가 아니다. 이전 화면의 전송 결과도 같은 세션의 원래 레인으로 돌아온다.
  const setDrafts = useCallback((update: SetStateAction<ChatComposerDrafts>) => {
    updateChatComposerDrafts({ identity, generation }, update);
  }, [identity, generation]);
  return [state.identity === identity ? state.drafts : EMPTY_DRAFTS, setDrafts] as const;
}
