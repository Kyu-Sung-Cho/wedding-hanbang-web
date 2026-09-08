import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { weddingLinkProps } from "@/lib/weddingPaths";

export default function MannersMobileHeader({ index = false }: { index?: boolean }) {
  return (
    <header className="flex h-16 items-center gap-1.5 border-b border-[var(--amora-line)] px-[18px] md:hidden">
      <Link {...weddingLinkProps(index ? "" : "/manners")} prefetch={false} aria-label={index ? "웨딩한방 홈으로 이동" : "예절 가이드 전체 보기"} className="-ml-3 inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] text-[var(--amora-ink)]">
        <ChevronLeft aria-hidden className="size-[21px]" />
      </Link>
      <span className="text-[15px] font-semibold text-[var(--amora-ink)]">결혼 예절 가이드</span>
    </header>
  );
}
