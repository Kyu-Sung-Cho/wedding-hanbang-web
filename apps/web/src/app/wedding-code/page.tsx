import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "웨딩코드 검증 준비 안내 | 웨딩한방",
  description: "웨딩코드는 문항과 결과의 정식 검증을 준비하고 있으며 현재 답변을 받지 않습니다.",
  robots: { index: false, follow: false },
};

export default function WeddingCodePage() {
  return (
    <main className="min-h-screen bg-[#FBF8F2] px-4 py-10 sm:py-16">
      <section className="mx-auto w-full max-w-[580px] rounded-[28px] border border-[#EFE4D7] bg-white px-6 py-9 text-center shadow-[0_16px_42px_rgba(8,22,38,0.07)] sm:px-10 sm:py-12">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#F7F1E8] text-[#36534E]">
          <ShieldCheck aria-hidden="true" className="h-6 w-6" />
        </div>

        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-[#8F6662]">
          WEDDINGCODE
        </p>
        <h1 className="mt-2 text-2xl font-semibold leading-snug text-[#243832] sm:text-3xl">
          웨딩코드는 정식 검증을 준비하고 있어요
        </h1>
        <p className="mt-5 text-base font-medium leading-relaxed text-[#36534E]">
          문항과 결과가 실제 결혼 준비에 도움이 되고 오해를 만들지 않는지 확인하는 동안 참여를
          중단했어요.
        </p>

        <div
          className="mt-6 rounded-[16px] border border-[#C7D1C2] bg-[#F7F1E8] px-4 py-4 text-sm font-semibold leading-relaxed text-[#36534E]"
          role="status"
        >
          현재 이 화면에서는 답변을 받거나 저장하지 않습니다.
        </div>

        <Link
          href="/wedding"
          className="mt-8 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#36534E] px-7 text-sm font-semibold text-white shadow-[0_12px_26px_rgba(54,83,78,0.2)] transition-colors hover:bg-[#243832] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          웨딩한방으로 돌아가기
        </Link>
      </section>
    </main>
  );
}
