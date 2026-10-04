"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { markHydratedAndClearLoadFailureNotice } from "@/lib/browserStorageFallback";
import { reportClientError } from "@/lib/observability/clientErrorReport";

/**
 * 화면 조각(청크)을 못 받아서 난 오류인가. 오류 이름이 ChunkLoadError 이거나 메시지가 청크·동적 불러오기 실패 계열이다
 * (Turbopack: "Failed to load chunk …", webpack: "Loading chunk … failed", 사파리와 크롬: 동적 모듈 불러오기 실패 문장).
 * 이 오류는 reset() 으로 풀리지 않는다. React.lazy 와 next/dynamic 이 실패한 약속을 저장해 두어서 다시 그려도 같은 실패를 되돌려 주므로(감사 A70)
 * 요청을 다시 보내려면 페이지를 새로 불러와야 한다.
 */
const CHUNK_LOAD_ERROR_PATTERN =
  /Failed to load chunk|Loading chunk \S+ failed|Loading CSS chunk|ChunkLoadError|Importing a module script failed|error loading dynamically imported module|Failed to fetch dynamically imported module/i;

function isChunkLoadError(error: Error): boolean {
  return error.name === "ChunkLoadError" || CHUNK_LOAD_ERROR_PATTERN.test(String(error.message ?? ""));
}

/** 자동 새로고침을 마지막으로 한 시각을 탭 안에 남겨, 같은 오류가 되풀이돼도 새로고침이 끝없이 도는 일이 없게 한다. */
const AUTO_RELOAD_MARK_KEY = "hb:chunk-error-auto-reload-at";
const AUTO_RELOAD_QUIET_MS = 60_000;

/**
 * 청크 오류에서 한 번만 자동으로 새로고침한다. 표시를 못 남기는 브라우저(저장소가 막힘)에서는 되풀이될 수 있으므로 자동으로는 하지 않고 단추에 맡긴다.
 * 이미 한 번 했다면(최근 1분 안) 단추로만 새로고침한다.
 */
function reloadAutomaticallyOnce(): void {
  try {
    const last = Number(window.sessionStorage.getItem(AUTO_RELOAD_MARK_KEY));
    if (Number.isFinite(last) && last > 0 && Date.now() - last < AUTO_RELOAD_QUIET_MS) return;
    window.sessionStorage.setItem(AUTO_RELOAD_MARK_KEY, String(Date.now()));
  } catch {
    return;
  }
  window.location.reload();
}

// 루트 에러 경계. 이게 없으면 어느 화면에서든 Next 기본 "Application error" 원문이
// 그대로 노출된다 — 사용자에게는 내부 사정 대신 다음 행동만 보여준다.
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const pathname = usePathname();
  // 웨딩코드의 답은 일정·예산·대화가 아니라 이 브라우저에 자동 저장된 답이다. 같은 경계가 두 곳을 맡아서 문구를 경로로 가른다(감사 A65).
  const isWeddingCode = pathname === "/wedding-code" || (pathname ?? "").startsWith("/wedding-code/");
  const chunkFailed = isChunkLoadError(error);

  useEffect(() => {
    // 원문은 콘솔·모니터링으로만 흘리고 화면에는 올리지 않는다.
    console.error("[root-error]", error.digest ?? error.message);
    // **React 에러 경계가 잡은 오류는 window 의 error 이벤트를 안 만든다.** 그래서
    // 이 줄이 없으면 사용자가 깨진 화면을 보는 바로 그 경우가 모니터링에 안 남는다
    // (2026-08-26 확인: 웹이 Sentry 로 의도적으로 보내던 오류는 AI 원장 실패 3줄뿐이었다).
    reportClientError(error);
    // 이 오류 화면이 같은 안내를 하므로(화면을 불러오지 못했어요 + 새로고침 단추) head 스크립트의 안내 막대와 겹쳐 두 번 말하지 않게 막대를 걷는다.
    markHydratedAndClearLoadFailureNotice();
    // 화면 조각을 못 받은 오류는 다시 그려서는 안 풀린다. 한 번은 알아서 새로고침한다.
    if (isChunkLoadError(error)) reloadAutomaticallyOnce();
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--hb-surface-page)] px-5 py-16 text-[var(--hb-text-strong)]">
      <div className="w-full max-w-md text-center">
        <p className="text-sm font-bold text-[#8F6662]">잠시 문제가 생겼어요</p>
        <h1 className="mt-2 text-2xl font-bold tracking-normal">화면을 불러오지 못했어요</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--hb-text-strong)]/70">
          {isWeddingCode
            ? "자동 저장을 켜 두었다면 저장된 답은 이 브라우저에 그대로 있어요. 다시 시도해도 같은 화면이 나오면 잠시 후에 열어봐 주세요."
            : "저장된 일정·예산·대화 내용은 그대로예요. 다시 시도해도 같은 화면이 나오면 잠시 후에 열어봐 주세요."}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            // 청크 오류는 reset() 이 같은 실패를 되돌려 주므로 페이지를 새로 불러온다.
            onClick={chunkFailed ? () => window.location.reload() : reset}
            className="inline-flex min-h-12 items-center justify-center rounded-[6px] bg-[var(--hb-primary)] px-6 text-sm font-bold text-white transition-colors hover:bg-[var(--hb-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B89785]"
          >
            {chunkFailed ? "새로고침" : "다시 시도하기"}
          </button>
          <Link
            href={isWeddingCode ? "/wedding-code" : "/wedding"}
            className="inline-flex min-h-12 items-center justify-center rounded-[6px] border border-[var(--color-paper-outline)] bg-white px-6 text-sm font-bold text-[var(--hb-text-strong)] transition-colors hover:bg-[#F5ECE4]/55"
          >
            {isWeddingCode ? "웨딩코드 처음으로" : "홈으로 가기"}
          </Link>
        </div>
      </div>
    </main>
  );
}
