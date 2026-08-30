"use client";

import { useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";

interface ShareButtonsProps {
  shareUrl: string;
  shareTitle: string;
  shareText: string;
}

// 카톡 공유 진단 결과 페이지 공유 버튼.
// 모바일 → Web Share API (카톡/메시지/링크 등 시스템 시트)
// 데스크톱 → URL 클립보드 복사
export default function ShareButtons({ shareUrl, shareTitle, shareText }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);

  const canNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  const handleNativeShare = async () => {
    try {
      await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
    } catch {
      // 사용자가 취소했거나 실패 — 클립보드 복사로 폴백
      handleCopy();
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 클립보드 권한 거부 — prompt로 폴백
      window.prompt("복사할 링크입니다", `${shareText}\n${shareUrl}`);
    }
  };

  return (
    <div className="mt-6 flex flex-col gap-2 sm:flex-row">
      {canNativeShare && (
        <button
          type="button"
          onClick={handleNativeShare}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--hb-hairline)] bg-white px-4 py-3 text-sm font-medium text-[var(--hb-accent-hover)] transition-colors hover:bg-[#fffdfb]"
        >
          <Share2 className="h-4 w-4" />
          카톡·메시지로 공유
        </button>
      )}
      <button
        type="button"
        onClick={handleCopy}
        className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#e4e2e1] bg-white px-4 py-3 text-sm font-medium text-[var(--hb-text-strong)] transition-colors hover:bg-[var(--hb-surface-hover)]"
      >
        {copied ? (
          <>
            <Check className="h-4 w-4 text-emerald-600" />
            링크 복사됨
          </>
        ) : (
          <>
            <Copy className="h-4 w-4" />
            링크 복사
          </>
        )}
      </button>
    </div>
  );
}
