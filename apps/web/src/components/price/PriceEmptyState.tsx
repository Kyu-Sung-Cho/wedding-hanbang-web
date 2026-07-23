import Link from "next/link";
import { ArrowRight, FileHeart } from "lucide-react";

export function PriceEmptyState() {
  return (
    <section className="rounded-[24px] border border-[#243832]/12 bg-white px-5 py-10 text-center shadow-[0_12px_34px_rgba(36,56,50,0.06)] sm:px-8">
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-[#F5ECE4] text-[#8F6662]">
        <FileHeart aria-hidden="true" className="size-6" />
      </span>
      <h2 className="mt-5 text-xl font-bold tracking-[-0.02em] text-[#243832]">
        아직 가격을 공개하지 않은 업체예요.
      </h2>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[#243832]/70">
        견적을 받으셨다면 공유해주세요 — 다른 커플을 위한 실거래 정보가 만들어져요.
      </p>
      <Link
        href="/wedding/community/quote-check"
        className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#36534E] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(36,56,50,0.16)] hover:bg-[#2B423E] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B89785]"
      >
        견적 공유하러 가기
        <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    </section>
  );
}
