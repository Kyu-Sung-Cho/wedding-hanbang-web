import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { START_COPY } from "@hanbang/shared/invitation";

import { START_PHOTO } from "@/components/landing/redesign/StartScreen";
import AmoraOrb from "@/components/ui/AmoraOrb";

/**
 * 로그인·가입·동의·비밀번호 재설정이 함께 쓰는 틀. 2026-11-20 파운더 원문: "근데 로그인 페이지도  다 바궈야할듯해".
 *
 * 디자인 시안에는 로그인 화면이 없어서, 바로 앞 화면인 시작 화면(`StartScreen`, 시안 `Main.dc`)의 모양을 잇는다.
 * 값은 시작 화면과 같은 곳에서 읽는다(사진 `START_PHOTO`, 문구 `START_COPY`, 색·글꼴 `inv-*`).
 *   - 바탕: 보케 사진을 화면에 붙여 둔다(`fixed`). 가입 폼처럼 긴 화면은 카드만 내려 본다.
 *   - 위: amora(Cormorant 이탤릭 500, 40px, 흰색) 와 한 줄(12px, 흰색 90%). 누르면 서비스 소개로 간다.
 *   - 가운데: 오브. 시작 화면보다 작게 두고, 화면이 짧으면 사이 여백이 먼저 줄어든다.
 *   - 아래: 흰색 86%·24px 흐림·반경 36px 유리 카드. 안쪽 위 32·옆 26·아래 22px, 사이 14px.
 *     넓은 화면에서는 너비 440px 로 가운데에 두고 아래 여백을 40px 로 둔다(시작 화면과 같다).
 */
export default function InvitationAuthShell({
  children,
  labelledBy,
}: {
  children: ReactNode;
  /** 카드 안 제목의 id. 카드가 무엇을 하는 칸인지 읽어 준다. */
  labelledBy?: string;
}) {
  return (
    <main className="relative min-h-[100svh] bg-inv-blush font-inv-sans leading-[normal] text-inv-ink">
      <div aria-hidden="true" className="fixed inset-0 overflow-hidden">
        <Image src={START_PHOTO} alt="" fill sizes="100vw" priority className="object-cover" />
      </div>

      <div className="relative mx-auto flex min-h-[100svh] w-full max-w-[440px] flex-col px-3 pb-3 pt-12 md:pb-10 md:pt-16">
        <Link
          href="/landing"
          aria-label="웨딩한방 서비스 소개"
          className="mx-auto flex flex-col items-center gap-1 rounded-[20px] px-4 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inv-white"
        >
          <span className="font-inv-numeral text-[40px] font-medium italic leading-[normal] tracking-[0.01em] text-inv-white">
            {START_COPY.wordmark}
          </span>
          <span className="text-[12px] leading-[normal] tracking-[0.08em] text-inv-white/90">
            {START_COPY.tagline}
          </span>
        </Link>

        <div className="flex min-h-[112px] flex-1 items-center justify-center py-6">
          <AmoraOrb size={88} mood="calm" decorative />
        </div>

        <section
          aria-labelledby={labelledBy}
          className="flex flex-col gap-3.5 rounded-[36px] bg-inv-white/86 px-[26px] pb-[22px] pt-8 backdrop-blur-[24px]"
        >
          {children}
        </section>
      </div>
    </main>
  );
}
