"use client";

import { useEffect } from "react";

import { clearLoadFailureNoticeWhenHydrated } from "@/lib/browserStorageFallback";

/**
 * 루트 레이아웃에 두는 아주 작은 클라이언트 컴포넌트. 화면이 하이드레이션돼서 살아 있으면
 * "화면을 불러오지 못했어요" 안내 막대(head 인라인 스크립트가 띄운다)를 걷고, 이후 새로 실패하는 파일(하이드레이션 뒤에 따로 받는 모니터링 파일 등)로는
 * 막대를 다시 띄우지 않게 표시를 남긴다. 하이드레이션이 실패하면 막대는 그대로 남는다.
 * 이 컴포넌트가 마운트됐다는 것만으로는 화면이 살아난 것이 아니다(레이아웃과 화면 본문은 따로 하이드레이션된다). 그래서 서버 HTML 에 있던 "확인 중" 구간이 사라지기를 기다린다.
 * 그 구간이 처음부터 없는 화면에서는 기다릴 신호가 없으므로 막대를 걷지 않는다. 근거는 `lib/browserStorageFallback.ts`.
 */
export default function LoadFailureNoticeCleaner() {
  useEffect(() => clearLoadFailureNoticeWhenHydrated(), []);
  return null;
}
