import type { Metadata } from "next";
import Link from "next/link";

import { MANNERS_PARTS } from "@/lib/manners/data";

// 예절 안내 안에서 없는 파트를 열었을 때. 루트 404로 튕기면 이 화면의 헤더·푸터가
// 사라지고 "여기가 어디였는지"를 잃는다. 읽으러 온 사람에게는 목록으로 돌아가는
// 길이 다른 서비스 링크보다 먼저다.
export const metadata: Metadata = {
  title: "찾는 예절 안내가 없어요 — 웨딩한방",
  robots: { index: false, follow: false },
};

export default function MannersNotFound() {
  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-14 sm:px-6">
      <p className="text-[13px] font-semibold text-[#8F5150]">404</p>
      <h1 className="mt-2 font-serif-kr text-[26px] font-normal leading-snug text-[#1b1c1c]">
        찾는 예절 안내가 없어요
      </h1>
      <p className="mt-3 text-[14px] leading-[1.8] text-[#3d4a45]">
        주소가 바뀌었거나 아직 쓰지 않은 주제일 수 있어요. 지금 있는 {MANNERS_PARTS.length}개는
        아래에서 볼 수 있어요.
      </p>
      <Link
        href="/wedding/manners"
        prefetch={false}
        className="mt-6 inline-flex rounded-[6px] border border-[var(--hb-primary)]/15 bg-white px-5 py-2.5 text-[13.5px] font-semibold text-[var(--hb-text-strong)] transition-colors hover:border-[#8F5150]/45"
      >
        예절 안내 전체 보기
      </Link>
    </div>
  );
}
