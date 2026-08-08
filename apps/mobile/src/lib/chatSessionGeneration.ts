export interface ChatSessionGenerationGuard {
  begin: () => number;
  current: () => number;
  invalidate: () => void;
  isCurrent: (generation: number) => boolean;
}

export function createChatSessionGenerationGuard(): ChatSessionGenerationGuard {
  let currentGeneration = 0;
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
  };
}
