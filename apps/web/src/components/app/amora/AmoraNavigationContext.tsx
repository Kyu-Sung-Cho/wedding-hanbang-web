"use client";

import { createContext, useContext } from "react";

// 헤더에는 표시 위치만 전달한다. 대화 범위·초안·전송 상태는 ChatContent가 계속 소유한다.
export const AmoraNavigationTargetContext = createContext<HTMLElement | null>(null);

export function useAmoraNavigationTarget() {
  return useContext(AmoraNavigationTargetContext);
}
