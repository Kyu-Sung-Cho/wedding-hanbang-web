import type { ChatScope } from "./chatPrivacyScope";

type ScrollOptions = {
  scrollToOffset(position: { offset: number; animated: boolean }): void;
  onAwayChange(away: boolean): void;
};

/** 역순 목록의 0은 최신 대화다. 계정 밖에 위치를 저장하지 않고, 사람의 스크롤을 자동 이동보다 우선한다. */
export function createChatScrollPosition(options: ScrollOptions) {
  let activeScope: ChatScope = "shared";
  let offsets: Record<ChatScope, number> = { shared: 0, private: 0 };
  let revision = 0;
  let restoring = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const isAway = () => offsets[activeScope] > 80;
  const cancel = () => {
    revision++;
    timers.forEach(clearTimeout);
    timers.clear();
  };
  const schedule = (offset: number, animated: boolean, delay: number, explicit: boolean) => {
    const token = revision;
    const scope = activeScope;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (token !== revision || scope !== activeScope || (!explicit && isAway())) return;
      restoring = false;
      offsets[scope] = offset;
      options.onAwayChange(isAway());
      options.scrollToOffset({ offset, animated });
    }, delay);
    timers.add(timer);
  };
  return {
    activate(scope: ChatScope) {
      if (scope === activeScope) return;
      cancel();
      activeScope = scope;
      restoring = true;
      options.onAwayChange(isAway());
    },
    restore(scope: ChatScope) {
      if (scope !== activeScope || !restoring) return;
      schedule(offsets[scope], false, 0, true);
    },
    onScroll(scope: ChatScope, offset: number) {
      if (scope !== activeScope || restoring || !Number.isFinite(offset)) return;
      offsets[scope] = Math.max(0, offset);
      options.onAwayChange(isAway());
    },
    beginDrag(scope: ChatScope) {
      if (scope !== activeScope) return;
      cancel();
      restoring = false;
    },
    followLatest(animated = true, delay = 40) {
      if (restoring || isAway()) return;
      schedule(0, animated, delay, false);
    },
    jumpToLatest() {
      cancel();
      restoring = false;
      offsets[activeScope] = 0;
      options.onAwayChange(false);
      schedule(0, true, 0, true);
    },
    reset() {
      cancel();
      activeScope = "shared";
      offsets = { shared: 0, private: 0 };
      restoring = false;
      options.onAwayChange(false);
    },
    dispose: cancel,
  };
}
