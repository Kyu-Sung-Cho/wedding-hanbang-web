"use client";

import { useEffect } from "react";

import { reportClientError } from "@/lib/observability/clientErrorReport";

export default function PriceWishlistError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 이 경계가 잡으면 루트 경계까지 올라가지 않는다 — React 는 가장 가까운
    // 하나만 쓴다. 그래서 여기서 직접 보내지 않으면 이 화면은 모니터링에
    // 아무것도 안 남긴다(콘솔에는 Next 가 원문을 찍는다).
    console.error("[price-wishlist-error]", error.digest ?? error.message);
    reportClientError(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FBF8F2] px-5 text-[#243832]">
      <div className="max-w-md text-center">
        <p className="text-sm font-bold text-[#8F6662]">잠시 연결이 불안정해요</p>
        <h1 className="mt-2 text-2xl font-bold tracking-normal">공식 가격 카탈로그를 불러오지 못했어요.</h1>
        <p className="mt-3 text-sm leading-6 text-[#243832]/70">
          저장된 찜에는 영향이 없어요. 잠시 후 다시 확인해 주세요.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 min-h-12 rounded-full bg-[#36534E] px-6 text-sm font-bold text-white"
        >
          다시 불러오기
        </button>
      </div>
    </div>
  );
}
