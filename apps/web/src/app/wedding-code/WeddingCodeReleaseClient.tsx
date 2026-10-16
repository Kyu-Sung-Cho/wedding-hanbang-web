"use client";

import { useMemo, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import WeddingCodeLikertClient from "@/components/weddingCodeLikert/WeddingCodeLikertClient";
import type { WeddingCodeEntry } from "./entry";
import LegacyEntry from "./WeddingCodeEntryClient";
import { weddingCodeReleaseTarget, type WeddingCodeExplicitTarget } from "./releaseEntry";
import WeddingCodeClient from "./WeddingCodeClient";

const serverHash = () => null;

const loadingScreen = <main className="flex min-h-[60vh] items-center justify-center bg-[var(--ivory-50)] px-5 text-sm text-[var(--hb-text-body)]" role="status">웨딩코드를 불러오고 있어요.</main>;

/**
 * 64문항 화면은 늦게 불러온다. 36문항·30문항·구판으로 가는 방문자의 번들에 64문항 은행(약 124KB)을 싣지 않는다.
 * 선례는 `WeddingCodeEntryClient.tsx` 의 v4 화면이다. 서버는 해시를 못 보므로 어차피 하이드레이션 뒤에 그린다.
 */
const WeddingCode64Client = dynamic(() => import("@/components/weddingCode64/WeddingCode64Client"), {
  ssr: false,
  loading: () => loadingScreen,
});

function createHashStore() {
  let held = "";
  let pathname: string | null = null;
  return {
    getSnapshot() {
      pathname ??= window.location.pathname;
      // 다른 페이지로 돌아가는 중에는 그 페이지의 목차 조각을 답으로 읽지 않는다.
      if (window.location.pathname !== pathname) return held;
      const current = window.location.hash;
      if (current) held = current;
      return current || held;
    },
    subscribe(onChange: () => void) {
      const receive = () => {
        if (window.location.pathname !== pathname) return;
        // 구판은 받은 답을 메모리로 옮긴 뒤 주소를 비운다. 그 답의 판을 계속 유지한다.
        if (!window.location.hash && held) return;
        held = window.location.hash;
        onChange();
      };
      window.addEventListener("hashchange", receive);
      window.addEventListener("popstate", receive);
      return () => {
        window.removeEventListener("hashchange", receive);
        window.removeEventListener("popstate", receive);
      };
    },
  };
}

export default function WeddingCodeReleaseClient({ queryIsLegacy, explicitTarget = null, ...legacyProps }: {
  queryIsLegacy: boolean;
  /** 주소가 직접 고른 판(`?v=` 또는 36문항 초대 `?ct=`). 없으면 맨 주소 기본값을 쓴다. */
  explicitTarget?: WeddingCodeExplicitTarget | null;
  shareOrigin: string;
  initialEntry: WeddingCodeEntry;
  researchContributionOpen: boolean;
  researchStorageActive: boolean;
}) {
  const store = useMemo(() => createHashStore(), []);
  const hash = useSyncExternalStore(store.subscribe, store.getSnapshot, serverHash);
  if (hash === null && !queryIsLegacy) return loadingScreen;
  const target = weddingCodeReleaseTarget(queryIsLegacy, hash ?? "", explicitTarget);
  if (target === "legacy") return <LegacyEntry {...legacyProps} />;
  if (target === "likert") return <WeddingCodeLikertClient />;
  return target === "wc64" ? <WeddingCode64Client /> : <WeddingCodeClient />;
}
