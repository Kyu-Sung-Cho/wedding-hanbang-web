"use client";

import Link from "next/link";
import { useEffect } from "react";

import { reportClientError } from "@/lib/observability/clientErrorReport";
import { weddingPath } from "@/lib/weddingPaths";

// 로그인한 화면의 에러 경계. 이게 없으면 `app/error.tsx` 가 받아 사이드바·상단 바까지 통째로 사라진다.
// 경계가 (app) 레이아웃 안쪽이라 틀은 남고, 사이드바로 다른 화면에 바로 빠져나갈 수 있다.
// 문구는 `app/error.tsx` 와 같다. 홈 버튼만 로그인한 사람의 첫 화면인 웨딩 라운지로 보낸다.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // 원문은 콘솔·모니터링으로만 흘리고 화면에는 올리지 않는다.
    console.error("[app-error]", error.digest ?? error.message);
    // React 에러 경계가 잡은 오류는 window 의 error 이벤트를 만들지 않는다. 이 줄이 없으면
    // 사용자가 깨진 화면을 보는 바로 그 경우가 모니터링에 안 남는다.
    reportClientError(error);
  }, [error]);

  // 틀의 `<main>` 안에 들어가므로 `<main>`·min-h-screen·전체 배경은 쓰지 않는다. 채팅 틀은 main 이
  // overflow-hidden 이라 카드가 잘리면 스크롤이 안 되어, 래퍼가 스스로 스크롤한다.
  // 제목 크기는 `!` 를 붙인다. amora/planning 틀에는 전역 h1 보정이 안 걸려 본문 크기로 떨어지고,
  // 그 밖의 틀에서는 보정이 일반 유틸리티를 이기기 때문이다.
  return (
    <div role="alert" className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-5 py-16 text-[var(--hb-text-strong)]">
      <div className="w-full max-w-md text-center">
        <p className="text-sm font-bold text-[#8F6662]">잠시 문제가 생겼어요</p>
        <h1 className="mt-2 !text-[24px] !font-medium">화면을 불러오지 못했어요</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--hb-text-strong)]/70">
          저장된 일정·예산·대화 내용은 그대로예요. 다시 시도해도 같은 화면이 나오면 잠시 후에 열어봐 주세요.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-12 items-center justify-center rounded-[6px] bg-[var(--hb-primary)] px-6 text-sm font-bold text-white transition-colors hover:bg-[var(--hb-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B89785]"
          >
            다시 시도하기
          </button>
          <Link
            href={weddingPath("/lounge")}
            className="inline-flex min-h-12 items-center justify-center rounded-[6px] border border-[var(--color-paper-outline)] bg-white px-6 text-sm font-bold text-[var(--hb-text-strong)] transition-colors hover:bg-[#F5ECE4]/55"
          >
            웨딩 라운지로
          </Link>
        </div>
      </div>
    </div>
  );
}
