"use client";

import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import Button from "@/components/ui/Button";
import { WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { V40_ENTRY_COPY } from "@/lib/weddingCode/v40/entryCopy";
import type { WeddingCodeV40ClientProps } from "@/lib/weddingCode/v40/types";

import WeddingCodeV06Client from "./WeddingCodeV06Client";
import WeddingCodeV20Client from "./WeddingCodeV20Client";
import WeddingCodeV30Client from "./WeddingCodeV30Client";
import WeddingCodeV31Client from "./WeddingCodeV31Client";
import { WeddingCodeComparisonResume } from "./WeddingCodeV31Connection";
import {
  WEDDING_CODE_DEFAULT_VERSION,
  defaultWeddingCodeEntry,
  parseWeddingCodeEntryHash,
  type WeddingCodeEntry,
  type WeddingCodeLegacyEntryInitial,
  type WeddingCodeRestartTarget,
  type WeddingCodeV20EntryInitial,
  weddingCodeEntryKey,
  weddingCodeRestartEntry,
  weddingCodeRestartSearch,
} from "./entry";

export { parseWeddingCodeEntryHash } from "./entry";

/**
 * 웨딩코드 4.0 화면은 늦게 불러온다. v3.1 이하 길로 가는 방문자의 번들에 v4 화면과 문항 은행이 들어가지 않게 한다.
 * (링크 없이 여는 `?v=v4.0-tendency` 는 서버가 제목과 소개 글까지 미리 그린다. 이때 시작 단추는 누를 수 없는 채로 나가고, 브라우저가 저장소를 읽은 뒤에 풀린다.
 * 받은 링크는 주소의 # 뒤를 서버가 볼 수 없어서 하이드레이션 뒤에 읽고, 그동안은 불러오는 중이라는 글을 보인다.)
 */
const LazyWeddingCodeV40Client = dynamic<WeddingCodeV40ClientProps>(() => import("./WeddingCodeV40Client"), {
  loading: () => (
    <div role="status" className="mx-auto flex min-h-[60vh] w-full max-w-[680px] items-center justify-center px-5 text-sm text-[var(--hb-text-body)]">
      {V40_ENTRY_COPY.loadingLabel}
    </div>
  ),
});

/**
 * 서버가 그린 v4 화면을 하이드레이션으로 이어받게 하는 장치. 늦게 불러오는 경계는 불러오는 동안 부모가 다시 그려져 경계의 props 가 새로 만들어지면
 * 서버 화면 이어받기를 포기하고 지운 뒤 새로 그린다(개발 서버에서 확인했다: 서버가 그린 소개 노드가 모두 새 노드로 바뀌었다).
 * 입구는 하이드레이션 직후 주소의 # 뒤를 읽으며 반드시 한 번 다시 그려지므로, props 가 같으면 경계를 건드리지 않게 memo 로 감싼다.
 * 그래서 이 경계에 넘기는 props 는 하이드레이션 전후로 같아야 한다(`resolved` 를 hash 로 바꾸어 넘기지 않는 까닭이다).
 */
const WeddingCodeV40Client = memo(LazyWeddingCodeV40Client);

/**
 * 주소의 # 뒤를 읽는 저장소. useSyncExternalStore 의 바깥 저장소로 쓴다.
 *
 * v4 받는 사람 화면은 상대의 답을 메모리로 옮긴 뒤 history.replaceState 로 주소의 # 뒤를 지운다(이때는 어떤 이벤트도 나지 않는다).
 * 그 뒤에 입구가 다시 그려질 때 주소만 읽으면 받는 사람 화면이 기본 입구로 바뀌어 상대의 답이 사라진다.
 * 그래서 v4 링크의 해시를 읽은 적이 있고 주소가 비었다면, 새 # 뒤로 실제로 이동하기까지 읽은 해시를 그대로 돌려준다.
 *
 * 붙잡은 링크를 놓는 경우는 둘뿐이다. (1) hashchange, popstate 가 났고 그때 주소에 # 뒤가 있다(다른 링크로 이동함).
 * (2) 입구가 release() 를 부른다(다시 시작). 주소가 빈 채로 난 popstate 나 hashchange 는 이동으로 치지 않는다: 받는 사람 화면이 이미
 * 주소를 지웠는데 그 뒤 어떤 이벤트(직접 낸 가짜 이벤트 포함)가 난다고 상대의 답과 하던 답이 조용히 사라지면 안 된다.
 * 읽을 수 없는 v4 링크도 같다: 오류 화면이 주소창에서 깨진 조각을 지운 뒤에도(ErrorEntry) 오류 화면이 그대로 남게 붙잡는다.
 * v4 가 아닌 링크는 예전처럼 주소를 그대로 읽는다.
 */
function createLocationHashStore() {
  let held: string | null = null;
  let pathname: string | null = null;
  let snapshot = "";
  const listeners = new Set<() => void>();
  return {
    subscribe(onStoreChange: () => void) {
      listeners.add(onStoreChange);
      const onNavigate = () => {
        if (window.location.pathname !== pathname) return;
        if (held !== null && window.location.hash === "") return;
        held = null;
        onStoreChange();
      };
      window.addEventListener("hashchange", onNavigate);
      window.addEventListener("popstate", onNavigate);
      return () => {
        listeners.delete(onStoreChange);
        window.removeEventListener("hashchange", onNavigate);
        window.removeEventListener("popstate", onNavigate);
      };
    },
    getSnapshot(): string {
      pathname ??= window.location.pathname;
      if (window.location.pathname !== pathname) return snapshot;
      const live = window.location.hash;
      if (live === "") {
        snapshot = held ?? "";
        return snapshot;
      }
      const parsed = live.includes(WEDDING_CODE_V40_VERSION) ? parseWeddingCodeEntryHash(live) : null;
      held = parsed?.kind === "v40" || (parsed?.kind === "error" && parsed.version !== undefined) ? live : null;
      snapshot = live;
      return snapshot;
    },
    /** 붙잡고 있던 링크를 놓고 다시 읽게 한다(다시 시작). */
    release() {
      held = null;
      listeners.forEach((listener) => listener());
    },
  };
}

const getServerHash = (): string | null => null;

function ErrorEntry({ onRestart, embedded, v40 }: { onRestart: () => void; embedded: boolean; v40: boolean }) {
  const Root = embedded ? "div" : "main";
  const broken = V40_ENTRY_COPY.brokenLink;
  const rootRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    // 낭독기와 키보드 사용자가 링크를 못 연다는 것을 알 수 있게 다른 화면처럼 초점을 화면 이름으로 옮긴다.
    rootRef.current?.focus({ preventScroll: true });
    if (!v40) return;
    // 읽을 수 없는 v4 링크의 코드 조각을 주소창과 이력에서 지운다(받는 사람 화면과 같다). 쿼리에 실려 온 답도 함께 지운다.
    // 화면은 입구가 붙잡은 링크(createLocationHashStore)나 서버가 준 오류로 그대로 남는다. 새로고침하면 v4 빈 입구가 열린다.
    const { pathname, search, hash } = window.location;
    // a, b 에 이미 있는 배려를 서로 짐작하기의 ga, gb 까지 늘린다(깨진 링크의 짐작 글자도 주소창과 이력에 남기지 않는다).
    if (hash === "" && !/[?&](?:a|b|ga|gb)=/.test(search)) return;
    window.history.replaceState(window.history.state, "", `${pathname}?v=${WEDDING_CODE_V40_VERSION}`);
  }, [v40]);
  return (
    <Root className={`mx-auto flex w-full max-w-[680px] items-center px-5 py-12${embedded ? "" : " min-h-[60vh]"}`}>
      <section
        ref={rootRef}
        tabIndex={-1}
        aria-labelledby="wedding-code-entry-error-title"
        className="w-full rounded-[6px] border border-[var(--hb-hairline)] bg-white px-5 py-8 shadow-sm outline-none sm:px-8"
      >
        <p className="text-[12px] font-semibold text-[var(--color-rose-700)]">웨딩코드 링크</p>
        <h1 id="wedding-code-entry-error-title" className="mt-3 text-xl font-semibold text-[var(--hb-text-strong)]">{v40 ? broken.title : "이 링크는 열 수 없어요"}</h1>
        <p className="mt-3 text-sm leading-7 text-[var(--hb-text-body)]">
          {v40
            ? broken.body
            : "링크가 중간에 잘렸거나, 아직 지원하지 않는 버전이에요. 처음부터 다시 답하거나 보낸 사람에게 링크를 다시 받아 주세요."}
        </p>
        <Button
          variant="primary"
          type="button"
          onClick={() => onRestart()}
          className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-[6px] bg-[var(--hb-action)] px-5 text-sm font-semibold text-white hover:bg-[var(--hb-action-hover)]"
        >
          {v40 ? broken.startButton : "처음부터 답하기"}
        </Button>
      </section>
    </Root>
  );
}

/** 기본 진입이 v4 인 동안 명시 `?v=v3.1-preferences` 로 연 이전 판 화면 위의 안내. 새 판으로 가는 길은 이 단추 하나다. */
function OlderVersionNotice({ onStartNew }: { onStartNew: () => void }) {
  return (
    <aside data-older-version="" className="mx-auto mt-6 mb-4 flex w-full max-w-[680px] flex-wrap items-center justify-between gap-3 rounded-[6px] border border-[var(--hb-hairline)] bg-white px-4 py-3">
      <p className="text-sm text-[var(--hb-text-body)]">{V40_ENTRY_COPY.olderVersion.notice}</p>
      <Button variant="secondary" type="button" onClick={() => onStartNew()}>
        {V40_ENTRY_COPY.olderVersion.startNewButton}
      </Button>
    </aside>
  );
}

export default function WeddingCodeEntryClient({
  shareOrigin,
  initialEntry,
  v20Initial,
  legacyInitial = null,
  researchContributionOpen = false,
  researchStorageActive = false,
  initialError = false,
  embedded = false,
}: {
  shareOrigin: string;
  initialEntry?: WeddingCodeEntry;
  v20Initial?: WeddingCodeV20EntryInitial;
  legacyInitial?: WeddingCodeLegacyEntryInitial | null;
  researchContributionOpen?: boolean;
  researchStorageActive?: boolean;
  /** 서버가 query를 판별했지만 지원하지 않거나 깨진 링크로 확인한 경우. */
  initialError?: boolean;
  embedded?: boolean;
}) {
  const defaultVersion = WEDDING_CODE_DEFAULT_VERSION;
  const defaultEntry = useMemo<WeddingCodeEntry>(
    () => initialEntry ?? (initialError ? { kind: "error" }
      : legacyInitial ? { kind: "legacy", initial: legacyInitial }
      : v20Initial ? { kind: "v20", initial: v20Initial }
      : defaultWeddingCodeEntry(defaultVersion)),
    [defaultVersion, initialEntry, initialError, legacyInitial, v20Initial],
  );
  // Server and first client render deliberately share the same entry. The URL fragment is applied
  // after hydration, so an old share link never flashes a fabricated result during hydration.
  // Known data-quality caveat (recorded, not fixed here): while the default entry is v3.1, a v4 hash link first hydrates the
  // v3.1 start screen (the server never sees the fragment), and the frozen v3.1 client's mount effect sends
  // `wedding_code_intro_viewed` (version v3.1-preferences, has_partner_link false) before this entry swaps to v4. Every v4
  // recipient therefore adds one v3.1 intro view. It cannot be stopped from here without editing v3.1 or the analytics module;
  // account for it before comparing intro-to-completion rates across the v3.1 to v4 default swap.
  const [hashStore] = useState(createLocationHashStore);
  const hash = useSyncExternalStore<string | null>(hashStore.subscribe, hashStore.getSnapshot, getServerHash);
  const [restartTarget, setRestartTarget] = useState<WeddingCodeRestartTarget | null>(null);
  const [restartRevision, setRestartRevision] = useState(0);
  const [restartNotice, setRestartNotice] = useState("");
  const hashEntry = useMemo(() => parseWeddingCodeEntryHash(hash ?? "", { defaultVersion }), [hash, defaultVersion]);
  const entry = hashEntry ?? (restartTarget ? weddingCodeRestartEntry(restartTarget, defaultVersion) : defaultEntry);

  // 다시 시작은 도착 판을 밝힌다: v3.1 화면은 v3.1 빈 입구로, v4 화면은 v4 빈 입구로, 그 밖의 판은 그때의 기본 판으로 간다.
  // v4 로 가는 길은 v4 화면의 다시 시작과 이전 판 안내의 「새 판으로 시작하기」뿐이다.
  const restart = useCallback((message: unknown, target: WeddingCodeRestartTarget) => {
    // replaceState clears the fragment without ever placing an answer in `?a=` or `?b=`.
    // 기본 판이 아닌 판은 `?v=` 만 남겨서(답 없음) 새로고침해도 같은 판이 열리게 한다.
    window.history.replaceState(null, "", `${window.location.pathname}${weddingCodeRestartSearch(target, defaultVersion)}`);
    setRestartNotice(typeof message === "string" ? message : "");
    setRestartTarget(target);
    setRestartRevision((value) => value + 1);
    // 붙잡은 v4 링크를 먼저 놓는다(빈 주소의 popstate 는 이동으로 치지 않는다). popstate 는 이 입구 밖에서 주소를 읽는 화면을 위해 그대로 낸다.
    hashStore.release();
    window.dispatchEvent(new Event("popstate"));
  }, [defaultVersion, hashStore]);
  const restartDefault = useCallback((message?: string) => restart(message, "default"), [restart]);
  const restartV31 = useCallback((message?: string) => restart(message, "v31"), [restart]);
  const restartV40 = useCallback((message?: string) => restart(message, "v40"), [restart]);

  if (entry.kind === "error") {
    return <ErrorEntry onRestart={entry.version ? restartV40 : restartDefault} embedded={embedded} v40={Boolean(entry.version)} />;
  }
  if (entry.kind === "v40") {
    const received = entry.initial.partner !== null || entry.initial.both !== null;
    return (
      <WeddingCodeV40Client
        key={`v40:${weddingCodeEntryKey(entry)}:${restartRevision}`}
        shareOrigin={shareOrigin}
        initial={entry.initial}
        // 주소의 # 뒤를 읽기 전에 저장소를 읽지 않는 일은 본체가 스스로 한다(서버 렌더와 하이드레이션 첫 그림이 끝난 뒤에야 연다).
        // 이 값이 하이드레이션 전후로 바뀌면 늦게 불러오는 경계가 서버 화면을 이어받지 못한다(위 memo 설명).
        resolved
        embedded={embedded}
        onRestart={restartV40}
        initialNotice={received ? "" : restartNotice}
      />
    );
  }
  if (entry.kind === "v31") {
    return (
      <>
      {entry.older ? <OlderVersionNotice onStartNew={restartV40} /> : null}
      {hash !== null && !entry.initial.partnerDraft && !entry.initial.bothDrafts ? <WeddingCodeComparisonResume /> : null}
      <WeddingCodeV31Client
        embedded={embedded}
        key={`v31:${weddingCodeEntryKey(entry)}`}
        shareOrigin={shareOrigin}
        partnerDraft={entry.initial.partnerDraft}
        bothDrafts={entry.initial.bothDrafts}
        allowLocalProgress={hash !== null}
        initialNotice={entry.initial.partnerDraft || entry.initial.bothDrafts ? "" : restartNotice}
        onRestart={restartV31}
      />
      </>
    );
  }
  if (entry.kind === "v30") {
    return (
      <WeddingCodeV30Client
        embedded={embedded}
        key={`v30:${weddingCodeEntryKey(entry)}`}
        shareOrigin={shareOrigin}
        partnerDraft={entry.initial.partnerDraft}
        bothDrafts={entry.initial.bothDrafts}
        onRestart={restartDefault}
      />
    );
  }
  if (entry.kind === "legacy") {
    return (
      <WeddingCodeV06Client
        embedded={embedded}
        key={`legacy:${weddingCodeEntryKey(entry)}`}
        shareOrigin={shareOrigin}
        version={entry.initial.version}
        partnerAnswers={entry.initial.partnerAnswers}
        partnerCode={entry.initial.partnerCode}
        bothCodes={entry.initial.bothCodes}
        researchContributionOpen={researchContributionOpen}
        researchStorageActive={researchStorageActive}
        onRestart={restartDefault}
      />
    );
  }
  return (
    <WeddingCodeV20Client
      embedded={embedded}
      key={`v20:${weddingCodeEntryKey(entry)}`}
      shareOrigin={shareOrigin}
      partnerAnswers={entry.initial.partnerAnswers}
      partnerCode={entry.initial.partnerCode}
      bothAnswers={entry.initial.bothAnswers}
      onRestart={restartDefault}
    />
  );
}
