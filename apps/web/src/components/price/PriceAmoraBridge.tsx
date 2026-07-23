import Link from "next/link";
import { ArrowRight, MessageCircleHeart } from "lucide-react";

// 가격을 확인한 직후가 "그래서 뭐부터 하지?"가 가장 커지는 순간이다.
// 그 순간을 아모라 체험(가입 없음)으로 잇는 절제된 브릿지 — 과장·재촉 문구 금지.
export function PriceAmoraBridge() {
  return (
    <section
      aria-label="아모라 체험 안내"
      className="mt-10 rounded-[24px] border border-[#36534E]/15 bg-[#36534E]/[0.06] px-5 py-8 text-center sm:px-8"
    >
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-white text-[#36534E] shadow-[0_8px_20px_rgba(36,56,50,0.12)]">
        <MessageCircleHeart aria-hidden="true" className="size-6" />
      </span>
      <h2 className="mt-4 text-lg font-bold tracking-[-0.02em] text-[#243832]">
        가격은 확인했는데, 뭐부터 해야 할지 막막하다면
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#243832]/70">
        AI 웨딩 플래너 아모라가 어떻게 돕는지 가입 없이 미리 볼 수 있어요.
      </p>
      <Link
        href="/demo"
        className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#36534E] px-6 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(36,56,50,0.16)] hover:bg-[#2B423E] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B89785]"
      >
        아모라 미리 보기
        <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    </section>
  );
}
