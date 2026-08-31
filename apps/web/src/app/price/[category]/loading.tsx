export default function PriceCategoryLoading() {
  return (
    <div className="min-h-screen bg-[var(--hb-surface-page)] text-[var(--hb-text-strong)]" aria-busy="true" aria-label="공시 가격 목록 불러오는 중">
      <div className="animate-pulse border-b border-[var(--hb-primary)]/10 bg-white px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="h-3 w-36 rounded-[6px] bg-[#E2D3C8]" />
          <div className="mt-4 h-10 w-full max-w-xl rounded-[6px] bg-[#C7D1C2]" />
          <div className="mt-7 flex gap-2">
            {[1, 2, 3, 4].map((value) => <div key={value} className="h-11 w-28 rounded-full bg-[#F5ECE4]" />)}
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-6xl animate-pulse space-y-4 px-4 py-7 sm:px-6">
        <div className="h-20 rounded-[6px] bg-white" />
        <div className="grid gap-4 lg:grid-cols-2">
          {[1, 2, 3, 4].map((value) => <div key={value} className="h-72 rounded-[6px] bg-white" />)}
        </div>
        <p className="sr-only">최신 발행 가격과 추가금을 확인하고 있어요.</p>
      </div>
    </div>
  );
}
