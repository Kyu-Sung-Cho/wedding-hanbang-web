"use client";

export default function PriceCategoryError({ reset }: { reset: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FBF8F2] px-5 text-[#243832]">
      <div className="max-w-md text-center">
        <p className="text-sm font-bold text-[#8F6662]">잠시 연결이 불안정해요</p>
        <h1 className="mt-2 text-2xl font-bold tracking-normal">공시 가격을 불러오지 못했어요.</h1>
        <p className="mt-3 text-sm leading-6 text-[#243832]/70">저장한 찜과 조합에는 영향이 없어요. 잠시 후 다시 확인해 주세요.</p>
        <button type="button" onClick={reset} className="mt-6 min-h-12 rounded-full bg-[#36534E] px-6 text-sm font-bold text-white">
          다시 불러오기
        </button>
      </div>
    </div>
  );
}
