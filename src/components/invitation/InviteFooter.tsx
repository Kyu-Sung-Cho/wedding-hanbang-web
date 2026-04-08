"use client";

import type { Invitation } from "@/types/invitation.types";
import { Heart } from "lucide-react";

interface Props {
  invitation: Invitation;
  colors: string[];
}

export default function InviteFooter({ invitation, colors }: Props) {
  const handleShare = async () => {
    const url = window.location.href;
    const title = `${invitation.groom_name} ♥ ${invitation.bride_name} 결혼합니다`;

    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        // 공유 취소
      }
    } else {
      navigator.clipboard.writeText(url);
    }
  };

  return (
    <section className="py-12 px-6 text-center">
      <button
        onClick={handleShare}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-[21px] font-medium text-white transition-colors mb-6"
        style={{ background: colors[0] }}
      >
        <Heart className="w-4 h-4" />
        청첩장 공유하기
      </button>

      <p className="text-[21px] opacity-20 mt-4">
        Powered by 웨딩한방
      </p>
    </section>
  );
}
