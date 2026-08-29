"use client";

import Link from "next/link";
import { useEffect } from "react";

import { reportClientError } from "@/lib/observability/clientErrorReport";

// 루트 에러 경계. 이게 없으면 어느 화면에서든 Next 기본 "Application error" 원문이
// 그대로 노출된다 — 사용자에게는 내부 사정 대신 다음 행동만 보여준다.
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // 원문은 콘솔·모니터링으로만 흘리고 화면에는 올리지 않는다.
    console.error("[root-error]", error.digest ?? error.message);
    // **React 에러 경계가 잡은 오류는 window 의 error 이벤트를 안 만든다.** 그래서
    // 이 줄이 없으면 사용자가 깨진 화면을 보는 바로 그 경우가 모니터링에 안 남는다
    // (2026-08-26 확인: 웹이 Sentry 로 의도적으로 보내던 오류는 AI 원장 실패 3줄뿐이었다).
    reportClientError(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--hb-surface-page)] px-5 py-16 text-[var(--hb-text-strong)]">
      <div className="w-full max-w-md text-center">
        <p className="text-sm font-bold text-[#8F6662]">잠시 문제가 생겼어요</p>
        <h1 className="mt-2 text-2xl font-bold tracking-normal">화면을 불러오지 못했어요</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--hb-text-strong)]/70">
          저장된 일정·예산·대화 내용은 그대로예요. 다시 시도해도 같은 화면이 나오면 잠시 후에 열어봐 주세요.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-[var(--hb-primary)] px-6 text-sm font-bold text-white transition-colors hover:bg-[var(--hb-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B89785]"
          >
            다시 시도하기
          </button>
          <Link
            href="/wedding"
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-[var(--hb-primary)]/18 bg-white px-6 text-sm font-bold text-[var(--hb-text-strong)] transition-colors hover:bg-[#F5ECE4]/55"
          >
            홈으로 가기
          </Link>
        </div>
      </div>
    </main>
  );
}
