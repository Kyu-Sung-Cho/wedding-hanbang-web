import type { Metadata } from "next";
import Link from "next/link";

import { MANNERS_PARTS } from "@/lib/manners/data";
import MannersMobileHeader from "@/components/manners/MannersMobileHeader";

// 예절 안내 안에서 없는 파트를 열었을 때. 루트 404로 튕기면 이 화면의 헤더·푸터가
// 사라지고 "여기가 어디였는지"를 잃는다. 읽으러 온 사람에게는 목록으로 돌아가는
// 길이 다른 서비스 링크보다 먼저다.
export const metadata: Metadata = {
  title: "찾는 예절 안내가 없어요 — 웨딩한방",
  robots: { index: false, follow: false },
};

export default function MannersNotFound() {
  return (
    <>
    <MannersMobileHeader />
    <div className="mx-auto w-full max-w-[1220px] px-[18px] py-14 md:px-9 xl:px-16">
      <p className="text-[13px] font-semibold text-[var(--amora-rose-deep)]">404</p>
      <h1 className="planning-display mt-2 text-[26px] leading-snug text-[var(--amora-ink)]">
        찾는 예절 안내가 없어요
      </h1>
      <p className="mt-3 text-[14px] leading-[1.8] text-[var(--amora-soft)]">
        주소가 바뀌었거나 아직 쓰지 않은 주제일 수 있어요. 지금 있는 {MANNERS_PARTS.length}개는
        아래에서 볼 수 있어요.
      </p>
      <Link
        href="/wedding/manners"
        prefetch={false}
        className="mt-6 inline-flex min-h-11 items-center rounded-[11px] border border-[var(--color-paper-outline)] bg-white px-5 py-2.5 text-[13.5px] font-semibold text-[var(--amora-ink)]"
      >
        예절 안내 전체 보기
      </Link>
    </div>
    </>
  );
}
