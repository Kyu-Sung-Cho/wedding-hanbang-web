import type { Metadata } from "next";
import Link from "next/link";

import { ArrowRight, ShieldCheck } from "lucide-react";

import { weddingPath } from "@/lib/weddingPaths";

export const metadata: Metadata = {
  title: "공개 견적 링크 종료 — 웨딩한방",
  description: "견적 개인정보 보호를 위해 과거 공개 결과 링크 제공을 종료했습니다.",
  robots: { index: false, follow: false },
};

export default function RetiredPublicQuotePage() {
  return (
    <main className="min-h-dvh bg-[var(--hb-surface-page)] px-5 py-12">
      <section className="mx-auto max-w-[560px] border border-[#E2D3C8] bg-white px-6 py-8 sm:px-8">
        <ShieldCheck aria-hidden="true" className="h-7 w-7 text-[var(--hb-text-strong)]" />
        <h1 className="mt-5 text-2xl font-semibold leading-[1.4] text-[var(--hb-text-strong)]">
          공개 견적 링크 제공을 종료했어요
        </h1>
        <p className="mt-4 text-sm font-medium leading-7 text-[var(--hb-text-body)]">
          견적 금액과 점검 결과가 별도 공개 동의 없이 링크로 열리던 방식을 중단했습니다.
          새 견적 점검은 입력 내용을 별도 서버 DB에 저장하지 않고 결과만 바로 보여드립니다.
        </p>
        <Link
          href={weddingPath("/quote-check")}
          className="mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 bg-[var(--hb-primary)] px-5 text-sm font-semibold text-white hover:bg-[var(--hb-primary)]"
        >
          저장 없이 견적 점검하기
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </section>
    </main>
  );
}
