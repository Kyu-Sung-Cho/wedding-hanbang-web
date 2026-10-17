"use client";

import { useMemo, useSyncExternalStore } from "react";
import WeddingCodeLikertClient from "@/components/weddingCodeLikert/WeddingCodeLikertClient";
import type { WeddingCodeEntry } from "./entry";
import LegacyEntry from "./WeddingCodeEntryClient";
import { weddingCodeReleaseTarget } from "./releaseEntry";
import WeddingCodeClient from "./WeddingCodeClient";

const serverHash = () => null;

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

export default function WeddingCodeReleaseClient({ queryIsLegacy, explicitLikert = false, embedded = false, ...legacyProps }: {
  queryIsLegacy: boolean;
  explicitLikert?: boolean;
  embedded?: boolean;
  shareOrigin: string;
  initialEntry: WeddingCodeEntry;
  researchContributionOpen: boolean;
  researchStorageActive: boolean;
}) {
  const store = useMemo(() => createHashStore(), []);
  const hash = useSyncExternalStore(store.subscribe, store.getSnapshot, serverHash);
  const Root = embedded ? "div" : "main";
  if (hash === null && !queryIsLegacy) return <Root className="flex min-h-[60vh] items-center justify-center bg-[var(--ivory-50)] px-5 text-sm text-[var(--hb-text-body)]" role="status">웨딩코드를 불러오고 있어요.</Root>;
  const target = weddingCodeReleaseTarget(queryIsLegacy, hash ?? "", explicitLikert);
  if (target === "legacy") return <LegacyEntry {...legacyProps} embedded={embedded} />;
  return target === "likert" ? <WeddingCodeLikertClient embedded={embedded} /> : <WeddingCodeClient embedded={embedded} />;
}
