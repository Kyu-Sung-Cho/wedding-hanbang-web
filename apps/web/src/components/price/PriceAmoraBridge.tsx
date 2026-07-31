import Link from "next/link";
import { MessageCircleHeart } from "lucide-react";

import { StartDemoButton } from "@/components/demo/StartDemoButton";

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
      <h2 className="mt-4 text-lg font-bold tracking-normal text-[#243832]">
        가격은 확인했는데, 뭐부터 해야 할지 막막하다면
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#243832]/70">
        AI 웨딩 플래너 아모라에게 가입 없이 바로 물어볼 수 있어요.
        체험 화면의 이름·예산은 샘플이고, 나눈 이야기는 저장되지 않아요.
      </p>
      <StartDemoButton className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#36534E] px-6 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(36,56,50,0.16)] hover:bg-[#2B423E] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B89785]" />
      <p className="mt-3 text-[13px]">
        <Link href="/demo" prefetch={false} className="font-semibold text-[#36534E] underline underline-offset-4">
          아모라가 무엇을 하고 무엇을 하지 않는지 먼저 보기
        </Link>
      </p>
    </section>
  );
}
