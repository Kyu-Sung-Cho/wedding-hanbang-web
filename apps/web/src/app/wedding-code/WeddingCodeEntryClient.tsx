"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import Button from "@/components/ui/Button";

import WeddingCodeV06Client from "./WeddingCodeV06Client";
import WeddingCodeV20Client from "./WeddingCodeV20Client";
import {
  EMPTY_WEDDING_CODE_ENTRY,
  parseWeddingCodeEntryHash,
  type WeddingCodeEntry,
  type WeddingCodeLegacyEntryInitial,
  type WeddingCodeV20EntryInitial,
  weddingCodeEntryKey,
} from "./entry";

export { parseWeddingCodeEntryHash } from "./entry";

const EMPTY_V20: WeddingCodeV20EntryInitial = EMPTY_WEDDING_CODE_ENTRY.kind === "v20"
  ? EMPTY_WEDDING_CODE_ENTRY.initial
  : { partnerAnswers: null, partnerCode: null, bothAnswers: null };


function ErrorEntry({ onRestart }: { onRestart: () => void }) {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-[680px] items-center px-5 py-12">
      <section className="w-full rounded-[6px] border border-[var(--hb-hairline)] bg-white px-5 py-8 shadow-sm sm:px-8">
        <p className="text-[12px] font-semibold text-[var(--color-rose-700)]">웨딩코드 링크</p>
        <h1 className="mt-3 text-xl font-semibold text-[var(--hb-text-strong)]">이 링크는 열 수 없어요</h1>
        <p className="mt-3 text-sm leading-7 text-[var(--hb-text-body)]">
          링크가 중간에 잘렸거나, 아직 지원하지 않는 버전이에요. 처음부터 다시 답하거나 보낸 사람에게 링크를 다시 받아 주세요.
        </p>
        <Button
          variant="primary"
          type="button"
          onClick={onRestart}
          className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-[6px] bg-[var(--hb-action)] px-5 text-sm font-semibold text-white hover:bg-[var(--hb-action-hover)]"
        >
          처음부터 답하기
        </Button>
      </section>
    </main>
  );
}

export default function WeddingCodeEntryClient({
  shareOrigin,
  initialEntry,
  v20Initial = EMPTY_V20,
  legacyInitial = null,
  researchContributionOpen = false,
  researchStorageActive = false,
  initialError = false,
}: {
  shareOrigin: string;
  initialEntry?: WeddingCodeEntry;
  v20Initial?: WeddingCodeV20EntryInitial;
  legacyInitial?: WeddingCodeLegacyEntryInitial | null;
  researchContributionOpen?: boolean;
  researchStorageActive?: boolean;
  /** 서버가 query를 판별했지만 지원하지 않거나 깨진 링크로 확인한 경우. */
  initialError?: boolean;
}) {
  const defaultEntry = useMemo<WeddingCodeEntry>(
    () => initialEntry ?? (initialError ? { kind: "error" } : legacyInitial ? { kind: "legacy", initial: legacyInitial } : { kind: "v20", initial: v20Initial }),
    [initialEntry, initialError, legacyInitial, v20Initial],
  );
  // Server and first client render deliberately share the same entry. The URL fragment is applied
  // after hydration, so an old share link never flashes a fabricated result during hydration.
  const hash = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("hashchange", onStoreChange);
      window.addEventListener("popstate", onStoreChange);
      return () => {
        window.removeEventListener("hashchange", onStoreChange);
        window.removeEventListener("popstate", onStoreChange);
      };
    },
    () => window.location.hash,
    () => "",
  );
  const [restarted, setRestarted] = useState(false);
  const entry = parseWeddingCodeEntryHash(hash) ?? (restarted ? EMPTY_WEDDING_CODE_ENTRY : defaultEntry);

  const restart = useCallback(() => {
    // replaceState clears the fragment without ever placing an answer in `?a=` or `?b=`.
    window.history.replaceState(null, "", window.location.pathname);
    setRestarted(true);
    window.dispatchEvent(new Event("popstate"));
  }, []);

  if (entry.kind === "error") return <ErrorEntry onRestart={restart} />;
  if (entry.kind === "legacy") {
    return (
      <WeddingCodeV06Client
        key={`legacy:${weddingCodeEntryKey(entry)}`}
        shareOrigin={shareOrigin}
        version={entry.initial.version}
        partnerAnswers={entry.initial.partnerAnswers}
        partnerCode={entry.initial.partnerCode}
        bothCodes={entry.initial.bothCodes}
        researchContributionOpen={researchContributionOpen}
        researchStorageActive={researchStorageActive}
        onRestart={restart}
      />
    );
  }
  return (
    <WeddingCodeV20Client
      key={`v20:${weddingCodeEntryKey(entry)}`}
      shareOrigin={shareOrigin}
      partnerAnswers={entry.initial.partnerAnswers}
      partnerCode={entry.initial.partnerCode}
      bothAnswers={entry.initial.bothAnswers}
      onRestart={restart}
    />
  );
}
