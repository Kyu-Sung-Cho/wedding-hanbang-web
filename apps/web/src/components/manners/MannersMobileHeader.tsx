import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { weddingLinkProps } from "@/lib/weddingPaths";
import HiddenInsideMobileApp from "@/components/common/HiddenInsideMobileApp";

export default function MannersMobileHeader({ index = false }: { index?: boolean }) {
  // 앱 웹뷰에서는 내린다. 앱 머리가 뒤로 가기와 제목(「결혼 예절 안내」)을 이미 갖고 있고,
  // 목록의 「홈」은 로그인 필요 경로(라운지)라 세션 없는 웹뷰에서는 웹 로그인 화면이 됐다.
  return (
    <HiddenInsideMobileApp>
    <header className="flex h-16 items-center gap-1.5 border-b border-[var(--amora-line)] px-[18px] md:hidden">
      {/* 목록에서의 "홈"은 데스크톱 사이드바 로고(`app/manners/layout.tsx`)와 같은 라운지다. */}
      <Link {...weddingLinkProps(index ? "/lounge" : "/manners")} prefetch={false} aria-label={index ? "웨딩한방 홈으로 이동" : "예절 가이드 전체 보기"} className="-ml-3 inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] text-[var(--amora-ink)]">
        <ChevronLeft aria-hidden className="size-[21px]" />
      </Link>
      <span className="text-[15px] font-semibold text-[var(--amora-ink)]">결혼 예절 가이드</span>
    </header>
    </HiddenInsideMobileApp>
  );
}
