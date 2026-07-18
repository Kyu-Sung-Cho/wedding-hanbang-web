export default function VendorPriceLoading() {
  return (
    <main className="min-h-screen bg-[#FBF8F2] text-[#243832]" aria-busy="true" aria-label="업체 공시 가격 불러오는 중">
      <div className="mx-auto w-full max-w-4xl animate-pulse px-5 py-10 sm:px-8">
        <div className="h-5 w-36 rounded bg-[#E2D3C8]" />
        <div className="mt-10 h-4 w-28 rounded bg-[#E2D3C8]" />
        <div className="mt-4 h-11 w-64 rounded bg-[#C7D1C2]" />
        <div className="mt-12 space-y-5 border-y border-[#243832]/10 py-7">
          <div className="h-24 rounded bg-[#F7F1E8]" />
          <div className="h-24 rounded bg-[#F7F1E8]" />
          <div className="h-24 rounded bg-[#F7F1E8]" />
        </div>
        <p className="sr-only">공시 가격과 근거를 확인하고 있어요.</p>
      </div>
    </main>
  );
}
