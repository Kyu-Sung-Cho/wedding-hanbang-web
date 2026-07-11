import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "잠시 점검 중 | 웨딩한방",
  robots: { index: false, follow: false },
};

export default function MaintenancePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f7f4ee] px-5 py-12 text-[#25332d]">
      <section className="w-full max-w-md rounded-[2rem] border border-[#d9ded8] bg-white/95 px-7 py-10 text-center shadow-[0_24px_70px_rgba(48,66,58,0.10)] sm:px-10">
        <div
          aria-hidden="true"
          className="mx-auto mb-7 flex h-14 w-14 items-center justify-center rounded-full bg-[#e8efe9] text-2xl"
        >
          ♡
        </div>
        <p className="text-sm font-semibold tracking-[0.18em] text-[#6f8178]">
          WEDDING HANBANG
        </p>
        <h1 className="mt-4 text-balance text-2xl font-bold leading-snug sm:text-3xl">
          더 안정적인 아모라를 준비하고 있어요
        </h1>
        <p className="mt-4 text-pretty text-[15px] leading-7 text-[#5f6d66]">
          대화와 웨딩 준비 기록을 안전하게 지키면서 업데이트 중입니다.
          잠시 후 다시 확인해 주세요.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-[#3e5d4f] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#324d41] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3e5d4f]"
        >
          다시 확인하기
        </Link>
        <p className="mt-5 text-xs leading-5 text-[#89958f]">
          점검 중에는 새 메시지와 변경 사항이 저장되지 않습니다.
        </p>
      </section>
    </main>
  );
}
