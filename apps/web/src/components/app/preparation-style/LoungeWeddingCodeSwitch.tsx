"use client";

import { useMemo, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import type { WeddingCodeEntry } from "@/app/wedding-code/entry";
import WeddingCodeEntryClient from "@/app/wedding-code/WeddingCodeEntryClient";
import { weddingCodeReleaseTarget, type WeddingCodeExplicitTarget } from "@/app/wedding-code/releaseEntry";
import { createReleaseHashStore } from "@/app/wedding-code/releaseHashStore";
import LoungePreviousV31 from "./LoungePreviousV31";

const serverHash = () => null;

/** 라운지 안이라 문서의 main 은 앱 껍데기가 맡는다. 불러오는 동안에도 main 을 하나 더 만들지 않는다. */
const loadingScreen = <div className="flex min-h-[40vh] items-center justify-center px-5 text-sm text-[var(--hb-text-body)]" role="status">웨딩코드를 불러오고 있어요.</div>;

/** 64문항 화면은 늦게 불러온다. 옛 링크로 v3.1 을 여는 방문자의 번들에 64문항 은행을 싣지 않는다. */
const WeddingCode64Client = dynamic(() => import("@/components/weddingCode64/WeddingCode64Client"), {
  ssr: false,
  loading: () => loadingScreen,
});

/**
 * 라운지 웨딩코드의 판 고르기. 공개 입구와 같은 `weddingCodeReleaseTarget` 을 쓴다.
 * 판정이 wc64 일 때만 64문항을 그리고, 나머지(옛 판 쿼리, `#v=` 링크, `?ct=`, `?v=36`, likert)는 모두 기존 입구가 맡는다.
 * 그래서 `WEDDING_CODE_BARE_TARGET` 을 `"36"` 으로 되돌리면 라운지 맨 주소도 v3.1 로 돌아간다.
 */
export default function LoungeWeddingCodeSwitch({ queryIsLegacy, explicitTarget = null, shareOrigin, initialEntry }: {
  queryIsLegacy: boolean;
  /** 주소가 직접 고른 판(`?v=` 또는 36문항 초대 `?ct=`). 없으면 맨 주소 기본값을 쓴다. */
  explicitTarget?: WeddingCodeExplicitTarget | null;
  shareOrigin: string;
  initialEntry: WeddingCodeEntry;
}) {
  const store = useMemo(() => createReleaseHashStore(), []);
  const hash = useSyncExternalStore(store.subscribe, store.getSnapshot, serverHash);
  if (hash === null && !queryIsLegacy) return loadingScreen;
  const target = weddingCodeReleaseTarget(queryIsLegacy, hash ?? "", explicitTarget);
  if (target === "wc64") return <WeddingCode64Client embedded introExtra={<LoungePreviousV31 />} />;
  return <WeddingCodeEntryClient shareOrigin={shareOrigin} initialEntry={initialEntry} embedded />;
}
