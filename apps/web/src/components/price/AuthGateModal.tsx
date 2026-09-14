"use client";

import Link from "next/link";
import { X } from "lucide-react";

import { useAccessibleModal } from "@/hooks/useAccessibleModal";
import { getSameOriginRedirectPath } from "@/lib/auth/safeRedirect";

type AuthGateModalProps = {
  open: boolean;
  redirectPath: string;
  onClose(): void;
};

export function AuthGateModal({ open, redirectPath, onClose }: AuthGateModalProps) {
  const dialogRef = useAccessibleModal({ open, onClose });

  if (!open) return null;
  const safeRedirect = getSameOriginRedirectPath(
    redirectPath,
    "https://internal.hanbang.invalid",
    "/price/studio",
  );

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-[var(--hb-primary-hover)]/50 p-3 backdrop-blur-[2px] sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="relative w-full max-w-sm rounded-[6px] bg-[var(--hb-surface-page)] p-6 shadow-2xl sm:p-7"
        role="dialog"
        aria-modal="true"
        aria-labelledby="price-auth-gate-title"
        aria-describedby="price-auth-gate-description"
        tabIndex={-1}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="absolute right-3 top-3 grid size-11 place-items-center rounded-full text-[var(--hb-text-strong)] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B89785]"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
        <h2 id="price-auth-gate-title" className="pr-10 text-xl font-bold tracking-normal text-[var(--hb-text-strong)]">
          저장하려면 로그인이 필요해요
        </h2>
        <p id="price-auth-gate-description" className="mt-3 text-sm leading-6 text-[var(--hb-text-strong)]/75">
          찜과 조합을 계정에 저장해 어느 기기에서든 다시 볼 수 있어요.
        </p>
        <Link
          href={`/login?redirect=${encodeURIComponent(safeRedirect)}`}
          className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-[6px] bg-[var(--hb-action)] px-5 text-sm font-bold text-white hover:bg-[var(--hb-action-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B89785]"
        >
          로그인하고 계속하기
        </Link>
      </div>
    </div>
  );
}
