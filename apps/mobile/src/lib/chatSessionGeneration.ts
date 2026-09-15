export interface ChatSessionGenerationGuard {
  begin: () => number;
  current: () => number;
  invalidate: () => void;
  isCurrent: (generation: number) => boolean;
  /**
   * 이 채팅 화면(가드) 고유 번호. 실시간 채널 토픽에 넣는다.
   *
   * 채팅 화면이 둘 마운트되면(루트 스택 위로 `(tabs)`가 한 벌 더 쌓인 경우) 둘 다 세대 1에서
   * 시작한다. realtime-js 의 `channel(topic)`은 같은 토픽이면 이미 있는 채널을 돌려주므로, 세대만
   * 넣은 토픽은 두 화면이 한 채널을 나눠 쓰고 한쪽이 닫힐 때 다른 쪽 구독까지 끊는다.
   */
  instanceId: () => number;
}

let lastChatSessionInstanceId = 0;

export function createChatSessionGenerationGuard(): ChatSessionGenerationGuard {
  let currentGeneration = 0;
  // 처음 쓸 때 정한다. `useRef(createChatSessionGenerationGuard())`는 렌더마다 가드를 만들지만
  // 실제로 쓰이는 것은 첫 가드뿐이라, 번호는 쓰일 때만 소비한다.
  let instanceId: number | null = null;
  return {
    begin() {
      currentGeneration += 1;
      return currentGeneration;
    },
    current() {
      return currentGeneration;
    },
    invalidate() {
      currentGeneration += 1;
    },
    isCurrent(generation) {
      return generation === currentGeneration;
    },
    instanceId() {
      if (instanceId === null) {
        lastChatSessionInstanceId += 1;
        instanceId = lastChatSessionInstanceId;
      }
      return instanceId;
    },
  };
}
