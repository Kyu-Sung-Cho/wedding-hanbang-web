import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { EXAMPLE_COPY } from "@hanbang/shared/invitation";

/**
 * 예시 커플 "민지와 준호" 화면들. 로그인 없이 보고, 서버를 부르지 않는다.
 *
 * 업체 이름과 가격, 사진이 예시라서(아티팩트 메모) 검색에 뜨지 않게 하고(robots 목록에도 있다),
 * 모든 화면 맨 위에 예시라는 줄을 작게 둔다.
 */
export const metadata: Metadata = {
  title: {
    default: "예시 커플 | 웨딩한방",
    template: "%s | 예시 커플 | 웨딩한방",
  },
  robots: { index: false, follow: false },
};

/**
 * 화면 높이를 창 높이에 묶는다. 아티팩트의 폰 화면은 높이가 정해진 틀이라, 가운데 칸만 스크롤하고
 * 아래 행동은 틀 바닥에 붙는다. 예시 줄은 그 위의 한 줄이다.
 */
export default function ExampleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col bg-inv-white font-inv-sans leading-[normal] text-inv-ink">
      <p className="shrink-0 px-4 py-2 text-center text-[12px] leading-[1.5] text-inv-muted" data-example-banner>
        {EXAMPLE_COPY.banner}{" "}
        <Link
          href="/"
          className="whitespace-nowrap underline underline-offset-2 hover:text-inv-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)]"
        >
          {EXAMPLE_COPY.leave}
        </Link>
      </p>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
