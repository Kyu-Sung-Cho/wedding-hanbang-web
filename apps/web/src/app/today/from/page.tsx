import type { Metadata } from "next";
import Link from "next/link";

import { findCard } from "@/lib/todayOneLine/deck";
import { CardFace } from "../TodayClient";

/**
 * OG는 **어느 카드인지 드러내지 않는다.** 링크가 카톡·메신저에 뿌려질 때 미리보기로
 * 상대가 고른 문장이 노출되면, 본인이 열기 전에 제3자가 먼저 보게 된다.
 */
export const metadata: Metadata = {
  title: "받은 한 마디 | 웨딩한방",
  description: "누군가 오늘 한 마디를 건넸어요.",
  robots: { index: false, follow: false },
  openGraph: { title: "받은 한 마디 | 웨딩한방", description: "누군가 오늘 한 마디를 건넸어요." },
};

/**
 * 링크로 받은 한 장.
 *
 * 「주는 카드」가 성립하려면 **받는 쪽이 로그인 없이 카드 한 장만 보고 끝나는 경로**가
 * 있어야 한다. 없으면 비대칭을 뒤집는다는 이 제품의 핵심 장치가 문구로만 남는다.
 * 여기서는 아무것도 묻지 않고 아무것도 저장하지 않는다.
 */
export default async function ReceivedCardPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const card = findCard(c ?? "");

  return (
    <main className="min-h-dvh bg-[#FBF8F2] px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-[560px]">
        {card ? (
          <>
            {/*
              이 카드는 **보낸 사람이 듣고 싶은 질문**이다. 「누군가」·「그쪽」처럼 거리를 두는
              말을 쓰면 약혼자 사이에 오는 카드의 온도가 아니게 된다.
            */}
            <p className="mx-auto max-w-[340px] text-[14px] font-medium leading-[1.7] text-[#36534E]">
              오늘 이 말을 <b className="font-semibold text-[#243832]">먼저 물어봐 주면</b>{" "}
              좋겠대요.
              <br />
              늘 결혼 얘기를 먼저 꺼내던 쪽이 보낸 한 장이에요.
            </p>
            <div className="mt-5">
              <CardFace card={card} />
            </div>
            <div className="mx-auto mt-6 w-full max-w-[340px]">
              <p className="text-[13px] font-medium leading-[1.7] text-[#8F6662]">
                답을 보내는 곳은 없어요. 읽고 그대로 물어보면 돼요.
              </p>
              <Link
                href="/today"
                className="mt-5 inline-flex min-h-[48px] w-full items-center justify-center rounded-full border border-[#C7D1C2] bg-white px-5 text-[14px] font-semibold text-[#36534E] transition-colors hover:bg-[#F7F1E8]"
              >
                나도 한 장 골라보기
              </Link>
            </div>
          </>
        ) : (
          <div className="mx-auto max-w-[340px] rounded-[20px] border border-[#EFE4D7] bg-white px-6 py-8">
            <h1 className="text-[20px] font-semibold leading-[1.4] text-[#243832]">
              카드를 찾지 못했어요
            </h1>
            <p className="mt-3 text-[14px] font-medium leading-[1.7] text-[#36534E]">
              링크가 잘린 것 같아요. 보낸 사람에게 다시 받아보시거나, 직접 한 장 골라보셔도
              괜찮아요.
            </p>
            <Link
              href="/today"
              className="mt-6 inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-[#36534E] px-6 text-[15px] font-semibold text-white transition-colors hover:bg-[#243832]"
            >
              한 장 골라보기
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
